import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  actAscend,
  actClaimAchievement,
  actClaimActivity,
  actClaimExpedition,
  actClaimOffline,
  actClaimQuest,
  actLevelUp,
  actPlayStage,
  actSkipStage,
  actSummon,
  actUseFastRewards,
  claimAchievement,
  claimActivity,
  claimExpedition,
  claimQuest,
  FeatureError,
  MetaError,
  GameRuleError,
  HeroError,
  newGame,
  playStage,
  repeatStage,
  skipStage,
  withFeatures,
  withMeta,
  type SaveState,
} from '../src/core';
import { loadGameContext } from '../scripts/lib/content-node';
import { withReplay } from './helpers';

const root = join(import.meta.dirname, '..');
const read = (f: string) => JSON.parse(readFileSync(join(root, f), 'utf8'));
const ctx = withFeatures(loadGameContext(), read('data/progression.json'), read('data/quests.json'));
const D1 = '2026-09-26';
const s1 = ctx.content.stages[0].id;
const s2 = ctx.content.stages[1].id;

// Выпущенные данные запрещают повторы пройденных этапов; K7 (пропуск/повтор) проверяется при явном replay: true.
const rctx = withReplay(ctx);

function winningSeed(save: SaveState, stageId: string, c: typeof ctx = ctx): number {
  for (let seed = 1; seed <= 50; seed++) if (playStage(save, stageId, seed, c).result.winner === 'A') return seed;
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

  it('skipStage = playStage без лога (тот же итог, награды за повтор; replay: true)', () => {
    const s = cleared();
    const seed = winningSeed(s, s1, rctx);
    const full = playStage(s, s1, seed, rctx, undefined, D1);
    const skip = skipStage(s, s1, seed, rctx, D1);
    expect(full.result.log.length).toBeGreaterThan(0);
    expect(skip.result.log).toEqual([]);
    expect(skip.save).toEqual(full.save);
    expect(skip.events).toEqual(full.events);
    expect({ ...skip.result, log: undefined }).toEqual({ ...full.result, log: undefined });
    expect(skip.save.resources.gold - s.resources.gold).toBe(Math.floor(ctx.content.stages[0].rewards.gold * rctx.progression.campaign.replayRewardMultiplier!));
  });

  it('repeatStage = playStage с логом для пройденного (replay: true)', () => {
    const s = cleared();
    expect(repeatStage(s, s1, 3, rctx)).toEqual(playStage(s, s1, 3, rctx));
  });

  it('выпущенные данные: пропуск и повтор пройденного этапа запрещены (stage_cleared)', () => {
    const s = cleared();
    for (const f of [() => skipStage(s, s1, 3, ctx, D1), () => repeatStage(s, s1, 3, ctx, D1), () => actSkipStage(s, D1, s1, 3, ctx)]) {
      expect(f).toThrow(GameRuleError);
      expect(f).toThrow(expect.objectContaining({ code: 'stage_cleared' }));
    }
  });
});

describe('обёртки действий засчитывают задания', () => {
  it('actPlayStage: попытка и победа (уровни в бою не растут — опыт уходит в пул)', () => {
    const s = newGame(ctx, 0, D1);
    const seed = winningSeed(s, s1);
    const out = actPlayStage(s, D1, s1, seed, ctx);
    const base = playStage(s, s1, seed, ctx);
    expect(base.events.some((e) => e.type === 'levelUp')).toBe(false);
    expect(out.result).toEqual(base.result);
    // battle_win — задание «победы в боях» (кампания или Башня) после отмены повторов этапов.
    expect(out.save.daily.quests).toEqual({ stage_attempt: 1, stage_win: 1, battle_win: 1 });
    // K10: обёртка ещё засчитывает достижения (battles_won, stages_cleared…).
    expect({ ...out.save, daily: undefined, achievements: undefined }).toEqual({ ...base.save, daily: undefined, achievements: undefined });
  });

  it('actPlayStage: поражение — только попытка', () => {
    // Одна Вика ур. 1 (лекарь) против этапа 2: ищем проигрышный seed.
    const s = { ...cleared(), squad: ['h3', null, null, null, null] };
    let seed = 1;
    while (seed < 50 && playStage(s, s2, seed, ctx).result.winner === 'A') seed++;
    const out = actPlayStage(s, D1, s2, seed, ctx);
    expect(out.result.winner).not.toBe('A');
    expect(out.save.daily.quests).toEqual({ stage_attempt: 1 });
  });

  it('actSkipStage считает бой (replay: true)', () => {
    const s = cleared();
    const out = actSkipStage(s, D1, s1, winningSeed(s, s1, rctx), rctx);
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

  it('actLevelUp: уровни за опыт пула + hero_level_up по числу уровней и hero_max_level; ошибки пробрасываются', () => {
    const s0 = newGame(ctx, 0, D1);
    const s: SaveState = { ...s0, resources: { ...s0.resources, heroExp: 100_000, gold: 100_000 } };
    const out = actLevelUp(s, D1, 'h1', ctx, 3);
    expect(out.levels).toBe(3);
    expect(out.save.heroes[0].level).toBe(4);
    expect(out.save.daily.quests).toEqual({ hero_level_up: 3 });
    expect(out.save.achievements.counters.hero_max_level).toBe(4);
    expect(() => actLevelUp(s0, D1, 'h1', ctx)).toThrow(HeroError);
    expect(() => actLevelUp(s, D1, 'ghost', ctx)).toThrow(HeroError);
  });

  it('actSummon / actAscend: задания summon / hero_ascend и достижения summons / ascensions', () => {
    const s0 = { ...newGame(ctx, 0, D1), campaign: { cleared: ctx.content.stages.slice(0, ctx.content.stages.findIndex((x) => x.id === 'ch1_s5') + 1).map((x) => x.id) } };
    // Зелёная копия Алана (h90) — корм для вознесения зелёный → синий (пересмотр 10.10: одна любая зелёная, было две).
    const copies = [{ id: 'h90', templateId: 'alan', rarity: 'green' as const, level: 1 }];
    const s: SaveState = { ...s0, heroes: [...s0.heroes, ...copies], currency: { gems: 1000, scrolls: 0 }, resources: { ...s0.resources, gold: 10_000 } };
    const pulled = actSummon(s, D1, 10, 'gems', ctx);
    expect(pulled.results).toHaveLength(10);
    expect(pulled.save.daily.quests).toEqual({ summon: 10 });
    expect(pulled.save.achievements.counters.summons).toBe(10);
    const up = actAscend(pulled.save, D1, 'h1', ['h90'], ctx);
    expect(up.save.heroes[0].rarity).toBe('blue');
    expect(up.save.daily.quests).toEqual({ summon: 10, hero_ascend: 1 });
    expect(up.save.achievements.counters.ascensions).toBe(1);
    expect(() => actSummon(newGame(ctx, 0, D1), D1, 1, 'free', ctx)).toThrow(HeroError);
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

describe('обёртки наград с опытом: опыт — в общий пул, уровни поднимает игрок', () => {
  const mctx = withMeta(ctx, read('data/expeditions.json'), read('data/achievements.json'));
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

  it('actClaimActivity: jobExp порога — в пул; уровни и счётчик level-up не меняются', () => {
    const s0 = base();
    // 60 очков активности: три задания по 20.
    const s: SaveState = { ...s0, daily: { ...s0.daily, claimedQuests: ['win_stages', 'offline_chest', 'fast_rewards'] } };
    const plain = claimActivity(s, D1, 60, mctx);
    const exp = mctx.features.quests.milestones.find((m) => m.points === 60)!.rewards.jobExp;
    expect(exp).toBeGreaterThan(0);
    expect(plain.save.resources.heroExp).toBe(s.resources.heroExp + exp);
    expect(plain.save.heroes).toEqual(s.heroes);
    const out = actClaimActivity(s, D1, 60, mctx);
    expect(out.events).toEqual(plain.events);
    expect(out.save.daily.quests).toEqual({});
    expect(out.save.daily.activityClaimed).toEqual([60]);
    expect({ ...out.save, daily: undefined }).toEqual({ ...plain.save, daily: undefined });
    expect(() => actClaimActivity(s0, D1, 60, mctx)).toThrow(FeatureError);
  });

  it('actClaimExpedition: опыт экспедиции — в пул, карты героя — новыми экземплярами', () => {
    const s0 = base();
    const hero = s0.heroes[0].id;
    const s: SaveState = {
      ...s0,
      bounties: {
        active: [
          {
            location: 'ant_hell',
            hours: 1,
            heroIds: [hero],
            power: 1000,
            startedAt: 0,
            endsAt: 1000,
            rewards: { gold: 10, jobExp: 500, gems: 0, heroCards: { blue: 2, purple: 0 }, scrolls: 0, items: [] },
          },
        ],
      },
    };
    const plain = claimExpedition(s, 'ant_hell', 1000, mctx);
    expect(plain.save.resources.heroExp).toBe(500);
    const added = plain.save.heroes.slice(s.heroes.length);
    expect(added.map((h) => h.rarity)).toEqual(['blue', 'blue']);
    expect(plain.events.filter((e) => e.type === 'heroCard')).toHaveLength(2);
    const out = actClaimExpedition(s, D1, 'ant_hell', 1000, mctx);
    expect(out.events).toEqual(plain.events);
    // Уровней награда не даёт; добыча экспедиции засчитывается заданию дня «expedition» (daily-loop-2026-10-10).
    expect(out.save.daily.quests).toEqual({ expedition_claim: 1 });
    expect(out.save.achievements).toEqual(plain.save.achievements);
    expect(() => actClaimExpedition(s, D1, 'ant_hell', 999, mctx)).toThrow(MetaError);
  });

  it('actClaimAchievement: гемы и карта героя достижения', () => {
    const s0 = base();
    const s: SaveState = { ...s0, achievements: { ...s0.achievements, counters: { ...s0.achievements.counters, battles_won: 100 } } };
    const plain = claimAchievement(s, 'battles_100', mctx);
    expect(plain.rewards.heroCards).toEqual({ blue: 1 });
    expect(plain.save.heroes.slice(s.heroes.length).map((h) => h.rarity)).toEqual(['blue']);
    const out = actClaimAchievement(s, D1, 'battles_100', mctx);
    expect(out.events).toEqual(plain.events);
    expect(out.save.daily.quests).toEqual({});
    expect(out.save.achievements).toEqual(plain.save.achievements);
    expect(() => actClaimAchievement(out.save, D1, 'battles_100', mctx)).toThrow(MetaError);
  });
});
