// Chronoworld: вебхук бота @Chronoworldbot (docs/design/online.md, «Бот и уведомления»). verify_jwt выключен.
// - Telegram → POST с заголовком X-Telegram-Bot-Api-Secret-Token = webhookSecret(токен): команды и кнопки.
// - Оркестратор → POST с заголовком X-CW-Admin = adminKey(токен), { action: 'setup' | 'info' }: setWebhook,
//   setMyCommands, getWebhookInfo (токен в ответе не возвращается).
// Чистая логика и тексты — ../_shared/bot.ts (тесты в tests/online-bot.test.ts).
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  adminKey,
  COMMANDS,
  parseCommand,
  replyFriends,
  replyHelp,
  replyMe,
  replyNoPlayer,
  replyNotify,
  replyPlay,
  replyStart,
  replyTop,
  replyUnknown,
  safeEqual,
  webhookSecret,
  type Reply,
  type TopData,
} from '../_shared/bot.ts';
import { tgCall } from '../_shared/telegram.ts';
import { isoWeek } from '../cw-api/tg.ts';

const TOKEN = Deno.env.get('CHRONOWORLD_BOT_TOKEN') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const db = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface TgUserLite {
  id: number;
  first_name?: string;
}
interface TgUpdate {
  message?: { chat: { id: number; type: string }; from?: TgUserLite; text?: string };
  callback_query?: { id: string; from: TgUserLite; data?: string; message?: { chat: { id: number }; message_id: number } };
}

const send = (chat: number, r: Reply) => tgCall(TOKEN, 'sendMessage', { chat_id: chat, text: r.text, reply_markup: r.reply_markup, link_preview_options: { is_disabled: true } });

async function player(id: number) {
  const { data } = await db.from('cw_player').select('tg_id, first_name, chapter, stage, tower_best, notify, bot_started, blocked_at').eq('tg_id', id).maybeSingle();
  return data;
}

/** Пользователь написал боту — теперь ему можно писать. Запись в cw_bot_start (на случай, если игрока ещё нет). */
async function markStarted(id: number, p: Awaited<ReturnType<typeof player>>) {
  await db.from('cw_bot_start').upsert({ tg_id: id, started_at: new Date().toISOString() });
  if (!p) return;
  // Вернулся после блокировки — снова включаем уведомления (выключили их мы, а не он).
  const upd: Record<string, unknown> = { bot_started: true };
  if (p.blocked_at) Object.assign(upd, { notify: true, blocked_at: null });
  if (!p.bot_started || p.blocked_at) await db.from('cw_player').update(upd).eq('tg_id', id);
}

async function friendCount(id: number): Promise<number> {
  const { count } = await db.from('cw_friend').select('*', { count: 'exact', head: true }).eq('a', id);
  return count ?? 0;
}

async function myPlace(week: string, board: string, id: number): Promise<{ place: number; value: number } | null> {
  const { data: my } = await db.from('cw_score').select('value').match({ week, board, tg_id: id }).maybeSingle();
  if (!my) return null;
  const { count } = await db.from('cw_score').select('*', { count: 'exact', head: true }).eq('week', week).eq('board', board).gt('value', my.value);
  return { place: (count ?? 0) + 1, value: Number(my.value) };
}

async function topData(id: number): Promise<TopData> {
  const week = isoWeek(new Date());
  const { data: rows } = await db.from('cw_score').select('tg_id, value').eq('week', week).eq('board', 'tower').order('value', { ascending: false }).limit(5);
  const ids = (rows ?? []).map((r) => Number(r.tg_id));
  const { data: names } = ids.length ? await db.from('cw_player').select('tg_id, first_name').in('tg_id', ids) : { data: [] };
  const nameOf = new Map((names ?? []).map((n) => [Number(n.tg_id), String(n.first_name ?? '')]));
  const [tower, mvp] = await Promise.all([myPlace(week, 'tower', id), myPlace(week, 'mvp', id)]);
  return { week, tower, mvp, top: (rows ?? []).map((r, i) => ({ place: i + 1, name: nameOf.get(Number(r.tg_id)) ?? '…', value: Number(r.value) })) };
}

async function onMessage(m: NonNullable<TgUpdate['message']>) {
  if (m.chat.type !== 'private' || !m.from) return;
  const id = m.from.id;
  const c = parseCommand(m.text);
  const p = await player(id);
  // Любое сообщение боту = разрешение писать в ответ.
  await markStarted(id, p);
  if (!c) return send(id, replyUnknown());
  switch (c.cmd) {
    case 'start':
      return send(id, replyStart(m.from.first_name ?? '', !!p, c.arg));
    case 'play':
      return send(id, replyPlay());
    case 'help':
      return send(id, replyHelp());
    case 'friends':
      return send(id, p ? replyFriends(id, await friendCount(id)) : replyNoPlayer());
    case 'top':
      return send(id, replyTop(await topData(id)));
    case 'me': {
      if (!p) return send(id, replyNoPlayer());
      const [friends, { count: gifts }] = await Promise.all([
        friendCount(id),
        db.from('cw_gift').select('*', { count: 'exact', head: true }).eq('to_id', id).eq('claimed', false),
      ]);
      return send(id, replyMe({ name: p.first_name ?? '', chapter: p.chapter ?? 0, stage: p.stage ?? 0, towerBest: p.tower_best ?? 0, friends, giftsWaiting: gifts ?? 0, notify: !!p.notify }));
    }
    case 'notify':
      return send(id, p ? replyNotify(!!p.notify) : replyNoPlayer());
    default:
      return send(id, replyUnknown());
  }
}

async function onCallback(q: NonNullable<TgUpdate['callback_query']>) {
  const id = q.from.id;
  const chat = q.message?.chat.id ?? id;
  if (q.data === 'notify_on' || q.data === 'notify_off') {
    const on = q.data === 'notify_on';
    const p = await player(id);
    if (!p) {
      await tgCall(TOKEN, 'answerCallbackQuery', { callback_query_id: q.id });
      return send(chat, replyNoPlayer());
    }
    await db.from('cw_player').update({ notify: on, bot_started: true, blocked_at: null }).eq('tg_id', id);
    await tgCall(TOKEN, 'answerCallbackQuery', { callback_query_id: q.id, text: on ? 'Уведомления включены' : 'Уведомления выключены' });
    const r = replyNotify(on);
    if (q.message) return tgCall(TOKEN, 'editMessageText', { chat_id: chat, message_id: q.message.message_id, text: r.text, reply_markup: r.reply_markup });
    return send(chat, r);
  }
  await tgCall(TOKEN, 'answerCallbackQuery', { callback_query_id: q.id });
  if (q.data === 'help') return send(chat, replyHelp());
}

async function setup() {
  const url = `${SUPABASE_URL}/functions/v1/cw-bot`;
  const hook = await tgCall(TOKEN, 'setWebhook', {
    url,
    secret_token: await webhookSecret(TOKEN),
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
  const cmdsDefault = await tgCall(TOKEN, 'setMyCommands', { commands: COMMANDS });
  const cmdsRu = await tgCall(TOKEN, 'setMyCommands', { commands: COMMANDS, language_code: 'ru' });
  const info = await tgCall(TOKEN, 'getWebhookInfo');
  return { setWebhook: hook, setMyCommands: { default: cmdsDefault, ru: cmdsRu }, webhookInfo: info };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!TOKEN) return json({ error: 'no_token' }, 500);
  const admin = req.headers.get('x-cw-admin');
  if (admin !== null) {
    if (!safeEqual(admin, await adminKey(TOKEN))) return json({ error: 'unauthorized' }, 401);
    const body = await req.json().catch(() => ({}));
    if (body?.action === 'info') return json({ ok: true, webhookInfo: await tgCall(TOKEN, 'getWebhookInfo') });
    return json({ ok: true, ...(await setup()) });
  }
  if (!safeEqual(req.headers.get('x-telegram-bot-api-secret-token'), await webhookSecret(TOKEN))) return json({ error: 'unauthorized' }, 401);
  let upd: TgUpdate;
  try {
    upd = await req.json();
  } catch {
    return json({ ok: true });
  }
  try {
    if (upd.message) await onMessage(upd.message);
    else if (upd.callback_query) await onCallback(upd.callback_query);
  } catch (e) {
    console.error('cw-bot', e);
  }
  // Telegram всегда получает 200 — иначе будет повторять обновление.
  return json({ ok: true });
});
