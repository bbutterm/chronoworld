import type { GameContext } from '../progression/types';
import type { SaveState } from '../save/schema';
import { maxLevelOf } from './card';
import { levelRangeCost, levelUpCost } from './level';

/**
 * Сколько опыта пула нужно отряду на levels уровней каждому (не выше предела редкости): «Улучшить» отряда
 * на ближайшее время. Герои на пределе ничего не просят.
 */
export function squadExpNeed(save: Pick<SaveState, 'squad' | 'heroes'>, ctx: GameContext, levels = 5): number {
  let need = 0;
  for (const id of save.squad) {
    const hero = id ? save.heroes.find((h) => h.id === id) : undefined;
    if (!hero) continue;
    const to = Math.min(maxLevelOf(ctx, hero.rarity), hero.level + levels);
    need += levelRangeCost(hero.level, to, ctx).exp;
  }
  return need;
}

/**
 * Опыта в запасе с избытком — «Улучшить» отряда упрётся не в опыт. Как кнопка «Улучшить отряд» (по уровню самому
 * низкому): пока не больше levels уровней каждому, тратим пул и золото; первым кончилось золото или все дошли до
 * levels / предела редкости — опыт с избытком (true); первым кончился опыт — опыт нужен (false).
 * Тогда опыт за золото — ловушка: Лавка не предлагает наборы опыта, пока узкое место — золото.
 */
export function heroExpAbundant(save: Pick<SaveState, 'squad' | 'heroes' | 'resources'>, ctx: GameContext, levels = 5): boolean {
  const squad = save.squad
    .map((id) => (id ? save.heroes.find((h) => h.id === id) : undefined))
    .filter((h): h is SaveState['heroes'][number] => !!h)
    .map((h) => ({ level: h.level, to: Math.min(maxLevelOf(ctx, h.rarity), h.level + levels) }));
  let exp = save.resources.heroExp;
  let gold = save.resources.gold;
  for (let guard = 0; guard < 1000; guard++) {
    const next = squad.filter((h) => h.level < h.to).sort((a, b) => a.level - b.level)[0];
    if (!next) return true;
    const cost = levelUpCost(next.level, ctx);
    if (cost.exp > exp) return false;
    if (cost.gold > gold) return true;
    exp -= cost.exp;
    gold -= cost.gold;
    next.level++;
  }
  return true;
}
