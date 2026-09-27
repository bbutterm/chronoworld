import { heroJobId } from '../heroes/card';
import type { GameContext } from '../progression/types';
import type { GearLookup, StatBonus } from '../progression/stats';
import type { HeroState, ItemInstance, SaveState } from '../save/schema';
import { EquipmentError } from './errors';
import type { EquipmentContext } from './load';
import type { ItemDef, Slot } from './schema';

/** Описание предмета по id; нет — EquipmentError('unknown_item_def'). */
export function getItemDef(ctx: EquipmentContext, itemId: string): ItemDef {
  const def = ctx.equipment.items[itemId];
  if (!def) throw new EquipmentError('unknown_item_def', `Неизвестный предмет: ${itemId}`);
  return def;
}

/** Экземпляры предметов, надетые на героя heroId (порядок — как в инвентаре). */
export function heroEquipment(save: SaveState, heroId: string): ItemInstance[] {
  return save.inventory.items.filter((i) => i.equippedBy === heroId);
}

/** Надетое на героя по слотам (экземпляр + описание). Предметы, которых нет в контенте, пропускаются. */
export function heroSlots(save: SaveState, heroId: string, ctx: EquipmentContext): Partial<Record<Slot, { instance: ItemInstance; def: ItemDef }>> {
  const out: Partial<Record<Slot, { instance: ItemInstance; def: ItemDef }>> = {};
  for (const instance of heroEquipment(save, heroId)) {
    const def = ctx.equipment.items[instance.itemId];
    if (def) out[def.slot] = { instance, def };
  }
  return out;
}

/** Сумма плоских прибавок предметов. */
export function equipmentStats(items: readonly ItemDef[]): StatBonus {
  const sum: StatBonus = { hp: 0, atk: 0, def: 0, spd: 0 };
  for (const it of items) {
    sum.hp += it.stats.hp ?? 0;
    sum.atk += it.stats.atk ?? 0;
    sum.def += it.stats.def ?? 0;
    sum.spd += it.stats.spd ?? 0;
  }
  return sum;
}

/** Прибавка экипировки героя (неизвестные контенту предметы в сохранении не считаются). */
export function heroGearStats(save: SaveState, heroId: string, ctx: EquipmentContext): StatBonus {
  return equipmentStats(Object.values(heroSlots(save, heroId, ctx)).map((s) => s.def));
}

/**
 * Контекст с прибавками экипировки всех героев save (ctx.heroGear) — передаётся в playStage/skipStage/buildUnit,
 * которые о save.inventory не знают. Без ctx.equipment возвращает ctx как есть.
 */
export function withGear<C extends GameContext>(ctx: C & { equipment?: EquipmentContext['equipment'] }, save: SaveState): C & GearLookup {
  if (!ctx.equipment) return ctx;
  const ectx = ctx as C & EquipmentContext;
  const heroGear: Record<string, StatBonus> = {};
  for (const hero of save.heroes) {
    if (save.inventory.items.some((i) => i.equippedBy === hero.id)) heroGear[hero.id] = heroGearStats(save, hero.id, ectx);
  }
  return { ...ctx, heroGear };
}

/** Профессия jobId и все её предки по полю from. */
function jobLine(ctx: GameContext, jobId: string): Set<string> {
  const seen = new Set<string>();
  const stack = [jobId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(ctx.content.jobs[id]?.from ?? []));
  }
  return seen;
}

/** Может ли герой надеть предмет (ограничение jobs: профессия героя или её предок в списке). */
export function canEquip(hero: HeroState, def: ItemDef, ctx: GameContext): boolean {
  if (!def.jobs) return true;
  const line = jobLine(ctx, heroJobId(hero, ctx));
  return def.jobs.some((j) => line.has(j));
}

function findHero(save: SaveState, heroId: string): HeroState {
  const hero = save.heroes.find((h) => h.id === heroId);
  if (!hero) throw new EquipmentError('unknown_hero', `Герой ${heroId} не найден`);
  return hero;
}

function findItem(save: SaveState, itemInstanceId: string): ItemInstance {
  const item = save.inventory.items.find((i) => i.id === itemInstanceId);
  if (!item) throw new EquipmentError('unknown_item', `Предмет ${itemInstanceId} не найден в инвентаре`);
  return item;
}

/**
 * Надеть предмет itemInstanceId на героя heroId. Чистая функция.
 * - Предмет в слоте уже надетый на этого героя снимается в инвентарь (замена).
 * - Уже надет на этого героя — без изменений.
 * - Ошибки: unknown_hero, unknown_item, unknown_item_def, job_restricted (профессия не подходит),
 *   item_equipped_by_other (предмет на другом герое — сначала unequip).
 */
export function equip(save: SaveState, heroId: string, itemInstanceId: string, ctx: EquipmentContext): SaveState {
  const hero = findHero(save, heroId);
  const item = findItem(save, itemInstanceId);
  const def = getItemDef(ctx, item.itemId);
  if (item.equippedBy === heroId) return save;
  if (item.equippedBy !== null) throw new EquipmentError('item_equipped_by_other', `${def.name} уже надет на другого героя`);
  if (!canEquip(hero, def, ctx)) throw new EquipmentError('job_restricted', `${def.name}: не подходит для профессии героя`);
  const items = save.inventory.items.map((i): ItemInstance => {
    if (i.id === item.id) return { ...i, equippedBy: heroId };
    if (i.equippedBy === heroId && ctx.equipment.items[i.itemId]?.slot === def.slot) return { ...i, equippedBy: null };
    return i;
  });
  return { ...save, inventory: { ...save.inventory, items } };
}

/** Снять предмет в инвентарь. Не надет — без изменений; нет в инвентаре — EquipmentError('unknown_item'). */
export function unequip(save: SaveState, itemInstanceId: string): SaveState {
  const item = findItem(save, itemInstanceId);
  if (item.equippedBy === null) return save;
  const items = save.inventory.items.map((i) => (i.id === item.id ? { ...i, equippedBy: null } : i));
  return { ...save, inventory: { ...save.inventory, items } };
}

/**
 * Добавить в инвентарь новые экземпляры предметов itemIds (не надеты).
 * id экземпляра — `it<N>`, N = максимальный существующий N + 1 (детерминированно, без случайности).
 */
export function addItems(save: SaveState, itemIds: readonly string[]): { save: SaveState; added: ItemInstance[] } {
  let n = 0;
  for (const i of save.inventory.items) {
    const m = /^it(\d+)$/.exec(i.id);
    if (m) n = Math.max(n, Number(m[1]));
  }
  const added = itemIds.map((itemId): ItemInstance => ({ id: `it${++n}`, itemId, equippedBy: null }));
  if (added.length === 0) return { save, added };
  return { save: { ...save, inventory: { ...save.inventory, items: [...save.inventory.items, ...added] } }, added };
}
