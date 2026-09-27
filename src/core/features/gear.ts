import { canEquip } from '../equipment/equipment';
import type { EquipmentContext } from '../equipment/load';
import { RARITIES, SLOTS, type ItemDef, type Slot } from '../equipment/schema';
import type { SaveState } from '../save/schema';
import { actEquip } from './actions';
import type { FeatureContext, PowerConfig } from './config';

/**
 * P10 (T1-08). «Надеть лучшее»: какие лежащие в инвентаре предметы усилят героя.
 * Оценка предмета — те же веса, что у мощи (data/progression.json → power): предмет лучше, если его
 * вклад в мощь больше, чем у надетого в этом слоте. Чужие (надетые на других героев) предметы не берём.
 */

/** Вклад предмета в мощь героя (hp·k.hp + atk·k.atk + def·k.def + spd·k.spd). */
export function itemScore(def: ItemDef, k: PowerConfig): number {
  const s = def.stats;
  return (s.hp ?? 0) * k.hp + (s.atk ?? 0) * k.atk + (s.def ?? 0) * k.def + (s.spd ?? 0) * k.spd;
}

export interface GearUpgrade {
  slot: Slot;
  /** Экземпляр предмета из инвентаря, который стоит надеть. */
  instanceId: string;
  itemId: string;
  /** Экземпляр, который сейчас в слоте (снимется), или null — слот пуст. */
  replaces: string | null;
  /** На сколько вырастет оценка слота (> 0). */
  gain: number;
}

export type GearContext = FeatureContext & EquipmentContext;

/**
 * Лучший свободный предмет для каждого слота героя, если он лучше надетого (по одному на слот, по порядку SLOTS).
 * Равные по оценке — выше редкость, затем меньший id экземпляра (детерминированно). Нет героя — [].
 */
export function gearUpgrades(save: SaveState, heroId: string, ctx: GearContext): GearUpgrade[] {
  const hero = save.heroes.find((h) => h.id === heroId);
  if (!hero) return [];
  const k = ctx.features.power;
  const out: GearUpgrade[] = [];
  for (const slot of SLOTS) {
    const worn = save.inventory.items.find((i) => i.equippedBy === heroId && ctx.equipment.items[i.itemId]?.slot === slot);
    const wornDef = worn ? ctx.equipment.items[worn.itemId] : undefined;
    const base = wornDef ? itemScore(wornDef, k) : 0;
    let best: { id: string; itemId: string; score: number; rarity: number } | null = null;
    for (const i of save.inventory.items) {
      if (i.equippedBy !== null) continue;
      const def = ctx.equipment.items[i.itemId];
      if (!def || def.slot !== slot || !canEquip(hero, def, ctx)) continue;
      const cand = { id: i.id, itemId: i.itemId, score: itemScore(def, k), rarity: RARITIES.indexOf(def.rarity) };
      if (!best || cand.score > best.score || (cand.score === best.score && (cand.rarity > best.rarity || (cand.rarity === best.rarity && cand.id < best.id)))) best = cand;
    }
    if (best && best.score > base) out.push({ slot, instanceId: best.id, itemId: best.itemId, replaces: worn?.id ?? null, gain: best.score - base });
  }
  return out;
}

/** id героев, которым есть что надеть получше (значок на «Герои» и карточке). */
export function heroesWithGearUpgrades(save: SaveState, ctx: GearContext): string[] {
  return save.heroes.filter((h) => gearUpgrades(save, h.id, ctx).length > 0).map((h) => h.id);
}

/** Надеть на героя все улучшения gearUpgrades (через actEquip — счётчик достижения items_equipped растёт). */
export function actEquipBest(save: SaveState, heroId: string, ctx: GearContext): { save: SaveState; equipped: GearUpgrade[] } {
  const ups = gearUpgrades(save, heroId, ctx);
  let s = save;
  for (const u of ups) s = actEquip(s, heroId, u.instanceId, ctx);
  return { save: s, equipped: ups };
}
