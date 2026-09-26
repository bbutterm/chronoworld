import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  actChangeJob,
  actClaimOffline,
  actPlayStage,
  actSkipStage,
  actUseFastRewards,
  FeatureError,
  GameRuleError,
  newGame,
  playStage,
  repeatStage,
  skipStage,
  withFeatures,
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
    expect({ ...out.save, daily: undefined }).toEqual({ ...base.save, daily: undefined });
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
