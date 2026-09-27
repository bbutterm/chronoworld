import { enemySquad } from '../campaign/campaign';
import type { UnitDef } from '../content/schema';
import { withGear } from '../equipment/equipment';
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
  return unitPower(buildUnit(hero, save ? withGear(ctx, save) : ctx), ctx);
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
export function stagePower(stageId: string, ctx: FeatureContext): number {
  return enemySquad(stageId, ctx).reduce((sum, u) => sum + (u ? unitPower(u, ctx) : 0), 0);
}
