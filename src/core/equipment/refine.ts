/**
 * «Заточка» снаряжения (как у кузнеца в Ragnarok Online, +1…+maxLevel) — главный сток золота после потолка уровней.
 * Детерминированно, без случайности: шаг всегда успешен. Числа — data/drops.json → refine (RefineConfigSchema).
 *   статы предмета:  база × (1 + bonusPerLevel · N), округление до целого;
 *   цена шага +N → +N+1:  cost.base[редкость] × cost.growth^N (2 значащие цифры).
 * Статы с заточкой попадают в бой и мощь через heroGearStats / withGear.
 */
import type { GameContext } from '../progression/types';
import type { ItemInstance, SaveState } from '../save/schema';
import { featureUnlocked } from '../unlocks/unlocks';
import { heroSlots } from './equipment';
import { EquipmentError } from './errors';
import type { EquipmentConfig, EquipmentContext } from './load';
import { SLOTS, type ItemDef, type ItemStats, type RefineConfig } from './schema';

/** Контекст, из которого берётся конфиг заточки. */
type RefineCtx = { equipment: EquipmentConfig };

/** Конфиг заточки или undefined (в data/drops.json нет refine — заточки нет). */
export function refineConfig(ctx: RefineCtx): RefineConfig | undefined {
  return ctx.equipment.drops.refine;
}

/** Уровень заточки экземпляра (нет поля — 0). */
export function refineLevel(instance: Pick<ItemInstance, 'refine'>): number {
  return instance.refine ?? 0;
}

/** Максимальный уровень заточки (нет конфига — 0). */
export function refineMax(ctx: RefineCtx): number {
  return refineConfig(ctx)?.maxLevel ?? 0;
}

/** Статы предмета с заточкой refine: база × (1 + bonusPerLevel · refine), округлено. refine 0 / нет конфига — база. */
export function refinedStats(def: Pick<ItemDef, 'stats'>, refine: number, ctx: RefineCtx): ItemStats {
  const cfg = refineConfig(ctx);
  if (!cfg || refine <= 0) return def.stats;
  const m = 1 + cfg.bonusPerLevel * Math.min(refine, cfg.maxLevel);
  const out: ItemStats = {};
  for (const k of ['hp', 'atk', 'def', 'spd'] as const) {
    const v = def.stats[k];
    if (v !== undefined) out[k] = Math.round(v * m);
  }
  return out;
}

/** Имя с заточкой: «+7 Меч» (без заточки — просто имя). */
export function refinedName(def: Pick<ItemDef, 'name'>, refine: number): string {
  return refine > 0 ? `+${refine} ${def.name}` : def.name;
}

/** 2 значащие цифры (1234 → 1200, 45 678 → 46 000). */
function nice(n: number): number {
  if (n <= 0) return 0;
  const step = Math.pow(10, Math.max(0, Math.floor(Math.log10(n)) - 1));
  return Math.round(n / step) * step;
}

/** Цена шага с уровня refine на refine+1 для редкости предмета или null (максимум / нет конфига). */
export function refineStepCost(def: Pick<ItemDef, 'rarity'>, refine: number, ctx: RefineCtx): { gold: number } | null {
  const cfg = refineConfig(ctx);
  if (!cfg || refine >= cfg.maxLevel) return null;
  return { gold: nice(cfg.cost.base[def.rarity] * Math.pow(cfg.cost.growth, refine)) };
}

/** Цена следующего шага заточки экземпляра или null (уже максимум или заточки нет). */
export function refineCost(instance: Pick<ItemInstance, 'refine'>, def: Pick<ItemDef, 'rarity'>, ctx: RefineCtx): { gold: number } | null {
  return refineStepCost(def, refineLevel(instance), ctx);
}

/** Открыта ли заточка: есть конфиг и пройден этап из data/unlocks.json (refine; нет строки — сразу). */
export function refineUnlocked(save: Pick<SaveState, 'campaign'>, ctx: GameContext & RefineCtx): boolean {
  return !!refineConfig(ctx) && featureUnlocked(save, 'refine', ctx);
}

export interface RefineEvent {
  type: 'refined';
  instanceId: string;
  itemId: string;
  from: number;
  to: number;
  gold: number;
}

/**
 * Заточить предмет на +1 (надетый или лежащий). Чистая функция, всегда успешно.
 * Ошибки EquipmentError: unknown_item, unknown_item_def, refine_unavailable (нет конфига), refine_locked (не открыта),
 * refine_max (уже максимум), not_enough_gold.
 */
export function refineItem(save: SaveState, instanceId: string, ctx: EquipmentContext): { save: SaveState; events: RefineEvent[] } {
  const item = save.inventory.items.find((i) => i.id === instanceId);
  if (!item) throw new EquipmentError('unknown_item', `Предмет ${instanceId} не найден в инвентаре`);
  const def = ctx.equipment.items[item.itemId];
  if (!def) throw new EquipmentError('unknown_item_def', `Неизвестный предмет: ${item.itemId}`);
  if (!refineConfig(ctx)) throw new EquipmentError('refine_unavailable', 'Заточка недоступна');
  if (!featureUnlocked(save, 'refine', ctx)) throw new EquipmentError('refine_locked', 'Заточка ещё не открыта');
  const from = refineLevel(item);
  const cost = refineCost(item, def, ctx);
  if (!cost) throw new EquipmentError('refine_max', `${refinedName(def, from)}: заточка на максимуме`);
  if (save.resources.gold < cost.gold) throw new EquipmentError('not_enough_gold', `Не хватает золота: нужно ${cost.gold}, есть ${save.resources.gold}`);
  const to = from + 1;
  const items = save.inventory.items.map((i): ItemInstance => (i.id === item.id ? { ...i, refine: to } : i));
  return {
    save: { ...save, resources: { ...save.resources, gold: save.resources.gold - cost.gold }, inventory: { ...save.inventory, items } },
    events: [{ type: 'refined', instanceId: item.id, itemId: item.itemId, from, to, gold: cost.gold }],
  };
}

/** План «Заточить всё надетое»: шаги по одному на предмет героя (в порядке слотов), пока хватает золота. */
export interface RefineAllPlan {
  steps: { instanceId: string; itemId: string; from: number; gold: number }[];
  /** Сумма золота всех шагов. */
  gold: number;
}

/**
 * «Заточить всё надетое» на герое heroId: по одному шагу каждому надетому предмету (слоты по порядку, максимум
 * пропускается), пока хватает золота. Для подтверждения в UI — сначала план, потом actRefineAll.
 */
export function refineAllPlan(save: SaveState, heroId: string, ctx: EquipmentContext): RefineAllPlan {
  const slots = heroSlots(save, heroId, ctx);
  let left = save.resources.gold;
  const steps: RefineAllPlan['steps'] = [];
  for (const slot of SLOTS) {
    const s = slots[slot];
    if (!s) continue;
    const cost = refineCost(s.instance, s.def, ctx);
    if (!cost || cost.gold > left) continue;
    left -= cost.gold;
    steps.push({ instanceId: s.instance.id, itemId: s.instance.itemId, from: refineLevel(s.instance), gold: cost.gold });
  }
  return { steps, gold: save.resources.gold - left };
}

/** Выполнить refineAllPlan: заточить надетое на герое (по шагу каждому предмету). Ошибки — как у refineItem. */
export function actRefineAll(save: SaveState, heroId: string, ctx: EquipmentContext): { save: SaveState; events: RefineEvent[] } {
  const plan = refineAllPlan(save, heroId, ctx);
  let s = save;
  const events: RefineEvent[] = [];
  for (const st of plan.steps) {
    const r = refineItem(s, st.instanceId, ctx);
    s = r.save;
    events.push(...r.events);
  }
  return { save: s, events };
}
