import { playStage, type StageOutcome } from '../campaign/campaign';
import { claimOffline, type OfflineRewards } from '../campaign/offline';
import { equip, unequip } from '../equipment/equipment';
import { playWithEquipment, type StageOutcomeWithDrops } from '../equipment/drops';
import type { EquipmentConfig, EquipmentContext } from '../equipment/load';
import { changeJob } from '../progression/jobChange';
import { GameRuleError, type GameContext, type ProgressEvent } from '../progression/types';
import type { SaveState } from '../save/schema';
import { climbTower, type TowerContext, type TowerOutcome } from '../tower/tower';
import type { FeatureContext, FeatureEvent } from './config';
import { useFastRewards, type FastRewards } from './fastRewards';
import { recordActivity } from './quests';
import { skipStage } from './skip';

/**
 * Обёртки над действиями игрока для UI: вызывают функцию ядра и засчитывают события ежедневных заданий
 * (K5) на день day. Сами функции ядра (playStage, claimOffline, changeJob…) заданий не знают.
 * Все обёртки чистые; ошибки исходных функций пробрасываются как есть, без записи активности.
 */

function levelUps(events: readonly { type: string }[]): number {
  return events.filter((e) => e.type === 'levelUp').length;
}

function recordBattle<O extends StageOutcome>(out: O, day: string): O {
  let s = recordActivity(out.save, day, 'stage_attempt');
  if (out.result.winner === 'A') s = recordActivity(s, day, 'stage_win');
  s = recordActivity(s, day, 'hero_level_up', levelUps(out.events));
  return { ...out, save: s };
}

/**
 * playStage + stage_attempt, stage_win (при победе), hero_level_up (по событиям levelUp).
 * K6: при ctx.equipment бой идёт с экипировкой героев, при победе — выпадение предметов (drops).
 */
export function actPlayStage(save: SaveState, day: string, stageId: string, seed: number, ctx: GameContext & { equipment?: EquipmentConfig }): StageOutcomeWithDrops {
  return recordBattle(playWithEquipment(save, stageId, seed, ctx, (c) => playStage(save, stageId, seed, c)), day);
}

/** skipStage (K7) + те же события и выпадение K6, что у actPlayStage: пропущенный бой засчитывается как сыгранный. */
export function actSkipStage(save: SaveState, day: string, stageId: string, seed: number, ctx: GameContext & { equipment?: EquipmentConfig }): StageOutcomeWithDrops {
  return recordBattle(playWithEquipment(save, stageId, seed, ctx, (c) => skipStage(save, stageId, seed, c)), day);
}

/** claimOffline + offline_claim (только если что-то получено) + hero_level_up. */
export function actClaimOffline(
  save: SaveState,
  now: number,
  day: string,
  ctx: GameContext,
): { save: SaveState; rewards: OfflineRewards; events: ProgressEvent[] } {
  const out = claimOffline(save, now, ctx);
  let s = recordActivity(out.save, day, 'offline_claim', out.rewards.gold > 0 || out.rewards.jobExp > 0 ? 1 : 0);
  s = recordActivity(s, day, 'hero_level_up', levelUps(out.events));
  return { ...out, save: s };
}

/** changeJob для героя heroId (GameRuleError('unknown_hero'), если нет) + job_change. */
export function actChangeJob(save: SaveState, day: string, heroId: string, jobId: string, ctx: GameContext): { save: SaveState; events: ProgressEvent[] } {
  const hero = save.heroes.find((h) => h.id === heroId);
  if (!hero) throw new GameRuleError('unknown_hero', `Герой ${heroId} не найден`);
  const r = changeJob(hero, jobId, ctx);
  const next: SaveState = { ...save, heroes: save.heroes.map((h) => (h.id === heroId ? r.hero : h)) };
  return { save: recordActivity(next, day, 'job_change'), events: r.events };
}

/** useFastRewards (K1) + fast_rewards + hero_level_up. */
export function actUseFastRewards(save: SaveState, day: string, ctx: FeatureContext): { save: SaveState; rewards: FastRewards; events: FeatureEvent[] } {
  const out = useFastRewards(save, day, ctx);
  let s = recordActivity(out.save, day, 'fast_rewards');
  s = recordActivity(s, day, 'hero_level_up', levelUps(out.events));
  return { ...out, save: s };
}

/** K6. equip (надеть, предмет из того же слота — в инвентарь). Заданий не засчитывает. */
export function actEquip(save: SaveState, heroId: string, itemInstanceId: string, ctx: EquipmentContext): SaveState {
  return equip(save, heroId, itemInstanceId, ctx);
}

/** K6. unequip (снять в инвентарь). */
export function actUnequip(save: SaveState, itemInstanceId: string): SaveState {
  return unequip(save, itemInstanceId);
}

/** climbTower (K4) + tower_attempt (за каждый штурм, и победу, и поражение) + hero_level_up. */
export function actClimbTower(save: SaveState, day: string, seed: number, ctx: TowerContext): TowerOutcome {
  const out = climbTower(save, seed, ctx);
  let s = recordActivity(out.save, day, 'tower_attempt');
  s = recordActivity(s, day, 'hero_level_up', levelUps(out.events));
  return { ...out, save: s };
}
