import type { PowerConfig } from '../features/config';
import type { ItemInstance, SaveState } from '../save/schema';
import type { CardsLookup } from './cards';
import { canEquip, heroItemStats } from './equipment';
import { EquipmentError } from './errors';
import type { EquipmentContext } from './load';
import type { ItemDef, ItemStats } from './schema';

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
 * Сколько героев ждут вещь def: герои, которые могут её надеть и у которых в её слоте пусто или вещь хуже.
 * Копии одной карточки героя считаются одним героем (сравнение — с лучшей вещью в слоте среди копий): копия «на
 * вознесение» с пустыми слотами не держит запас. Оценка — веса мощи (data/progression.json → power), как у «Надеть
 * лучшее» (features/gear.ts itemScore); надетая вещь — с заточкой и картой MVP. Нет весов в контексте — сумма статов.
 */
export function heroesWanting(save: SaveState, def: ItemDef, ctx: EquipmentContext): number {
  const k = (ctx as { features?: { power?: PowerConfig } }).features?.power;
  const score = (st: ItemStats): number =>
    k ? (st.hp ?? 0) * k.hp + (st.atk ?? 0) * k.atk + (st.def ?? 0) * k.def + (st.spd ?? 0) * k.spd : (st.hp ?? 0) + (st.atk ?? 0) + (st.def ?? 0) + (st.spd ?? 0);
  const own = score(def.stats);
  const worn = new Map<string, number>();
  for (const hero of save.heroes) {
    if (!ctx.content.heroes[hero.templateId] || !canEquip(hero, def, ctx)) continue;
    const item = save.inventory.items.find((i) => i.equippedBy === hero.id && ctx.equipment.items[i.itemId]?.slot === def.slot);
    const itemDef = item ? ctx.equipment.items[item.itemId] : undefined;
    const now = item && itemDef ? score(heroItemStats(hero, itemDef, item, ctx as EquipmentContext & CardsLookup)) : 0;
    worn.set(hero.templateId, Math.max(worn.get(hero.templateId) ?? -Infinity, now));
  }
  let n = 0;
  for (const s of worn.values()) if (own > s) n++;
  return n;
}

/**
 * Без списка — только лишние обычные/редкие копии. Свободных копий каждого itemId остаётся столько, сколько героев её
 * ждут (heroesWanting: вещь лучше надетой), и не меньше одной запасной: «повторы» — только сверх этого.
 * Эпики никогда не попадают в пакетную продажу. Явный список — только продаваемые вещи, без дублей id.
 */
export function salvagePlan(save: SaveState, ctx: EquipmentContext, instanceIds?: readonly string[]): SalvagePlan {
  const ids = instanceIds ? new Set(instanceIds) : undefined;
  const kept = new Map<string, number>();
  const keepOf = new Map<string, number>();
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
      const n = kept.get(item.itemId) ?? 0;
      // Первая копия остаётся всегда; сколько ждут герои — считаем, только когда копий больше одной.
      let keep = keepOf.get(item.itemId);
      if (keep === undefined && n >= 1) {
        keep = Math.max(1, heroesWanting(save, def, ctx));
        keepOf.set(item.itemId, keep);
      }
      if (n < (keep ?? 1)) {
        kept.set(item.itemId, n + 1);
        continue;
      }
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
