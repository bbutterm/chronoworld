import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { newGame, type FullContext, type SaveState } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { notifyTimersOf, timersChanged } from '../src/game/online/logic';
import {
  adminKey,
  appLink,
  clientNotifyFields,
  COMMANDS,
  deriveSecret,
  isQuiet,
  localDay,
  MAX_PER_DAY,
  noticeReply,
  parseCommand,
  parseTimer,
  parseTzOffset,
  planNotice,
  playButton,
  prevWeek,
  replyFriends,
  replyMe,
  replyNotify,
  replyStart,
  replyTop,
  safeEqual,
  sendErrorPatch,
  shareLink,
  startParam,
  webhookSecret,
  type NotifyRow,
} from '../supabase/functions/_shared/bot';

const TOKEN = '123456:TEST-token';
const H = 3600_000;
const DAY = 24 * H;
/** Чт 1 окт 2026, 12:00 UTC = 15:00 по Москве. */
const NOW = Date.UTC(2026, 9, 1, 12, 0);
const iso = (t: number) => new Date(t).toISOString();

const row = (over: Partial<NotifyRow> = {}): NotifyRow => ({
  tg_id: 42,
  first_name: 'Вика',
  notify: true,
  bot_started: true,
  tz_offset: -180,
  last_seen: iso(NOW - 5 * H),
  chest_full_at: null,
  exp_done_at: null,
  gift_at: null,
  gift_notified_day: null,
  last_notified_at: null,
  notified_today: 0,
  notified_day: null,
  comeback_stage: 0,
  week_notified: null,
  ...over,
});

describe('бот: секреты из токена', () => {
  it('hex(HMAC_SHA256(токен, метка)).slice(0, 48)', async () => {
    const want = (label: string) => createHmac('sha256', TOKEN).update(label).digest('hex').slice(0, 48);
    expect(await webhookSecret(TOKEN)).toBe(want('cw-webhook'));
    expect(await adminKey(TOKEN)).toBe(want('cw-admin'));
    expect(await deriveSecret(TOKEN, 'x')).toMatch(/^[0-9a-f]{48}$/);
    expect(await webhookSecret(TOKEN)).not.toBe(await adminKey(TOKEN));
  });

  it('safeEqual', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(false);
    expect(safeEqual(null, 'abc')).toBe(false);
  });
});

describe('бот: команды и ответы', () => {
  it('разбор команд', () => {
    expect(parseCommand('/start ref_7')).toEqual({ cmd: 'start', arg: 'ref_7' });
    expect(parseCommand('/start')).toEqual({ cmd: 'start', arg: '' });
    expect(parseCommand('/top@Chronoworldbot')).toEqual({ cmd: 'top', arg: '' });
    expect(parseCommand('/TOP@chronoworldbot')).toEqual({ cmd: 'top', arg: '' });
    expect(parseCommand('/top@OtherBot')).toBeNull();
    expect(parseCommand('/dance')).toEqual({ cmd: null, arg: '' });
    expect(parseCommand('привет')).toBeNull();
    expect(parseCommand('')).toBeNull();
    expect(parseCommand(undefined)).toBeNull();
    expect(COMMANDS.map((c) => c.command)).toEqual(['play', 'me', 'top', 'friends', 'notify', 'help']);
    for (const c of COMMANDS) expect(c.description).toMatch(/[а-яё]/i);
  });

  it('startapp: только допустимые символы; реферал пробрасывается в /start', () => {
    expect(startParam('ref_7')).toBe('ref_7');
    expect(startParam('ref 7')).toBeNull();
    expect(startParam('a'.repeat(65))).toBeNull();
    expect(appLink('ref_7')).toBe('https://t.me/Chronoworldbot?startapp=ref_7');
    expect(playButton()).toEqual({ text: 'Играть', web_app: { url: 'https://chronoworld-ecru.vercel.app/' } });
    const start = replyStart('Вика', false, 'ref_7');
    expect(start.text).toContain('Бруно');
    expect(start.reply_markup.inline_keyboard[0][0]).toEqual({ text: 'Играть', url: 'https://t.me/Chronoworldbot?startapp=ref_7' });
    expect(replyStart('Вика', true, '<script>').reply_markup.inline_keyboard[0][0].web_app).toBeTruthy();
    expect(replyStart('', true).text).toMatch(/^С возвращением!/);
  });

  it('в каждом ответе есть «Играть»', () => {
    const replies = [
      replyStart('Вика', true),
      replyFriends(42, 3),
      replyTop({ week: '2026-W40', tower: null, mvp: null, top: [] }),
      replyMe({ name: 'Вика', chapter: 2, stage: 5, towerBest: 10, friends: 1, giftsWaiting: 2, notify: true }),
      replyNotify(true),
      noticeReply('chest'),
    ];
    for (const r of replies) expect(r.reply_markup.inline_keyboard.flat().some((b) => b.text === 'Играть')).toBe(true);
  });

  it('друзья: ссылка-приглашение и число', () => {
    expect(shareLink(42)).toContain(encodeURIComponent('https://t.me/Chronoworldbot?startapp=ref_42'));
    const r = replyFriends(42, 3);
    expect(r.text).toContain('3 друга');
    expect(replyFriends(42, 5).text).toContain('5 друзей');
    expect(replyFriends(42, 0).text).toContain('одиночку');
    expect(r.reply_markup.inline_keyboard[0][0].url).toMatch(/^https:\/\/t\.me\/share\/url\?url=/);
  });

  it('рекорды: топ-5 Башни, моё место', () => {
    const top = Array.from({ length: 7 }, (_, i) => ({ place: i + 1, name: `Игрок${i + 1}`, value: 100 - i }));
    const t = replyTop({ week: '2026-W40', tower: { place: 12, value: 40 }, mvp: { place: 3, value: 1234567 }, top }).text;
    expect(t).toContain('1. Игрок1 — этаж 100');
    expect(t).toContain('5. Игрок5');
    expect(t).not.toContain('Игрок6');
    expect(t).toContain('12-е место (этаж 40)');
    expect(t).toContain('1 234 567');
  });

  it('/me и /notify', () => {
    const t = replyMe({ name: 'Вика', chapter: 2, stage: 5, towerBest: 0, friends: 1, giftsWaiting: 2, notify: false }).text;
    expect(t).toContain('Глава 2, этап 5');
    expect(t).toContain('Ждут колокольчики: 2');
    expect(t).toContain('выключены');
    expect(replyNotify(true).reply_markup.inline_keyboard[0][0]).toEqual({ text: 'Выключить', callback_data: 'notify_off' });
    expect(replyNotify(false).reply_markup.inline_keyboard[0][0]).toEqual({ text: 'Включить', callback_data: 'notify_on' });
  });
});

describe('уведомления: когда и какое', () => {
  it('тихие часы — по местному времени игрока', () => {
    expect(isQuiet(NOW, -180)).toBe(false); // 15:00 МСК
    expect(isQuiet(Date.UTC(2026, 9, 1, 19, 30), -180)).toBe(true); // 22:30 МСК
    expect(isQuiet(Date.UTC(2026, 9, 1, 5, 59), -180)).toBe(true); // 08:59 МСК
    expect(isQuiet(Date.UTC(2026, 9, 1, 6, 0), -180)).toBe(false); // 09:00 МСК
    expect(isQuiet(NOW, -600)).toBe(true); // 22:00 во Владивостоке
    expect(localDay(Date.UTC(2026, 9, 1, 22, 0), -180)).toBe('2026-10-02');
  });

  it('ничего не шлём: выключены, бот не запущен, ночь, игрок в игре', () => {
    const due = { chest_full_at: iso(NOW - H) };
    expect(planNotice(row(due), NOW).kind).toBe('chest');
    expect(planNotice(row({ ...due, notify: false }), NOW).kind).toBeNull();
    expect(planNotice(row({ ...due, bot_started: false }), NOW).kind).toBeNull();
    expect(planNotice(row({ ...due, tz_offset: -600 }), NOW).kind).toBeNull();
    expect(planNotice(row({ ...due, last_seen: iso(NOW - 5 * 60_000) }), NOW).kind).toBeNull();
    // Сундук ещё не полон.
    expect(planNotice(row({ chest_full_at: iso(NOW + H) }), NOW).kind).toBeNull();
  });

  it('не больше 2 в сутки и не чаще раза в 3 часа; новый местный день — снова можно', () => {
    const due = { exp_done_at: iso(NOW - H) };
    const day = localDay(NOW, -180);
    expect(planNotice(row({ ...due, notified_day: day, notified_today: MAX_PER_DAY, last_notified_at: iso(NOW - 5 * H) }), NOW).kind).toBeNull();
    expect(planNotice(row({ ...due, notified_day: day, notified_today: 1, last_notified_at: iso(NOW - 2 * H) }), NOW).kind).toBeNull();
    const p = planNotice(row({ ...due, notified_day: day, notified_today: 1, last_notified_at: iso(NOW - 4 * H) }), NOW);
    expect(p.kind).toBe('expedition');
    expect(p.onSent).toMatchObject({ exp_done_at: null, notified_day: day, notified_today: 2, last_notified_at: iso(NOW) });
    expect(planNotice(row({ ...due, notified_day: '2026-09-30', notified_today: 2, last_notified_at: iso(NOW - 4 * H) }), NOW).onSent.notified_today).toBe(1);
  });

  it('приоритет: колокольчик > экспедиция > сундук > неделя > возвращайся', () => {
    const monday = Date.UTC(2026, 9, 5, 9, 0); // пн, 12:00 МСК
    const all = row({
      gift_at: iso(monday - 2 * H),
      exp_done_at: iso(monday - H),
      chest_full_at: iso(monday - H),
      last_seen: iso(monday - 4 * DAY),
    });
    // Игрок не заходил 4 дня — сундук и экспедиция старше последнего входа, но не устарели (≤ 2 суток).
    const order: string[] = [];
    let p = all;
    for (let i = 0; i < 5; i++) {
      const plan = planNotice(p, monday, { lastWeekPlace: 3 });
      if (!plan.kind) break;
      order.push(plan.kind);
      p = { ...p, ...plan.clear, ...plan.onSent, notified_today: 0, last_notified_at: null } as NotifyRow;
    }
    expect(order).toEqual(['gift', 'expedition', 'chest', 'week', 'comeback']);
  });

  it('колокольчик — не чаще раза в местный день', () => {
    const day = localDay(NOW, -180);
    expect(planNotice(row({ gift_at: iso(NOW - H), gift_notified_day: day }), NOW).kind).toBeNull();
    expect(planNotice(row({ gift_at: iso(NOW - H), gift_notified_day: '2026-09-30' }), NOW).onSent).toMatchObject({ gift_at: null, gift_notified_day: day });
  });

  it('сундук и экспедиция: устаревшие и уже увиденные снимаются молча', () => {
    const old = planNotice(row({ chest_full_at: iso(NOW - 3 * DAY), last_seen: iso(NOW - 4 * DAY) }), NOW);
    expect(old.clear).toEqual({ chest_full_at: null });
    expect(old.kind).not.toBe('chest');
    const seen = planNotice(row({ exp_done_at: iso(NOW - 3 * H), last_seen: iso(NOW - H) }), NOW);
    expect(seen.clear).toEqual({ exp_done_at: null });
    expect(seen.kind).toBeNull();
    // Даже если писать нельзя (ночь) — устаревшее снимается.
    expect(planNotice(row({ chest_full_at: iso(NOW - 3 * DAY), tz_offset: -600 }), NOW).clear).toEqual({ chest_full_at: null });
  });

  it('итоги недели: только в первые двое суток недели, один раз', () => {
    const monday = Date.UTC(2026, 9, 5, 9, 0);
    const wed = Date.UTC(2026, 9, 7, 9, 0);
    const r = (over: Partial<NotifyRow> = {}, at = monday) => row({ last_seen: iso(at - 5 * H), ...over });
    expect(prevWeek(monday)).toBe('2026-W40');
    expect(planNotice(r(), monday, { lastWeekPlace: 4 }).onSent).toMatchObject({ week_notified: '2026-W41' });
    expect(planNotice(r({ week_notified: '2026-W41' }), monday, { lastWeekPlace: 4 }).kind).toBeNull();
    expect(planNotice(r(), monday, { lastWeekPlace: null }).kind).toBeNull();
    expect(planNotice(r({}, wed), wed, { lastWeekPlace: 4 }).kind).toBeNull(); // среда
    expect(noticeReply('week', { place: 4 }).text).toContain('4-м в Башне');
    expect(noticeReply('week', { place: 1 }).text).toContain('первым');
  });

  it('«возвращайся»: через 3 дня, ещё раз через 7 дней, потом тишина', () => {
    const away = (days: number, over: Partial<NotifyRow> = {}) => planNotice(row({ last_seen: iso(NOW - days * DAY), ...over }), NOW);
    expect(away(2).kind).toBeNull();
    expect(away(3).onSent).toMatchObject({ comeback_stage: 1 });
    expect(away(6, { comeback_stage: 1, last_notified_at: iso(NOW - 3 * DAY) }).kind).toBeNull();
    expect(away(10, { comeback_stage: 1, last_notified_at: iso(NOW - 7 * DAY) }).onSent).toMatchObject({ comeback_stage: 2 });
    expect(away(30, { comeback_stage: 2, last_notified_at: iso(NOW - 20 * DAY) }).kind).toBeNull();
    expect(noticeReply('comeback', { comeback: 1, name: 'Вика' }).text).toMatch(/^Вика, твоя кружка третий день/);
    expect(noticeReply('comeback', { comeback: 2 }).text).not.toContain('третий день');
  });

  it('тексты уведомлений живые и с кнопкой', () => {
    for (const k of ['gift', 'expedition', 'chest', 'week', 'comeback'] as const) {
      for (const seed of [0, 1]) {
        const r = noticeReply(k, { seed, place: 2 });
        expect(r.text.length).toBeGreaterThan(30);
        expect(r.text.length).toBeLessThan(300);
        expect(r.text).not.toMatch(/undefined|null|NaN/);
      }
    }
  });

  it('ошибки отправки: 403 — выключить, chat not found — бот не запущен, прочее — ничего', () => {
    expect(sendErrorPatch(403, 'Forbidden: bot was blocked by the user', NOW)).toEqual({ notify: false, bot_started: false, blocked_at: iso(NOW) });
    expect(sendErrorPatch(400, 'Bad Request: chat not found', NOW)).toEqual({ bot_started: false });
    expect(sendErrorPatch(500, 'oops', NOW)).toBeNull();
  });
});

describe('cw-api: поля для уведомлений от клиента', () => {
  it('tzOffset в [−840, 720]', () => {
    expect(parseTzOffset(-180)).toBe(-180);
    expect(parseTzOffset(0)).toBe(0);
    expect(parseTzOffset(-900)).toBeUndefined();
    expect(parseTzOffset('60')).toBeUndefined();
  });

  it('моменты: в будущем до 7 суток, прошлое — null, мусор — не трогаем', () => {
    expect(parseTimer(NOW + H, NOW)).toBe(iso(NOW + H));
    expect(parseTimer(NOW - H, NOW)).toBeNull();
    expect(parseTimer(null, NOW)).toBeNull();
    expect(parseTimer(NOW + 30 * DAY, NOW)).toBeUndefined();
    expect(parseTimer('x', NOW)).toBeUndefined();
    expect(clientNotifyFields({ tzOffset: -180, chestFullAt: NOW + H, expeditionsDoneAt: null }, NOW)).toEqual({ tz_offset: -180, chest_full_at: iso(NOW + H), exp_done_at: null });
    // Старый клиент без полей — колонки не трогаем.
    expect(clientNotifyFields({ chapter: 2 }, NOW)).toEqual({});
  });
});

describe('клиент: сроки сундука и экспедиций', () => {
  const ctx: FullContext = loadFullContext();
  const capMs = ctx.progression.offline.capHours * H;

  it('новичок: сундук не копится, экспедиций нет', () => {
    const s = newGame(ctx, 1000);
    expect(notifyTimersOf(s, 1000, ctx)).toEqual({ chestFullAt: null, expeditionsDoneAt: null });
  });

  it('сундук копится с последнего «Собрать», экспедиция — ближайшая из ещё не вернувшихся', () => {
    const base = newGame(ctx, 0);
    const stage = ctx.content.stages[0].id;
    const t0 = 10 * H;
    const s: SaveState = {
      ...base,
      campaign: { ...base.campaign, cleared: [stage] },
      offline: { ...base.offline, lastClaimAt: t0 },
      bounties: {
        ...base.bounties,
        active: [
          { ...({} as SaveState['bounties']['active'][number]), location: 'a', heroIds: ['x'], startedAt: t0, endsAt: t0 + 8 * H },
          { ...({} as SaveState['bounties']['active'][number]), location: 'b', heroIds: ['y'], startedAt: t0, endsAt: t0 + 2 * H },
          { ...({} as SaveState['bounties']['active'][number]), location: 'c', heroIds: ['z'], startedAt: t0 - 9 * H, endsAt: t0 - H },
        ],
      },
    };
    const now = t0 + H;
    expect(notifyTimersOf(s, now, ctx)).toEqual({ chestFullAt: t0 + capMs, expeditionsDoneAt: t0 + 2 * H });
    // Сундук уже полон — игрок в игре и видит его сам.
    expect(notifyTimersOf(s, t0 + capMs + 1, ctx).chestFullAt).toBeNull();
  });

  it('изменилось заметно — больше минуты или появилось/пропало', () => {
    const a = { chestFullAt: 1_000_000, expeditionsDoneAt: null };
    expect(timersChanged(null, a)).toBe(true);
    expect(timersChanged(a, { ...a, chestFullAt: 1_030_000 })).toBe(false);
    expect(timersChanged(a, { ...a, chestFullAt: 1_100_000 })).toBe(true);
    expect(timersChanged(a, { ...a, expeditionsDoneAt: 5 })).toBe(true);
  });
});
