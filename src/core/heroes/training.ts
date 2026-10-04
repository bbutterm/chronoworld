import type { GameContext } from '../progression/types';
import type { HeroState, SaveState } from '../save/schema';
import type { Stats } from '../types';
import { HeroError } from './errors';

export type HeroFocus = 'resolve' | 'precision' | 'guard';

/** Запомнить достигнутое до сброса уровня/смены пути. Прогресс принадлежит этому экземпляру. */
export function rememberHeroJourney(hero: HeroState): HeroState {
  const journey = hero.journey ?? {};
  const peakLevel = Math.max(hero.level, journey.peakLevel ?? 1);
  const branchLevels = { ...journey.branchLevels };
  if (hero.branch) branchLevels[hero.branch] = Math.max(hero.level, branchLevels[hero.branch] ?? 1);
  return { ...hero, journey: { ...journey, peakLevel, ...(Object.keys(branchLevels).length ? { branchLevels } : {}) } };
}

export interface HeroFocusOption {
  id: HeroFocus;
  name: string;
  text: string;
  bonusText: string;
  selected: boolean;
  available: boolean;
}

/** Обученная специализация остаётся в дневнике; боевой бонус требует текущего уровня. */
export function heroFocusOptions(hero: HeroState, ctx: GameContext): HeroFocusOption[] {
  const cfg = ctx.cards.training;
  if (!cfg) return [];
  const available = Math.max(hero.level, hero.journey?.peakLevel ?? 1) >= cfg.unlockLevel;
  const statLabel = { hp: 'ОЗ', atk: 'атаки', def: 'защиты' };
  return cfg.focuses.map((f) => ({ ...f, bonusText: `+${f.pct}% ${statLabel[f.stat]}`, selected: hero.journey?.focus === f.id, available }));
}

/** Выбор и переобучение бесплатны. Нельзя менять подготовку героя, пока он в экспедиции. */
export function setHeroFocus(save: SaveState, heroId: string, focus: HeroFocus, ctx: GameContext): SaveState {
  const hero = save.heroes.find((h) => h.id === heroId);
  if (!hero) throw new HeroError('unknown_hero', `Герой ${heroId} не найден`);
  const option = heroFocusOptions(hero, ctx).find((f) => f.id === focus);
  if (!option) throw new HeroError('bad_focus', 'Нет такой специализации тренировки');
  if (!option.available) throw new HeroError('training_locked', `Тренировка откроется на уровне ${ctx.cards.training!.unlockLevel}`);
  if (save.bounties.active.some((b) => b.heroIds.includes(heroId))) throw new HeroError('hero_busy', 'Герой в экспедиции — дождитесь возвращения');
  if (option.selected) return save;
  const remembered = rememberHeroJourney(hero);
  return { ...save, heroes: save.heroes.map((h) => h.id === heroId ? { ...remembered, journey: { ...remembered.journey, focus } } : h) };
}

/** Отменить специализацию копии, чтобы её снова можно было использовать для повышения спутника. */
export function clearHeroFocus(save: SaveState, heroId: string): SaveState {
  const hero = save.heroes.find((h) => h.id === heroId);
  if (!hero) throw new HeroError('unknown_hero', `Герой ${heroId} не найден`);
  if (save.bounties.active.some((b) => b.heroIds.includes(heroId))) throw new HeroError('hero_busy', 'Герой в экспедиции — дождитесь возвращения');
  if (!hero.journey?.focus) return save;
  const { focus: _focus, ...journey } = hero.journey;
  return { ...save, heroes: save.heroes.map((h) => h.id === heroId ? { ...h, journey } : h) };
}

/** Только к базовым статам: броня и связки не умножаются второй раз. */
export function withHeroFocus(stats: Stats, hero: HeroState, ctx: GameContext): Stats {
  const cfg = ctx.cards.training;
  if (!cfg || hero.level < cfg.unlockLevel) return stats;
  const focus = cfg.focuses.find((f) => f.id === hero.journey?.focus);
  return focus ? { ...stats, [focus.stat]: Math.round(stats[focus.stat] * (1 + focus.pct / 100)) } : stats;
}
