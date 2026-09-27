import { playStage, type StageOutcome } from '../campaign/campaign';
import { claimOffline, type OfflineRewards } from '../campaign/offline';
import { equip, unequip } from '../equipment/equipment';
import { playWithEquipment, type StageOutcomeWithDrops } from '../equipment/drops';
import type { EquipmentConfig, EquipmentContext } from '../equipment/load';
import { claimAchievement, syncAchievementCounters, trackAchievement, type MetaEvent } from '../meta/achievements';
import { claimBounty } from '../meta/bounties';
import type { MetaContext, MetaRewards } from '../meta/config';
import { changeJob } from '../progression/jobChange';
import { GameRuleError, type GameContext, type ProgressEvent } from '../progression/types';
import type { SaveState } from '../save/schema';
import { climbTower, type TowerContext, type TowerOutcome } from '../tower/tower';
import type { FeatureContext, FeatureEvent } from './config';
import { useFastRewards, type FastRewards } from './fastRewards';
import { claimActivity, claimQuest, recordActivity, type MilestoneRewards } from './quests';
import { skipStage } from './skip';

/**
 * Обёртки над действиями игрока для UI: вызывают функцию ядра и засчитывают события ежедневных заданий
 * (K5) на день day, а также счётчики достижений (K10: battles_won, jobs_changed, items_equipped и
 * «максимумы» stages_cleared / tower_floor / hero_max_job_level). Сами функции ядра (playStage, claimOffline,
 * changeJob…) ни заданий, ни достижений не знают.
 * Все обёртки чистые; ошибки исходных функций пробрасываются как есть, без записи активности.
 */

function levelUps(events: readonly { type: string }[]): number {
  return events.filter((e) => e.type === 'levelUp').length;
}

function recordBattle<O extends StageOutcome>(out: O, day: string): O {
  let s = recordActivity(out.save, day, 'stage_attempt');
  if (out.result.winner === 'A') s = recordActivity(s, day, 'stage_win');
  s = recordActivity(s, day, 'hero_level_up', levelUps(out.events));
  s = syncAchievementCounters(trackAchievement(s, 'battles_won', out.result.winner === 'A' ? 1 : 0, 'add'));
  return { ...out, save: s };
}

/**
 * playStage + stage_attempt, stage_win (при победе), hero_level_up (по событиям levelUp).
 * K6: при ctx.equipment бой идёт с экипировкой героев, при победе — выпадение предметов (drops).
 * now (мс, необязательно) — время боя: при первой победе в кампании с него начинает копиться сундук (P9, T1-15).
 */
export function actPlayStage(
  save: SaveState,
  day: string,
  stageId: string,
  seed: number,
  ctx: GameContext & { equipment?: EquipmentConfig },
  now?: number,
): StageOutcomeWithDrops {
  return recordBattle(playWithEquipment(save, stageId, seed, ctx, (c) => playStage(save, stageId, seed, c, now)), day);
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
  s = syncAchievementCounters(s);
  return { ...out, save: s };
}

/** changeJob для героя heroId (GameRuleError('unknown_hero'), если нет) + job_change. */
export function actChangeJob(save: SaveState, day: string, heroId: string, jobId: string, ctx: GameContext): { save: SaveState; events: ProgressEvent[] } {
  const hero = save.heroes.find((h) => h.id === heroId);
  if (!hero) throw new GameRuleError('unknown_hero', `Герой ${heroId} не найден`);
  const r = changeJob(hero, jobId, ctx);
  const next: SaveState = { ...save, heroes: save.heroes.map((h) => (h.id === heroId ? r.hero : h)) };
  const s = syncAchievementCounters(trackAchievement(recordActivity(next, day, 'job_change'), 'jobs_changed', 1, 'add'));
  return { save: s, events: r.events };
}

/** useFastRewards (K1) + fast_rewards + hero_level_up. */
export function actUseFastRewards(save: SaveState, day: string, ctx: FeatureContext): { save: SaveState; rewards: FastRewards; events: FeatureEvent[] } {
  const out = useFastRewards(save, day, ctx);
  let s = recordActivity(out.save, day, 'fast_rewards');
  s = recordActivity(s, day, 'hero_level_up', levelUps(out.events));
  s = syncAchievementCounters(s);
  return { ...out, save: s };
}

/** K6. equip (надеть, предмет из того же слота — в инвентарь). Заданий не засчитывает. K10: items_equipped + 1. */
export function actEquip(save: SaveState, heroId: string, itemInstanceId: string, ctx: EquipmentContext): SaveState {
  const next = equip(save, heroId, itemInstanceId, ctx);
  // Предмет уже был на этом герое (equip вернул тот же save) — надевания не было, счётчик не растёт.
  return next === save ? save : trackAchievement(next, 'items_equipped', 1, 'add');
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
  s = syncAchievementCounters(trackAchievement(s, 'battles_won', out.result.winner === 'A' ? 1 : 0, 'add'));
  return { ...out, save: s };
}

/*
 * Награды с опытом (задания, пороги активности, поручения, достижения): функции ядра сами обновляют
 * счётчики-«максимумы» достижений, но дня не знают — hero_level_up засчитывают обёртки ниже.
 * Рекурсии нет: засчитанный level-up только двигает счётчик daily.quests, ничего не забирает автоматически.
 */
function recordLevelUps<O extends { save: SaveState; events: readonly { type: string }[] }>(out: O, day: string): O {
  return { ...out, save: recordActivity(out.save, day, 'hero_level_up', levelUps(out.events)) };
}

/** claimQuest + hero_level_up (сейчас задание даёт только очки, опыта нет — на будущее и для единообразия). */
export function actClaimQuest(save: SaveState, day: string, questId: string, ctx: FeatureContext): { save: SaveState; points: number; events: FeatureEvent[] } {
  return recordLevelUps(claimQuest(save, day, questId, ctx), day);
}

/** claimActivity + hero_level_up (jobExp порога активности). */
export function actClaimActivity(
  save: SaveState,
  day: string,
  milestone: number,
  ctx: FeatureContext,
): { save: SaveState; rewards: MilestoneRewards; events: FeatureEvent[] } {
  return recordLevelUps(claimActivity(save, day, milestone, ctx), day);
}

/** K9. claimBounty + hero_level_up (jobExp поручения). */
export function actClaimBounty(
  save: SaveState,
  day: string,
  bountyId: string,
  now: number,
  ctx: MetaContext,
): { save: SaveState; rewards: MetaRewards; events: MetaEvent[] } {
  return recordLevelUps(claimBounty(save, bountyId, now, ctx), day);
}

/** K10. claimAchievement + hero_level_up (jobExp достижения). */
export function actClaimAchievement(save: SaveState, day: string, id: string, ctx: MetaContext): { save: SaveState; rewards: MetaRewards; events: MetaEvent[] } {
  return recordLevelUps(claimAchievement(save, id, ctx), day);
}
