/**
 * «Заточка» снаряжения (как у кузнеца в Ragnarok Online, +1…+maxLevel) — главный сток золота после потолка уровней.
 * Числа — data/drops.json → refine (RefineConfigSchema):
 *   статы предмета:  база × (1 + bonusByLevel[N]), округление до целого (ступени: +1…+4 скромно, +8…+10 огромно);
 *   цена шага +N → +N+1:  cost.base[редкость] × cost.growth^N (2 значащие цифры);
 *   шаг на +N ломает (уничтожает) вещь с шансом breakChance[N−1], золото списывается в любом случае;
 *   режимы шага: обычный, «надёжный» (цена × safeGoldMult, шанс ÷ safeBreakDiv), «рудой» (1 Благословенная руда,
 *   золото как за обычный, поломки нет). Руда падает с боссов — grantBlessedOre.
 * Бросок — Rng с seed refineSeed(createdAt, inventory.refineSeq); счётчик растёт с каждой попыткой, поэтому
 * перезагрузка страницы исход не меняет (детерминированно). Статы с заточкой идут в бой и мощь через heroGearStats / withGear.
 */
import type { GameContext } from '../progression/types';
import { Rng } from '../rng';
import type { ItemInstance, SaveState } from '../save/schema';
import { featureUnlocked } from '../unlocks/unlocks';
import { heroSlots } from './equipment';
import { EquipmentError } from './errors';
import type { EquipmentConfig, EquipmentContext } from './load';
import { SLOTS, type ItemDef, type ItemStats, type RefineConfig } from './schema';
import { groupDigits } from '../format';

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

/** Накопленная прибавка к статам на +refine (доля базы: 2.5 = +250%). Нет конфига — 0. */
export function refineBonus(refine: number, ctx: RefineCtx): number {
  const cfg = refineConfig(ctx);
  if (!cfg || refine <= 0) return 0;
  return cfg.bonusByLevel[Math.min(refine, cfg.maxLevel)] ?? 0;
}

/** Статы предмета с заточкой refine: база × (1 + bonusByLevel[refine]), округлено. refine 0 / нет конфига — база. */
export function refinedStats(def: Pick<ItemDef, 'stats'>, refine: number, ctx: RefineCtx): ItemStats {
  const cfg = refineConfig(ctx);
  if (!cfg || refine <= 0) return def.stats;
  const m = 1 + refineBonus(refine, ctx);
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

/** Режим шага: обычный, «надёжная заточка» (дороже, риск меньше), «рудой» (без риска, тратит 1 руду). */
export type RefineMode = 'normal' | 'safe' | 'ore';

export type RefineEvent =
  | { type: 'refined'; ok: true; instanceId: string; itemId: string; from: number; to: number; gold: number; chance: number; mode: RefineMode }
  /** Вещь сломалась при шаге с level на level+1 и удалена из инвентаря (надетая — снята с героя). */
  | { type: 'refineBroken'; instanceId: string; itemId: string; level: number; heroId: string | null; gold: number; chance: number; mode: RefineMode };

/**
 * Шанс сломать вещь при шаге с уровня from на from+1 в режиме mode (0 — безопасно; максимум / нет конфига — 0).
 * «Надёжная» — breakChance ÷ safeBreakDiv (30% → 6%), «рудой» — 0.
 */
export function refineBreakChance(from: number, ctx: RefineCtx, mode: RefineMode = 'normal'): number {
  const cfg = refineConfig(ctx);
  if (!cfg || from >= cfg.maxLevel || mode === 'ore') return 0;
  const base = cfg.breakChance?.[from] ?? 0;
  return mode === 'safe' && cfg.safeBreakDiv ? Math.round((base / cfg.safeBreakDiv) * 10000) / 10000 : base;
}

/** Есть ли «надёжная заточка» в конфиге. */
export function refineSafeAvailable(ctx: RefineCtx): boolean {
  return refineConfig(ctx)?.safeGoldMult !== undefined;
}

/** Цена шага с уровня refine в режиме mode: «надёжная» — × safeGoldMult, остальные — как обычный. null — максимум. */
export function refineModeCost(instance: Pick<ItemInstance, 'refine'>, def: Pick<ItemDef, 'rarity'>, ctx: RefineCtx, mode: RefineMode = 'normal'): { gold: number } | null {
  const c = refineCost(instance, def, ctx);
  if (!c) return null;
  const mult = mode === 'safe' ? (refineConfig(ctx)?.safeGoldMult ?? 1) : 1;
  return { gold: Math.round(c.gold * mult) };
}

/** Сколько Благословенной руды у игрока. */
export function blessedOre(save: Pick<SaveState, 'currency'>): number {
  return save.currency.blessedOre ?? 0;
}

/** Сколько руды выпадает с босса при данном seed: min…max равновероятно; нет конфига — 0. */
export function rollBlessedOre(seed: number, ctx: { equipment?: EquipmentConfig }): number {
  const o = ctx.equipment?.drops.refine?.blessedOre;
  if (!o) return 0;
  // Свой поток случайности (не совпадает с броском боя / добычи от того же seed).
  let h = 0x811c9dc5;
  for (const ch of `ore#${seed >>> 0}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return o.min + Math.floor(new Rng(h).next() * (o.max - o.min + 1));
}

/** Выдать руду с босса (seed — seed награды: бой этапа / этажа, добыча охоты). Нет конфига — без изменений, 0. */
export function grantBlessedOre(save: SaveState, seed: number, ctx: { equipment?: EquipmentConfig }): { save: SaveState; count: number } {
  const count = rollBlessedOre(seed, ctx);
  if (count <= 0) return { save, count: 0 };
  return { save: { ...save, currency: { ...save.currency, blessedOre: blessedOre(save) + count } }, count };
}

/** seed броска поломки: FNV-1a от createdAt и номера попытки (как summonSeed у Таверны). */
export function refineSeed(createdAt: number, seq: number): number {
  let h = 0x811c9dc5;
  for (const ch of `refine#${Math.floor(createdAt)}#${seq}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export interface RefineOptions {
  /** seed броска поломки; по умолчанию — refineSeed(createdAt, inventory.refineSeq). */
  seed?: number;
  /** Режим шага (по умолчанию обычный). */
  mode?: RefineMode;
}

/**
 * Заточить предмет на +1 (надетый или лежащий). Чистая функция.
 * Шаг с шансом поломки бросает Rng(seed); seed по умолчанию — refineSeed(createdAt, inventory.refineSeq), счётчик
 * растёт на 1 с каждой попыткой (и безопасной тоже). Поломка — вещь удаляется из инвентаря, золото списано.
 * mode 'safe' — цена × safeGoldMult, шанс ÷ safeBreakDiv; 'ore' — тратит 1 руду, золото как за обычный, поломки нет.
 * Ошибки EquipmentError: unknown_item, unknown_item_def, refine_unavailable (нет конфига / режима), refine_locked (не открыта),
 * refine_max (уже максимум), not_enough_gold, not_enough_ore.
 */
export function refineItem(save: SaveState, instanceId: string, ctx: EquipmentContext, opts: RefineOptions = {}): { save: SaveState; events: RefineEvent[] } {
  const mode = opts.mode ?? 'normal';
  const item = save.inventory.items.find((i) => i.id === instanceId);
  if (!item) throw new EquipmentError('unknown_item', `Предмет ${instanceId} не найден в инвентаре`);
  const def = ctx.equipment.items[item.itemId];
  if (!def) throw new EquipmentError('unknown_item_def', `Неизвестный предмет: ${item.itemId}`);
  if (!refineConfig(ctx)) throw new EquipmentError('refine_unavailable', 'Заточка недоступна');
  if (!featureUnlocked(save, 'refine', ctx)) throw new EquipmentError('refine_locked', 'Заточка ещё не открыта');
  const from = refineLevel(item);
  if (mode === 'safe' && !refineSafeAvailable(ctx)) throw new EquipmentError('refine_unavailable', 'Надёжная заточка недоступна');
  const cost = refineModeCost(item, def, ctx, mode);
  if (!cost) throw new EquipmentError('refine_max', `${refinedName(def, from)}: заточка на максимуме`);
  if (mode === 'ore' && blessedOre(save) < 1) throw new EquipmentError('not_enough_ore', 'Нет Благословенной руды — она падает с боссов');
  if (save.resources.gold < cost.gold) throw new EquipmentError('not_enough_gold', `Не хватает золота: нужно ${groupDigits(cost.gold)}, есть ${groupDigits(save.resources.gold)}`);
  const seq = save.inventory.refineSeq ?? 0;
  const chance = refineBreakChance(from, ctx, mode);
  const broken = chance > 0 && new Rng(opts.seed ?? refineSeed(save.createdAt, seq)).next() < chance;
  const items = broken ? save.inventory.items.filter((i) => i.id !== item.id) : save.inventory.items.map((i): ItemInstance => (i.id === item.id ? { ...i, refine: from + 1 } : i));
  const next: SaveState = {
    ...save,
    resources: { ...save.resources, gold: save.resources.gold - cost.gold },
    inventory: { ...save.inventory, items, refineSeq: seq + 1 },
    ...(mode === 'ore' ? { currency: { ...save.currency, blessedOre: blessedOre(save) - 1 } } : {}),
  };
  const event: RefineEvent = broken
    ? { type: 'refineBroken', instanceId: item.id, itemId: item.itemId, level: from, heroId: item.equippedBy, gold: cost.gold, chance, mode }
    : { type: 'refined', ok: true, instanceId: item.id, itemId: item.itemId, from, to: from + 1, gold: cost.gold, chance, mode };
  return { save: next, events: [event] };
}

/** План «Заточить всё надетое»: только безопасные шаги (шанс поломки 0), по одному на предмет, пока хватает золота. */
export interface RefineAllPlan {
  steps: { instanceId: string; itemId: string; from: number; gold: number }[];
  /** Сумма золота всех шагов. */
  gold: number;
  /** Сколько надетых предметов можно точить безопасно (без учёта золота): 0 — остались только рискованные шаги или максимум. */
  safe: number;
  /** Сколько надетых предметов ещё не на максимуме, но следующий шаг рискованный (только вручную). */
  risky: number;
}

/**
 * «Заточить всё надетое» на герое heroId: по одному безопасному шагу (шанс поломки 0) каждому надетому предмету
 * (слоты по порядку), пока хватает золота. Рискованные шаги — только вручную. Для подтверждения в UI — сначала план.
 */
export function refineAllPlan(save: SaveState, heroId: string, ctx: EquipmentContext): RefineAllPlan {
  const slots = heroSlots(save, heroId, ctx);
  let left = save.resources.gold;
  const steps: RefineAllPlan['steps'] = [];
  let safe = 0;
  let risky = 0;
  for (const slot of SLOTS) {
    const s = slots[slot];
    if (!s) continue;
    const cost = refineCost(s.instance, s.def, ctx);
    if (!cost) continue;
    if (refineBreakChance(refineLevel(s.instance), ctx) > 0) {
      risky++;
      continue;
    }
    safe++;
    if (cost.gold > left) continue;
    left -= cost.gold;
    steps.push({ instanceId: s.instance.id, itemId: s.instance.itemId, from: refineLevel(s.instance), gold: cost.gold });
  }
  return { steps, gold: save.resources.gold - left, safe, risky };
}

/** Выполнить refineAllPlan: безопасные шаги заточки надетого на герое. Ошибки — как у refineItem. */
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
