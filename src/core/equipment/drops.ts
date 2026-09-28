import { getStage, type StageOutcome } from '../campaign/campaign';
import type { GameContext } from '../progression/types';
import type { GearLookup } from '../progression/stats';
import { Rng } from '../rng';
import type { ItemInstance, SaveState } from '../save/schema';
import { addItems, withGear } from './equipment';
import type { EquipmentConfig, EquipmentContext } from './load';
import { itemPools, pickRarity } from './chest';
import type { DropRule, RarityWeights } from './schema';

/** Правило выпадения для этапа: своё правило главы, иначе первое без chapter, иначе нет. */
export function dropRule(stageId: string, ctx: EquipmentContext): DropRule | undefined {
  const stage = getStage(ctx, stageId);
  const rules = ctx.equipment.drops.rules;
  return rules.find((r) => r.chapter === stage.chapter) ?? rules.find((r) => !r.chapter);
}

/** Отдельный поток случайности из seed боя, чтобы выпадение не повторяло первые броски боя. */
function dropRng(seed: number): Rng {
  return new Rng(Math.imul((seed ^ 0x9e3779b9) >>> 0, 0x85ebca6b) >>> 0);
}

/**
 * K6. Предметы за победу на этапе (id описаний, 0 или 1 шт.). Детерминированно по seed боя.
 * - firstClear и rule.firstClearGuaranteed → ровно 1 предмет (веса firstClearRarityWeights ?? rarityWeights);
 * - иначе с шансом rule.chance — 1 предмет по rarityWeights;
 * - предмет — равновероятно среди предметов выбранной редкости с drop ≠ false (по порядку id);
 *   редкости без таких предметов не выпадают.
 */
export function rollDrops(stageId: string, seed: number, firstClear: boolean, ctx: EquipmentContext): string[] {
  const rule = dropRule(stageId, ctx);
  if (!rule) return [];
  const rng = dropRng(seed);
  const pools = itemPools(ctx.equipment.items);

  let weights: RarityWeights;
  if (firstClear && rule.firstClearGuaranteed) weights = rule.firstClearRarityWeights ?? rule.rarityWeights;
  else if (rng.next() < rule.chance) weights = rule.rarityWeights;
  else return [];

  const rarity = pickRarity(rng, weights, pools);
  if (!rarity) return [];
  const pool = pools[rarity];
  return [pool[rng.int(pool.length)]];
}

/** Итог боя с выпадением K6. */
export interface StageOutcomeWithDrops extends StageOutcome {
  /** Новые экземпляры в инвентаре (уже добавлены в save). */
  drops: ItemInstance[];
}

/**
 * Для обёрток actPlayStage/actSkipStage: сыграть бой play(ctx с экипировкой героев), при победе
 * бросить выпадение (firstClear — этапа не было в save.campaign.cleared до боя) и добавить предметы в инвентарь.
 * Без ctx.equipment — просто play(ctx), drops = [].
 */
export function playWithEquipment<C extends GameContext>(
  save: SaveState,
  stageId: string,
  seed: number,
  ctx: C & { equipment?: EquipmentConfig },
  play: (ctx: C & GearLookup) => StageOutcome,
): StageOutcomeWithDrops {
  const out = play(withGear(ctx, save));
  if (!ctx.equipment || out.result.winner !== 'A') return { ...out, drops: [] };
  const firstClear = !save.campaign.cleared.includes(stageId);
  const r = addItems(out.save, rollDrops(stageId, seed, firstClear, ctx as C & EquipmentContext));
  return { ...out, save: r.save, drops: r.added };
}
