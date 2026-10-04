import type { ItemInstance, SaveState } from '../save/schema';
import { EquipmentError } from './errors';
import type { EquipmentContext } from './load';
import type { ItemDef } from './schema';

export type SalvageProtection = 'equipped' | 'refined' | 'card' | 'locked';

/** Защита действует в ядре, поэтому прямой вызов не сможет продать ценную вещь. */
export function salvageProtection(item: ItemInstance): SalvageProtection | null {
  if (item.equippedBy !== null) return 'equipped';
  if ((item.refine ?? 0) > 0) return 'refined';
  if (item.card) return 'card';
  if (item.locked) return 'locked';
  return null;
}

export function salvageValue(def: Pick<ItemDef, 'rarity'>, ctx: EquipmentContext): number {
  return ctx.equipment.drops.salvage?.goldByRarity[def.rarity] ?? 0;
}

/** Замок не мешает надеванию и заточке, защищает только от продажи. */
export function lockItem(save: SaveState, instanceId: string, locked: boolean): SaveState {
  const item = save.inventory.items.find((i) => i.id === instanceId);
  if (!item) throw new EquipmentError('unknown_item', 'Предмета больше нет в инвентаре');
  if (!!item.locked === locked) return save;
  return { ...save, inventory: { ...save.inventory, items: save.inventory.items.map((i) => i.id === instanceId ? { ...i, locked } : i) } };
}

export interface SalvagePlan {
  instanceIds: string[];
  gold: number;
}

/**
 * Без списка — только лишние обычные/редкие копии: одна безопасная запасная вещь каждого itemId остаётся.
 * Эпики никогда не попадают в пакетную продажу. Явный список — только продаваемые вещи, без дублей id.
 */
export function salvagePlan(save: SaveState, ctx: EquipmentContext, instanceIds?: readonly string[]): SalvagePlan {
  const ids = instanceIds ? new Set(instanceIds) : undefined;
  const keep = new Set<string>();
  const selected: string[] = [];
  let gold = 0;
  for (const item of save.inventory.items) {
    if (ids && !ids.has(item.id)) continue;
    const def = ctx.equipment.items[item.itemId];
    if (!def || salvageProtection(item)) continue;
    const value = salvageValue(def, ctx);
    if (value <= 0) continue;
    if (!ids) {
      if (def.rarity === 'epic') continue;
      if (!keep.has(item.itemId)) { keep.add(item.itemId); continue; }
    }
    // Повреждённое сохранение с повторными id не умножает выручку.
    if (selected.includes(item.id)) continue;
    selected.push(item.id);
    gold += value;
  }
  return { instanceIds: selected, gold };
}

/**
 * Подтверждённая продажа: сначала проверяет весь список, затем удаляет экземпляры и выдаёт золото атомарно.
 * Повтор того же запроса / устаревший план — ошибка без выдачи золота. Дубли в запросе считаются один раз.
 */
export function salvageItems(save: SaveState, instanceIds: readonly string[], ctx: EquipmentContext): { save: SaveState; gold: number; sold: number } {
  if (!ctx.equipment.drops.salvage) throw new EquipmentError('salvage_unavailable', 'Продажа снаряжения недоступна');
  const ids = [...new Set(instanceIds)];
  if (!ids.length) return { save, gold: 0, sold: 0 };
  let gold = 0;
  for (const id of ids) {
    const matching = save.inventory.items.filter((i) => i.id === id);
    if (matching.length !== 1) throw new EquipmentError('unknown_item', 'Список снаряжения изменился — выберите предметы заново');
    const item = matching[0];
    const def = ctx.equipment.items[item.itemId];
    if (!def) throw new EquipmentError('unknown_item_def', 'Предмета больше нет в игре');
    if (salvageProtection(item)) throw new EquipmentError('item_protected', 'Нельзя продать надетую, улучшенную, закреплённую вещь или предмет с картой MVP');
    gold += salvageValue(def, ctx);
  }
  const selected = new Set(ids);
  // Поддерживает и старые сохранения без itemSeq: удалённые номера больше не будут выданы заново.
  let itemSeq = save.inventory.itemSeq ?? 0;
  for (const item of save.inventory.items) {
    const n = /^it(\d+)$/.exec(item.id);
    if (n) itemSeq = Math.max(itemSeq, Number(n[1]));
  }
  return {
    save: { ...save, resources: { ...save.resources, gold: save.resources.gold + gold }, inventory: { ...save.inventory, items: save.inventory.items.filter((i) => !selected.has(i.id)), itemSeq } },
    gold,
    sold: ids.length,
  };
}
