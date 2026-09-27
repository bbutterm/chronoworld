import type { GameContext } from '../progression/types';
import type { HeroState, SaveState } from '../save/schema';
import { heroJobId, heroRole, newHeroId } from './card';
import type { CardRarity } from './schema';

/**
 * Ростер: новые экземпляры, правило «один шаблон — один слот отряда», место в строю.
 */

/** Новый экземпляр карточки templateId (ур. level) в save.heroes; discovered пополняется. Возвращает и героя. */
export function addHeroCard(
  save: SaveState,
  templateId: string,
  rarity: CardRarity,
  opts: { level?: number; isNew?: boolean } = {},
): { save: SaveState; hero: HeroState } {
  const hero: HeroState = { id: newHeroId(save.heroes), templateId, rarity, level: opts.level ?? 1, ...(opts.isNew ? { isNew: true } : {}) };
  const discovered = save.summon.discovered.includes(templateId) ? save.summon.discovered : [...save.summon.discovered, templateId];
  return { save: { ...save, heroes: [...save.heroes, hero], summon: { ...save.summon, discovered } }, hero };
}

/** Передний (танк, ближний бой) или задний (дальний, лекарь) по обычной атаке класса и роли. */
export function isFrontliner(hero: HeroState, ctx: GameContext): boolean {
  const role = heroRole(hero, ctx);
  if (role === 'tank') return true;
  if (role === 'healer') return false;
  const job = ctx.content.jobs[heroJobId(hero, ctx)];
  return ctx.content.skills[job?.basic ?? '']?.range === 'melee';
}

/**
 * Шаблон карточки уже стоит в отряде другим экземпляром (правило «одна копия карточки в отряде»).
 * exceptSlot — слот, который будет заменён (его героя не считаем).
 */
export function templateInSquad(save: Pick<SaveState, 'heroes'>, squad: readonly (string | null)[], templateId: string, exceptSlot = -1): boolean {
  return squad.some((id, i) => {
    if (i === exceptSlot || id === null) return false;
    return save.heroes.find((h) => h.id === id)?.templateId === templateId;
  });
}

/** id героев отряда с повторяющимся шаблоном (второй и дальше) — [] если правило соблюдено. */
export function duplicateCardsInSquad(save: Pick<SaveState, 'heroes'>, squad: readonly (string | null)[]): string[] {
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const id of squad) {
    const h = id === null ? undefined : save.heroes.find((x) => x.id === id);
    if (!h) continue;
    if (seen.has(h.templateId)) dups.push(h.id);
    seen.add(h.templateId);
  }
  return dups;
}

/**
 * Поставить героя в свободный слот отряда: передние — с первого слота, задние — с последнего. Нет места или его шаблон
 * уже в отряде — squad как есть.
 */
export function placeInSquad(squad: readonly (string | null)[], hero: HeroState, save: Pick<SaveState, 'heroes'>, ctx: GameContext): (string | null)[] {
  if (squad.includes(hero.id) || templateInSquad({ heroes: [...save.heroes, hero] }, squad, hero.templateId)) return [...squad];
  const order = isFrontliner(hero, ctx) ? [0, 1, 2, 3, 4] : [4, 3, 2, 1, 0];
  const slot = order.find((i) => squad[i] === null);
  if (slot === undefined) return [...squad];
  return squad.map((id, i) => (i === slot ? hero.id : id));
}

/** Сюжетные карточки игрока (id шаблонов) в порядке сюжета (start, затем recruits). */
export function ownedStoryTemplates(save: Pick<SaveState, 'heroes'>, ctx: GameContext): string[] {
  const order = [...ctx.progression.heroes.start, ...ctx.progression.heroes.recruits.map((r) => r.template)];
  return order.filter((t) => save.heroes.some((h) => h.templateId === t));
}

/** Экземпляр сюжетной карточки templateId (сюжетные не дублируются; если вдруг два — первый). */
export function storyHero(save: Pick<SaveState, 'heroes'>, templateId: string): HeroState | undefined {
  return save.heroes.find((h) => h.templateId === templateId);
}

/** Снять с героя «Новый!» (UI — при открытии карточки). */
export function markHeroSeen(save: SaveState, heroId: string): SaveState {
  if (!save.heroes.some((h) => h.id === heroId && h.isNew)) return save;
  return { ...save, heroes: save.heroes.map((h) => (h.id === heroId ? withoutNew(h) : h)) };
}

function withoutNew(h: HeroState): HeroState {
  const { isNew: _n, ...rest } = h;
  return rest;
}

/** Замок на карточке (закреплённую нельзя отдать в корм). */
export function setHeroLocked(save: SaveState, heroId: string, locked: boolean): SaveState {
  return {
    ...save,
    heroes: save.heroes.map((h) => {
      if (h.id !== heroId) return h;
      const { locked: _l, ...rest } = h;
      return locked ? { ...rest, locked: true } : rest;
    }),
  };
}
