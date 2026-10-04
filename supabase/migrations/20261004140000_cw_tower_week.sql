-- Башня: пожизненный рекорд профиля отделён от реально сыгранных этажей недели.
-- Legacy RPC-аргументы остаются совместимыми: новый необязательный p_tower_week = 0.
do $$ begin
  if to_regprocedure('public.cw_sync_player_base(bigint,integer,integer,bigint,integer,bigint,text,jsonb)') is null then
    alter function public.cw_sync_player(bigint,integer,integer,bigint,integer,bigint,text,jsonb) rename to cw_sync_player_base;
  end if;
end $$;

create or replace function public.cw_sync_player(
  p_tg_id bigint, p_chapter integer, p_stage integer, p_power bigint, p_tower integer,
  p_mvp bigint, p_week text, p_notify jsonb default '{}'::jsonb, p_tower_week integer default 0
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  -- Базовая транзакция сохраняет блокировку игрока до выхода из wrapper. Нулевой p_tower не создаёт
  -- недельную запись из пожизненного рекорда. Referral/MVP/notify сохраняют прежнюю атомарность.
  result := public.cw_sync_player_base(p_tg_id, p_chapter, p_stage, p_power, 0, p_mvp, p_week, p_notify);
  if result ? 'error' then return result; end if;
  update public.cw_player set tower_best = greatest(tower_best, p_tower) where tg_id = p_tg_id;
  if p_tower_week > 0 then
    insert into public.cw_score (week, board, tg_id, value) values (p_week, 'tower', p_tg_id, p_tower_week)
    on conflict (week, board, tg_id) do update set value = greatest(cw_score.value, excluded.value), updated_at = now();
  end if;
  return result;
end $$;

-- Повторная baseline/reliability-миграция могла вернуть прежний overload. Убираем только функцию,
-- строки игроков/забегов/рейтингов сохраняются. 8 аргументов разрешаются новым RPC с default.
drop function if exists public.cw_sync_player(bigint,integer,integer,bigint,integer,bigint,text,jsonb);
revoke all on function public.cw_sync_player(bigint,integer,integer,bigint,integer,bigint,text,jsonb,integer) from public, anon, authenticated;
grant execute on function public.cw_sync_player(bigint,integer,integer,bigint,integer,bigint,text,jsonb,integer) to service_role;
