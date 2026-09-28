import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  achievementStatus,
  actLevelUp,
  actClimbTower,
  actPlayStage,
  claimAchievement,
  maxHeroLevel,
  MetaError,
  newGame,
  playStage,
  syncAchievementCounters,
  trackAchievement,
  withFeatures,
  withMeta,
  withTower,
  type AchievementCounter,
  type SaveState,
} from '../src/core';
import { loadGameContext } from '../scripts/lib/content-node';

const root = join(import.meta.dirname, '..');
const read = (f: string) => JSON.parse(readFileSync(join(root, f), 'utf8'));
const ctx = withMeta(
  withTower(withFeatures(loadGameContext(), read('data/progression.json'), read('data/quests.json')), read('data/tower.json')),
  read('data/expeditions.json'),
  read('data/achievements.json'),
);
const D1 = '2026-09-26';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(MetaError);
    return (e as MetaError).code;
  }
  return undefined;
}

describe('K10 счётчики', () => {
  it('trackAchievement: add копит, max хранит максимум, режим по умолчанию — из ACHIEVEMENT_COUNTERS', () => {
    const s = newGame(ctx, 0);
    const a = trackAchievement(s, 'battles_won', 2, 'add');
    expect(a.achievements.counters).toEqual({ battles_won: 2 });
    expect(s.achievements.counters).toEqual({});
    expect(trackAchievement(a, 'battles_won', 3).achievements.counters.battles_won).toBe(5);
    expect(trackAchievement(a, 'battles_won', 0)).toBe(a);
    expect(trackAchievement(a, 'battles_won', -4, 'add')).toBe(a);
    const m = trackAchievement(a, 'tower_floor', 5, 'max');
    expect(trackAchievement(m, 'tower_floor', 3).achievements.counters.tower_floor).toBe(5);
    expect(trackAchievement(m, 'tower_floor', 3)).toBe(m);
    expect(trackAchievement(m, 'tower_floor', 8.9).achievements.counters.tower_floor).toBe(8);
    expect(codeOf(() => trackAchievement(s, 'nope' as AchievementCounter, 1))).toBe('invalid_counter');
    expect(codeOf(() => trackAchievement(s, 'battles_won', NaN))).toBe('invalid_counter');
  });

  it('syncAchievementCounters: этапы, этаж, наибольший уровень карточки', () => {
    const s = newGame(ctx, 0);
    const p: SaveState = {
      ...s,
      campaign: { cleared: ['a', 'b', 'b'] },
      tower: { floor: 3 },
      heroes: s.heroes.map((h, i) => (i === 1 ? { ...h, level: 12 } : h)),
    };
    expect(maxHeroLevel(p)).toBe(12);
    expect(syncAchievementCounters(p).achievements.counters).toEqual({ stages_cleared: 2, tower_floor: 3, hero_max_level: 12 });
  });
});

describe('K10 статус и награды', () => {
  it('achievementStatus: прогресс ограничен target, done/claimed', () => {
    const s = trackAchievement(newGame(ctx, 0), 'battles_won', 15);
    const st = achievementStatus(s, ctx);
    expect(st.map((a) => a.id)).toEqual(ctx.meta.achievements.achievements.map((a) => a.id));
    expect(st.find((a) => a.id === 'battles_10')).toMatchObject({ progress: 10, done: true, claimed: false });
    expect(st.find((a) => a.id === 'battles_100')).toMatchObject({ progress: 15, done: false });
  });

  it('claimAchievement: награда один раз; не выполнено / неизвестно → ошибки', () => {
    const s = newGame(ctx, 0);
    expect(codeOf(() => claimAchievement(s, 'first_ascend', ctx))).toBe('achievement_not_done');
    expect(codeOf(() => claimAchievement(s, 'nope', ctx))).toBe('unknown_achievement');
    const done = trackAchievement(trackAchievement(s, 'ascensions', 1), 'battles_won', 10);
    const r = claimAchievement(done, 'first_ascend', ctx);
    const def = ctx.meta.achievements.achievements.find((a) => a.id === 'first_ascend')!;
    expect(r.rewards).toEqual(def.rewards);
    expect(r.save.achievements.claimed).toEqual(['first_ascend']);
    expect(r.events[0]).toEqual({ type: 'achievementClaimed', achievementId: 'first_ascend' });
    // Осколки награды — «отстающему» сюжетному герою (все зелёные, осколков нет — первый по сюжету, Алан).
    expect(def.rewards.shards).toBeGreaterThan(0);
    expect(r.save.shards).toEqual({ alan: def.rewards.shards });
    expect(r.events).toContainEqual({ type: 'shards', templateId: 'alan', count: def.rewards.shards });
    expect(achievementStatus(r.save, ctx).find((a) => a.id === 'first_ascend')!.claimed).toBe(true);
    expect(codeOf(() => claimAchievement(r.save, 'first_ascend', ctx))).toBe('achievement_already_claimed');

    const g = claimAchievement(done, 'battles_10', ctx);
    expect(g.save.resources.gold).toBe(done.resources.gold + ctx.meta.achievements.achievements.find((a) => a.id === 'battles_10')!.rewards.gold);
  });
});

describe('K10 учёт через обёртки act*', () => {
  it('actPlayStage: победа → battles_won и stages_cleared', () => {
    const s = newGame(ctx, 0, D1);
    const stage = ctx.content.stages[0].id;
    let seed = 1;
    while (playStage(s, stage, seed, ctx).result.winner !== 'A') seed++;
    const out = actPlayStage(s, D1, stage, seed, ctx);
    expect(out.save.achievements.counters).toMatchObject({ battles_won: 1, stages_cleared: 1 });
    expect(achievementStatus(out.save, ctx).find((a) => a.id === 'first_stage')!.done).toBe(true);
  });

  it('actLevelUp → hero_max_level', () => {
    const s = newGame(ctx, 0, D1);
    const rich = { ...s, resources: { gold: 1e6, heroExp: 1e6 } };
    const out = actLevelUp(rich, D1, 'h1', ctx, 9);
    expect(out.save.achievements.counters).toMatchObject({ hero_max_level: 10 });
  });

  it('actClimbTower: победа → tower_floor и battles_won, поражение — только попытка', () => {
    const s = newGame(ctx, 0, D1);
    const open = { ...s, campaign: { cleared: ctx.content.stages.map((x) => x.id) } };
    const easy = { ...ctx, tower: { ...ctx.tower, baseMult: 0.01 } };
    const win = actClimbTower(open, D1, 1, easy);
    expect(win.save.achievements.counters).toMatchObject({ tower_floor: 1, battles_won: 1 });
    const hard = { ...ctx, tower: { ...ctx.tower, baseMult: 1000 } };
    const lose = actClimbTower(open, D1, 1, hard);
    expect(lose.save.achievements.counters.battles_won).toBeUndefined();
    expect(lose.save.achievements.counters.tower_floor).toBeUndefined();
    expect(lose.save.daily.quests.tower_attempt).toBe(1);
  });
});
