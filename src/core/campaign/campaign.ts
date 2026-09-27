import type { BattleResult } from '../types';
import { simulateBattle } from '../battle';
import type { UnitDef } from '../content/schema';
import type { SaveState } from '../save/schema';
import { buildUnit } from '../heroes/card';
import { addHeroExp } from '../heroes/level';
import { addHeroCard, duplicateCardsInSquad, placeInSquad } from '../heroes/roster';
import { addShards, replayShardCount, stageShardHero, stageShardReward } from '../heroes/shards';
import { grantTavernWelcome } from '../heroes/summon';
import { GameRuleError, type GameContext, type ProgressEvent } from '../progression/types';
import type { StageInfo } from './schema';
import { withGear } from '../equipment/equipment';
import { bankOffline, lastClearedStage } from './offline';

export type StageStatus = 'locked' | 'open' | 'cleared';

/** Этап по id; неизвестный — GameRuleError('unknown_stage'). */
export function getStage(ctx: GameContext, stageId: string): StageInfo {
  const stage = ctx.content.stages.find((s) => s.id === stageId);
  if (!stage) throw new GameRuleError('unknown_stage', `Неизвестный этап: ${stageId}`);
  return stage;
}

/**
 * T-B. Статус этапа: cleared — в save.campaign.cleared; open — первый этап кампании
 * или предыдущий (по globalIndex) пройден; иначе locked.
 */
export function stageStatus(save: SaveState, stageId: string, ctx: GameContext): StageStatus {
  const stage = getStage(ctx, stageId);
  if (save.campaign.cleared.includes(stage.id)) return 'cleared';
  if (stage.globalIndex === 0) return 'open';
  const prev = ctx.content.stages[stage.globalIndex - 1];
  return prev && save.campaign.cleared.includes(prev.id) ? 'open' : 'locked';
}

/**
 * T-B. Отряд врагов этапа: UnitDef монстров со статами hp/atk/def × mult × (1 + growth)^globalIndex
 * (growth = progression.campaign.enemyStatGrowthPerStage; spd не растёт), округление до целых.
 * id юнита — `${stage.id}_${slot}` (у разных слотов разные id), остальное — из data/units.
 */
export function enemySquad(stageId: string, ctx: GameContext): (UnitDef | null)[] {
  const stage = getStage(ctx, stageId);
  const growth = Math.pow(1 + ctx.progression.campaign.enemyStatGrowthPerStage, stage.globalIndex);
  return stage.enemies.map((e, slot) => {
    if (!e) return null;
    const base = ctx.content.units[e.unit];
    if (!base) throw new Error(`Этап ${stage.id}: враг ${e.unit} не найден`);
    const k = e.mult * growth;
    return {
      ...base,
      id: `${stage.id}_${slot}`,
      stats: {
        ...base.stats,
        hp: Math.max(1, Math.round(base.stats.hp * k)),
        atk: Math.round(base.stats.atk * k),
        def: Math.round(base.stats.def * k),
      },
    };
  });
}

export interface StageOutcome {
  save: SaveState;
  result: BattleResult;
  events: ProgressEvent[];
}

/**
 * Отряд игрока для боя: save.squad → buildUnit (null — пустой слот). GameRuleError: unknown_hero, empty_squad,
 * duplicate_card (две копии одной карточки в отряде). heroIds — герои отряда по порядку слотов.
 */
export function squadUnits(save: SaveState, ctx: GameContext): { squad: (UnitDef | null)[]; heroIds: string[] } {
  const heroIds: string[] = [];
  const squad = save.squad.map((heroId) => {
    if (heroId === null) return null;
    const hero = save.heroes.find((h) => h.id === heroId);
    if (!hero) throw new GameRuleError('unknown_hero', `Герой ${heroId} не найден`);
    if (!heroIds.includes(hero.id)) heroIds.push(hero.id);
    return buildUnit(hero, ctx);
  });
  if (heroIds.length === 0) throw new GameRuleError('empty_squad', 'В отряде нет героев');
  if (duplicateCardsInSquad(save, save.squad).length) throw new GameRuleError('duplicate_card', 'В отряде может быть только одна копия каждой карточки');
  return { squad, heroIds };
}

/**
 * T-B. Сыграть этап. Чистая функция: исходный save не меняется.
 * - GameRuleError('unknown_stage') / ('stage_locked') / ('empty_squad') / ('duplicate_card');
 * - отряд игрока: save.squad → buildUnit(hero) (null — пустой слот);
 * - бой: simulateBattle(ctx.content, squad, enemySquad, seed, { combat: ctx.combat });
 * - battleSeq + 1 всегда;
 * - победа: награда целиком при первом прохождении, × replayRewardMultiplier при повторе (floor); золото в resources,
 *   опыт (rewards.jobExp) — в общий пул героев resources.heroExp (уровни поднимает игрок: heroes/level.ts);
 *   осколки героя этапа (heroes/shards.ts: первое прохождение — firstClear/bossFirstClear, повтор — шанс от seed);
 *   рекрут (progression.heroes.recruits) и подарок Таверны (summon.unlockAfterStage) при первом прохождении;
 *   события rewards, shards, stageCleared, stageUnlocked, heroJoined, tavernUnlocked;
 * - поражение: только battleSeq;
 * - P9 (T1-15): первая победа в кампании (cleared был пуст) при переданном now ставит offline.lastClaimAt = now —
 *   сундук копит время с первого пройденного этапа, а не с создания сохранения. Без now lastClaimAt не меняется.
 * - P11 (T4-10): первая победа на этапе новее последнего пройденного при переданном now — bankOffline:
 *   накопленное в сундуке фиксируется по прежней ставке.
 */
export function playStage(save: SaveState, stageId: string, seed: number, ctx: GameContext, now?: number): StageOutcome {
  // Экипировка героев из сохранения (если в контексте есть предметы).
  ctx = withGear(ctx, save);
  const stage = getStage(ctx, stageId);
  if (stageStatus(save, stageId, ctx) === 'locked') throw new GameRuleError('stage_locked', `Этап ${stage.name} ещё закрыт`);
  const { squad } = squadUnits(save, ctx);

  const result = simulateBattle(ctx.content, squad, enemySquad(stageId, ctx), seed, { combat: ctx.combat });
  let next: SaveState = { ...save, battleSeq: save.battleSeq + 1 };
  const events: ProgressEvent[] = [];
  if (result.winner !== 'A') return { save: next, result, events };

  const firstTime = !save.campaign.cleared.includes(stage.id);
  const mult = firstTime ? 1 : ctx.progression.campaign.replayRewardMultiplier;
  const gold = Math.floor(stage.rewards.gold * mult);
  const heroExp = Math.floor(stage.rewards.jobExp * mult);

  // P11 (T4-10): этап новее последнего пройденного меняет ставку сундука — накопленное до сих пор
  // фиксируется по старой ставке (offline.banked), дальше копится по новой.
  const prevLast = lastClearedStage(save, ctx);
  if (firstTime && prevLast && stage.globalIndex > prevLast.globalIndex && now !== undefined) next.offline = bankOffline(save, now, ctx).offline;
  next.resources = { ...save.resources, gold: save.resources.gold + gold };
  next = addHeroExp(next, heroExp);
  if (firstTime) next.campaign = { ...save.campaign, cleared: [...save.campaign.cleared, stage.id] };
  if (firstTime && save.campaign.cleared.length === 0 && now !== undefined) next.offline = { ...save.offline, lastClaimAt: now };

  events.push({ type: 'rewards', gold, heroExp });
  // Осколки героя этапа: первое прохождение — всегда, повтор — с шансом (от seed боя).
  const shard = firstTime ? stageShardReward(save, stage, ctx) : (() => {
    const t = stageShardHero(save, stage, ctx);
    const n = t ? replayShardCount(seed, ctx) : 0;
    return t && n > 0 ? { templateId: t, count: n } : null;
  })();
  if (shard) {
    next = addShards(next, shard.templateId, shard.count);
    events.push({ type: 'shards', templateId: shard.templateId, count: shard.count });
  }
  events.push({ type: 'stageCleared', stageId: stage.id, firstTime });
  const following = ctx.content.stages[stage.globalIndex + 1];
  if (firstTime && following) events.push({ type: 'stageUnlocked', stageId: following.id });

  if (firstTime) {
    for (const rc of ctx.progression.heroes.recruits) {
      if (rc.afterStage !== stage.id || next.heroes.some((h) => h.templateId === rc.template)) continue;
      const t = ctx.content.heroes[rc.template];
      if (!t) continue;
      const r = addHeroCard(next, rc.template, t.baseRarity);
      // В отряд — на свободное место (передние — с первого слота, задние — с последнего), если есть.
      next = { ...r.save, squad: placeInSquad(r.save.squad, r.hero, r.save, ctx) };
      events.push({ type: 'heroJoined', heroId: r.hero.id, templateId: rc.template, name: t.name });
    }
    const w = grantTavernWelcome(next, ctx);
    next = w.save;
    events.push(...w.events);
  }
  return { save: next, result, events };
}
