import type { CampaignChoices } from '../campaign/choices';
import { enemySquad, getStage } from '../campaign/campaign';
import type { UnitDef } from '../content/schema';
import { heroGearStats, withGear } from '../equipment/equipment';
import type { EquipmentConfig } from '../equipment/load';
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
 * K2. Мощь героя игрока = unitPower(buildUnit(hero)).
 * K6: с save и ctx.equipment — с экипировкой героя из save.inventory (иначе без неё).
 */
export function heroPower(hero: HeroState, ctx: FeatureContext & { equipment?: EquipmentConfig }, save?: SaveState): number {
  if (save && ctx.equipment) {
    // withGear раньше строил прибавки всей коллекции ради одного героя. Карты остаются от настоящего
    // экземпляра в save, даже если hero — предварительный просмотр уровня/профессии.
    const gear = save.heroes.some((h) => h.id === hero.id)
      ? heroGearStats(save, hero.id, ctx as FeatureContext & { equipment: EquipmentConfig })
      : { hp: 0, atk: 0, def: 0, spd: 0 };
    return unitPower(buildUnit(hero, ctx, gear), ctx);
  }
  return unitPower(buildUnit(hero, ctx), ctx);
}

/** K2. Мощь отряда = сумма мощи героев в слотах save.squad (пустые и неизвестные слоты — 0), K6: с экипировкой. */
export function squadPower(save: SaveState, ctx: FeatureContext & { equipment?: EquipmentConfig }): number {
  const gctx = withGear(ctx, save);
  let sum = 0;
  for (const id of save.squad) {
    const hero = id === null ? undefined : save.heroes.find((h) => h.id === id);
    if (hero) sum += heroPower(hero, gctx);
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

/** Мощь отряда против рекомендуемой мощи этапа — для экрана подготовки к бою и карты кампании. */
export function stagePowerCheck(save: SaveState, stageId: string, ctx: FeatureContext & { equipment?: EquipmentConfig }): StagePowerCheck {
  const squad = squadPower(save, ctx);
  const recommended = recommendedPower(stageId, ctx, save.campaignChoices);
  const ratio = recommended > 0 ? squad / recommended : 0;
  const verdict: PowerVerdict = ratio >= 1.1 ? 'easy' : ratio >= 0.95 ? 'ok' : ratio >= 0.85 ? 'hard' : 'very_hard';
  return { squad, recommended, ratio, verdict };
}
