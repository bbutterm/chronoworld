import type { GameContext } from '../progression/types';
import type { HeroState, SaveState } from '../save/schema';
import { heroJobId, heroRole, newHeroId } from './card';
import { rarityIndex, type CardRarity } from './schema';

/**
 * Ростер: новые экземпляры, правило «один шаблон — один слот отряда», место в строю.
 */

/** Новый экземпляр карточки templateId (ур. level) в save.heroes; discovered пополняется. Возвращает и героя. */
export function addHeroCard(
  save: SaveState,
  templateId: string,
  rarity: CardRarity,
  opts: { level?: number; isNew?: boolean; granted?: boolean } = {},
): { save: SaveState; hero: HeroState } {
  const level = opts.level ?? 1;
  const hero: HeroState = {
    id: newHeroId(save.heroes, save.heroSeq ?? 0),
    templateId,
    rarity,
    level,
    ...(!save.heroes.some((h) => h.templateId === templateId) ? { companion: true } : {}),
    ...(opts.isNew ? { isNew: true } : {}),
    ...(opts.granted && level > 1 ? { grantedLevel: level } : {}),
  };
  const discovered = save.summon.discovered.includes(templateId) ? save.summon.discovered : [...save.summon.discovered, templateId];
  return { save: { ...save, heroSeq: Number(hero.id.slice(1)), heroes: [...save.heroes, hero], summon: { ...save.summon, discovered } }, hero };
}

/**
 * RN-02. Догоняющий уровень сюжетного героя (Грета, Дорн), который присоединяется к отряду: средний уровень героев
 * отряда (вниз до целого), но не выше предела его редкости и не ниже 1. Уровни до него — дар (HeroState.grantedLevel):
 * в корм они не возвращаются, так что экономика опыта/золота не получает «бесплатных» ресурсов. Пустой отряд — 1.
 */
export function catchUpLevel(save: Pick<SaveState, 'heroes' | 'squad'>, rarity: CardRarity, ctx: GameContext): number {
  const levels = save.squad.map((id) => save.heroes.find((h) => h.id === id)?.level).filter((l): l is number => l !== undefined);
  if (!levels.length) return 1;
  const avg = Math.floor(levels.reduce((a, b) => a + b, 0) / levels.length);
  const cap = ctx.cards.rarities.find((r) => r.id === rarity)?.maxLevel ?? 1;
  return Math.max(1, Math.min(cap, avg));
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

/** Сильнейший экземпляр героя templateId (выше редкость, затем уровень; при равенстве — первый). */
export function storyHero(save: Pick<SaveState, 'heroes'>, templateId: string): HeroState | undefined {
  let best: HeroState | undefined;
  for (const h of save.heroes) {
    if (h.templateId !== templateId) continue;
    if (!best || rarityIndex(h.rarity) > rarityIndex(best.rarity) || (h.rarity === best.rarity && h.level > best.level)) best = h;
  }
  return best;
}

/** Экземпляры героя templateId, сильнейший первым (копии для экрана «Герои» и вознесения). */
export function heroCopies(save: Pick<SaveState, 'heroes'>, templateId: string): HeroState[] {
  return save.heroes
    .filter((h) => h.templateId === templateId)
    .sort((a, b) => rarityIndex(b.rarity) - rarityIndex(a.rarity) || b.level - a.level);
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
