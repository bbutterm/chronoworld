/**
 * Кухня в Таверне (docs/design/kitchen.md): кладовая продуктов, блюдо дня и его прибавка отряду.
 * - Продукты копятся из экспедиций, охоты и сундука простоя (броски от seed источника; повторы этапов — только при
 *   progression.campaign.replay ≠ false и sources.replay) и
 *   покупаются за золото (лимит в день). Копятся и до открытия Кухни — к открытию кладовая не пуста.
 *   Предел кладовой — pantryCap штук каждого продукта: лишнее не начисляется (старый запас сверх предела не сгорает).
 * - Раз в день (день передаёт UI, как у заданий дня) готовится одно блюдо; оно действует до смены дня. День не
 *   новее дня последнего блюда (часы назад) — готовить нельзя: второго блюда переводом часов не получить.
 * - Прибавка — к статам отряда в боях кампании, Башни и охоты (withMeal; Арена нормализована и её не видит) и к опыту
 *   героев за этапы кампании.
 * Сохранение: необязательное save.kitchen (без смены версии): нет поля — кладовая пуста, блюд не было.
 */
import type { UnitDef } from '../content/schema';
import { lootSeed } from '../equipment/chest';
import { progressChapter } from '../equipment/gates';
import { assertDay } from '../features/daily';
import { Rng } from '../rng';
import type { SaveState } from '../save/schema';
import { featureUnlocked, lockedText, type UnlocksContext } from '../unlocks/unlocks';
import { KitchenConfigSchema, type Ingredient, type KitchenBuff, type KitchenConfig, type Recipe } from './schema';

/** Контекст Кухни: открытия функций + data/kitchen.json (нет файла — Кухни нет, продукты не выпадают). */
export interface KitchenContext extends UnlocksContext {
  kitchen?: KitchenConfig;
}

export type KitchenState = NonNullable<SaveState['kitchen']>;
/** Продукт → штук (выдача или цена). */
export type Pantry = Record<string, number>;

export type KitchenErrorCode =
  | 'kitchen_locked'
  | 'no_kitchen'
  | 'already_cooked'
  | 'unknown_recipe'
  | 'not_enough'
  | 'unknown_ingredient'
  | 'day_limit'
  | 'not_enough_gold'
  | 'pantry_full';

export class KitchenError extends Error {
  override name = 'KitchenError';
  constructor(
    public code: KitchenErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Разобрать data/kitchen.json. Ошибка схемы — Error с путём до поля. */
export function parseKitchenConfig(json: unknown): KitchenConfig {
  const r = KitchenConfigSchema.safeParse(json);
  if (!r.success) {
    throw new Error(
      `data/kitchen.json: ${r.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.length ? i.path.map(String).join('.') : '(корень)'}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return r.data;
}

/** До двух значащих цифр (как цены Лавки, shop.ts niceNumber; своя копия — без цикла импортов). */
function niceNumber(x: number): number {
  if (x < 100) return Math.max(1, Math.round(x));
  const p = Math.pow(10, Math.floor(Math.log10(x)) - 1);
  return Math.round(x / p) * p;
}

const cfgOf = (ctx: object): KitchenConfig | undefined => (ctx as { kitchen?: KitchenConfig }).kitchen;

/** Состояние Кухни из сохранения (нет поля — пустая кладовая). */
export function kitchenOf(save: Pick<SaveState, 'kitchen'>): KitchenState {
  return save.kitchen ?? { pantry: {} };
}

/** Блюдо, которое действует в день day (приготовлено именно в этот день), или null. */
export function activeMeal(save: Pick<SaveState, 'kitchen'>, day: string | undefined, ctx: object): Recipe | null {
  const cfg = cfgOf(ctx);
  const meal = save.kitchen?.meal;
  if (!cfg || !meal || day === undefined || meal.day !== day) return null;
  return cfg.recipes.find((r) => r.id === meal.id) ?? null;
}

/** Прибавка блюда дня (проценты) или null. */
export function mealBuff(save: Pick<SaveState, 'kitchen'>, day: string | undefined, ctx: object): KitchenBuff | null {
  return activeMeal(save, day, ctx)?.buff ?? null;
}

/**
 * Прибавка блюда дня к юнитам отряда (до боя; battle.ts о Кухне не знает): hp/atk/def × (1 + %/100), округление.
 * Нет блюда на этот день — тот же массив. Точка подключения — squadUnits (кампания, охота) и towerRunSquad (Башня).
 */
export function withMeal(squad: readonly (UnitDef | null)[], save: Pick<SaveState, 'kitchen'>, day: string | undefined, ctx: object): (UnitDef | null)[] {
  const b = mealBuff(save, day, ctx);
  if (!b || (!b.atk && !b.hp && !b.def)) return squad as (UnitDef | null)[];
  const k = (v: number, pct: number | undefined) => (pct ? Math.round(v * (1 + pct / 100)) : v);
  return squad.map((u) => (u ? { ...u, stats: { ...u.stats, hp: Math.max(1, k(u.stats.hp, b.hp)), atk: k(u.stats.atk, b.atk), def: k(u.stats.def, b.def) } } : u));
}

/** Опыт героев за этап с учётом блюда дня (exp %). */
export function mealExp(exp: number, save: Pick<SaveState, 'kitchen'>, day: string | undefined, ctx: object): number {
  const pct = mealBuff(save, day, ctx)?.exp;
  return pct ? Math.floor(exp * (1 + pct / 100)) : exp;
}

// ---------- Продукты ----------

/** Предел кладовой на каждый продукт (data/kitchen.json → pantryCap; нет поля или Кухни — без предела). */
export function pantryCap(ctx: object): number {
  return cfgOf(ctx)?.pantryCap ?? Infinity;
}

/** Сколько из выдачи поместится в кладовую под пределом cap (запас сверх предела не уменьшается). */
export function fitPantry(save: Pick<SaveState, 'kitchen'>, gained: Pantry, cap: number): Pantry {
  const pantry = save.kitchen?.pantry ?? {};
  const out: Pantry = {};
  for (const [id, n] of Object.entries(gained)) {
    const m = Math.min(n, Math.max(0, cap - (pantry[id] ?? 0)));
    if (m > 0) out[id] = m;
  }
  return out;
}

/** Сложить продукты в кладовую (без предела — его учитывают выдачи через fitPantry). Пусто — тот же объект. */
export function addIngredients(save: SaveState, gained: Pantry): SaveState {
  const entries = Object.entries(gained).filter(([, n]) => n > 0);
  if (!entries.length) return save;
  const k = kitchenOf(save);
  const pantry = { ...k.pantry };
  for (const [id, n] of entries) pantry[id] = (pantry[id] ?? 0) + n;
  return { ...save, kitchen: { ...k, pantry } };
}

/** n случайных продуктов по весам (ingredients[].weight). */
export function rollIngredients(rng: Rng, n: number, cfg: KitchenConfig): Pantry {
  const out: Pantry = {};
  const total = cfg.ingredients.reduce((s, g) => s + g.weight, 0);
  for (let i = 0; i < n; i++) {
    let x = rng.next() * total;
    let pick: Ingredient = cfg.ingredients[cfg.ingredients.length - 1];
    for (const g of cfg.ingredients) {
      x -= g.weight;
      if (x < 0) {
        pick = g;
        break;
      }
    }
    out[pick.id] = (out[pick.id] ?? 0) + 1;
  }
  return out;
}

/** Выдача источника: новое сохранение и что получено (пусто — тот же save). */
export interface IngredientGrant {
  save: SaveState;
  gained: Pantry;
}

const none = (save: SaveState): IngredientGrant => ({ save, gained: {} });
/** Выдать под пределом кладовой: gained — что реально легло (кладовая полна — пусто, тот же save). */
const give = (save: SaveState, rolled: Pantry, ctx: object): IngredientGrant => {
  const gained = fitPantry(save, rolled, pantryCap(ctx));
  return { save: addIngredients(save, gained), gained };
};
const rngOf = (...parts: (string | number)[]) => new Rng(lootSeed('kitchen', ...parts));

/** Вернувшаяся экспедиция: sources.expedition.min…max продуктов. seed — seed экспедиции. */
export function grantExpeditionIngredients(save: SaveState, seed: number, ctx: object): IngredientGrant {
  const cfg = cfgOf(ctx);
  if (!cfg) return none(save);
  const rng = rngOf('expedition', seed);
  const { min, max } = cfg.sources.expedition;
  return give(save, rollIngredients(rng, min + rng.int(max - min + 1), cfg), ctx);
}

/** Попытка охоты: взят порог tier (≥ 0) — min + ⌊tier / tiersPerExtra⌋ продуктов (не больше max). seed — добыча попытки. */
export function huntIngredientCount(tier: number, cfg: KitchenConfig): number {
  if (tier < 0) return 0;
  const h = cfg.sources.hunt;
  return Math.min(h.max, h.min + Math.floor(tier / h.tiersPerExtra));
}

export function grantHuntIngredients(save: SaveState, tier: number, seed: number, ctx: object): IngredientGrant {
  const cfg = cfgOf(ctx);
  if (!cfg) return none(save);
  const n = huntIngredientCount(tier, cfg);
  return n > 0 ? give(save, rollIngredients(rngOf('hunt', seed), n, cfg), ctx) : none(save);
}

/** Победный повтор этапа с наградой (только при разрешённых повторах): с шансом sources.replay.chance — count продуктов. Нет sources.replay — ничего. seed — seed боя. */
export function grantReplayIngredients(save: SaveState, seed: number, ctx: object): IngredientGrant {
  const cfg = cfgOf(ctx);
  const src = cfg?.sources.replay;
  if (!cfg || !src) return none(save);
  const rng = rngOf('replay', seed);
  if (rng.next() >= src.chance) return none(save);
  return give(save, rollIngredients(rng, src.count, cfg), ctx);
}

/** Сбор сундука: по броску на каждый полный тик (шанс sources.chest.chancePerTick). seed — seed сундука до сбора. */
export function grantChestIngredients(save: SaveState, ticks: number, seed: number, ctx: object): IngredientGrant {
  const cfg = cfgOf(ctx);
  if (!cfg || ticks <= 0) return none(save);
  const rng = rngOf('chest', seed);
  let n = 0;
  for (let i = 0; i < ticks; i++) if (rng.next() < cfg.sources.chest.chancePerTick) n++;
  return n > 0 ? give(save, rollIngredients(rng, n, cfg), ctx) : none(save);
}

// ---------- Покупка и готовка ----------

/** Цена продукта сейчас: price × (1 + chapterGrowth × (глава − 1)), до 2 значащих цифр. */
export function ingredientPrice(save: Pick<SaveState, 'campaign'>, ing: Ingredient, cfg: KitchenConfig, ctx: KitchenContext): number {
  return niceNumber(ing.price * (1 + cfg.shop.chapterGrowth * (progressChapter(save, ctx) - 1)));
}

/** Куплено продуктов в день day; день раньше записанного (часы назад) — лимит исчерпан. */
export function boughtToday(save: Pick<SaveState, 'kitchen'>, day: string, cfg: KitchenConfig): number {
  const b = save.kitchen?.bought;
  if (!b || day > b.day) return 0;
  return day === b.day ? b.count : cfg.shop.dailyLimit;
}

/** Можно ли готовить в день day: блюда ещё не было, или последнее — в более ранний день. */
export function canCookOn(save: Pick<SaveState, 'kitchen'>, day: string): boolean {
  const meal = save.kitchen?.meal;
  return !meal || day > meal.day;
}

export interface RecipeView extends Recipe {
  /** Продуктов хватает. */
  affordable: boolean;
  /** Чего не хватает: продукт → штук. */
  missing: Pantry;
  /** Это блюдо дня (приготовлено сегодня). */
  active: boolean;
}

export interface PantryRow extends Ingredient {
  count: number;
  /** Цена сейчас (с ростом по главе). */
  priceNow: number;
  /** Кладовая полна (count ≥ pantryCap): выдача не начисляется, купить нельзя. */
  full: boolean;
}

export interface KitchenStatus {
  unlocked: boolean;
  lockedText: string;
  pantry: PantryRow[];
  recipes: RecipeView[];
  /** Блюдо дня (действует сейчас) или null. */
  meal: Recipe | null;
  /** Сегодня можно приготовить блюдо. */
  canCook: boolean;
  /** Можно приготовить хоть что-то прямо сейчас (для красной точки). */
  ready: boolean;
  bought: number;
  buyLimit: number;
  buyLeft: number;
  /** Предел кладовой на продукт (data/kitchen.json → pantryCap) или null — без предела. */
  cap: number | null;
}

/** Состояние Кухни на день day (save не меняется). Нет data/kitchen.json — KitchenError('no_kitchen'). */
export function kitchenStatus(save: SaveState, day: string, ctx: KitchenContext): KitchenStatus {
  assertDay(day);
  const cfg = cfgOf(ctx);
  if (!cfg) throw new KitchenError('no_kitchen', 'Кухни нет: нет data/kitchen.json');
  const k = kitchenOf(save);
  const unlocked = featureUnlocked(save, 'kitchen', ctx);
  const meal = activeMeal(save, day, ctx);
  const canCook = unlocked && canCookOn(save, day);
  const recipes = cfg.recipes.map((r) => {
    const missing: Pantry = {};
    for (const [id, n] of Object.entries(r.cost)) if ((k.pantry[id] ?? 0) < n) missing[id] = n - (k.pantry[id] ?? 0);
    return { ...r, affordable: !Object.keys(missing).length, missing, active: meal?.id === r.id };
  });
  const bought = boughtToday(save, day, cfg);
  const cap = cfg.pantryCap ?? Infinity;
  return {
    unlocked,
    lockedText: lockedText(save, 'kitchen', ctx),
    pantry: cfg.ingredients.map((g) => ({ ...g, count: k.pantry[g.id] ?? 0, priceNow: ingredientPrice(save, g, cfg, ctx), full: (k.pantry[g.id] ?? 0) >= cap })),
    recipes,
    meal,
    canCook,
    ready: canCook && recipes.some((r) => r.affordable),
    bought,
    buyLimit: cfg.shop.dailyLimit,
    buyLeft: Math.max(0, cfg.shop.dailyLimit - bought),
    cap: cfg.pantryCap ?? null,
  };
}

/** Красная точка Кухни: открыта, сегодня не готовили и на какое-то блюдо продуктов хватает. Нет Кухни — false. */
export function kitchenReady(save: SaveState, day: string, ctx: KitchenContext): boolean {
  if (!cfgOf(ctx)) return false;
  return kitchenStatus(save, day, ctx).ready;
}

function requireOpen(save: SaveState, ctx: KitchenContext): KitchenConfig {
  const cfg = cfgOf(ctx);
  if (!cfg) throw new KitchenError('no_kitchen', 'Кухни нет: нет data/kitchen.json');
  if (!featureUnlocked(save, 'kitchen', ctx)) throw new KitchenError('kitchen_locked', `Кухня: ${lockedText(save, 'kitchen', ctx) || 'пока закрыта'}`);
  return cfg;
}

/**
 * Приготовить блюдо дня: продукты из кладовой, save.kitchen.meal = {id, day}. Чистая функция.
 * KitchenError: kitchen_locked, already_cooked (сегодня уже готовили или часы переведены назад), unknown_recipe, not_enough.
 */
export function cookMeal(save: SaveState, day: string, recipeId: string, ctx: KitchenContext): SaveState {
  assertDay(day);
  const cfg = requireOpen(save, ctx);
  if (!canCookOn(save, day)) throw new KitchenError('already_cooked', 'Сегодня блюдо уже готово — новое завтра');
  const recipe = cfg.recipes.find((r) => r.id === recipeId);
  if (!recipe) throw new KitchenError('unknown_recipe', `Неизвестное блюдо: ${recipeId}`);
  const k = kitchenOf(save);
  const pantry = { ...k.pantry };
  for (const [id, n] of Object.entries(recipe.cost)) {
    if ((pantry[id] ?? 0) < n) {
      const name = cfg.ingredients.find((g) => g.id === id)?.name ?? id;
      throw new KitchenError('not_enough', `Не хватает: ${name}`);
    }
    pantry[id] -= n;
    if (!pantry[id]) delete pantry[id];
  }
  return { ...save, kitchen: { ...k, pantry, meal: { id: recipe.id, day } } };
}

/**
 * Купить продукт за золото (count штук). Лимит — shop.dailyLimit в день; день раньше записанного — лимит исчерпан.
 * Больше предела кладовой (pantryCap) не купить.
 * KitchenError: kitchen_locked, unknown_ingredient, pantry_full, day_limit, not_enough_gold.
 */
export function buyIngredient(save: SaveState, day: string, ingredientId: string, ctx: KitchenContext, count = 1): SaveState {
  assertDay(day);
  const cfg = requireOpen(save, ctx);
  const ing = cfg.ingredients.find((g) => g.id === ingredientId);
  if (!ing) throw new KitchenError('unknown_ingredient', `Неизвестный продукт: ${ingredientId}`);
  const n = Math.max(1, Math.floor(count));
  const cap = cfg.pantryCap ?? Infinity;
  if ((save.kitchen?.pantry[ing.id] ?? 0) + n > cap) throw new KitchenError('pantry_full', `Кладовая полна: больше ${cap} не поместится`);
  const bought = boughtToday(save, day, cfg);
  if (bought + n > cfg.shop.dailyLimit) throw new KitchenError('day_limit', 'На сегодня продукты раскуплены — завтра привезут ещё');
  const price = ingredientPrice(save, ing, cfg, ctx) * n;
  if (save.resources.gold < price) throw new KitchenError('not_enough_gold', 'Не хватает золота');
  const next = addIngredients({ ...save, resources: { ...save.resources, gold: save.resources.gold - price } }, { [ing.id]: n });
  const k = kitchenOf(next);
  const prevDay = save.kitchen?.bought?.day;
  return { ...next, kitchen: { ...k, bought: { day: prevDay && prevDay > day ? prevDay : day, count: bought + n } } };
}

/** Названия выдачи: «Мясо ×2, Мёд ×1» (для тостов и итогов). */
export function pantryText(gained: Pantry, ctx: object): string {
  const cfg = cfgOf(ctx);
  return Object.entries(gained)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${cfg?.ingredients.find((g) => g.id === id)?.name ?? id} ×${n}`)
    .join(', ');
}

/** Сумма двух выдач. */
export function mergePantry(a: Pantry, b: Pantry): Pantry {
  const out = { ...a };
  for (const [id, n] of Object.entries(b)) out[id] = (out[id] ?? 0) + n;
  return out;
}

/** Описание прибавки: «+6% АТК», «+3% ко всем статам», «+10% опыта героев». */
export function buffText(b: KitchenBuff): string {
  if (b.atk && b.atk === b.hp && b.hp === b.def && !b.exp) return `+${b.atk}% к АТК, ОЗ и защите`;
  const parts: string[] = [];
  if (b.atk) parts.push(`+${b.atk}% АТК`);
  if (b.hp) parts.push(`+${b.hp}% ОЗ`);
  if (b.def) parts.push(`+${b.def}% защиты`);
  if (b.exp) parts.push(`+${b.exp}% опыта с боёв`);
  return parts.join(', ');
}
