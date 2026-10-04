import { afterEach, describe, expect, it, vi } from 'vitest';
import { newGame, type FullContext, type SaveState } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { isoWeek as serverWeek } from '../supabase/functions/cw-api/tg';
import { api, call, initData, onlineAvailable, type Fetcher } from '../src/game/online/api';
import {
  agoText,
  applyRewardGrants,
  cloudSaveDelay,
  groupDigits,
  isFreshSave,
  isoWeek,
  nextMvpWeek,
  normalizeAppLink,
  parseBoard,
  parseFriends,
  parseHello,
  parseSaveGet,
  parseSavePut,
  parseGrants,
  progressOf,
  refLink,
  shareUrl,
  shouldOfferCloud,
  victoryOf,
} from '../src/game/online/logic';

const ctx: FullContext = loadFullContext();
const D = '2026-10-01';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('онлайн-клиент: офлайн (не Telegram)', () => {
  it('нет Telegram.WebApp — онлайн недоступен, вызовы сразу null без сети', async () => {
    const fetcher = vi.fn();
    expect(initData()).toBeNull();
    expect(onlineAvailable()).toBe(false);
    expect(await call('hello', {}, { fetcher: fetcher as unknown as Fetcher })).toBeNull();
    expect(await api.hello()).toBeNull();
    expect(await api.friends()).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('Telegram без initData (открыто не как Mini App) — тоже офлайн', () => {
    vi.stubGlobal('Telegram', { WebApp: { initData: '' } });
    expect(onlineAvailable()).toBe(false);
  });
});

describe('онлайн-клиент: вызов сервера', () => {
  const tg = () => vi.stubGlobal('Telegram', { WebApp: { initData: 'user=%7B%22id%22%3A1%7D&hash=x' } });

  it('тело — action, initData и поля; ответ 2xx разбирается', async () => {
    tg();
    let sent: Record<string, unknown> = {};
    const fetcher: Fetcher = async (_url, init) => {
      sent = JSON.parse(String(init.body));
      return { ok: true, status: 200, json: async () => ({ ok: true, claimed: 3 }) };
    };
    expect(await call('gift_claim', { x: 1 }, { fetcher })).toEqual({ ok: true, claimed: 3 });
    expect(sent).toMatchObject({ action: 'gift_claim', x: 1 });
    expect(String(sent.initData)).toContain('hash=x');
  });

  it('401/500, исключение сети и таймаут — null, наружу ничего не летит', async () => {
    tg();
    const bad: Fetcher = async () => ({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) });
    const boom: Fetcher = async () => {
      throw new TypeError('Failed to fetch');
    };
    const hang: Fetcher = (_u, init) =>
      new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    const badJson: Fetcher = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } });
    expect(await call('hello', {}, { fetcher: bad })).toBeNull();
    expect(await call('hello', {}, { fetcher: boom })).toBeNull();
    expect(await call('hello', {}, { fetcher: hang, timeoutMs: 20 })).toBeNull();
    expect(await call('hello', {}, { fetcher: badJson })).toBeNull();
  });
});

describe('онлайн-клиент: разбор ответов', () => {
  it('hello', () => {
    const h = parseHello({ ok: true, id: 42, name: 'Вика', fresh: true, cloudSave: { chapter: 3, updated_at: '2026-10-01T10:00:00Z', save_version: 7 }, giftsWaiting: 2, refBonus: 1 });
    expect(h).toEqual({ id: 42, name: 'Вика', fresh: true, cloudSave: { chapter: 3, updatedAt: Date.parse('2026-10-01T10:00:00Z'), saveVersion: 7 }, giftsWaiting: 2, refBonus: 1 });
    expect(parseHello({ ok: true, id: 42, cloudSave: null })?.cloudSave).toBeNull();
    expect(parseHello({ error: 'unauthorized' })).toBeNull();
    expect(parseHello(null)).toBeNull();
    expect(parseHello({ ok: true })).toBeNull();
  });

  it('CAS отличается от версии схемы; 409 — конфликт, {error} при 200 не является записью', () => {
    expect(parseHello({ ok: true, protocol: 2, id: 42, cloudSave: { chapter: 3, save_version: 7, write_revision: 25 } })?.cloudSave?.writeRevision).toBe(25);
    expect(parseSavePut({ ok: true, writeRevision: 26 })).toEqual({ status: 'saved', writeRevision: 26 });
    expect(parseSavePut({ ok: true })).toBeNull();
    expect(parseSavePut({ error: 'server' })).toBeNull();
    expect(parseSavePut({ error: 'save_conflict', cloudSave: { chapter: 4, save_version: 7, write_revision: 27 } })).toMatchObject({ status: 'conflict', cloudSave: { writeRevision: 27 } });
    expect(parseSavePut({ error: 'upgrade_required' })).toEqual({ status: 'upgrade_required' });
  });

  it('недостоверная grant-выдача отвергается; повторы одного ID объединяются', () => {
    const gift = { id: '00000000-0000-4000-8000-000000000001', kind: 'gift', units: 1, gems: 20 };
    expect(parseGrants({ ok: true, grants: [gift, gift] })).toEqual([gift]);
    expect(parseGrants({ ok: true, grants: [gift, { ...gift, id: 'bad' }] })).toBeNull();
    expect(parseGrants({ ok: true, grants: [{ ...gift, gems: 999 }] })).toBeNull();
    expect(parseGrants({ ok: true, grants: [{ ...gift, units: 0 }] })).toBeNull();
    expect(parseGrants({ ok: true, grants: [] })).toEqual([]);
    expect(parseGrants({ claimed: 3 })).toBeNull();
  });

  it('повтор ответа после обрыва связи не удваивает гемы и письма; старое welcome-письмо учитывается', () => {
    const s = newGame(ctx, 0, D);
    const grants = parseGrants({ ok: true, grants: [
      { id: '00000000-0000-4000-8000-000000000001', kind: 'gift', units: 1, gems: 20 },
      { id: '00000000-0000-4000-8000-000000000002', kind: 'ref', units: 2, gems: 400 },
      { id: '00000000-0000-4000-8000-000000000003', kind: 'ref_welcome', units: 1, gems: 100 },
    ] })!;
    const first = applyRewardGrants(s, grants, D, ctx);
    expect(first.bells).toBe(1);
    expect(first.refs).toBe(2);
    expect(first.save.currency.gems).toBe(s.currency.gems + 20);
    expect(first.save.mail?.letters.filter((l) => l.source?.startsWith('online_'))).toHaveLength(2);
    const second = applyRewardGrants(first.save, grants, D, ctx);
    expect(second.save).toBe(first.save);
    expect(second.bells).toBe(0);
    expect(second.refs).toBe(0);
    const old = { ...s, mail: { seq: 0, letters: [], delivered: ['online_ref_welcome'] } };
    const migrated = applyRewardGrants(old, grants.slice(2), D, ctx);
    expect(migrated.save.mail?.letters).toHaveLength(0);
    expect(migrated.save.currency.gems).toBe(s.currency.gems);
  });

  it('друзья, доска, облачное сохранение — мусор отбрасывается', () => {
    const f = parseFriends({ ok: true, friends: [{ id: 7, name: 'Артём', chapter: 2, stage: 5, towerBest: 12, giftSent: true, giftWaiting: false }, { id: 'x' }, null] });
    // Старый сервер не присылает силу — 0 (строка друга тогда без «Сила»).
    expect(f).toEqual([{ id: 7, name: 'Артём', chapter: 2, stage: 5, power: 0, towerBest: 12, giftSent: true, giftWaiting: false }]);
    expect(parseFriends({ ok: true })).toBeNull();
    const b = parseBoard({ ok: true, week: '2026-W40', top: [{ place: 1, name: 'А', value: 50, me: false }, { place: 2, name: 'Б', value: 40, me: true }], mine: { place: 2, value: 40 } });
    expect(b?.top[1].me).toBe(true);
    // Старый сервер: без главы и силы в строках — нули.
    expect(b?.mine).toEqual({ place: 2, value: 40, chapter: 0, stage: 0, power: 0 });
    expect(b?.top[0]).toEqual({ place: 1, name: 'А', value: 50, me: false, chapter: 0, stage: 0, power: 0 });
    expect(parseBoard({ ok: true, top: [], mine: null })?.mine).toBeNull();
    expect(parseSaveGet({ ok: true, save: null })).toBeNull();
    expect(parseSaveGet({ ok: true, save: { data: { version: 7 }, save_version: 7, chapter: 2, updated_at: '2026-10-01T10:00:00Z' } })?.chapter).toBe(2);
  });
});

describe('онлайн-клиент: какое сохранение новее', () => {
  const cloud = (chapter: number, updatedAt: number) => ({ chapter, updatedAt, saveVersion: 7 });
  const H = 3600_000;

  it('нет облачного — не спрашиваем', () => {
    expect(shouldOfferCloud({ chapter: 1, fresh: true, changedAt: 0 }, null)).toBe(false);
  });
  it('здесь новая игра — предлагаем облачное', () => {
    expect(shouldOfferCloud({ chapter: 1, fresh: true, changedAt: 10 * H }, cloud(1, 5 * H))).toBe(true);
  });
  it('облачное дальше по главе — предлагаем; ближе — нет', () => {
    expect(shouldOfferCloud({ chapter: 2, fresh: false, changedAt: 10 * H }, cloud(4, 1 * H))).toBe(true);
    expect(shouldOfferCloud({ chapter: 5, fresh: false, changedAt: 1 * H }, cloud(4, 10 * H))).toBe(false);
  });
  it('та же глава: только если облачное заметно новее последней игры здесь', () => {
    expect(shouldOfferCloud({ chapter: 3, fresh: false, changedAt: 10 * H }, cloud(3, 10 * H + 60_000))).toBe(false);
    expect(shouldOfferCloud({ chapter: 3, fresh: false, changedAt: 10 * H }, cloud(3, 12 * H))).toBe(true);
    expect(shouldOfferCloud({ chapter: 3, fresh: false, changedAt: 0 }, cloud(3, 12 * H))).toBe(false);
  });
  it('от этого облачного сохранения уже отказались — не спрашиваем снова', () => {
    expect(shouldOfferCloud({ chapter: 1, fresh: true, changedAt: 0 }, cloud(4, 5 * H), 5 * H)).toBe(false);
    expect(shouldOfferCloud({ chapter: 1, fresh: true, changedAt: 0 }, cloud(4, 6 * H), 5 * H)).toBe(true);
  });
});

describe('онлайн-клиент: реферальная ссылка', () => {
  it('VITE_TG_APP_LINK: только https://t.me/…, без хвостового слэша', () => {
    expect(normalizeAppLink('https://t.me/chronoworld_bot/play/')).toBe('https://t.me/chronoworld_bot/play');
    expect(normalizeAppLink('https://t.me/chronoworld_bot')).toBe('https://t.me/chronoworld_bot');
    expect(normalizeAppLink('')).toBeNull();
    expect(normalizeAppLink(undefined)).toBeNull();
    expect(normalizeAppLink('https://example.com/x')).toBeNull();
    expect(normalizeAppLink('javascript:alert(1)')).toBeNull();
  });
  it('ссылка с startapp=ref_<id> и окно «Поделиться»', () => {
    const app = 'https://t.me/chronoworld_bot/play';
    expect(refLink(app, 12345)).toBe('https://t.me/chronoworld_bot/play?startapp=ref_12345');
    const u = new URL(shareUrl(app, 12345, 'Привет'));
    expect(u.origin + u.pathname).toBe('https://t.me/share/url');
    expect(u.searchParams.get('url')).toBe('https://t.me/chronoworld_bot/play?startapp=ref_12345');
    expect(u.searchParams.get('text')).toBe('Привет');
  });
});

describe('онлайн-клиент: прогресс, победы, зачёт MVP', () => {
  it('новичок — глава 1, этап 1; пройдена глава 1 — глава 2', () => {
    const s = newGame(ctx, 0, D);
    expect(isFreshSave(s)).toBe(true);
    expect(progressOf(s, ctx)).toEqual({ chapter: 1, stage: 1 });
    const ch1 = ctx.content.chapters.find((c) => c.order === 1)!;
    const ids = ctx.content.stages.filter((st) => st.chapter === ch1.id).map((st) => st.id);
    const done: SaveState = { ...s, campaign: { cleared: ids } };
    expect(progressOf(done, ctx).chapter).toBe(2);
    expect(progressOf(done, ctx).stage).toBe(1);
    expect(progressOf({ ...s, campaign: { cleared: ids.slice(0, 3) } }, ctx)).toEqual({ chapter: 1, stage: 4 });
  });

  it('победы: этап, этаж Башни, бой охоты; прочее — нет', () => {
    const s = newGame(ctx, 0, D);
    expect(victoryOf(s, { ...s, campaign: { cleared: ['x'] } })).toBe('stage');
    expect(victoryOf(s, { ...s, tower: { ...s.tower, floor: 3 } })).toBe('tower');
    expect(victoryOf(s, { ...s, hunt: { day: D, used: 1, best: {} } })).toBe('hunt');
    expect(victoryOf(s, { ...s, resources: { ...s.resources, gold: 999 } })).toBeNull();
  });

  it('недельный зачёт MVP: учитывается каждая попытка, в том числе ниже пожизненного рекорда', () => {
    const w = nextMvpWeek(null, '2026-W40', 800);
    expect(w).toEqual({ week: '2026-W40', value: 800 });
    expect(nextMvpWeek(w, '2026-W40', 300)).toBe(w);
    // На следующей неделе результат 600 учитывается, хотя 800 за всё время остаётся непобитым.
    expect(nextMvpWeek(w, '2026-W41', 600)).toEqual({ week: '2026-W41', value: 600 });
    expect(nextMvpWeek(w, '2026-W41', NaN)).toEqual({ week: '2026-W41', value: 0 });
  });

  it('ISO-неделя совпадает с серверной', () => {
    for (const d of ['2026-01-01', '2026-10-01', '2026-12-31', '2027-01-03', '2027-01-04', '2020-12-31']) {
      const date = new Date(`${d}T12:00:00Z`);
      expect(isoWeek(date)).toBe(serverWeek(date));
    }
  });
});

describe('онлайн-клиент: мелочи', () => {
  it('облачное сохранение — не чаще раза в минуту', () => {
    expect(cloudSaveDelay(1000, 0)).toBe(0);
    expect(cloudSaveDelay(100_000, 90_000)).toBe(50_000);
    expect(cloudSaveDelay(200_000, 90_000)).toBe(0);
  });
  it('«X назад» по-русски и числа с пробелами', () => {
    expect(agoText(10_000)).toBe('только что');
    expect(agoText(5 * 60_000)).toBe('5 минут назад');
    expect(agoText(21 * 60_000)).toBe('21 минуту назад');
    expect(agoText(3 * 3600_000)).toBe('3 часа назад');
    expect(agoText(2 * 86400_000)).toBe('2 дня назад');
    expect(groupDigits(1234567)).toBe('1 234 567');
  });
});
