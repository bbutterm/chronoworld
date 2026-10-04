-- Полная исходная схема Chronoworld. CREATE IF NOT EXISTS сохраняет существующих игроков.
-- Доступ к таблицам только у service_role; Telegram-подпись проверяется в Edge Function.
create table if not exists public.cw_player (
  tg_id bigint primary key,
  first_name text not null default '',
  username text,
  lang text,
  chapter integer not null default 0,
  stage integer not null default 0,
  power bigint not null default 0,
  tower_best integer not null default 0,
  ref_by bigint,
  ref_rewarded boolean not null default false,
  ref_bonus_pending integer not null default 0,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create table if not exists public.cw_save (
  tg_id bigint primary key,
  data jsonb not null,
  save_version integer not null,
  chapter integer not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists public.cw_friend (
  a bigint not null,
  b bigint not null,
  primary key (a, b),
  check (a <> b)
);
create table if not exists public.cw_score (
  week text not null,
  board text not null,
  tg_id bigint not null,
  value bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (week, board, tg_id)
);
create table if not exists public.cw_gift (
  day date not null,
  from_id bigint not null,
  to_id bigint not null,
  claimed boolean not null default false,
  claimed_on date,
  primary key (day, from_id, to_id),
  check (from_id <> to_id)
);
create index if not exists cw_player_power_idx on public.cw_player (power desc, tg_id);
create index if not exists cw_player_progress_idx on public.cw_player (chapter desc, stage desc, power desc, tg_id);
create index if not exists cw_score_board_idx on public.cw_score (week, board, value desc, tg_id);
create index if not exists cw_gift_waiting_idx on public.cw_gift (to_id, day, from_id) where not claimed;
create index if not exists cw_gift_claimed_idx on public.cw_gift (to_id, claimed_on) where claimed;
alter table public.cw_player enable row level security;
alter table public.cw_save enable row level security;
alter table public.cw_friend enable row level security;
alter table public.cw_score enable row level security;
alter table public.cw_gift enable row level security;
revoke all on public.cw_player, public.cw_save, public.cw_friend, public.cw_score, public.cw_gift from anon, authenticated;
grant all on public.cw_player, public.cw_save, public.cw_friend, public.cw_score, public.cw_gift to service_role;
