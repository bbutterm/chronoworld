import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  claimActivity,
  claimQuest,
  FeatureError,
  newGame,
  questStatus,
  recordActivity,
  withFeatures,
  type FeatureContext,
  type FeatureErrorCode,
  type SaveState,
} from '../src/core';
import { loadGameContext } from '../scripts/lib/content-node';

const root = join(import.meta.dirname, '..');
const read = (f: string) => JSON.parse(readFileSync(join(root, f), 'utf8'));
const base = loadGameContext();
const progressionJson = read('data/progression.json');
const ctx = withFeatures(base, progressionJson, read('data/quests.json'));
const D1 = '2026-09-26';
const D2 = '2026-09-27';

/** Тестовый набор заданий, не зависящий от data/quests.json. */
const tctx: FeatureContext = withFeatures(base, progressionJson, {
  quests: [
    { id: 'win', name: 'Победы', event: 'stage_win', target: 2, points: 30 },
    { id: 'chest', name: 'Сундук', event: 'offline_claim', target: 1, points: 30 },
    { id: 'lvl', name: 'Уровни', event: 'hero_level_up', target: 1, points: 40 },
  ],
  milestones: [
    { points: 30, rewards: { gold: 100 } },
    { points: 60, rewards: { gems: 25 } },
    { points: 100, rewards: { jobExp: 50 } },
  ],
});

function expectFeatureError(fn: () => unknown, code: FeatureErrorCode) {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(FeatureError);
  expect((err as FeatureError).code).toBe(code);
}

const fresh = (): SaveState => newGame(ctx, 0, D1);

describe('K5 ежедневные задания', () => {
  it('data/quests.json: все задания достижимы по очкам до последнего порога', () => {
    const st = questStatus(fresh(), ctx);
    expect(st.quests.length).toBeGreaterThan(0);
    expect(st.maxActivity).toBeGreaterThanOrEqual(ctx.features.quests.milestones.at(-1)!.points);
  });

  it('recordActivity копит счётчики, не меняет исходный save, amount ≤ 0 игнорируется', () => {
    const s = fresh();
    const a = recordActivity(s, D1, 'stage_win');
    const b = recordActivity(a, D1, 'stage_win', 3);
    expect(b.daily.quests).toEqual({ stage_win: 4 });
    expect(s.daily.quests).toEqual({});
    expect(recordActivity(b, D1, 'stage_win', 0)).toEqual(b);
  });

  it('счётчики и полученные награды сбрасываются в новый день', () => {
    let s = recordActivity(fresh(), D1, 'stage_win', 2);
    s = claimQuest(s, D1, 'win', tctx).save;
    const next = recordActivity(s, D2, 'offline_claim');
    expect(next.daily).toMatchObject({ day: D2, fastRewardsUsed: 0, quests: { offline_claim: 1 }, claimedQuests: [], activityClaimed: [] });
    expect(questStatus(s, tctx, D2).quests.every((q) => q.progress === 0 && !q.claimed)).toBe(true);
  });

  it('questStatus: прогресс ограничен target, done/claimed, очки активности', () => {
    const s = recordActivity(fresh(), D1, 'stage_win', 5);
    const st = questStatus(s, tctx);
    expect(st.quests[0]).toMatchObject({ id: 'win', progress: 2, done: true, claimed: false });
    expect(st.quests[1]).toMatchObject({ progress: 0, done: false });
    expect(st.activity).toBe(0);
    expect(st.maxActivity).toBe(100);
  });

  it('claimQuest: очки активности один раз; не выполнено / неизвестно / повтор → ошибки', () => {
    let s = recordActivity(fresh(), D1, 'stage_win', 1);
    expectFeatureError(() => claimQuest(s, D1, 'win', tctx), 'quest_not_done');
    expectFeatureError(() => claimQuest(s, D1, 'nope', tctx), 'unknown_quest');
    s = recordActivity(s, D1, 'stage_win');
    const r = claimQuest(s, D1, 'win', tctx);
    expect(r.points).toBe(30);
    expect(r.events).toEqual([{ type: 'questClaimed', questId: 'win', points: 30, activity: 30 }]);
    expect(questStatus(r.save, tctx).activity).toBe(30);
    expectFeatureError(() => claimQuest(r.save, D1, 'win', tctx), 'quest_already_claimed');
  });

  it('claimActivity: награды порогов, гемы, опыт всем героям; ошибки', () => {
    let s = fresh();
    expectFeatureError(() => claimActivity(s, D1, 30, tctx), 'not_enough_activity');
    expectFeatureError(() => claimActivity(s, D1, 31, tctx), 'unknown_milestone');
    s = recordActivity(s, D1, 'stage_win', 2);
    s = recordActivity(s, D1, 'offline_claim');
    s = recordActivity(s, D1, 'hero_level_up');
    for (const id of ['win', 'chest', 'lvl']) s = claimQuest(s, D1, id, tctx).save;

    const r1 = claimActivity(s, D1, 30, tctx);
    expect(r1.save.resources.gold).toBe(s.resources.gold + 100);
    expect(r1.rewards).toEqual({ gold: 100, gems: 0, jobExp: 0 });
    expectFeatureError(() => claimActivity(r1.save, D1, 30, tctx), 'milestone_already_claimed');

    const r2 = claimActivity(r1.save, D1, 60, tctx);
    expect(r2.save.currency.gems).toBe(25);
    expect(r2.events).toContainEqual({ type: 'gems', amount: 25 });

    const r3 = claimActivity(r2.save, D1, 100, tctx);
    // Опыт порога — в общий пул героев.
    expect(r3.save.resources.heroExp).toBe(s.resources.heroExp + 50);
    expect(r3.save.heroes).toEqual(s.heroes);
    expect(questStatus(r3.save, tctx).milestones.every((m) => m.reached && m.claimed)).toBe(true);
  });

  it('детерминизм и чистота', () => {
    const s = recordActivity(fresh(), D1, 'stage_win', 2);
    const copy = structuredClone(s);
    expect(claimQuest(s, D1, 'win', tctx)).toEqual(claimQuest(s, D1, 'win', tctx));
    expect(s).toEqual(copy);
  });
});
