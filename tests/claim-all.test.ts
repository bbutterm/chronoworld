import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  achievementStatus,
  actClaimAllAchievements,
  actClaimAllQuests,
  claimAllQuests,
  newGame,
  questStatus,
  recordActivity,
  trackAchievement,
  withFeatures,
  withMeta,
  withTower,
} from '../src/core';
import { towerBadgeCount } from '../src/game/flow';
import { loadGameContext } from '../scripts/lib/content-node';

const root = join(import.meta.dirname, '..');
const read = (f: string) => JSON.parse(readFileSync(join(root, f), 'utf8'));
const ctx = withTower(
  withMeta(withFeatures(loadGameContext(), read('data/progression.json'), read('data/quests.json')), read('data/expeditions.json'), read('data/achievements.json')),
  read('data/tower.json'),
);
const D1 = '2026-09-26';

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
  it('башня (рогалик): кружок, пока добыча дня не взята или в забеге ждёт выбор', () => {
    const s = newGame(ctx, 0, D1);
    // Башня закрыта в новой игре.
    expect(towerBadgeCount(s, ctx, D1)).toBe(0);
    const open = { ...s, campaign: { ...s.campaign, cleared: [...new Set([...s.campaign.cleared, ctx.tower.unlockAfterStage!])] } };
    expect(towerBadgeCount(open, ctx, D1)).toBe(1);
    // Забег сегодня уже был — добыча взята.
    const done = { ...open, tower: { ...open.tower, lootDay: D1, lootFloor: 5 } };
    expect(towerBadgeCount(done, ctx, D1)).toBe(0);
    expect(towerBadgeCount(done, ctx, '2026-09-27')).toBe(1);
  });
});
