-- Chronoworld: бот @Chronoworldbot и уведомления (docs/design/online.md, «Бот и уведомления»).
-- Применять ДО развёртывания новой cw-api (она пишет новые колонки). Повторное применение безопасно.
-- Секретов здесь нет: ключ cron кладётся отдельно —
--   insert into public.cw_config (key, value) values ('cron_key', '<случайная строка>')
--   on conflict (key) do update set value = excluded.value;

-- 1. Колонки игрока для уведомлений.
alter table public.cw_player
  add column if not exists notify boolean not null default true,         -- игрок не выключал (/notify)
  add column if not exists bot_started boolean not null default false,   -- нажал Start в боте или разрешил писать (allows_write_to_pm)
  add column if not exists blocked_at timestamptz,                       -- бот получил 403 (заблокирован): notify выключили мы
  add column if not exists tz_offset integer,                            -- как Date.getTimezoneOffset(): UTC − местное, минуты
  add column if not exists chest_full_at timestamptz,                    -- когда сундук трофеев заполнится (от клиента)
  add column if not exists exp_done_at timestamptz,                      -- когда вернётся ближайшая экспедиция (от клиента)
  add column if not exists gift_at timestamptz,                          -- друг прислал колокольчик, уведомление ещё не ушло
  add column if not exists gift_notified_day date,                       -- местный день последнего уведомления о колокольчике
  add column if not exists last_notified_at timestamptz,
  add column if not exists notified_today integer not null default 0,
  add column if not exists notified_day date,                            -- местный день, к которому относится notified_today
  add column if not exists comeback_stage integer not null default 0,    -- сколько «возвращайся» отправлено с последнего входа (0…2)
  add column if not exists week_notified text;                           -- ISO-неделя последнего «итоги недели»

-- Для cw-cron: выборка тех, кому вообще можно писать.
create index if not exists cw_player_notify_idx on public.cw_player (tg_id) where notify and bot_started;

-- 2. Кто нажал Start в боте (в том числе раньше, чем открыл игру — тогда строки cw_player ещё нет).
create table if not exists public.cw_bot_start (
  tg_id bigint primary key,
  started_at timestamptz not null default now()
);
alter table public.cw_bot_start enable row level security;

-- 3. Служебные значения (cron_key). RLS без политик: читает только service role (функции).
create table if not exists public.cw_config (
  key text primary key,
  value text not null
);
alter table public.cw_config enable row level security;

-- 4. Расписание: каждые 15 минут дёргать cw-cron (pg_cron + pg_net). Нет cron_key — запрос не уходит.
select cron.unschedule('cw-cron') where exists (select 1 from cron.job where jobname = 'cw-cron');
select cron.schedule(
  'cw-cron',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://ajltzwomvyvntvtjnrrf.supabase.co/functions/v1/cw-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-CW-Cron', (select value from public.cw_config where key = 'cron_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  where exists (select 1 from public.cw_config where key = 'cron_key');
  $$
);
