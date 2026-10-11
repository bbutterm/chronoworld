/**
 * Совет Кухни (docs/design/kitchen.md, «Совет повара»): какое блюдо приготовить сегодня под то, чем игрок занят.
 * - boss: следующий этап кампании — босс → самое сильное из блюд с goodFor: ['boss'] (Пир, Медовый пирог — они стоят
 *   мёда и молока, редких продуктов).
 * - level: героям отряда не хватает опыта на уровень, а золото на него есть → блюдо с goodFor: ['level'] (каша).
 * - обычный день — самое сильное из доступных блюд без goodFor: ['boss'] (дорогие блюда берегут к боссу; saving — какое
 *   из них сейчас доступно). Других нет — самое сильное из доступных.
 * Оценка — recipeScore (замер боями: процент АТК ценнее процента ОЗ, тот — защиты; опыт — только в ситуации level).
 * Чистые функции; день передаёт UI.
 */
import type { GameContext } from '../progression/types';
import type { SaveState } from '../save/schema';
import { levelUpInfo } from '../heroes/level';
import { kitchenStatus, type KitchenContext, type KitchenStatus, type Pantry, type RecipeView } from './kitchen';
import type { KitchenBuff, KitchenSituation } from './schema';

/**
 * Веса прибавок для сравнения блюд: процент АТК — 1, ОЗ — 0.6, защиты — 0.35 (замер 11.10.2026: доля побед отряда модели
 * у стены и у босса с +7 % АТК, +7 % ОЗ, +12 % защиты; docs/design/kitchen.md). Опыт — 0.3, только когда его не хватает.
 */
export const RECIPE_WEIGHTS = { atk: 1, hp: 0.6, def: 0.35, exp: 0.3 } as const;

/** Оценка прибавки блюда. Опыт считается, только когда его не хватает (withExp): иначе каша не «сильнее» сока. */
export function recipeScore(b: KitchenBuff, withExp = false): number {
  const W = RECIPE_WEIGHTS;
  return W.atk * (b.atk ?? 0) + W.hp * (b.hp ?? 0) + W.def * (b.def ?? 0) + (withExp ? W.exp * (b.exp ?? 0) : 0);
}

export interface KitchenSituationInfo {
  situation: KitchenSituation;
  /** Этап с боссом (situation boss). */
  stageId?: string;
}

/**
 * Чем игрок занят сейчас: впереди босс (первый непройденный этап кампании — boss) или героям не хватает опыта
 * (никого из отряда нельзя улучшить, и хотя бы одного держит именно опыт, а золото есть). Ничего особого — null.
 */
export function kitchenSituation(save: SaveState, ctx: GameContext): KitchenSituationInfo | null {
  const cleared = new Set(save.campaign.cleared);
  const next = ctx.content.stages.find((s) => !cleared.has(s.id));
  if (next?.boss) return { situation: 'boss', stageId: next.id };
  const infos = save.squad.filter((id): id is string => !!id && save.heroes.some((h) => h.id === id)).map((id) => levelUpInfo(save, id, ctx));
  if (infos.length && !infos.some((i) => i.canLevel) && infos.some((i) => i.blocker === 'not_enough_exp' && i.cost && i.cost.gold <= i.gold)) return { situation: 'level' };
  return null;
}

export interface KitchenAdvice {
  recipeId: string;
  /**
   * Почему это блюдо: boss — впереди босс, level — не хватает опыта на уровень, best — обычный день, buy — ни на что
   * не хватает, но недостающее можно докупить сегодня (лимит дня и золото).
   */
  reason: KitchenSituation | 'best' | 'buy';
  /** Этап с боссом (reason boss). */
  stageId?: string;
  /** Обычный день: доступное блюдо для босса, которое совет бережёт (самое сильное из них). */
  saving?: string;
  /** reason buy: что докупить (продукт → штук) и почём всего (золото). */
  buy?: Pantry;
  gold?: number;
}

const byScore = (withExp: boolean) => (a: RecipeView, b: RecipeView) => recipeScore(b.buff, withExp) - recipeScore(a.buff, withExp);

/**
 * Совет на сегодня: блюдо из доступных (продуктов хватает). Ситуация есть, но её блюдо недоступно — самое сильное
 * из доступных (reason best). Ни на что не хватает — самое дешёвое по золоту блюдо, недостающее к которому можно
 * докупить сегодня (сначала блюда ситуации, на обычный день — без блюд для босса; reason buy). Сегодня уже готовили,
 * Кухня закрыта или купить не на что — null.
 */
export function kitchenAdvice(save: SaveState, day: string, ctx: GameContext & KitchenContext): KitchenAdvice | null {
  if (!ctx.kitchen) return null;
  const st = kitchenStatus(save, day, ctx);
  if (!st.canCook) return null;
  const ok = st.recipes.filter((r) => r.affordable);
  const sit = kitchenSituation(save, ctx);
  if (!ok.length) return buyAdvice(save, st, sit?.situation ?? null);
  if (sit) {
    const fit = ok.filter((r) => r.goodFor?.includes(sit.situation)).sort(byScore(sit.situation === 'level'))[0];
    if (fit) return { recipeId: fit.id, reason: sit.situation, ...(sit.stageId ? { stageId: sit.stageId } : {}) };
  }
  const forBoss = (r: RecipeView) => !!r.goodFor?.includes('boss');
  const everyday = ok.filter((r) => !forBoss(r)).sort(byScore(false));
  if (sit?.situation !== 'boss' && everyday.length) {
    const saving = ok.filter(forBoss).sort(byScore(false))[0];
    return { recipeId: everyday[0].id, reason: 'best', ...(saving ? { saving: saving.id } : {}) };
  }
  return { recipeId: [...ok].sort(byScore(false))[0].id, reason: 'best' };
}

/** Докупить недостающее к самому дешёвому блюду (в пределах лимита дня и золота) или null. */
function buyAdvice(save: SaveState, st: KitchenStatus, situation: KitchenSituation | null): KitchenAdvice | null {
  const price = (id: string) => st.pantry.find((p) => p.id === id)?.priceNow ?? Infinity;
  const options = st.recipes
    .map((r) => ({
      r,
      need: Object.values(r.missing).reduce((a, n) => a + n, 0),
      gold: Object.entries(r.missing).reduce((a, [id, n]) => a + n * price(id), 0),
    }))
    .filter((o) => o.need <= st.buyLeft && o.gold <= save.resources.gold);
  const fits = (r: RecipeView) => (situation ? !!r.goodFor?.includes(situation) : !r.goodFor?.includes('boss'));
  const pool = options.some((o) => fits(o.r)) ? options.filter((o) => fits(o.r)) : options;
  const pick = pool.sort((a, b) => a.gold - b.gold || recipeScore(b.r.buff) - recipeScore(a.r.buff))[0];
  return pick ? { recipeId: pick.r.id, reason: 'buy', buy: { ...pick.r.missing }, gold: pick.gold } : null;
}

/**
 * Порядок рецептов на экране: блюдо дня, совет, доступные, остальные; внутри групп — по recipeScore (сильнее — выше),
 * при равенстве — порядок data/kitchen.json. Новый массив.
 */
export function sortRecipes(recipes: readonly RecipeView[], advice: KitchenAdvice | null): RecipeView[] {
  const withExp = advice?.reason === 'level';
  const rank = (r: RecipeView) => (r.active ? 0 : r.id === advice?.recipeId ? 1 : r.affordable ? 2 : 3);
  return recipes
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || recipeScore(b.r.buff, withExp) - recipeScore(a.r.buff, withExp) || a.i - b.i)
    .map((x) => x.r);
}
