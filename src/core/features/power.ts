import type { CampaignChoices } from '../campaign/choices';
import { enemySquad, getStage } from '../campaign/campaign';
import type { UnitDef } from '../content/schema';
import { heroGearStats, withGear } from '../equipment/equipment';
import type { EquipmentConfig } from '../equipment/load';
import { withMeal } from '../kitchen/kitchen';
import { buildUnit } from '../progression/stats';
import type { HeroState, SaveState } from '../save/schema';
import type { FeatureContext } from './config';

/**
 * K2. Мощь юнита (число для экранов и баланса, на бой не влияет):
 *   round(hp·k.hp + atk·k.atk + def·k.def + spd·k.spd + k.perActive·A + k.perPassive·P),
 * k — data/progression.json → power; A — активные навыки сверх обычной атаки (ульта и skills.actives),
 * P — число пассивок. moveSpeed не учитывается.
 */
export function unitPower(unit: UnitDef, ctx: FeatureContext): number {
  const k = ctx.features.power;
  const s = unit.stats;
  const actives = (unit.skills.ult ? 1 : 0) + unit.skills.actives.length;
  const passives = unit.skills.passives.length;
  return Math.round(s.hp * k.hp + s.atk * k.atk + s.def * k.def + s.spd * k.spd + k.perActive * actives + k.perPassive * passives);
}

/**
 * Юнит с блюдом дня Кухни — как в бою кампании, Башни и охоты (kitchen.ts withMeal: hp/atk/def × (1 + %/100)).
 * Нет сохранения, дня или блюда на этот день — тот же юнит.
 */
function fed(unit: UnitDef, save: Pick<SaveState, 'kitchen'> | undefined, day: string | undefined, ctx: object): UnitDef {
  return save && day !== undefined ? (withMeal([unit], save, day, ctx)[0] ?? unit) : unit;
}

/**
 * K2. Мощь героя игрока = unitPower(buildUnit(hero)).
 * K6: с save и ctx.equipment — с экипировкой героя из save.inventory (иначе без неё).
 * day (с save) — день боя: блюдо дня Кухни, приготовленное в этот день, прибавляет статы, как в бою. Без дня — без блюда.
 */
export function heroPower(hero: HeroState, ctx: FeatureContext & { equipment?: EquipmentConfig }, save?: SaveState, day?: string): number {
  if (save && ctx.equipment) {
    // withGear раньше строил прибавки всей коллекции ради одного героя. Карты остаются от настоящего
    // экземпляра в save, даже если hero — предварительный просмотр уровня/профессии.
    const gear = save.heroes.some((h) => h.id === hero.id)
      ? heroGearStats(save, hero.id, ctx as FeatureContext & { equipment: EquipmentConfig })
      : { hp: 0, atk: 0, def: 0, spd: 0 };
    return unitPower(fed(buildUnit(hero, ctx, gear), save, day, ctx), ctx);
  }
  return unitPower(fed(buildUnit(hero, ctx), save, day, ctx), ctx);
}

/**
 * K2. Мощь отряда = сумма мощи героев в слотах save.squad (пустые и неизвестные слоты — 0), K6: с экипировкой.
 * day — день боя: блюдо дня Кухни прибавляет статы, как в бою кампании, Башни и охоты (squadUnits / towerRunSquad).
 * Без дня — без блюда: общая мощь отряда (экран «Герои», рейтинги) и Арена, которая блюда не видит.
 */
export function squadPower(save: SaveState, ctx: FeatureContext & { equipment?: EquipmentConfig }, day?: string): number {
  const gctx = withGear(ctx, save);
  let sum = 0;
  for (const id of save.squad) {
    const hero = id === null ? undefined : save.heroes.find((h) => h.id === id);
    if (hero) sum += unitPower(fed(buildUnit(hero, gctx), save, day, ctx), gctx);
  }
  return sum;
}

/** K2. Мощь врагов этапа = сумма unitPower по enemySquad (с ростом по кривой кампании). */
export function stagePower(stageId: string, ctx: FeatureContext, choices?: CampaignChoices): number {
  return enemySquad(stageId, ctx, choices).reduce((sum, u) => sum + (u ? unitPower(u, ctx) : 0), 0);
}

/** Округлить до «красивого» числа: 2 значащие цифры до 10 000, дальше — 3 (1234 → 1200, 45 678 → 45 700). */
function roundNice(n: number): number {
  if (n <= 0) return 0;
  const digits = n >= 10_000 ? 3 : 2;
  const step = Math.pow(10, Math.max(0, Math.floor(Math.log10(n)) + 1 - digits));
  return Math.round(n / step) * step;
}

/** Коэффициент рекомендуемой мощи этапа: power.recommendedStages[id] → recommendedBoss (босс) → recommended → 1. */
export function recommendedFactor(stageId: string, ctx: FeatureContext, choices?: CampaignChoices): number {
  const stage = getStage(ctx, stageId);
  const binding = stage.campaignChoice;
  const variantFactor = binding?.variants.find((v) => v.optionId === choices?.[binding.id])?.recommendedFactor;
  if (variantFactor !== undefined) return variantFactor;
  const k = ctx.features.power;
  const own = k.recommendedStages?.[stageId];
  if (own !== undefined) return own;
  const boss = getStage(ctx, stageId).boss;
  return (boss ? (k.recommendedBoss ?? k.recommended) : k.recommended) ?? 1;
}

/**
 * «Рекомендуемая мощь этапа» (как в AFK — число над кнопкой «В бой»): stagePower × recommendedFactor, округлено до
 * красивого числа (2 значащие цифры, от 10 000 — 3). Сравнивается напрямую со squadPower (stagePowerCheck).
 * Калибровка — моделью игрока (npm run balance -- --fit-recommended, docs/content/balance.md). Это ориентир развития:
 * распределение ролей, навыки, расстановка и лимит времени тоже определяют исход; превышение мощи не обещает победу.
 */
export function recommendedPower(stageId: string, ctx: FeatureContext, choices?: CampaignChoices): number {
  return roundNice(stagePower(stageId, ctx, choices) * recommendedFactor(stageId, ctx, choices));
}

/** Насколько отряд готов к этапу: very_hard < 0.85 ≤ hard < 0.95 ≤ ok < 1.1 ≤ easy (доля от рекомендуемой). */
export type PowerVerdict = 'easy' | 'ok' | 'hard' | 'very_hard';

export interface StagePowerCheck {
  squad: number;
  recommended: number;
  /** squad / recommended (0, если рекомендуемая 0). */
  ratio: number;
  verdict: PowerVerdict;
}

/** Мощь отряда против рекомендуемой мощи этапа — для экрана подготовки к бою и карты кампании. day — с блюдом дня (squadPower). */
export function stagePowerCheck(save: SaveState, stageId: string, ctx: FeatureContext & { equipment?: EquipmentConfig }, day?: string): StagePowerCheck {
  const squad = squadPower(save, ctx, day);
  const recommended = recommendedPower(stageId, ctx, save.campaignChoices);
  const ratio = recommended > 0 ? squad / recommended : 0;
  const verdict: PowerVerdict = ratio >= 1.1 ? 'easy' : ratio >= 0.95 ? 'ok' : ratio >= 0.85 ? 'hard' : 'very_hard';
  return { squad, recommended, ratio, verdict };
}
