/**
 * Лавка (как магазин AFK Arena, docs/design/afk-gap.md п. 9): слоты data/shop.json, раз в день новый ассортимент,
 * ручное обновление за гемы (цена растёт с каждым обновлением за день), ограниченный запас в слоте.
 * Главная роль — сток золота, когда уровни дорожают. Детерминированно: ассортимент зависит только от сохранения
 * (createdAt, прогресс), дня и номера обновления за день. День передаёт UI строкой 'YYYY-MM-DD' — здесь нет Date.
 */
import type { z } from 'zod';
import { addItems } from '../equipment/equipment';
import { itemPools, lootSeed } from '../equipment/chest';
import { progressChapter } from '../equipment/gates';
import type { EquipmentConfig } from '../equipment/load';
import { addHeroExp } from '../heroes/level';
import { addHeroCard } from '../heroes/roster';
import { summonPool } from '../heroes/config';
import type { GameContext } from '../progression/types';
import { Rng } from '../rng';
import { DayStringSchema, type SaveState, type ShopSlot, type ShopState } from '../save/schema';
import type { Content } from '../types';
import { featureUnlocked } from '../unlocks/unlocks';
import { ShopConfigSchema, type ShopConfig, type ShopGood } from './schema';
import { groupDigits } from '../format';

export type ShopErrorCode =
  | 'invalid_config'
  | 'invalid_day'
  | 'shop_locked'
  | 'refresh_limit'
  | 'not_enough_gold'
  | 'not_enough_gems'
  | 'unknown_slot'
  | 'sold_out'
  | 'day_limit'
  | 'unavailable';

/** Нарушение правил Лавки. message — русский текст для игрока. */
export class ShopError extends Error {
  override name = 'ShopError';
  constructor(
    public code: ShopErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Контекст Лавки: прогрессия + предметы + data/shop.json. */
export type ShopContext = GameContext & { equipment: EquipmentConfig; shop: ShopConfig };

function describe(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.length ? i.path.map(String).join('.') : '(корень)'}: ${i.message}`)
    .join('; ');
}

/** Разобрать data/shop.json. Ошибка схемы → ShopError('invalid_config'). */
export function parseShopConfig(json: unknown): ShopConfig {
  const r = ShopConfigSchema.safeParse(json);
  if (!r.success) throw new ShopError('invalid_config', `data/shop.json: ${describe(r.error)}`);
  return r.data;
}

/** Перекрёстные проверки: этапы fromStage существуют, для товаров-предметов есть предметы этой редкости. */
export function validateShop(cfg: ShopConfig, content: Content, equipment: EquipmentConfig | undefined, problems: string[]): void {
  const stages = new Set(content.stages.map((s) => s.id));
  const pools = equipment ? itemPools(equipment.items) : undefined;
  for (const g of cfg.goods) {
    if (g.fromStage && stages.size && !stages.has(g.fromStage)) problems.push(`data/shop.json: товар ${g.id} — этап ${g.fromStage} не найден в data/campaign`);
    if (g.kind === 'item' && pools && g.rarity && pools[g.rarity].length === 0) problems.push(`data/shop.json: товар ${g.id} — нет предметов редкости ${g.rarity} (drop ≠ false)`);
  }
  cfg.slots.forEach((s, i) => {
    // Слот должен быть заполнен у любого игрока: хотя бы один товар без условий (не карта героя и без fromStage).
    const always = s.some((id) => {
      const g = cfg.goods.find((x) => x.id === id);
      return g && !g.fromStage && g.kind !== 'heroCard';
    });
    if (!always) problems.push(`data/shop.json: слот ${i + 1} — нужен хотя бы один товар без fromStage и не карта героя (иначе слот бывает пустым)`);
  });
}

/** GameContext + предметы → + shop (схема и перекрёстные проверки; ошибки — ShopError('invalid_config')). */
export function withShop<C extends GameContext & { equipment: EquipmentConfig }>(ctx: C, shopJson: unknown): C & { shop: ShopConfig } {
  const shop = parseShopConfig(shopJson);
  const problems: string[] = [];
  validateShop(shop, ctx.content, ctx.equipment, problems);
  if (problems.length) throw new ShopError('invalid_config', problems.join('; '));
  return { ...ctx, shop };
}

function assertDay(day: string): void {
  if (!DayStringSchema.safeParse(day).success) throw new ShopError('invalid_day', `Неверный день: ${JSON.stringify(day)} (нужно YYYY-MM-DD)`);
}

/** Номер главы (с 0) последнего пройденного этапа; ничего не пройдено — 0. */
export function shopChapter(save: Pick<SaveState, 'campaign'>, ctx: Pick<GameContext, 'content'>): number {
  return progressChapter(save, ctx) - 1;
}

/** Множитель цен в золоте и наборов опыта/золота: 1 + chapterGrowth × глава. */
export function shopMultiplier(save: Pick<SaveState, 'campaign'>, ctx: Pick<ShopContext, 'content' | 'shop'>): number {
  return 1 + ctx.shop.chapterGrowth * shopChapter(save, ctx);
}

/** Округлить до двух значащих цифр (цены и наборы выглядят как в магазине: 12 000, 3 600). */
export function niceNumber(x: number): number {
  if (x < 100) return Math.max(1, Math.round(x));
  const p = Math.pow(10, Math.floor(Math.log10(x)) - 1);
  return Math.round(x / p) * p;
}

/** seed ассортимента: сохранение, день и номер обновления за день (0 — ежедневное). */
export function shopSeed(save: Pick<SaveState, 'createdAt'>, day: string, refresh: number): number {
  return lootSeed('shop', save.createdAt, day, refresh);
}

/** Товар доступен игроку сейчас: fromStage пройден, есть предметы редкости / герои для карты. */
function available(g: ShopGood, save: SaveState, ctx: ShopContext, pools: ReturnType<typeof itemPools>): boolean {
  if (g.fromStage && !save.campaign.cleared.includes(g.fromStage)) return false;
  if (g.kind === 'item') return !!g.rarity && pools[g.rarity].length > 0;
  if (g.kind === 'heroCard') return summonPool(ctx, g.cardRarity!).length > 0;
  return true;
}

/**
 * Ассортимент: для каждого слота товар по весам среди доступных, затем конкретный предмет (kind item).
 * На слот тратится ровно два случайных числа — ассортимент слота не зависит от доступности товаров других слотов.
 * Слот без доступных товаров пропускается (validateShop требует товар без условий в каждом слоте).
 */
export function rollShop(save: SaveState, day: string, refresh: number, ctx: ShopContext): ShopSlot[] {
  assertDay(day);
  const rng = new Rng(shopSeed(save, day, refresh));
  // Предметы — только открытые в главе игрока (minChapter): эпик в Лавке главы 1 не появится, слот возьмёт другой товар.
  const pools = itemPools(ctx.equipment.items, progressChapter(save, ctx));
  const mult = shopMultiplier(save, ctx);
  const out: ShopSlot[] = [];
  for (const slot of ctx.shop.slots) {
    const x = rng.next();
    const y = rng.next();
    const goods = slot.map((id) => ctx.shop.goods.find((g) => g.id === id)!).filter((g) => g && available(g, save, ctx, pools));
    const total = goods.reduce((s, g) => s + g.weight, 0);
    if (!goods.length || total <= 0) continue;
    let r = x * total;
    let good = goods[goods.length - 1];
    for (const g of goods) {
      if (r < g.weight) {
        good = g;
        break;
      }
      r -= g.weight;
    }
    const scaled = good.kind === 'heroExp' || good.kind === 'gold';
    const s: ShopSlot = {
      good: good.id,
      kind: good.kind,
      count: scaled ? niceNumber(good.count * mult) : good.count,
      currency: good.price.currency,
      price: good.price.currency === 'gold' ? niceNumber(good.price.amount * mult) : good.price.amount,
      stock: good.stock,
      bought: 0,
    };
    if (good.kind === 'item') {
      const pool = pools[good.rarity!];
      s.itemId = pool[Math.floor(y * pool.length)];
    }
    if (good.kind === 'heroCard') {
      const pool = summonPool(ctx, good.cardRarity!);
      s.hero = pool[Math.floor(y * pool.length)];
      s.rarity = good.cardRarity!;
    }
    out.push(s);
  }
  return out;
}

/** Открыта ли Лавка (data/unlocks.json → shop). */
export function shopUnlocked(save: Pick<SaveState, 'campaign'>, ctx: ShopContext): boolean {
  return featureUnlocked(save, 'shop', ctx);
}

/**
 * Ассортимент на день day: нет лавки или day новее её дня — новый ежедневный (бесплатно), счётчики дня обнуляются.
 * Тот же день — тот же save. День раньше сохранённого (часы переведены назад) — ничего не меняется: лавка ждёт
 * своего дня (переводом часов туда-обратно лишний ассортимент не получить).
 */
export function ensureShop(save: SaveState, day: string, ctx: ShopContext): SaveState {
  assertDay(day);
  if (save.shop && day <= save.shop.day) return save;
  const shop: ShopState = { day, refreshes: 0, slots: rollShop(save, day, 0, ctx), boughtToday: {} };
  return { ...save, shop };
}

/** Цена следующего ручного обновления в гемах; null — лимит на день исчерпан. */
export function refreshCost(refreshes: number, ctx: Pick<ShopContext, 'shop'>): number | null {
  const { gemCosts, maxPerDay } = ctx.shop.refresh;
  if (refreshes >= maxPerDay) return null;
  return gemCosts[Math.min(refreshes, gemCosts.length - 1)];
}

export interface ShopSlotView extends ShopSlot {
  index: number;
  /** Сколько ещё можно купить в слоте. */
  left: number;
  soldOut: boolean;
  /** Товар упёрся в дневной лимит perDay (слот не распродан, но купить нельзя до завтра). */
  dayLimited: boolean;
  /** Хватает валюты. */
  affordable: boolean;
}

export interface ShopStatus {
  unlocked: boolean;
  day: string;
  slots: ShopSlotView[];
  refreshes: number;
  /** Цена следующего обновления (0 — бесплатно); null — на сегодня всё. */
  nextRefreshCost: number | null;
  refreshesLeft: number;
}

function goodOf(ctx: ShopContext, id: string): ShopGood | undefined {
  return ctx.shop.goods.find((g) => g.id === id);
}

/** Состояние Лавки на день day для экрана (не меняет save; ассортимент нового дня — как после ensureShop). */
export function shopStatus(save: SaveState, day: string, ctx: ShopContext): ShopStatus {
  const s = ensureShop(save, day, ctx).shop!;
  const slots = s.slots.map((slot, index): ShopSlotView => {
    const left = Math.max(0, slot.stock - slot.bought);
    const g = goodOf(ctx, slot.good);
    const dayLimited = !!g?.perDay && (s.boughtToday[slot.good] ?? 0) >= g.perDay;
    const wallet = slot.currency === 'gold' ? save.resources.gold : save.currency.gems;
    return { ...slot, index, left, soldOut: left === 0, dayLimited, affordable: wallet >= slot.price };
  });
  const cost = refreshCost(s.refreshes, ctx);
  return {
    unlocked: shopUnlocked(save, ctx),
    day: s.day,
    slots,
    refreshes: s.refreshes,
    nextRefreshCost: cost,
    refreshesLeft: Math.max(0, ctx.shop.refresh.maxPerDay - s.refreshes),
  };
}

function assertUnlocked(save: SaveState, ctx: ShopContext): void {
  if (!shopUnlocked(save, ctx)) throw new ShopError('shop_locked', 'Лавка ещё закрыта — пройдите дальше по кампании');
}

/**
 * Ручное обновление ассортимента за гемы: цена — refresh.gemCosts[номер обновления за день] (последняя повторяется),
 * не больше refresh.maxPerDay раз в день. Все слоты заменяются (запас — полный); дневные лимиты perDay не сбрасываются.
 * ShopError: shop_locked, refresh_limit, not_enough_gems.
 */
export function refreshShop(save: SaveState, day: string, ctx: ShopContext): SaveState {
  assertUnlocked(save, ctx);
  save = ensureShop(save, day, ctx);
  const s = save.shop!;
  const cost = refreshCost(s.refreshes, ctx);
  if (cost === null) throw new ShopError('refresh_limit', `Обновлять лавку можно ${ctx.shop.refresh.maxPerDay} раз в день`);
  if (save.currency.gems < cost) throw new ShopError('not_enough_gems', `Не хватает гемов: нужно ${groupDigits(cost)}, у вас ${groupDigits(save.currency.gems)}`);
  const refreshes = s.refreshes + 1;
  return {
    ...save,
    currency: { ...save.currency, gems: save.currency.gems - cost },
    shop: { ...s, refreshes, slots: rollShop(save, s.day, refreshes, ctx) },
  };
}

/** Что получено за покупку. */
export interface ShopGrant {
  slot: ShopSlot;
  /** id экземпляра предмета (kind item). */
  itemInstanceId?: string;
  /** kind heroCard: id нового экземпляра героя. */
  heroInstanceId?: string;
}

/**
 * Купить товар слота index (одна покупка — count штук). Списывается цена, запас слота −1, счётчик perDay +1.
 * Предмет — в инвентарь, карта героя — новым экземпляром, опыт — в общий пул, свитки и золото — в валюту.
 * ShopError: shop_locked, unknown_slot, sold_out, day_limit, not_enough_gold, not_enough_gems, unavailable (предмета
 * или героя больше нет в игре).
 */
export function buyShopSlot(save: SaveState, day: string, index: number, ctx: ShopContext): { save: SaveState; grant: ShopGrant } {
  assertUnlocked(save, ctx);
  save = ensureShop(save, day, ctx);
  const s = save.shop!;
  const slot = s.slots[index];
  if (!slot) throw new ShopError('unknown_slot', `В лавке нет слота ${index + 1}`);
  if (slot.bought >= slot.stock) throw new ShopError('sold_out', 'Товар распродан — ждите обновления');
  const g = goodOf(ctx, slot.good);
  const today = s.boughtToday[slot.good] ?? 0;
  if (g?.perDay && today >= g.perDay) throw new ShopError('day_limit', `Этот товар можно купить ${g.perDay} раз в день`);
  if (slot.currency === 'gold' && save.resources.gold < slot.price) {
    throw new ShopError('not_enough_gold', `Не хватает золота: нужно ${groupDigits(slot.price)}, у вас ${groupDigits(save.resources.gold)}`);
  }
  if (slot.currency === 'gems' && save.currency.gems < slot.price) {
    throw new ShopError('not_enough_gems', `Не хватает гемов: нужно ${groupDigits(slot.price)}, у вас ${groupDigits(save.currency.gems)}`);
  }
  if (slot.kind === 'item' && (!slot.itemId || !ctx.equipment.items[slot.itemId])) throw new ShopError('unavailable', 'Этого предмета больше нет в игре');
  if (slot.kind === 'heroCard' && (!slot.hero || !ctx.content.heroes[slot.hero])) throw new ShopError('unavailable', 'Этого героя больше нет в игре');

  let next: SaveState = {
    ...save,
    resources: slot.currency === 'gold' ? { ...save.resources, gold: save.resources.gold - slot.price } : save.resources,
    currency: slot.currency === 'gems' ? { ...save.currency, gems: save.currency.gems - slot.price } : save.currency,
  };
  let itemInstanceId: string | undefined;
  let heroInstanceId: string | undefined;
  switch (slot.kind) {
    case 'item': {
      const r = addItems(next, [slot.itemId!]);
      next = r.save;
      itemInstanceId = r.added[0]?.id;
      break;
    }
    case 'heroCard': {
      const r = addHeroCard(next, slot.hero!, slot.rarity ?? 'blue', { isNew: true });
      next = r.save;
      heroInstanceId = r.hero.id;
      break;
    }
    case 'heroExp':
      next = addHeroExp(next, slot.count);
      break;
    case 'scrolls':
      next = { ...next, currency: { ...next.currency, scrolls: next.currency.scrolls + slot.count } };
      break;
    case 'gold':
      next = { ...next, resources: { ...next.resources, gold: next.resources.gold + slot.count } };
      break;
  }
  const slots = s.slots.map((x, i) => (i === index ? { ...x, bought: x.bought + 1 } : x));
  next = { ...next, shop: { ...s, slots, boughtToday: { ...s.boughtToday, [slot.good]: today + 1 } } };
  return { save: next, grant: { slot, ...(itemInstanceId ? { itemInstanceId } : {}), ...(heroInstanceId ? { heroInstanceId } : {}) } };
}
