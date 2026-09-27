import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  idleIncome,
  FeatureError,
  fastRewardsPreview,
  fastRewardsStatus,
  newGame,
  parseFeaturesConfig,
  rollDay,
  useFastRewards,
  withFeatures,
  type FeatureErrorCode,
  type SaveState,
} from '../src/core';
import { loadGameContext } from '../scripts/lib/content-node';

const root = join(import.meta.dirname, '..');
const progressionJson = JSON.parse(readFileSync(join(root, 'data/progression.json'), 'utf8'));
const questsJson = JSON.parse(readFileSync(join(root, 'data/quests.json'), 'utf8'));
const ctx = withFeatures(loadGameContext(), progressionJson, questsJson);
const D1 = '2026-09-26';
const D2 = '2026-09-27';

function expectFeatureError(fn: () => unknown, code: FeatureErrorCode) {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(FeatureError);
  expect((err as FeatureError).code).toBe(code);
  expect((err as Error).message.length).toBeGreaterThan(0);
}

function withStage(gems = 0): SaveState {
  const s = newGame(ctx, 0, D1);
  return { ...s, campaign: { cleared: [ctx.content.stages[0].id, ctx.content.stages[1].id] }, currency: { gems } };
}

describe('конфиг K-функций', () => {
  it('data/progression.json и data/quests.json валидны', () => {
    expect(() => parseFeaturesConfig(progressionJson, questsJson)).not.toThrow();
    expect(ctx.features.fastRewards.freePerDay).toBeGreaterThanOrEqual(0);
  });

  it('битый конфиг → FeatureError invalid_config с путём', () => {
    expectFeatureError(() => parseFeaturesConfig({ ...progressionJson, fastRewards: { hours: -1 } }, questsJson), 'invalid_config');
    const dup = { ...questsJson, quests: [...questsJson.quests, questsJson.quests[0]] };
    expect(() => parseFeaturesConfig(progressionJson, dup)).toThrow(/встречается дважды/);
    const badOrder = { ...questsJson, milestones: [...questsJson.milestones].reverse() };
    expect(() => parseFeaturesConfig(progressionJson, badOrder)).toThrow(/возрастать/);
    const badEvent = { ...questsJson, quests: [{ ...questsJson.quests[0], event: 'arena_win' }] };
    expect(() => parseFeaturesConfig(progressionJson, badEvent)).toThrow(/quests\.0\.event/);
  });
});

describe('rollDay', () => {
  it('новый день сбрасывает счётчики, тот же день — без изменений', () => {
    const s = { ...withStage(), daily: { day: D1, fastRewardsUsed: 3, quests: { stage_win: 2 }, claimedQuests: ['x'], activityClaimed: [20] } };
    expect(rollDay(s, D1)).toBe(s);
    expect(rollDay(s, D2).daily).toEqual({ day: D2, fastRewardsUsed: 0, quests: {}, claimedQuests: [], activityClaimed: [] });
    expect(s.daily.fastRewardsUsed).toBe(3);
  });

  it('день назад (часы переведены) — без сброса', () => {
    const s = { ...withStage(), daily: { ...withStage().daily, fastRewardsUsed: 1 } };
    expect(rollDay(s, '2026-09-25')).toBe(s);
  });

  it('неверный формат дня → invalid_day', () => {
    expectFeatureError(() => rollDay(withStage(), '26.09.2026'), 'invalid_day');
  });
});

describe('K1 быстрые награды', () => {
  it('preview = ставка последнего пройденного этапа × hours × 60; без этапов — нули', () => {
    const s = withStage();
    const minutes = ctx.features.fastRewards.hours * 60;
    expect(fastRewardsPreview(s, ctx)).toEqual({ minutes, ...idleIncome(ctx.content.stages[1], minutes, ctx) });
    expect(fastRewardsPreview(newGame(ctx, 0), ctx)).toEqual({ minutes: 0, gold: 0, jobExp: 0 });
  });

  it('сначала бесплатно, потом за гемы по gemCosts, затем лимит', () => {
    const { freePerDay, gemCosts } = ctx.features.fastRewards;
    const totalGems = gemCosts.reduce((a, b) => a + b, 0);
    let s = withStage(totalGems + 5);
    const preview = fastRewardsPreview(s, ctx);
    for (let i = 0; i < freePerDay + gemCosts.length; i++) {
      const cost = i < freePerDay ? 0 : gemCosts[i - freePerDay];
      expect(fastRewardsStatus(s, D1, ctx).nextCost).toBe(cost);
      const before = s;
      const r = useFastRewards(s, D1, ctx);
      expect(r.rewards).toEqual(preview);
      expect(r.save.resources.gold).toBe(before.resources.gold + preview.gold);
      expect(r.save.currency.gems).toBe(before.currency.gems - cost);
      expect(r.save.daily.fastRewardsUsed).toBe(i + 1);
      expect(r.save.offline).toEqual(before.offline);
      expect(r.events[0]).toEqual({ type: 'fastRewardsUsed', gemCost: cost, hours: ctx.features.fastRewards.hours });
      s = r.save;
    }
    expect(s.currency.gems).toBe(5);
    expect(fastRewardsStatus(s, D1, ctx)).toMatchObject({ usesLeft: 0, nextCost: null });
    expectFeatureError(() => useFastRewards(s, D1, ctx), 'fast_rewards_limit');
  });

  it('опыт получает каждый герой', () => {
    const s = withStage();
    const r = useFastRewards(s, D1, ctx);
    expect(r.save.heroes.some((h, i) => h.jobLevel !== s.heroes[i].jobLevel || h.jobExp !== s.heroes[i].jobExp)).toBe(true);
    expect(r.events.find((e) => e.type === 'rewards')).toMatchObject({ heroIds: s.heroes.map((h) => h.id) });
  });

  it('не хватает гемов → not_enough_gems, save не меняется', () => {
    let s = withStage(0);
    for (let i = 0; i < ctx.features.fastRewards.freePerDay; i++) s = useFastRewards(s, D1, ctx).save;
    const copy = structuredClone(s);
    expectFeatureError(() => useFastRewards(s, D1, ctx), 'not_enough_gems');
    expect(s).toEqual(copy);
  });

  it('новый день возвращает бесплатную попытку', () => {
    let s = withStage(0);
    for (let i = 0; i < ctx.features.fastRewards.freePerDay; i++) s = useFastRewards(s, D1, ctx).save;
    const r = useFastRewards(s, D2, ctx);
    expect(r.save.daily).toMatchObject({ day: D2, fastRewardsUsed: 1 });
  });

  it('нет пройденных этапов → no_income, попытка не тратится', () => {
    expectFeatureError(() => useFastRewards(newGame(ctx, 0, D1), D1, ctx), 'no_income');
  });

  it('детерминизм', () => {
    const s = withStage(100);
    expect(useFastRewards(s, D1, ctx)).toEqual(useFastRewards(s, D1, ctx));
  });
});
