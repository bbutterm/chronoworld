import type { GameContext, ProgressEvent } from '../progression/types';
import type { HeroState, SaveState } from '../save/schema';
import { activeForm, heroName, heroTemplate, maxLevelOf } from './card';
import { HeroError } from './errors';
import { groupDigits } from '../format';

/**
 * Уровень карточки (AFK): опыт героев — общий пул save.resources.heroExp (награды этапов, сундука, башни, поручений…),
 * кнопка «Улучшить» тратит опыт пула + золото. Стоимость L → L+1 — data/cards.json → level:
 * опыт floor(exp.base × L^exp.power), золото floor(gold.base × L^gold.power). Предел — maxLevel редкости.
 */

export interface LevelCost {
  exp: number;
  gold: number;
}

/** Стоимость уровня level → level + 1. */
export function levelUpCost(level: number, ctx: GameContext): LevelCost {
  const c = ctx.cards.level;
  return {
    exp: Math.max(1, Math.floor(c.exp.base * Math.pow(level, c.exp.power))),
    gold: Math.floor(c.gold.base * Math.pow(level, c.gold.power)),
  };
}

/** Сколько стоит подъём с уровня from до уровня to (to > from; иначе нули) — для возврата вложенного в корм. */
export function levelRangeCost(from: number, to: number, ctx: GameContext): LevelCost {
  const sum = { exp: 0, gold: 0 };
  for (let l = Math.max(1, from); l < to; l++) {
    const c = levelUpCost(l, ctx);
    sum.exp += c.exp;
    sum.gold += c.gold;
  }
  return sum;
}

/** Положить опыт в общий пул (amount ≤ 0 — тот же save). */
export function addHeroExp(save: SaveState, amount: number): SaveState {
  const n = Math.floor(amount);
  if (!(n > 0)) return save;
  return { ...save, resources: { ...save.resources, heroExp: save.resources.heroExp + n } };
}

export function findHero(save: SaveState, heroId: string): HeroState {
  const hero = save.heroes.find((h) => h.id === heroId);
  if (!hero) throw new HeroError('unknown_hero', `Герой ${heroId} не найден`);
  return hero;
}

export interface LevelUpInfo {
  heroId: string;
  level: number;
  maxLevel: number;
  /** Цена следующего уровня; null — предел редкости (нужно вознесение). */
  cost: LevelCost | null;
  /** Можно поднять хотя бы один уровень прямо сейчас. */
  canLevel: boolean;
  /** Почему нельзя: предел, не хватает опыта или золота. */
  blocker: 'max_level' | 'not_enough_exp' | 'not_enough_gold' | null;
  /** Сколько уровней подряд хватает ресурсов (до предела) — для «Улучшить ×N». */
  affordable: number;
  /** Пул опыта и золото игрока. */
  pool: number;
  gold: number;
}

/** Всё для кнопки «Улучшить» на карточке. */
export function levelUpInfo(save: SaveState, heroId: string, ctx: GameContext): LevelUpInfo {
  const hero = findHero(save, heroId);
  const maxLevel = maxLevelOf(ctx, hero.rarity);
  const pool = save.resources.heroExp;
  const gold = save.resources.gold;
  let affordable = 0;
  let exp = pool;
  let g = gold;
  for (let l = hero.level; l < maxLevel; l++) {
    const c = levelUpCost(l, ctx);
    if (c.exp > exp || c.gold > g) break;
    exp -= c.exp;
    g -= c.gold;
    affordable++;
  }
  const cost = hero.level < maxLevel ? levelUpCost(hero.level, ctx) : null;
  const blocker = !cost ? 'max_level' : cost.exp > pool ? 'not_enough_exp' : cost.gold > gold ? 'not_enough_gold' : null;
  return { heroId, level: hero.level, maxLevel, cost, canLevel: blocker === null, blocker, affordable, pool, gold };
}

/**
 * «Улучшить»: поднять карточку на times уровней (по умолчанию 1), пока хватает опыта пула и золота и не упёрлись
 * в предел редкости. Поднялось 0 уровней — HeroError (max_level / not_enough_exp / not_enough_gold), save не меняется.
 * События levelUp и skillUnlocked (навыки формы на новых уровнях). Чистая функция.
 */
export function levelUpHero(save: SaveState, heroId: string, ctx: GameContext, times = 1): { save: SaveState; levels: number; spent: LevelCost; events: ProgressEvent[] } {
  const hero = findHero(save, heroId);
  const info = levelUpInfo(save, heroId, ctx);
  if (!info.canLevel) {
    const name = heroName(hero, ctx);
    if (info.blocker === 'max_level') throw new HeroError('max_level', `${name}: предел уровня ${info.maxLevel} — нужно вознесение`);
    if (info.blocker === 'not_enough_exp') throw new HeroError('not_enough_exp', `Не хватает опыта: нужно ${groupDigits(info.cost!.exp)}, в запасе ${groupDigits(info.pool)}`);
    throw new HeroError('not_enough_gold', `Не хватает золота: нужно ${groupDigits(info.cost!.gold)}, есть ${groupDigits(info.gold)}`);
  }
  const n = Math.max(1, Math.min(Math.floor(times), info.affordable));
  const spent = levelRangeCost(hero.level, hero.level + n, ctx);
  const level = hero.level + n;
  const events: ProgressEvent[] = [];
  const form = activeForm(heroTemplate(ctx, hero.templateId), hero);
  for (let l = hero.level + 1; l <= level; l++) {
    events.push({ type: 'levelUp', heroId, level: l });
    for (const s of form.skills) if (s.level === l) events.push({ type: 'skillUnlocked', heroId, skill: s.skill, level: l });
  }
  const next: SaveState = {
    ...save,
    heroes: save.heroes.map((h) => (h.id === heroId ? { ...h, level } : h)),
    resources: { ...save.resources, heroExp: save.resources.heroExp - spent.exp, gold: save.resources.gold - spent.gold },
  };
  return { save: next, levels: n, spent, events };
}

/**
 * «Улучшить отряд» (и модель игрока в playthrough/balance): по одному уровню самому низкому из heroIds (по умолчанию —
 * герои отряда; при равенстве — по порядку), пока хватает опыта пула и золота и не упёрлись в пределы редкости.
 * Ничего не поднялось — тот же save, levels = 0. Ошибок не бросает.
 */
export function autoLevel(save: SaveState, ctx: GameContext, heroIds?: readonly string[]): { save: SaveState; levels: number; events: ProgressEvent[] } {
  const ids = (heroIds ?? save.squad.filter((id): id is string => id !== null)).filter((id) => save.heroes.some((h) => h.id === id));
  let cur = save;
  let levels = 0;
  const events: ProgressEvent[] = [];
  for (;;) {
    const ready = ids
      .map((id, i) => ({ hero: findHero(cur, id), i }))
      .filter((x) => levelUpInfo(cur, x.hero.id, ctx).canLevel)
      .sort((a, b) => a.hero.level - b.hero.level || a.i - b.i);
    if (!ready.length) break;
    const r = levelUpHero(cur, ready[0].hero.id, ctx, 1);
    cur = r.save;
    levels += r.levels;
    events.push(...r.events);
  }
  return { save: cur, levels, events };
}
