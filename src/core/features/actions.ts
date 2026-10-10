import { playStage, type StageOutcome } from '../campaign/campaign';
import { claimOffline, type OfflineRewards } from '../campaign/offline';
import { equip, unequip } from '../equipment/equipment';
import { playWithEquipment, type StageOutcomeWithDrops } from '../equipment/drops';
import type { ChestLootGrant } from '../equipment/chest';
import type { EquipmentConfig, EquipmentContext } from '../equipment/load';
import { claimAchievement, claimAllAchievements, syncAchievementCounters, trackAchievement, type MetaEvent } from '../meta/achievements';
import { claimAllExpeditions, claimExpedition, type ExpeditionContext } from '../meta/expeditions';
import type { MetaContext, MetaRewards } from '../meta/config';
import { ascendHero, type AscendOptions } from '../heroes/merge';
import { levelUpHero, type LevelCost } from '../heroes/level';
import { summon, type SummonPay, type SummonDraw } from '../heroes/summon';
import type { GameContext, ProgressEvent } from '../progression/types';
import type { SaveState } from '../save/schema';
import { climbTower, type TowerContext, type TowerOutcome } from '../tower/tower';
import { fightTowerFloor, type TowerFightOutcome } from '../tower/run';
import type { PlayerControl } from '../types';
import type { FeatureContext, FeatureEvent } from './config';
import { useFastRewards, type FastRewards } from './fastRewards';
import { claimActivity, claimAllQuests, claimQuest, recordActivity, type MilestoneRewards } from './quests';
import { skipStage } from './skip';
import { queueAfterStage, queueChapterDone, type StoryContext } from '../story/story';
import { buyIngredient, cookMeal, type KitchenContext, type Pantry } from '../kitchen/kitchen';

/**
 * Обёртки над действиями игрока для UI: вызывают функцию ядра и засчитывают события ежедневных заданий
 * (K5) на день day, а также счётчики достижений (K10: battles_won, items_equipped, summons, ascensions и
 * «максимумы» stages_cleared / tower_floor / hero_max_level). Сами функции ядра (playStage, claimOffline,
 * levelUpHero, summon…) ни заданий, ни достижений не знают.
 * Все обёртки чистые; ошибки исходных функций пробрасываются как есть, без записи активности.
 */

function levelUps(events: readonly { type: string }[]): number {
  return events.filter((e) => e.type === 'levelUp').length;
}

function recordBattle<O extends StageOutcome>(out: O, day: string): O {
  let s = recordActivity(out.save, day, 'stage_attempt');
  if (out.result.winner === 'A') s = recordActivity(s, day, 'stage_win');
  s = syncAchievementCounters(trackAchievement(s, 'battles_won', out.result.winner === 'A' ? 1 : 0, 'add'));
  return { ...out, save: s };
}

/**
 * playStage + stage_attempt, stage_win (при победе).
 * K6: при ctx.equipment бой идёт с экипировкой героев, при победе — выпадение предметов (drops).
 * now (мс, необязательно) — время боя: при первой победе в кампании с него начинает копиться сундук (P9, T1-15).
 */
export function actPlayStage(
  save: SaveState,
  day: string,
  stageId: string,
  seed: number,
  ctx: GameContext & { equipment?: EquipmentConfig } & Partial<StoryContext>,
  now?: number,
): StageOutcomeWithDrops {
  return queueStory(recordBattle(playWithEquipment(save, stageId, seed, ctx, (c) => playStage(save, stageId, seed, c, now, day)), day), ctx);
}

/** P11 (T4-05): сцена «после этапа» при первой победе встаёт в очередь сохранения вместе с самой победой. */
function queueStory<O extends StageOutcome>(out: O, ctx: GameContext & Partial<StoryContext>): O {
  let s = out.save;
  for (const e of out.events) {
    if (e.type !== 'stageCleared') continue;
    if (ctx.story) s = queueAfterStage(s, e.stageId, e.firstTime, { story: ctx.story });
    // «Глава пройдена» ждёт показа с той же записи, что и победа над боссом главы.
    s = queueChapterDone(s, e.stageId, e.firstTime, ctx);
  }
  return s === out.save ? out : { ...out, save: s };
}

/** skipStage (K7) + те же события и выпадение K6, что у actPlayStage: пропущенный бой засчитывается как сыгранный. */
export function actSkipStage(save: SaveState, day: string, stageId: string, seed: number, ctx: GameContext & { equipment?: EquipmentConfig } & Partial<StoryContext>): StageOutcomeWithDrops {
  return queueStory(recordBattle(playWithEquipment(save, stageId, seed, ctx, (c) => skipStage(save, stageId, seed, c, day)), day), ctx);
}

/** claimOffline (с трофеями при ctx.equipment и продуктами Кухни) + offline_claim (только если получены золото или опыт). */
export function actClaimOffline(
  save: SaveState,
  now: number,
  day: string,
  ctx: GameContext & { equipment?: EquipmentConfig },
): { save: SaveState; rewards: OfflineRewards; loot: ChestLootGrant; events: ProgressEvent[]; ingredients?: Pantry } {
  const out = claimOffline(save, now, ctx);
  const s = syncAchievementCounters(recordActivity(out.save, day, 'offline_claim', out.rewards.gold > 0 || out.rewards.jobExp > 0 ? 1 : 0));
  return { ...out, save: s };
}

/**
 * «Улучшить»: levelUpHero (опыт пула + золото, times уровней подряд, пока хватает) + hero_level_up (по уровням)
 * и hero_max_level. Ошибки — HeroError как у levelUpHero.
 */
export function actLevelUp(save: SaveState, day: string, heroId: string, ctx: GameContext, times = 1): { save: SaveState; levels: number; spent: LevelCost; events: ProgressEvent[] } {
  const out = levelUpHero(save, heroId, ctx, times);
  return { ...out, save: syncAchievementCounters(recordActivity(out.save, day, 'hero_level_up', out.levels)) };
}

/** Вознесение: ascendHero (копии, ветка) + hero_ascend и ascensions. Ошибки — HeroError как у ascendHero. */
export function actAscend(save: SaveState, day: string, heroId: string, fodderIds: readonly string[], ctx: GameContext, opts: AscendOptions = {}): ReturnType<typeof ascendHero> {
  const out = ascendHero(save, heroId, fodderIds, ctx, opts);
  return { ...out, save: syncAchievementCounters(trackAchievement(recordActivity(out.save, day, 'hero_ascend'), 'ascensions', 1, 'add')) };
}

/** Таверна: summon (×1/×10, гемы/свитки/бесплатно) + summon (по числу карточек) и summons. Ошибки — HeroError. */
export function actSummon(save: SaveState, day: string, count: number, pay: SummonPay, ctx: GameContext & { equipment?: EquipmentConfig }): { save: SaveState; results: SummonDraw[]; events: ProgressEvent[] } {
  const out = summon(save, ctx, { count, pay, day });
  return { ...out, save: syncAchievementCounters(trackAchievement(recordActivity(out.save, day, 'summon', out.results.length), 'summons', out.results.length, 'add')) };
}

/** useFastRewards (K1) + fast_rewards. */
export function actUseFastRewards(
  save: SaveState,
  day: string,
  ctx: FeatureContext & { equipment?: EquipmentConfig },
): { save: SaveState; rewards: FastRewards; loot: ChestLootGrant; events: FeatureEvent[] } {
  const out = useFastRewards(save, day, ctx);
  return { ...out, save: syncAchievementCounters(recordActivity(out.save, day, 'fast_rewards')) };
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

/** climbTower (K4) + tower_attempt (за каждый штурм, и победу, и поражение). */
export function actClimbTower(save: SaveState, day: string, seed: number, ctx: TowerContext): TowerOutcome {
  const out = climbTower(save, seed, ctx);
  const s = syncAchievementCounters(trackAchievement(recordActivity(out.save, day, 'tower_attempt'), 'battles_won', out.result.winner === 'A' ? 1 : 0, 'add'));
  return { ...out, save: s };
}

/** Забег Башни (рогалик): fightTowerFloor + tower_attempt (за каждый бой забега) + battles_won + максимумы (рекорд этажа). */
export function actTowerFight(save: SaveState, day: string, ctx: TowerContext, control?: PlayerControl): TowerFightOutcome {
  const out = fightTowerFloor(save, day, ctx, control);
  const s = syncAchievementCounters(trackAchievement(recordActivity(out.save, day, 'tower_attempt'), 'battles_won', out.result.winner === 'A' ? 1 : 0, 'add'));
  return { ...out, save: s };
}

/*
 * Награды с опытом (задания, пороги активности, экспедиции, достижения): опыт уходит в общий пул (v4), уровни
 * поднимает игрок (actLevelUp) — level-up в наградах не бывает. Обёртки переключают день (rollDay) и засчитали бы
 * hero_level_up, если бы награда когда-нибудь давала уровни напрямую.
 */
function recordLevelUps<O extends { save: SaveState; events: readonly { type: string }[] }>(out: O, day: string): O {
  return { ...out, save: recordActivity(out.save, day, 'hero_level_up', levelUps(out.events)) };
}

/** claimQuest + hero_level_up (сейчас задание даёт только очки, опыта нет — на будущее и для единообразия). */
export function actClaimQuest(save: SaveState, day: string, questId: string, ctx: FeatureContext): { save: SaveState; points: number; events: FeatureEvent[] } {
  return recordLevelUps(claimQuest(save, day, questId, ctx), day);
}

/** claimActivity (jobExp порога — в пул). */
export function actClaimActivity(
  save: SaveState,
  day: string,
  milestone: number,
  ctx: FeatureContext,
): { save: SaveState; rewards: MilestoneRewards; events: FeatureEvent[] } {
  return recordLevelUps(claimActivity(save, day, milestone, ctx), day);
}

/** K9. claimExpedition (опыт — в пул, карты — случайным героям, предметы — в инвентарь). */
export function actClaimExpedition(save: SaveState, day: string, locationId: string, now: number, ctx: ExpeditionContext): ReturnType<typeof claimExpedition> {
  return recordLevelUps(claimExpedition(save, locationId, now, ctx), day);
}

/** K10. claimAchievement (jobExp — в пул, карты героя — случайным героям). */
export function actClaimAchievement(save: SaveState, day: string, id: string, ctx: MetaContext): { save: SaveState; rewards: MetaRewards; events: MetaEvent[] } {
  return recordLevelUps(claimAchievement(save, id, ctx), day);
}

/** «Забрать всё» заданий дня: claimAllQuests (задания, затем пороги активности; опыт порогов — в пул). */
export function actClaimAllQuests(save: SaveState, day: string, ctx: FeatureContext): ReturnType<typeof claimAllQuests> {
  return recordLevelUps(claimAllQuests(save, day, ctx), day);
}

/** «Забрать всё» экспедиций: claimAllExpeditions (все вернувшиеся к now). */
export function actClaimAllExpeditions(save: SaveState, day: string, now: number, ctx: ExpeditionContext): ReturnType<typeof claimAllExpeditions> {
  return recordLevelUps(claimAllExpeditions(save, now, ctx), day);
}

/** «Забрать всё» достижений: claimAllAchievements. */
export function actClaimAllAchievements(save: SaveState, day: string, ctx: MetaContext): ReturnType<typeof claimAllAchievements> {
  return recordLevelUps(claimAllAchievements(save, ctx), day);
}

/**
 * Кухня (src/core/kitchen): приготовить блюдо дня. Заданий и достижений Кухня пока не засчитывает (data/quests.json —
 * отдельный пакет); обёртка — единая точка для экранов и будущих крючков заданий. Ошибки — KitchenError.
 */
export function actCookMeal(save: SaveState, day: string, recipeId: string, ctx: KitchenContext): SaveState {
  return cookMeal(save, day, recipeId, ctx);
}

/** Кухня: купить продукт за золото (лимит в день). Ошибки — KitchenError. */
export function actBuyIngredient(save: SaveState, day: string, ingredientId: string, ctx: KitchenContext, count = 1): SaveState {
  return buyIngredient(save, day, ingredientId, ctx, count);
}
