// Chronoworld: уведомления в боте (docs/design/online.md, «Бот и уведомления»). verify_jwt выключен.
// Вызывает pg_cron каждые 15 минут: net.http_post с заголовком X-CW-Cron = cw_config.cron_key.
// Ненавязчиво: только тем, кто запустил бота и не выключил уведомления; не ночью (22–9 местного), не больше 2 в сутки,
// не чаще раза в 3 часа, не пока игрок в игре. Выбор — planNotice (../_shared/bot.ts, тесты в tests/online-bot.test.ts).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { localDay, noticeReply, noticeSeed, planNotice, prevWeek, safeEqual, sendErrorPatch, tzOf, type NotifyRow } from '../_shared/bot.ts';
import { tgCall } from '../_shared/telegram.ts';

const TOKEN = Deno.env.get('CHRONOWORLD_BOT_TOKEN') ?? '';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** За один проход не больше (Telegram: ~30 сообщений в секунду на бота — держимся далеко ниже). */
const MAX_SENDS = 200;
const COLS =
  'tg_id, first_name, notify, bot_started, tz_offset, last_seen, chest_full_at, exp_done_at, gift_at, gift_notified_day, last_notified_at, notified_today, notified_day, comeback_stage, week_notified';

async function lastWeekPlaces(now: number): Promise<Map<number, number>> {
  const week = prevWeek(now);
  const { data } = await db.from('cw_score').select('tg_id, value').eq('week', week).eq('board', 'tower').order('value', { ascending: false }).limit(10000);
  const out = new Map<number, number>();
  let place = 0;
  let prev = Number.NaN;
  (data ?? []).forEach((r, i) => {
    // Равные значения — одно место (как count(value > мой) + 1 в cw-api board).
    if (Number(r.value) !== prev) place = i + 1;
    prev = Number(r.value);
    out.set(Number(r.tg_id), place);
  });
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const { data: cfg } = await db.from('cw_config').select('value').eq('key', 'cron_key').maybeSingle();
  if (!cfg?.value || !safeEqual(req.headers.get('x-cw-cron'), String(cfg.value))) return json({ error: 'unauthorized' }, 401);
  if (!TOKEN) return json({ error: 'no_token' }, 500);

  const now = Date.now();
  const { data: rows, error } = await db.from('cw_player').select(COLS).eq('notify', true).eq('bot_started', true).limit(5000);
  if (error) return json({ error: 'db', detail: error.message }, 500);
  const places = await lastWeekPlaces(now);
  const stats = { players: rows?.length ?? 0, sent: 0, failed: 0, cleared: 0 };

  for (const p of (rows ?? []) as NotifyRow[]) {
    const id = Number(p.tg_id);
    const plan = planNotice(p, now, { lastWeekPlace: places.get(id) ?? null });
    if (Object.keys(plan.clear).length) {
      stats.cleared++;
      await db.from('cw_player').update(plan.clear).eq('tg_id', id);
    }
    if (!plan.kind) continue;
    if (stats.sent >= MAX_SENDS) break;
    const r = noticeReply(plan.kind, {
      name: p.first_name,
      place: places.get(id) ?? null,
      seed: noticeSeed(id, localDay(now, tzOf(p))),
      comeback: Number(plan.onSent.comeback_stage) || 1,
    });
    const res = await tgCall(TOKEN, 'sendMessage', { chat_id: id, text: r.text, reply_markup: r.reply_markup, disable_notification: false });
    if (res.ok) {
      stats.sent++;
      await db.from('cw_player').update(plan.onSent).eq('tg_id', id);
      continue;
    }
    stats.failed++;
    if (res.error_code === 429) break; // слишком часто — остальное в следующий проход
    const patch = sendErrorPatch(res.error_code ?? 0, res.description ?? '', now);
    if (patch) await db.from('cw_player').update(patch).eq('tg_id', id);
    else console.error('cw-cron send', id, res.error_code, res.description);
  }
  return json({ ok: true, ...stats });
});
