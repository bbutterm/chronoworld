import type { BattleResult } from '../types';
import type { UnitDef } from '../content/schema';
import type { SaveState } from '../save/schema';
import { NotImplementedError, type GameContext, type ProgressEvent } from '../progression/types';
import type { StageInfo } from './schema';

export type StageStatus = 'locked' | 'open' | 'cleared';

export function getStage(ctx: GameContext, stageId: string): StageInfo {
  void ctx;
  throw new NotImplementedError(`getStage(${stageId}) — T-B`);
}

/**
 * T-B. Статус этапа: cleared — в save.campaign.cleared; open — первый этап кампании
 * или предыдущий (по globalIndex) пройден; иначе locked.
 */
export function stageStatus(save: SaveState, stageId: string, ctx: GameContext): StageStatus {
  void save;
  void ctx;
  throw new NotImplementedError(`stageStatus(${stageId}) — T-B`);
}

/**
 * T-B. Отряд врагов этапа: UnitDef монстров со статами hp/atk/def × mult × (1 + growth)^globalIndex
 * (growth = progression.campaign.enemyStatGrowthPerStage; spd не растёт), округление до целых.
 * id юнита — `${stage.id}_${slot}` (у разных слотов разные id), остальное — из data/units.
 */
export function enemySquad(stageId: string, ctx: GameContext): (UnitDef | null)[] {
  void ctx;
  throw new NotImplementedError(`enemySquad(${stageId}) — T-B`);
}

export interface StageOutcome {
  save: SaveState;
  result: BattleResult;
  events: ProgressEvent[];
}

/**
 * T-B. Сыграть этап. Чистая функция: исходный save не меняется.
 * - GameRuleError('unknown_stage') / ('stage_locked') / ('empty_squad');
 * - отряд игрока: save.squad → buildUnit(hero) (null — пустой слот);
 * - бой: simulateBattle(ctx.content, squad, enemySquad, seed, { combat: ctx.combat });
 * - battleSeq + 1 всегда;
 * - победа: награда целиком при первом прохождении, × replayRewardMultiplier при повторе (floor);
 *   золото в resources, jobExp каждому герою отряда через addJobExp; события rewards, stageCleared,
 *   stageUnlocked (для следующего этапа при первом прохождении), события addJobExp;
 * - поражение: только battleSeq.
 */
export function playStage(save: SaveState, stageId: string, seed: number, ctx: GameContext): StageOutcome {
  void save;
  void seed;
  void ctx;
  throw new NotImplementedError(`playStage(${stageId}) — T-B`);
}
