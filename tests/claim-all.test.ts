import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  achievementStatus,
  actClaimAllAchievements,
  actClaimAllBounties,
  actClaimAllQuests,
  addHeroCard,
  busyHeroes,
  claimAllBounties,
  claimAllQuests,
  claimBounty,
  dispatchAllBounties,
  heroRole,
  newGame,
  planDispatchAll,
  questStatus,
  recordActivity,
  startBounty,
  trackAchievement,
  withFeatures,
  withMeta,
  withTower,
  type Bounty,
  type CardRarity,
  type SaveState,
} from '../src/core';
import { bountiesBadgeCount, dispatchableBounties, towerBadgeCount } from '../src/game/flow';
import { loadGameContext } from '../scripts/lib/content-node';

const root = join(import.meta.dirname, '..');
const read = (f: string) => JSON.parse(readFileSync(join(root, f), 'utf8'));
const ctx = withTower(
  withMeta(withFeatures(loadGameContext(), read('data/progression.json'), read('data/quests.json')), read('data/bounties.json'), read('data/achievements.json')),
  read('data/tower.json'),
);
const D1 = '2026-09-26';
const MIN = 60_000;

const bounty = (id: string, patch: Partial<Bounty> = {}): Bounty => ({
  id,
  templateId: 'patrol',
  rarity: 'common',
  durationMinutes: 30,
  heroCount: 1,
  role: null,
  rewards: { gold: 100, jobExp: 20, gems: 1 },
  ...patch,
});

/** Сохранение без героев новой игры: только перечисленные карточки (шаблон, редкость) и доска board. */
function withRoster(cards: [string, CardRarity][], board: Bounty[]): SaveState {
  let s: SaveState = { ...newGame(ctx, 0, D1), heroes: [] };
  for (const [t, r] of cards) s = addHeroCard(s, t, r).save;
  return { ...s, bounties: { ...s.bounties, board, lastRefreshDay: D1 } };
}

const idOf = (s: SaveState, templateId: string, nth = 0) => s.heroes.filter((h) => h.templateId === templateId)[nth].id;

describe('«Отправить всё» (planDispatchAll / dispatchAllBounties)', () => {
  it('роль обязательна: танк идёт на поручение с танком, а не на патруль', () => {
    // Патруль первым на доске, караван с танком — вторым; танк один.
    const s = withRoster([['otto', 'green'], ['cecil', 'green'], ['celia', 'green']], [bounty('p'), bounty('c', { heroCount: 2, role: 'tank' })]);
    const plan = planDispatchAll(s, ctx);
    const c = plan.find((p) => p.bountyId === 'c')!;
    expect(c.heroIds).toContain(idOf(s, 'otto'));
    expect(c.heroIds).toHaveLength(2);
    expect(plan.find((p) => p.bountyId === 'p')!.heroIds).not.toContain(idOf(s, 'otto'));
  });

  it('нет героя нужной роли или не хватает героев — поручение пропускается целиком', () => {
    const s = withRoster([['cecil', 'green'], ['celia', 'green']], [bounty('c', { heroCount: 2, role: 'tank' }), bounty('big', { heroCount: 3 }), bounty('p')]);
    const plan = planDispatchAll(s, ctx);
    expect(plan.map((p) => p.bountyId)).toEqual(['p']);
    expect(plan[0].heroIds).toHaveLength(1);
  });

  it('герой не бронируется дважды и занятые не берутся', () => {
    const board = [bounty('a'), bounty('b'), bounty('c'), bounty('d', { heroCount: 2 })];
    let s = withRoster([['otto', 'green'], ['cecil', 'green'], ['celia', 'green'], ['margaretha', 'green']], board);
    s = startBounty(s, 'a', [idOf(s, 'cecil')], 0, ctx);
    const plan = planDispatchAll(s, ctx);
    const ids = plan.flatMap((p) => p.heroIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(idOf(s, 'cecil'));
    // Свободно трое: двое на «d» (больше героев — раньше), один на «b»; «c» ждёт.
    expect(plan.map((p) => p.bountyId)).toEqual(['d', 'b']);
  });

  it('редкость: эпическое поручение — старшая карточка, обычное — младшая', () => {
    const s = withRoster([['cecil', 'green'], ['zara', 'gold']], [bounty('common'), bounty('epic', { rarity: 'epic' })]);
    const plan = planDispatchAll(s, ctx);
    expect(plan[0]).toEqual({ bountyId: 'epic', heroIds: [idOf(s, 'zara')] });
    expect(plan[1]).toEqual({ bountyId: 'common', heroIds: [idOf(s, 'cecil')] });
  });

  it('dispatchAllBounties проходит проверки startBounty и детерминирован', () => {
    const s = withRoster(
      [['otto', 'green'], ['randel', 'blue'], ['cecil', 'green'], ['celia', 'purple'], ['margaretha', 'green']],
      [bounty('a', { heroCount: 2, role: 'tank' }), bounty('b', { rarity: 'rare', heroCount: 2, role: 'healer' }), bounty('c')],
    );
    const r = dispatchAllBounties(s, 1000, ctx);
    expect(r).toEqual(dispatchAllBounties(s, 1000, ctx));
    expect(r.started.map((b) => b.id)).toEqual(['b', 'a', 'c']);
    expect(r.save.bounties.board).toEqual([]);
    expect(busyHeroes(r.save)).toHaveLength(5);
    for (const a of r.save.bounties.active) {
      expect(a.endsAt).toBe(1000 + a.durationMinutes * MIN);
      if (a.role) expect(a.heroIds.some((id) => heroRole(r.save.heroes.find((h) => h.id === id)!, ctx) === a.role)).toBe(true);
    }
    // Всех отправили — повтор ничего не делает, тот же объект.
    const again = dispatchAllBounties(r.save, 2000, ctx);
    expect(again.started).toEqual([]);
    expect(again.save).toBe(r.save);
  });
});

describe('«Забрать всё» поручений', () => {
  it('забирает только завершённые, награды суммируются так же, как по одному', () => {
    const s0 = withRoster([['otto', 'green'], ['cecil', 'green'], ['celia', 'green']], [
      bounty('a', { durationMinutes: 30, rewards: { gold: 100, jobExp: 10, gems: 1 } }),
      bounty('b', { durationMinutes: 60, rewards: { gold: 200, jobExp: 20, gems: 2 } }),
      bounty('c', { durationMinutes: 600 }),
    ]);
    const s = dispatchAllBounties(s0, 0, ctx).save;
    const at = 60 * MIN;
    const r = claimAllBounties(s, at, ctx);
    expect(r.claimed.sort()).toEqual(['a', 'b']);
    expect(r.rewards).toEqual({ gold: 300, gems: 3, jobExp: 30, shards: 0 });
    expect(r.save.bounties.active.map((b) => b.id)).toEqual(['c']);
    // То же, что два claimBounty подряд.
    const one = claimBounty(claimBounty(s, 'a', at, ctx).save, 'b', at, ctx).save;
    expect(r.save.resources).toEqual(one.resources);
    expect(r.save.currency).toEqual(one.currency);
    expect(r.save.achievements.counters.bounties_done).toBe(2);
    // Нечего забрать — тот же объект.
    expect(claimAllBounties(r.save, at, ctx).save).toBe(r.save);
    expect(actClaimAllBounties(r.save, D1, at, ctx).claimed).toEqual([]);
  });
});

describe('«Забрать всё» заданий и достижений', () => {
  it('claimAllQuests: все выполненные задания, затем все пороги, до которых добрали очки', () => {
    let s = newGame(ctx, 0, D1);
    for (const q of ctx.features.quests.quests) s = recordActivity(s, D1, q.event, q.target);
    const r = claimAllQuests(s, D1, ctx);
    expect(r.quests).toEqual(ctx.features.quests.quests.map((q) => q.id));
    const max = ctx.features.quests.quests.reduce((n, q) => n + q.points, 0);
    expect(r.points).toBe(max);
    const reached = ctx.features.quests.milestones.filter((m) => m.points <= max);
    expect(r.milestones).toEqual(reached.map((m) => m.points));
    const sum = (k: 'gold' | 'gems' | 'jobExp') => reached.reduce((n, m) => n + (m.rewards[k] ?? 0), 0);
    expect(r.rewards).toEqual({ gold: sum('gold'), gems: sum('gems'), jobExp: sum('jobExp') });
    expect(r.save.resources.gold).toBe(s.resources.gold + sum('gold'));
    expect(r.save.currency.gems).toBe(s.currency.gems + sum('gems'));
    const st = questStatus(r.save, ctx, D1);
    expect(st.quests.every((q) => q.claimed)).toBe(true);
    // Повтор — ничего.
    const again = actClaimAllQuests(r.save, D1, ctx);
    expect(again.quests).toEqual([]);
    expect(again.milestones).toEqual([]);
    expect(again.save.resources).toEqual(r.save.resources);
  });

  it('claimAllQuests: невыполненные задания не трогает', () => {
    const q = ctx.features.quests.quests[0];
    const s = recordActivity(newGame(ctx, 0, D1), D1, q.event, q.target);
    const r = claimAllQuests(s, D1, ctx);
    expect(r.quests).toEqual(ctx.features.quests.quests.filter((x) => x.event === q.event && x.target <= q.target).map((x) => x.id));
  });

  it('actClaimAllAchievements: все выполненные, награды суммируются', () => {
    let s = newGame(ctx, 0, D1);
    s = trackAchievement(s, 'bounties_done', 1000, 'add');
    const ready = achievementStatus(s, ctx).filter((a) => a.done && !a.claimed);
    expect(ready.length).toBeGreaterThan(1);
    const r = actClaimAllAchievements(s, D1, ctx);
    expect(r.claimed).toEqual(expect.arrayContaining(ready.map((a) => a.id)));
    expect(r.rewards.gold).toBeGreaterThanOrEqual(ready.reduce((n, a) => n + a.rewards.gold, 0));
    expect(achievementStatus(r.save, ctx).filter((a) => a.done && !a.claimed)).toEqual([]);
    expect(actClaimAllAchievements(r.save, D1, ctx).claimed).toEqual([]);
  });
});

describe('красные кружки плиток главной', () => {
  it('поручения: завершённые + доступные к отправке', () => {
    const s0 = withRoster([['otto', 'green'], ['cecil', 'green']], [bounty('a'), bounty('b'), bounty('c')]);
    expect(dispatchableBounties(s0, ctx)).toBe(2);
    expect(bountiesBadgeCount(s0, 0, ctx)).toBe(2);
    const s = dispatchAllBounties(s0, 0, ctx).save;
    expect(bountiesBadgeCount(s, 0, ctx)).toBe(0);
    expect(bountiesBadgeCount(s, 30 * MIN, ctx)).toBe(2);
  });

  it('башня: кружок, когда мощь отряда не ниже мощи следующего этажа', () => {
    const s = newGame(ctx, 0, D1);
    // Башня закрыта в новой игре.
    expect(towerBadgeCount(s, ctx)).toBe(0);
    const open = { ...s, campaign: { ...s.campaign, cleared: [...new Set([...s.campaign.cleared, ctx.tower.unlockAfterStage!])] } };
    const strong = { ...open, heroes: open.heroes.map((h) => ({ ...h, level: 20 })) };
    expect(towerBadgeCount(strong, ctx)).toBe(1);
    const top = { ...strong, tower: { floor: ctx.tower.maxFloor } };
    expect(towerBadgeCount(top, ctx)).toBe(0);
  });
});
