/**
 * Бот @Chronoworldbot и уведомления (docs/design/online.md, «Бот и уведомления») — чистые функции без Deno API и сети:
 * секреты из токена, разбор команд, ответы и кнопки, выбор уведомления (тихие часы, лимит в сутки, приоритет), тексты.
 * Используют функции cw-bot, cw-cron и cw-api; проверяются в vitest (tests/online-bot.test.ts).
 */
import { isoWeek } from '../cw-api/tg.ts';

export const BOT_USERNAME = 'Chronoworldbot';
export const BOT_LINK = `https://t.me/${BOT_USERNAME}`;
/** Адрес игры (main Mini App бота) — для кнопки web_app. */
export const GAME_URL = 'https://chronoworld-ecru.vercel.app/';

// ---------- секреты, выведенные из токена ----------

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/** hex(HMAC_SHA256(key = токен, label)).slice(0, 48). */
export async function deriveSecret(token: string, label: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(label))).slice(0, 48);
}

/** secret_token вебхука (заголовок X-Telegram-Bot-Api-Secret-Token). */
export const webhookSecret = (token: string) => deriveSecret(token, 'cw-webhook');
/** Ключ служебных действий cw-bot (заголовок X-CW-Admin). */
export const adminKey = (token: string) => deriveSecret(token, 'cw-admin');

/** Сравнение строк за постоянное время; пустые не равны ничему. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ---------- команды ----------

export type Command = 'start' | 'play' | 'friends' | 'top' | 'me' | 'notify' | 'help';
const COMMAND_SET = new Set<Command>(['start', 'play', 'friends', 'top', 'me', 'notify', 'help']);

/** Меню команд (setMyCommands): русские описания. */
export const COMMANDS: { command: Command; description: string }[] = [
  { command: 'play', description: 'Открыть игру' },
  { command: 'me', description: 'Мой прогресс' },
  { command: 'top', description: 'Рекорды недели' },
  { command: 'friends', description: 'Позвать друга' },
  { command: 'notify', description: 'Уведомления: включить или выключить' },
  { command: 'help', description: 'Что умеет бот' },
];

export interface ParsedCommand {
  /** Известная команда или null — команда, которой нет (вежливо покажем /help). */
  cmd: Command | null;
  arg: string;
}

/** «/start ref_7», «/top@Chronoworldbot» → команда и аргумент; не команда (или команда другому боту) — null. */
export function parseCommand(text: string | undefined | null, bot = BOT_USERNAME): ParsedCommand | null {
  const m = /^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/.exec((text ?? '').trim());
  if (!m) return null;
  if (m[2] && m[2].toLowerCase() !== bot.toLowerCase()) return null;
  const name = m[1].toLowerCase() as Command;
  return { cmd: COMMAND_SET.has(name) ? name : null, arg: (m[3] ?? '').trim() };
}

/** Параметр для startapp: только [A-Za-z0-9_-], до 64 символов (так требует Telegram); иначе null. */
export function startParam(payload: string | undefined | null): string | null {
  const s = (payload ?? '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null;
}

/** Ссылка на main Mini App с параметром: https://t.me/Chronoworldbot?startapp=<param>. */
export function appLink(param?: string | null): string {
  const p = startParam(param);
  return p ? `${BOT_LINK}?startapp=${p}` : `${BOT_LINK}?startapp`;
}

export const refLink = (id: number) => appLink(`ref_${Math.floor(id)}`);

export const INVITE_TEXT = 'Заходи в Chronoworld — соберём отряд, пройдём Башню и будем звонить друг другу в колокольчик!';

/** t.me/share/url с приглашением. */
export function shareLink(id: number, text = INVITE_TEXT): string {
  return `https://t.me/share/url?url=${encodeURIComponent(refLink(id))}&text=${encodeURIComponent(text)}`;
}

// ---------- ответы ----------

export interface InlineButton {
  text: string;
  url?: string;
  web_app?: { url: string };
  callback_data?: string;
}

export interface Reply {
  text: string;
  reply_markup: { inline_keyboard: InlineButton[][] };
}

/** «Играть»: без параметра — кнопка web_app (игра сразу открывается), с параметром — ссылка ?startapp=… (Mini App получит start_param). */
export function playButton(param?: string | null, label = 'Играть'): InlineButton {
  const p = startParam(param);
  return p ? { text: label, url: appLink(p) } : { text: label, web_app: { url: GAME_URL } };
}

const reply = (text: string, ...rows: InlineButton[][]): Reply => ({ text, reply_markup: { inline_keyboard: rows } });

export const HELP_TEXT = [
  'Вот что я умею, путник:',
  '/play — открыть игру',
  '/me — где ты сейчас: глава, Башня, друзья',
  '/top — рекорды недели',
  '/friends — позвать друга',
  '/notify — уведомления: включить или выключить',
].join('\n');

/** /start: known — игрок уже есть в cw_player (играл). payload ref_<id> пробрасывается в startapp. */
export function replyStart(name: string, known: boolean, payload?: string | null): Reply {
  const who = name ? `, ${name}` : '';
  const text = known
    ? `С возвращением${who}! Бруно уже протирает твою кружку. Отряд ждёт у стойки «Двух колоколов» — заходи.\n\nНапишу, когда сундук наполнится или отряд вернётся из похода. Не чаще пары раз в день и не ночью — /notify, если не надо.`
    : `Добро пожаловать в «Два колокола»${who}! Я Бруно, здешний трактирщик. Садись к огню: тут собирают отряды, спорят о Башне и звонят друзьям в колокольчик.\n\nЖми «Играть» — Грета уже точит сковородку.`;
  return reply(text, [playButton(startParam(payload))], [{ text: 'Что умеет бот', callback_data: 'help' }]);
}

export const replyPlay = (): Reply => reply('Дверь открыта, огонь горит. Заходи!', [playButton()]);

export const replyHelp = (): Reply => reply(HELP_TEXT, [playButton()]);

export const replyUnknown = (): Reply =>
  reply('Хм, такого заказа в меню нет. Вот что подаём:\n\n' + HELP_TEXT.split('\n').slice(1).join('\n'), [playButton()]);

/** Игрока ещё нет в cw_player — команды про прогресс отвечают так. */
export const replyNoPlayer = (): Reply =>
  reply('Я тебя ещё не видел за стойкой. Открой игру разок — и я запомню тебя в лицо.', [playButton()]);

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function replyFriends(id: number, friends: number): Reply {
  const n = Math.max(0, Math.floor(friends));
  const head = n > 0 ? `За твоим столом ${n} ${plural(n, 'друг', 'друга', 'друзей')}.` : 'Пока ты пьёшь в одиночку — непорядок.';
  return reply(
    `${head} Позови ещё: друг пройдёт первую главу — тебе 200 гемов, ему 100. И колокольчик можно слать каждому раз в день.`,
    [{ text: 'Позвать друга', url: shareLink(id) }],
    [playButton()],
  );
}

export interface TopData {
  week: string;
  tower: { place: number; value: number } | null;
  mvp: { place: number; value: number } | null;
  /** Топ-5 Башни этой недели. */
  top: { place: number; name: string; value: number }[];
}

export const groupDigits = (n: number): string => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export function replyTop(d: TopData): Reply {
  const lines = ['Рекорды недели — Бруно записывает мелом на доске:'];
  if (d.top.length) {
    lines.push('', 'Башня:');
    for (const r of d.top.slice(0, 5)) lines.push(`${r.place}. ${r.name || '…'} — этаж ${r.value}`);
  } else lines.push('', 'Доска пока пуста — самое время подняться в Башню.');
  lines.push('');
  lines.push(d.tower ? `Ты в Башне: ${d.tower.place}-е место (этаж ${d.tower.value}).` : 'Ты в Башне на этой неделе ещё не был.');
  if (d.mvp) lines.push(`Охота на MVP: ${d.mvp.place}-е место (зачёт ${groupDigits(d.mvp.value)}).`);
  return reply(lines.join('\n'), [playButton()]);
}

export interface MeData {
  name: string;
  chapter: number;
  stage: number;
  towerBest: number;
  friends: number;
  giftsWaiting: number;
  notify: boolean;
}

export function replyMe(d: MeData): Reply {
  const lines = [
    d.name ? `${d.name}, вот что я про тебя знаю:` : 'Вот что я про тебя знаю:',
    d.chapter > 0 ? `Глава ${d.chapter}, этап ${Math.max(1, d.stage)}.` : 'Только начинаешь путь.',
    `Рекорд Башни: ${d.towerBest > 0 ? `этаж ${d.towerBest}` : 'ещё нет'}.`,
    `Друзей: ${d.friends}.`,
  ];
  if (d.giftsWaiting > 0) lines.push(`Ждут колокольчики: ${d.giftsWaiting} — забери в игре, это гемы!`);
  lines.push(`Уведомления: ${d.notify ? 'включены' : 'выключены'} (/notify).`);
  return reply(lines.join('\n'), [playButton()]);
}

export function replyNotify(on: boolean): Reply {
  const text = on
    ? 'Уведомления включены. Напишу, когда сундук полон, отряд вернулся или друг позвонил в колокольчик. Не чаще двух раз в день и не ночью.'
    : 'Уведомления выключены. Буду молчать, как Гаррет над кружкой. Захочешь — включи снова.';
  return reply(text, [on ? { text: 'Выключить', callback_data: 'notify_off' } : { text: 'Включить', callback_data: 'notify_on' }], [playButton()]);
}

// ---------- уведомления ----------

export type NoticeKind = 'gift' | 'expedition' | 'chest' | 'week' | 'comeback';

/** Порядок важности: друг звонил, отряд вернулся, сундук полон, итоги недели, «возвращайся». */
export const NOTICE_PRIORITY: NoticeKind[] = ['gift', 'expedition', 'chest', 'week', 'comeback'];

export const MAX_PER_DAY = 2;
/** Между двумя уведомлениями не меньше. */
export const MIN_GAP_MS = 3 * 3600_000;
/** Тихие часы по местному времени игрока: с 22:00 до 09:00. */
export const QUIET_FROM = 22;
export const QUIET_TO = 9;
/** Игрок заходил недавно (hello/sync) — он в игре, не пишем. */
export const ACTIVE_MS = 15 * 60_000;
/** «Возвращайся»: через 3 дня без игры, потом через 7 дней после первого, дальше не беспокоим. */
export const COMEBACK_AFTER_DAYS = 3;
export const COMEBACK_AGAIN_DAYS = 7;
/** Сундук и экспедиция старше этого — не напоминаем (игрок давно не заходил — для этого есть «возвращайся»). */
export const STALE_MS = 2 * 86400_000;
/** Итоги недели — только в первые двое суток недели (UTC). */
export const WEEK_NOTICE_WINDOW_MS = 2 * 86400_000;
/** Смещение по умолчанию (как getTimezoneOffset): Москва. */
export const DEFAULT_TZ_OFFSET = -180;

const DAY = 86400_000;

/** Строка cw_player, нужная для выбора уведомления (даты — ISO-строки из базы или null). */
export interface NotifyRow {
  tg_id: number;
  first_name?: string | null;
  notify: boolean;
  bot_started: boolean;
  /** Как Date.getTimezoneOffset(): UTC − местное, минуты (Москва −180). */
  tz_offset: number | null;
  last_seen: string | null;
  chest_full_at: string | null;
  exp_done_at: string | null;
  gift_at: string | null;
  gift_notified_day: string | null;
  last_notified_at: string | null;
  notified_today: number | null;
  notified_day: string | null;
  comeback_stage: number | null;
  week_notified: string | null;
}

export interface NoticeContext {
  /** Место игрока в Башне на прошлой неделе (null — не участвовал). */
  lastWeekPlace?: number | null;
}

export interface NoticePlan {
  kind: NoticeKind | null;
  /** Применить сразу (устаревшие отметки: сундук, экспедиция). */
  clear: Record<string, unknown>;
  /** Применить, если сообщение доставлено. */
  onSent: Record<string, unknown>;
}

const ms = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

export function tzOf(row: Pick<NotifyRow, 'tz_offset'>): number {
  const t = Number(row.tz_offset);
  return row.tz_offset !== null && Number.isFinite(t) && t >= -840 && t <= 720 ? t : DEFAULT_TZ_OFFSET;
}

/** Местное время игрока как Date в «UTC-полях». */
const local = (now: number, tz: number) => new Date(now - tz * 60_000);

export const localHour = (now: number, tz: number): number => local(now, tz).getUTCHours();
export const localDay = (now: number, tz: number): string => local(now, tz).toISOString().slice(0, 10);

export function isQuiet(now: number, tz: number): boolean {
  const h = localHour(now, tz);
  return h >= QUIET_FROM || h < QUIET_TO;
}

/** Начало ISO-недели (понедельник 00:00 UTC). */
export function weekStart(now: number): number {
  const d = new Date(now);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = d.getUTCDay() || 7;
  return t - (dow - 1) * DAY;
}

/** Прошлая ISO-неделя «2026-W39». */
export const prevWeek = (now: number): string => isoWeek(new Date(weekStart(now) - DAY));

/**
 * Какое уведомление послать игроку сейчас (не больше одного за проход cron). null — никакое: выключены, бот не
 * запущен, тихие часы, лимит в сутки, недавно писали, игрок в игре или нечего сказать.
 */
export function planNotice(p: NotifyRow, now: number, ctx: NoticeContext = {}): NoticePlan {
  const clear: Record<string, unknown> = {};
  const chest = ms(p.chest_full_at);
  const exp = ms(p.exp_done_at);
  const seen = ms(p.last_seen) ?? 0;
  // Устарело или игрок заходил после события — молча снимаем.
  if (chest !== null && chest <= now && (now - chest > STALE_MS || seen >= chest)) clear.chest_full_at = null;
  if (exp !== null && exp <= now && (now - exp > STALE_MS || seen >= exp)) clear.exp_done_at = null;
  const none = { kind: null, clear, onSent: {} };
  if (!p.notify || !p.bot_started) return none;
  const tz = tzOf(p);
  if (isQuiet(now, tz)) return none;
  if (now - seen < ACTIVE_MS) return none;
  const day = localDay(now, tz);
  const sentToday = p.notified_day === day ? Math.max(0, Number(p.notified_today) || 0) : 0;
  if (sentToday >= MAX_PER_DAY) return none;
  const last = ms(p.last_notified_at);
  if (last !== null && now - last < MIN_GAP_MS) return none;

  const due: Partial<Record<NoticeKind, Record<string, unknown>>> = {};
  if (ms(p.gift_at) !== null && p.gift_notified_day !== day) due.gift = { gift_at: null, gift_notified_day: day };
  if (exp !== null && exp <= now && !('exp_done_at' in clear)) due.expedition = { exp_done_at: null };
  if (chest !== null && chest <= now && !('chest_full_at' in clear)) due.chest = { chest_full_at: null };
  const week = isoWeek(new Date(now));
  if (p.week_notified !== week && ctx.lastWeekPlace && now - weekStart(now) < WEEK_NOTICE_WINDOW_MS) due.week = { week_notified: week };
  const stage = Math.max(0, Number(p.comeback_stage) || 0);
  const away = seen > 0 && now - seen >= COMEBACK_AFTER_DAYS * DAY;
  if (away && (stage === 0 || (stage === 1 && last !== null && now - last >= COMEBACK_AGAIN_DAYS * DAY))) due.comeback = { comeback_stage: stage + 1 };

  const kind = NOTICE_PRIORITY.find((k) => due[k]) ?? null;
  if (!kind) return none;
  return {
    kind,
    clear,
    onSent: { ...due[kind], last_notified_at: new Date(now).toISOString(), notified_day: day, notified_today: sentToday + 1 },
  };
}

export interface NoticeData {
  name?: string | null;
  /** Место в Башне на прошлой неделе (week). */
  place?: number | null;
  /** Номер для выбора варианта текста (tg_id + день). */
  seed?: number;
  /** «Возвращайся»: какой по счёту (1 — первый, 2 — второй). */
  comeback?: number;
}

const pick = <T>(list: T[], seed = 0): T => list[Math.abs(Math.floor(seed)) % list.length];

const NOTICE_TEXTS: Record<Exclude<NoticeKind, 'week'>, ((name: string) => string)[]> = {
  gift: [
    (n) => `${n ? n + ', д' : 'Д'}инь-динь! Друг позвонил тебе в колокольчик. Грета говорит, звон хороший — на гемы. Забери, пока не остыл.`,
    () => 'Над стойкой звякнул колокольчик — это друг вспомнил о тебе. Загляни, подарок ждёт.',
  ],
  expedition: [
    () => 'Отряд вернулся из похода! Сидят у Бруно, грязные и довольные, трофеи свалили на стол. Разбери, пока Грета не растащила.',
    () => 'Экспедиция вернулась. Капитан Гаррет докладывает: все целы, мешки полны. Ждут тебя в «Двух колоколах».',
  ],
  chest: [
    () => 'Сундук трофеев полон — крышка уже не закрывается. Бруно просит забрать, пока он не начал брать за хранение.',
    () => 'Сундук с трофеями набит до краёв: дальше копиться некуда. Заходи забрать — отряд без тебя скучает.',
  ],
  comeback: [
    (n) => `${n ? n + ', т' : 'Т'}воя кружка третий день стоит пустая. Бруно скучает, Грета ворчит, а Башня сама себя не пройдёт. Заглянешь?`,
    () => 'В «Двух колоколах» без тебя тихо. Гаррет ставит на стол лишнюю кружку — вдруг зайдёшь. Огонь ещё горит.',
  ],
};

/** Текст уведомления с кнопкой «Играть». */
export function noticeReply(kind: NoticeKind, d: NoticeData = {}): Reply {
  const name = (d.name ?? '').trim().slice(0, 32);
  let text: string;
  if (kind === 'week') {
    const place = Math.max(1, Math.floor(d.place ?? 1));
    text =
      place === 1
        ? `Новая неделя рекордов! На прошлой ты был первым в Башне — Бруно повесил твоё имя над стойкой. Удержишь?`
        : `Новая неделя рекордов! На прошлой ты был ${place}-м в Башне. Доска стёрта, мел наточен — время подняться выше.`;
  } else if (kind === 'comeback') {
    // Первое — «третий день», второе — другой текст.
    text = NOTICE_TEXTS.comeback[(d.comeback ?? 1) >= 2 ? 1 : 0](name);
  } else {
    text = pick(NOTICE_TEXTS[kind], d.seed)(name);
  }
  return reply(text, [playButton()]);
}

/** Вариант текста: от tg_id и дня — у разных игроков разный, у одного игрока меняется день ото дня. */
export const noticeSeed = (tgId: number, day: string): number => (tgId % 997) + Number(day.replace(/-/g, '')) % 7;

// ---------- данные от клиента (cw-api hello/sync) ----------

/** tzOffset (как getTimezoneOffset, минуты): целое в [−840, 720], иначе undefined (не трогаем колонку). */
export function parseTzOffset(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const n = Math.round(v);
  return n >= -840 && n <= 720 ? n : undefined;
}

/** Не дальше в будущем, чем это: сундук копится не больше суток, экспедиции — часы. */
export const TIMER_MAX_AHEAD_MS = 7 * DAY;

/**
 * Момент события (мс) от клиента → ISO-строка для timestamptz; null — события нет (очистить колонку);
 * undefined — поле не прислано или неправдоподобно (не трогаем колонку, обратная совместимость).
 */
export function parseTimer(v: unknown, now: number): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  if (v <= now) return null;
  if (v > now + TIMER_MAX_AHEAD_MS) return undefined;
  return new Date(Math.floor(v)).toISOString();
}

/** Поля cw_player из hello/sync: tz_offset, chest_full_at, exp_done_at (только присланные и разумные). */
export function clientNotifyFields(body: Record<string, unknown>, now: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const tz = parseTzOffset(body.tzOffset);
  if (tz !== undefined) out.tz_offset = tz;
  if ('chestFullAt' in body) {
    const c = parseTimer(body.chestFullAt, now);
    if (c !== undefined) out.chest_full_at = c;
  }
  if ('expeditionsDoneAt' in body) {
    const e = parseTimer(body.expeditionsDoneAt, now);
    if (e !== undefined) out.exp_done_at = e;
  }
  return out;
}

/** Ошибка Telegram при отправке → что пометить у игрока (403: заблокировал / не запускал; 400 chat not found). */
export function sendErrorPatch(code: number, description: string, now: number): Record<string, unknown> | null {
  if (code === 403) return { notify: false, bot_started: false, blocked_at: new Date(now).toISOString() };
  if (code === 400 && /chat not found|user not found/i.test(description)) return { bot_started: false };
  return null;
}
