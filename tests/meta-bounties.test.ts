import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addJobExp,
  bountyName,
  bountyStatus,
  busyHeroes,
  claimBounty,
  ensureBoard,
  generateBoard,
  MetaError,
  newGame,
  refreshBoard,
  refreshesLeft,
  startBounty,
  withMeta,
  type Bounty,
  type SaveState,
} from '../src/core';
import { loadGameContext } from '../scripts/lib/content-node';

const root = join(import.meta.dirname, '..');
const read = (f: string) => JSON.parse(readFileSync(join(root, f), 'utf8'));
const bountiesJson = read('data/bounties.json');
const ctx = withMeta(loadGameContext(), bountiesJson, read('data/achievements.json'));
const D1 = '2026-09-26';
const D2 = '2026-09-27';
const MIN = 60_000;

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(MetaError);
    return (e as MetaError).code;
  }
  return undefined;
}

/** Сохранение с одним поручением на доске (для точных проверок). */
function withBounty(patch: Partial<Bounty> = {}): SaveState {
  const s = newGame(ctx, 0, D1);
  const b: Bounty = { id: 'b1', templateId: 'patrol', rarity: 'common', durationMinutes: 30, heroCount: 2, role: null, rewards: { gold: 100, jobExp: 20, gems: 3 }, ...patch };
  return { ...s, bounties: { ...s.bounties, board: [b], lastRefreshDay: D1 } };
}

describe('K9 доска поручений', () => {
  it('ensureBoard: новая игра → доска на день, детерминированно по seed и дню', () => {
    const s = newGame(ctx, 0, D1);
    expect(s.bounties.board).toEqual([]);
    const a = ensureBoard(s, D1, 7, ctx);
    expect(a.bounties.board).toHaveLength(ctx.meta.bounties.boardSize);
    expect(a.bounties.lastRefreshDay).toBe(D1);
    expect(ensureBoard(s, D1, 7, ctx)).toEqual(a);
    expect(new Set(a.bounties.board.map((b) => b.id)).size).toBe(a.bounties.board.length);
    // Тот же день — тот же объект; следующий день — новая доска.
    expect(ensureBoard(a, D1, 99, ctx)).toBe(a);
    const b = ensureBoard(a, D2, 7, ctx);
    expect(b.bounties.board.map((x) => x.id)).not.toEqual(a.bounties.board.map((x) => x.id));
    // Часы назад — доска и счётчик те же, день принимается (P11, T4-07).
    const back = ensureBoard(b, D1, 7, ctx);
    expect(back.bounties).toEqual({ ...b.bounties, lastRefreshDay: D1 });
    expect(codeOf(() => ensureBoard(s, '26.09.2026', 1, ctx))).toBe('invalid_day');
  });

  it('поручения — снимки шаблонов; разные seed дают разные доски, редкости по весам', () => {
    const board = generateBoard(D1, 1, 0, ctx);
    for (const b of board) {
      const t = ctx.meta.bounties.templates.find((x) => x.id === b.templateId)!;
      expect(b).toMatchObject({ rarity: t.rarity, durationMinutes: t.durationMinutes, heroCount: t.heroCount, role: t.role });
      expect(bountyName(b, ctx)).toBe(t.name);
    }
    expect(bountyName({ templateId: 'gone' }, ctx)).toBe('gone');
    const seen = new Set<string>();
    const count: Record<string, number> = {};
    for (let seed = 0; seed < 200; seed++) {
      const g = generateBoard(D1, seed, 0, ctx);
      seen.add(g.map((b) => b.templateId).join());
      for (const b of g) count[b.rarity] = (count[b.rarity] ?? 0) + 1;
    }
    expect(seen.size).toBeGreaterThan(10);
    expect(count.common).toBeGreaterThan(count.rare);
    expect(count.rare).toBeGreaterThan(count.epic ?? 0);
  });

  it('T3-12: на доске нет двух одинаковых поручений, пока в каталоге хватает шаблонов', () => {
    const catalog = ctx.meta.bounties.templates.length;
    const size = ctx.meta.bounties.boardSize;
    for (let seed = 0; seed < 300; seed++) {
      const ids = generateBoard(D1, seed, 0, ctx).map((b) => b.templateId);
      expect(new Set(ids).size).toBe(Math.min(size, catalog));
    }
    // Доска больше каталога — повторы допустимы, но доска полная.
    const tiny = { ...ctx, meta: { ...ctx.meta, bounties: { ...ctx.meta.bounties, boardSize: catalog + 3 } } };
    const big = generateBoard(D1, 5, 0, tiny);
    expect(big).toHaveLength(catalog + 3);
    expect(new Set(big.map((b) => b.templateId)).size).toBe(catalog);
  });

  it('refreshBoard: ручные обновления ограничены dailyRefreshes, в новый день бесплатно', () => {
    const cfg = { ...bountiesJson, dailyRefreshes: 2 };
    const c2 = withMeta(loadGameContext(), cfg, read('data/achievements.json'));
    let s = ensureBoard(newGame(ctx, 0, D1), D1, 1, c2);
    expect(refreshesLeft(s, D1, c2)).toBe(2);
    const r1 = refreshBoard(s, D1, 1, c2);
    expect(r1.bounties.refreshesUsed).toBe(1);
    expect(r1.bounties.board).not.toEqual(s.bounties.board);
    expect(refreshBoard(s, D1, 1, c2)).toEqual(r1);
    s = refreshBoard(r1, D1, 1, c2);
    expect(refreshesLeft(s, D1, c2)).toBe(0);
    expect(codeOf(() => refreshBoard(s, D1, 1, c2))).toBe('refresh_limit');
    // Часы назад — тот же лимит.
    expect(codeOf(() => refreshBoard(s, '2026-09-01', 1, c2))).toBe('refresh_limit');
    expect(refreshesLeft(s, D2, c2)).toBe(2);
    const n = refreshBoard(s, D2, 1, c2);
    expect(n).toEqual(ensureBoard(s, D2, 1, c2));
    expect(n.bounties.refreshesUsed).toBe(0);
  });

  it('обновление доски не трогает поручения в работе', () => {
    const s = startBounty(withBounty(), 'b1', ['h1', 'h2'], 0, ctx);
    const n = ensureBoard(s, D2, 3, ctx);
    expect(n.bounties.active).toEqual(s.bounties.active);
  });

  it('startBounty: с доски в работу, таймер, герои заняты', () => {
    const s = withBounty();
    const a = startBounty(s, 'b1', ['h2', 'h1'], 1000, ctx);
    expect(a.bounties.board).toEqual([]);
    expect(a.bounties.active).toEqual([{ ...s.bounties.board[0], heroIds: ['h2', 'h1'], startedAt: 1000, endsAt: 1000 + 30 * MIN }]);
    expect(busyHeroes(a)).toEqual(['h2', 'h1']);
    expect(s.bounties.active).toEqual([]);
    // Занятый герой не может на второе поручение, но отряд/бои не ограничены (save.squad не трогается).
    expect(a.squad).toEqual(s.squad);
    const two = { ...a, bounties: { ...a.bounties, board: [{ ...s.bounties.board[0], id: 'b2' }] } };
    expect(codeOf(() => startBounty(two, 'b2', ['h1', 'h3'], 0, ctx))).toBe('hero_busy');
    const solo = { ...a, bounties: { ...a.bounties, board: [{ ...s.bounties.board[0], id: 'b2', heroCount: 1 }] } };
    expect(startBounty(solo, 'b2', ['h3'], 0, ctx).bounties.active).toHaveLength(2);
  });

  it('startBounty: ошибки', () => {
    const s = withBounty();
    expect(codeOf(() => startBounty(s, 'nope', ['h1', 'h2'], 0, ctx))).toBe('unknown_bounty');
    expect(codeOf(() => startBounty(s, 'b1', ['h1'], 0, ctx))).toBe('wrong_hero_count');
    expect(codeOf(() => startBounty(s, 'b1', ['h1', 'h1'], 0, ctx))).toBe('duplicate_hero');
    expect(codeOf(() => startBounty(s, 'b1', ['h1', 'h99'], 0, ctx))).toBe('unknown_hero');
    const tank = withBounty({ role: 'tank' });
    expect(codeOf(() => startBounty(tank, 'b1', ['h1', 'h2'], 0, ctx))).toBe('role_required');
    const withTank = { ...tank, heroes: tank.heroes.map((h) => (h.id === 'h2' ? { ...h, job: 'swordman' } : h)) };
    expect(startBounty(withTank, 'b1', ['h1', 'h2'], 0, ctx).bounties.active).toHaveLength(1);
  });

  it('bountyStatus и claimBounty: только после окончания, награда группе, достижение', () => {
    const s = startBounty(withBounty(), 'b1', ['h1', 'h2'], 1000, ctx);
    const end = 1000 + 30 * MIN;
    const st = bountyStatus(s, end - MIN);
    expect(st.active[0]).toMatchObject({ remainingMs: MIN, done: false });
    expect(st.busyHeroes).toEqual(['h1', 'h2']);
    expect(bountyStatus(s, end).active[0]).toMatchObject({ remainingMs: 0, done: true });
    expect(bountyStatus(s, 0).active[0].done).toBe(false);

    expect(codeOf(() => claimBounty(s, 'b1', end - 1, ctx))).toBe('bounty_not_finished');
    expect(codeOf(() => claimBounty(s, 'b9', end, ctx))).toBe('unknown_bounty');
    const r = claimBounty(s, 'b1', end, ctx);
    expect(r.rewards).toEqual({ gold: 100, jobExp: 20, gems: 3 });
    expect(r.save.resources.gold).toBe(s.resources.gold + 100);
    expect(r.save.currency.gems).toBe(s.currency.gems + 3);
    expect(r.save.bounties.active).toEqual([]);
    expect(busyHeroes(r.save)).toEqual([]);
    const hero = (save: SaveState, id: string) => save.heroes.find((h) => h.id === id)!;
    // Опыт начислен через addJobExp (у Новичка 20 опыта — уже несколько уровней).
    expect(hero(r.save, 'h1')).toEqual(addJobExp(hero(s, 'h1'), 20, ctx).hero);
    expect(hero(r.save, 'h3')).toEqual(hero(s, 'h3'));
    expect(r.save.achievements.counters.bounties_done).toBe(1);
    expect(r.events[0]).toEqual({ type: 'bountyDone', bountyId: 'b1', heroIds: ['h1', 'h2'] });
    expect(r.events).toContainEqual({ type: 'gems', amount: 3 });
    expect(codeOf(() => claimBounty(r.save, 'b1', end, ctx))).toBe('unknown_bounty');
  });
});
