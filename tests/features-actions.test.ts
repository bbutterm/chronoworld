import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  actChangeJob,
  actClaimAchievement,
  actClaimActivity,
  actClaimBounty,
  actClaimOffline,
  actClaimQuest,
  actPlayStage,
  actSkipStage,
  actUseFastRewards,
  claimAchievement,
  claimActivity,
  claimBounty,
  claimQuest,
  FeatureError,
  MetaError,
  GameRuleError,
  newGame,
  playStage,
  repeatStage,
  skipStage,
  withFeatures,
  withMeta,
  type SaveState,
} from '../src/core';
import { loadGameContext } from '../scripts/lib/content-node';

const root = join(import.meta.dirname, '..');
const read = (f: string) => JSON.parse(readFileSync(join(root, f), 'utf8'));
const ctx = withFeatures(loadGameContext(), read('data/progression.json'), read('data/quests.json'));
const D1 = '2026-09-26';
const s1 = ctx.content.stages[0].id;
const s2 = ctx.content.stages[1].id;

function winningSeed(save: SaveState, stageId: string): number {
  for (let seed = 1; seed <= 50; seed++) if (playStage(save, stageId, seed, ctx).result.winner === 'A') return seed;
  throw new Error(`нет победного seed для ${stageId}`);
}

function cleared(): SaveState {
  return { ...newGame(ctx, 0, D1), campaign: { cleared: [s1] } };
}

describe('K7 пропуск и повтор', () => {
  it('skipStage: только пройденный этап', () => {
    const s = newGame(ctx, 0, D1);
    expect(() => skipStage(s, s1, 1, ctx)).toThrow(FeatureError);
    try {
      skipStage(s, s1, 1, ctx);
    } catch (e) {
      expect((e as FeatureError).code).toBe('stage_not_cleared');
    }
    expect(() => repeatStage(s, s1, 1, ctx)).toThrow(FeatureError);
    expect(() => skipStage(s, 'nope', 1, ctx)).toThrow(GameRuleError);
  });

  it('skipStage = playStage без лога (тот же итог, награды за повтор)', () => {
    const s = cleared();
    const seed = winningSeed(s, s1);
    const full = playStage(s, s1, seed, ctx);
    const skip = skipStage(s, s1, seed, ctx);
    expect(full.result.log.length).toBeGreaterThan(0);
    expect(skip.result.log).toEqual([]);
    expect(skip.save).toEqual(full.save);
    expect(skip.events).toEqual(full.events);
    expect({ ...skip.result, log: undefined }).toEqual({ ...full.result, log: undefined });
    expect(skip.save.resources.gold - s.resources.gold).toBe(Math.floor(ctx.content.stages[0].rewards.gold * ctx.progression.campaign.replayRewardMultiplier));
  });

  it('repeatStage = playStage с логом для пройденного', () => {
    const s = cleared();
    expect(repeatStage(s, s1, 3, ctx)).toEqual(playStage(s, s1, 3, ctx));
  });
});

describe('обёртки действий засчитывают задания', () => {
  it('actPlayStage: попытка, победа, level-up', () => {
    const s = newGame(ctx, 0, D1);
    const seed = winningSeed(s, s1);
    const out = actPlayStage(s, D1, s1, seed, ctx);
    const base = playStage(s, s1, seed, ctx);
    const ups = base.events.filter((e) => e.type === 'levelUp').length;
    expect(out.result).toEqual(base.result);
    expect(out.save.daily.quests).toEqual({ stage_attempt: 1, stage_win: 1, ...(ups ? { hero_level_up: ups } : {}) });
    // K10: обёртка ещё засчитывает достижения (battles_won, stages_cleared…).
    expect({ ...out.save, daily: undefined, achievements: undefined }).toEqual({ ...base.save, daily: undefined, achievements: undefined });
  });

  it('actPlayStage: поражение — только попытка', () => {
    // Один новичок против этапа 2: ищем проигрышный seed.
    const s = { ...cleared(), squad: ['h1', null, null, null, null] };
    let seed = 1;
    while (seed < 50 && playStage(s, s2, seed, ctx).result.winner === 'A') seed++;
    const out = actPlayStage(s, D1, s2, seed, ctx);
    expect(out.result.winner).not.toBe('A');
    expect(out.save.daily.quests).toEqual({ stage_attempt: 1 });
  });

  it('actSkipStage считает бой', () => {
    const s = cleared();
    const out = actSkipStage(s, D1, s1, winningSeed(s, s1), ctx);
    expect(out.save.daily.quests.stage_attempt).toBe(1);
    expect(out.save.daily.quests.stage_win).toBe(1);
  });

  it('actClaimOffline: засчитывается только непустой сундук', () => {
    const empty = actClaimOffline(newGame(ctx, 0, D1), 60_000 * 60, D1, ctx);
    expect(empty.save.daily.quests.offline_claim).toBeUndefined();
    const full = actClaimOffline(cleared(), 60_000 * 60, D1, ctx);
    expect(full.rewards.gold).toBeGreaterThan(0);
    expect(full.save.daily.quests.offline_claim).toBe(1);
  });

  it('actChangeJob: смена профессии + job_change; ошибки пробрасываются', () => {
    const s = newGame(ctx, 0, D1);
    const tier1 = ctx.progression.jobChange.tierLevel['1'];
    const ready: SaveState = { ...s, heroes: s.heroes.map((h, i) => (i === 0 ? { ...h, jobLevel: tier1 } : h)) };
    const out = actChangeJob(ready, D1, 'h1', 'swordman', ctx);
    expect(out.save.heroes[0].job).toBe('swordman');
    expect(out.save.daily.quests).toEqual({ job_change: 1 });
    expect(() => actChangeJob(s, D1, 'h1', 'swordman', ctx)).toThrow(GameRuleError);
    expect(() => actChangeJob(s, D1, 'ghost', 'swordman', ctx)).toThrow(GameRuleError);
  });

  it('actUseFastRewards: fast_rewards', () => {
    const out = actUseFastRewards(cleared(), D1, ctx);
    expect(out.save.daily.quests.fast_rewards).toBe(1);
    expect(out.save.daily.fastRewardsUsed).toBe(1);
  });

  it('действие в новый день сбрасывает вчерашние счётчики', () => {
    const s = actUseFastRewards(cleared(), D1, ctx).save;
    const next = actUseFastRewards(s, '2026-09-27', ctx).save;
    expect(next.daily).toMatchObject({ day: '2026-09-27', fastRewardsUsed: 1 });
    expect(next.daily.quests.fast_rewards).toBe(1);
  });
});

describe('обёртки наград с опытом засчитывают hero_level_up', () => {
  const mctx = withMeta(ctx, read('data/bounties.json'), read('data/achievements.json'));
  const ups = (events: readonly { type: string }[]) => events.filter((e) => e.type === 'levelUp').length;
  const base = () => newGame(mctx, 0, D1);

  it('actClaimQuest: очки как у claimQuest; level-up задания только двигают счётчик, ничего не забирая', () => {
    const s0 = base();
    const s: SaveState = { ...s0, daily: { ...s0.daily, quests: { hero_level_up: 2 } } };
    const out = actClaimQuest(s, D1, 'level_ups', mctx);
    expect(out).toEqual(claimQuest(s, D1, 'level_ups', mctx));
    expect(out.save.daily.claimedQuests).toEqual(['level_ups']);
    expect(out.save.daily.quests).toEqual({ hero_level_up: 2 });
    expect(() => actClaimQuest(out.save, D1, 'level_ups', mctx)).toThrow(FeatureError);
  });

  it('actClaimActivity: jobExp порога → hero_level_up, без автозабора задания level_ups', () => {
    const s0 = base();
    // 60 очков активности: три задания по 20.
    const s: SaveState = { ...s0, daily: { ...s0.daily, claimedQuests: ['win_stages', 'offline_chest', 'fast_rewards'] } };
    const plain = claimActivity(s, D1, 60, mctx);
    const n = ups(plain.events);
    expect(n).toBeGreaterThan(0);
    const out = actClaimActivity(s, D1, 60, mctx);
    expect(out.events).toEqual(plain.events);
    expect(out.save.heroes).toEqual(plain.save.heroes);
    expect(out.save.daily.quests).toEqual({ hero_level_up: n });
    expect(out.save.daily.claimedQuests).toEqual(s.daily.claimedQuests);
    expect(out.save.daily.activityClaimed).toEqual([60]);
    expect({ ...out.save, daily: undefined }).toEqual({ ...plain.save, daily: undefined });
    // Порог без опыта — счётчик не трогается.
    expect(actClaimActivity(s, D1, 20, mctx).save.daily.quests).toEqual({});
    expect(() => actClaimActivity(s0, D1, 60, mctx)).toThrow(FeatureError);
  });

  it('actClaimBounty: jobExp поручения → hero_level_up на день day', () => {
    const s0 = base();
    const hero = s0.heroes[0].id;
    const s: SaveState = {
      ...s0,
      bounties: {
        ...s0.bounties,
        active: [
          { id: 'b1', templateId: 'patrol', rarity: 'common', durationMinutes: 30, heroCount: 1, role: null, rewards: { gold: 10, jobExp: 500, gems: 0 }, heroIds: [hero], startedAt: 0, endsAt: 1000 },
        ],
      },
    };
    const plain = claimBounty(s, 'b1', 1000, mctx);
    const n = ups(plain.events);
    expect(n).toBeGreaterThan(0);
    const out = actClaimBounty(s, D1, 'b1', 1000, mctx);
    expect(out.events).toEqual(plain.events);
    expect(out.save.daily.quests).toEqual({ hero_level_up: n });
    expect(out.save.achievements).toEqual(plain.save.achievements);
    expect(() => actClaimBounty(s, D1, 'b1', 999, mctx)).toThrow(MetaError);
  });

  it('actClaimAchievement: jobExp достижения → hero_level_up', () => {
    const s0 = base();
    const s: SaveState = { ...s0, achievements: { ...s0.achievements, counters: { ...s0.achievements.counters, jobs_changed: 1 } } };
    const plain = claimAchievement(s, 'first_job', mctx);
    const n = ups(plain.events);
    expect(n).toBeGreaterThan(0);
    const out = actClaimAchievement(s, D1, 'first_job', mctx);
    expect(out.events).toEqual(plain.events);
    expect(out.save.daily.quests).toEqual({ hero_level_up: n });
    expect(out.save.achievements).toEqual(plain.save.achievements);
    expect(() => actClaimAchievement(out.save, D1, 'first_job', mctx)).toThrow(MetaError);
  });
});
