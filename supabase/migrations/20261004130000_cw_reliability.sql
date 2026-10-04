-- Онлайн-протокол 2: серверная CAS-ревизия и долговечная доставка наград.
-- save_version = формат игры; write_revision = последовательность принятых сервером записей.
alter table public.cw_save
  add column if not exists write_revision bigint not null default 1,
  add column if not exists last_write_id uuid;

create table if not exists public.cw_reward_grant (
  id uuid primary key default gen_random_uuid(),
  tg_id bigint not null,
  kind text not null check (kind in ('gift', 'ref', 'ref_welcome')),
  units integer not null check (units > 0),
  gems bigint not null check (gems > 0),
  source_key text unique,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);
create index if not exists cw_reward_pending_idx on public.cw_reward_grant (tg_id, created_at, id) where acknowledged_at is null;
alter table public.cw_reward_grant enable row level security;
revoke all on public.cw_reward_grant from anon, authenticated;
grant all on public.cw_reward_grant to service_role;

-- Старое письмо узнаётся клиентом по online_ref_welcome; уже получивший игрок не получит второй бонус.
-- Если ответ старого sync потерялся, этот grant восстановит ещё не доставленное письмо.
insert into public.cw_reward_grant (tg_id, kind, units, gems, source_key)
select tg_id, 'ref_welcome', 1, 100, 'ref_welcome:' || tg_id
from public.cw_player where ref_by is not null and ref_rewarded
on conflict (source_key) do nothing;

create or replace function public.cw_save_put(
  p_tg_id bigint, p_data jsonb, p_save_version integer, p_chapter integer,
  p_expected_revision bigint, p_write_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_save public.cw_save%rowtype;
  next_revision bigint;
begin
  -- Лок на игроке сериализует создание отсутствующего save и claim; SELECT отсутствующей строки не даёт лок.
  perform 1 from public.cw_player where tg_id = p_tg_id for update;
  if not found then return jsonb_build_object('error', 'no_player'); end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 524288 then
    return jsonb_build_object('error', 'save_size');
  end if;
  select * into current_save from public.cw_save where tg_id = p_tg_id;
  if found then
    if p_save_version < current_save.save_version then
      return jsonb_build_object('error', 'upgrade_required', 'minimumSaveVersion', current_save.save_version);
    end if;
    -- Повтор после потерянного ответа: тот же writeId + тот же снимок уже успешно записаны.
    if p_write_id is not null and current_save.last_write_id = p_write_id and current_save.data = p_data
      and current_save.save_version = p_save_version and current_save.chapter = p_chapter then
      return jsonb_build_object('ok', true, 'writeRevision', current_save.write_revision);
    end if;
    if p_expected_revision is null then
      return jsonb_build_object('error', 'upgrade_required', 'writeRevision', current_save.write_revision);
    end if;
    if p_expected_revision <> current_save.write_revision then
      return jsonb_build_object('error', 'save_conflict', 'cloudSave', jsonb_build_object(
        'chapter', current_save.chapter, 'save_version', current_save.save_version,
        'updated_at', current_save.updated_at, 'write_revision', current_save.write_revision));
    end if;
    next_revision := current_save.write_revision + 1;
    -- После подтверждённой доставки нельзя случайно загрузить старый снимок, потеряв награды.
    -- IDs сохраняются даже после удаления письма/траты гемов.
    if exists (
      select 1 from public.cw_reward_grant g where g.tg_id = p_tg_id and g.acknowledged_at is not null
      and not coalesce(p_data #> '{online,appliedGrantIds}', '[]'::jsonb) ? g.id::text
    ) then return jsonb_build_object('error', 'reward_history_conflict'); end if;
  else
    if coalesce(p_expected_revision, 0) <> 0 then return jsonb_build_object('error', 'save_conflict'); end if;
    next_revision := 1;
  end if;
  insert into public.cw_save (tg_id, data, save_version, chapter, updated_at, write_revision, last_write_id)
  values (p_tg_id, p_data, p_save_version, p_chapter, now(), next_revision, p_write_id)
  on conflict (tg_id) do update set data = excluded.data, save_version = excluded.save_version,
    chapter = excluded.chapter, updated_at = excluded.updated_at,
    write_revision = excluded.write_revision, last_write_id = excluded.last_write_id;
  -- Подтверждение только в той транзакции, где сохранён снимок с наградой. До неё grant выдаётся повторно.
  update public.cw_reward_grant set acknowledged_at = now()
  where tg_id = p_tg_id and acknowledged_at is null
    and coalesce(p_data #> '{online,appliedGrantIds}', '[]'::jsonb) ? id::text;
  return jsonb_build_object('ok', true, 'writeRevision', next_revision);
end $$;

-- История подтверждённых выдач читается из журнала, даже если JSON старого снимка повреждён.
-- JSON aggregate не обрезается стандартным PostgREST лимитом 1000 строк.
create or replace function public.cw_save_get(p_tg_id bigint)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('ok', true, 'save', (
    select to_jsonb(s) || jsonb_build_object('applied_grant_ids', (
      select coalesce(jsonb_agg(g.id order by g.created_at, g.id), '[]'::jsonb)
      from public.cw_reward_grant g where g.tg_id = p_tg_id and g.acknowledged_at is not null
    )) from public.cw_save s where s.tg_id = p_tg_id
  ));
$$;

create or replace function public.cw_claim_rewards(p_tg_id bigint, p_kind text default 'all')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  claim_day date := (now() at time zone 'UTC')::date;
  room integer;
  ref_pending integer;
  picked public.cw_gift%rowtype;
  grants jsonb;
begin
  if p_kind not in ('all', 'gift', 'ref') then return jsonb_build_object('error', 'bad_kind'); end if;
  select ref_bonus_pending into ref_pending from public.cw_player where tg_id = p_tg_id for update;
  if not found then return jsonb_build_object('error', 'no_player'); end if;
  if p_kind in ('all', 'gift') then
    select greatest(0, 5 - count(*)::integer) into room from public.cw_gift where to_id = p_tg_id and claimed_on = claim_day;
    for picked in select * from public.cw_gift where to_id = p_tg_id and not claimed
      order by day, from_id limit room for update loop
      insert into public.cw_reward_grant (tg_id, kind, units, gems, source_key)
      values (p_tg_id, 'gift', 1, 20, 'gift:' || picked.day || ':' || picked.from_id || ':' || p_tg_id)
      on conflict (source_key) do nothing;
      update public.cw_gift set claimed = true, claimed_on = claim_day
      where day = picked.day and from_id = picked.from_id and to_id = p_tg_id;
    end loop;
  end if;
  if p_kind in ('all', 'ref') and ref_pending > 0 then
    insert into public.cw_reward_grant (tg_id, kind, units, gems) values (p_tg_id, 'ref', ref_pending, 200::bigint * ref_pending);
    update public.cw_player set ref_bonus_pending = 0 where tg_id = p_tg_id;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'units', units, 'gems', gems) order by created_at, id), '[]'::jsonb)
  into grants from public.cw_reward_grant where tg_id = p_tg_id and acknowledged_at is null
    and (p_kind = 'all' or kind = p_kind or (p_kind = 'ref' and kind = 'ref_welcome'));
  return jsonb_build_object('ok', true, 'grants', grants);
end $$;

create or replace function public.cw_sync_player(
  p_tg_id bigint, p_chapter integer, p_stage integer, p_power bigint, p_tower integer,
  p_mvp bigint, p_week text, p_notify jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  player public.cw_player%rowtype;
  rewarded boolean := false;
begin
  select * into player from public.cw_player where tg_id = p_tg_id for update;
  if not found then return jsonb_build_object('error', 'no_player'); end if;
  update public.cw_player set
    chapter = greatest(chapter, p_chapter),
    stage = case when p_chapter > chapter then p_stage when p_chapter = chapter then greatest(stage, p_stage) else stage end,
    power = greatest(power, p_power), tower_best = greatest(tower_best, p_tower), last_seen = now(), comeback_stage = 0,
    tz_offset = case when p_notify ? 'tz_offset' then (p_notify->>'tz_offset')::integer else tz_offset end,
    chest_full_at = case when p_notify ? 'chest_full_at' then (p_notify->>'chest_full_at')::timestamptz else chest_full_at end,
    exp_done_at = case when p_notify ? 'exp_done_at' then (p_notify->>'exp_done_at')::timestamptz else exp_done_at end
  where tg_id = p_tg_id;
  if player.ref_by is not null and not player.ref_rewarded and greatest(player.chapter, p_chapter) >= 2 then
    update public.cw_player set ref_rewarded = true where tg_id = p_tg_id;
    update public.cw_player set ref_bonus_pending = ref_bonus_pending + 1 where tg_id = player.ref_by;
    insert into public.cw_reward_grant (tg_id, kind, units, gems, source_key)
    values (p_tg_id, 'ref_welcome', 1, 100, 'ref_welcome:' || p_tg_id) on conflict (source_key) do nothing;
    rewarded := true;
  end if;
  -- Один UPSERT с GREATEST: медленный запрос не затирает более высокий результат параллельного запроса.
  if p_tower > 0 then
    insert into public.cw_score (week, board, tg_id, value) values (p_week, 'tower', p_tg_id, p_tower)
    on conflict (week, board, tg_id) do update set value = greatest(cw_score.value, excluded.value), updated_at = now();
  end if;
  if p_mvp > 0 then
    insert into public.cw_score (week, board, tg_id, value) values (p_week, 'mvp', p_tg_id, p_mvp)
    on conflict (week, board, tg_id) do update set value = greatest(cw_score.value, excluded.value), updated_at = now();
  end if;
  return jsonb_build_object('ok', true, 'refRewarded', rewarded);
end $$;

revoke all on function public.cw_save_put(bigint,jsonb,integer,integer,bigint,uuid) from public, anon, authenticated;
revoke all on function public.cw_save_get(bigint) from public, anon, authenticated;
revoke all on function public.cw_claim_rewards(bigint,text) from public, anon, authenticated;
revoke all on function public.cw_sync_player(bigint,integer,integer,bigint,integer,bigint,text,jsonb) from public, anon, authenticated;
grant execute on function public.cw_save_put(bigint,jsonb,integer,integer,bigint,uuid) to service_role;
grant execute on function public.cw_save_get(bigint) to service_role;
grant execute on function public.cw_claim_rewards(bigint,text) to service_role;
grant execute on function public.cw_sync_player(bigint,integer,integer,bigint,integer,bigint,text,jsonb) to service_role;
