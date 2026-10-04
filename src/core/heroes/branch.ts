import { canEquip } from '../equipment/equipment';
import type { ItemDef } from '../equipment/schema';
import type { GameContext, ProgressEvent } from '../progression/types';
import type { HeroState, SaveState } from '../save/schema';
import { activeBranch, branchOf, heroTemplate } from './card';
import { HeroError } from './errors';
import { findHero } from './level';
import { BRANCH_RARITY, rarityIndex } from './schema';
import { groupDigits } from '../format';
import { rememberHeroJourney } from './training';

/**
 * Ветка второй профессии (docs/design/heroes-v2.md, раздел 3). Выбирается на фиолетовом: при вознесении синий →
 * фиолетовый (merge.ts, opts.branch) или позже кнопкой «Выбрать ветку» (бесплатно) у фиолетового без ветки
 * (Таверна, контракт, миграция). Смена — «Сменить ветку»: первая бесплатно (data/cards.json → branchChange.firstFree),
 * дальше за гемы. Уровень, редкость и экипировка сохраняются; вещи, которые новая форма носить не может, — в инвентарь.
 */

type BranchCtx = GameContext & { equipment?: { items: Record<string, ItemDef> } };

/** Личная память не действует ниже фиолетового, а при возвращении редкости сохраняет прежний выбор. */
function chosenBranch(hero: HeroState, ctx: GameContext) {
  const t = heroTemplate(ctx, hero.templateId);
  return activeBranch(t, hero) ?? (rarityIndex(hero.rarity) >= rarityIndex(BRANCH_RARITY) ? branchOf(t, hero.journey?.lastBranch) : undefined);
}

export interface BranchStatus {
  heroId: string;
  /** Выбранная ветка (id профессии) или undefined. */
  branch?: string;
  /** Можно выбрать бесплатно (фиолетовый и выше без ветки). */
  canChoose: boolean;
  /** Можно сменить (ветка выбрана). */
  canChange: boolean;
  /** Цена смены в гемах (0 — бесплатно). */
  changeCost: number;
  /** Смена бесплатная (первая). */
  changeFree: boolean;
  /** Тип действия остаётся видимым в интерфейсе; выполнять его можно только без blocker. */
  blocker: 'expedition' | null;
  blockerText: string | null;
}

/** Профессия героя фиксирована до получения наград его активной экспедиции. */
export function heroProfessionBlocker(save: Pick<SaveState, 'bounties'>, heroId: string): string | null {
  return save.bounties.active.some((e) => e.heroIds.includes(heroId))
    ? 'Герой в экспедиции. Дождитесь возвращения и заберите награды, чтобы менять профессию.'
    : null;
}

/** Цена следующей смены ветки: первая бесплатно (если firstFree), дальше branchChange.gems. */
export function branchChangeCost(hero: Pick<HeroState, 'branchChanges'>, ctx: GameContext): number {
  const cfg = ctx.cards.branchChange;
  return cfg.firstFree && !(hero.branchChanges ?? 0) ? 0 : cfg.gems;
}

/** Всё для кнопок «Выбрать ветку» / «Сменить ветку» на карточке. */
export function branchStatus(save: SaveState, heroId: string, ctx: GameContext): BranchStatus {
  const hero = findHero(save, heroId);
  const purple = rarityIndex(hero.rarity) >= rarityIndex(BRANCH_RARITY);
  const current = chosenBranch(hero, ctx)?.job;
  const cost = branchChangeCost(hero, ctx);
  const blockerText = heroProfessionBlocker(save, heroId);
  return { heroId, ...(current ? { branch: current } : {}), canChoose: purple && !current, canChange: purple && !!current, changeCost: cost, changeFree: cost === 0, blocker: blockerText ? 'expedition' : null, blockerText };
}

/** Проверить, что job — ветка героя; иначе HeroError bad_branch. */
export function assertBranch(hero: Pick<HeroState, 'templateId'>, job: string, ctx: GameContext): void {
  const t = heroTemplate(ctx, hero.templateId);
  if (!branchOf(t, job)) throw new HeroError('bad_branch', `${t.name}: нет ветки «${ctx.content.jobs[job]?.name ?? job}» — только ${t.branches.map((b) => ctx.content.jobs[b.job]?.name ?? b.job).join(' или ')}`);
}

/** Снять вещи, которые герой (с новой веткой) носить не может. Нет описаний предметов — ничего не снимаем. */
function dropUnwearable(save: SaveState, heroId: string, ctx: BranchCtx): SaveState {
  const items = ctx.equipment?.items;
  if (!items) return save;
  const hero = findHero(save, heroId);
  let changed = false;
  const next = save.inventory.items.map((it) => {
    if (it.equippedBy !== heroId) return it;
    const def = items[it.itemId];
    if (!def || canEquip(hero, def, ctx)) return it;
    changed = true;
    return { ...it, equippedBy: null };
  });
  return changed ? { ...save, inventory: { ...save.inventory, items: next } } : save;
}

function setBranch(save: SaveState, heroId: string, job: string, changes?: number): SaveState {
  return {
    ...save,
    heroes: save.heroes.map((h) => {
      if (h.id !== heroId) return h;
      const { branch: _b, branchChanges: _c, ...rest } = rememberHeroJourney(h);
      return rememberHeroJourney({ ...rest, branch: job, ...(changes ? { branchChanges: changes } : {}) });
    }),
  };
}

/**
 * Выбрать ветку у фиолетового (и выше) героя без ветки — бесплатно. HeroError: unknown_hero, branch_locked (ниже
 * фиолетового или ветка уже выбрана — тогда changeBranch), bad_branch. Событие branchChosen. Чистая функция.
 */
export function chooseBranch(save: SaveState, heroId: string, job: string, ctx: BranchCtx): { save: SaveState; events: ProgressEvent[] } {
  const hero = findHero(save, heroId);
  const t = heroTemplate(ctx, hero.templateId);
  const blocker = heroProfessionBlocker(save, heroId);
  if (blocker) throw new HeroError('hero_busy', blocker);
  if (rarityIndex(hero.rarity) < rarityIndex(BRANCH_RARITY)) throw new HeroError('branch_locked', `${t.name}: ветка выбирается на фиолетовой редкости`);
  if (chosenBranch(hero, ctx)) throw new HeroError('branch_locked', `${t.name}: ветка уже выбрана — её можно сменить`);
  assertBranch(hero, job, ctx);
  const next = dropUnwearable(setBranch(save, heroId, job, hero.branchChanges), heroId, ctx);
  return { save: next, events: [{ type: 'branchChosen', heroId, branch: job, changed: false, gems: 0 }] };
}

/**
 * Сменить ветку: первая смена бесплатно, дальше branchChange.gems гемов. HeroError: unknown_hero, branch_locked (нет
 * выбранной ветки), bad_branch (не своя или та же), not_enough_gems. Вещи, которые новая форма носить не может, —
 * в инвентарь. Событие branchChosen (changed: true). Чистая функция.
 */
export function changeBranch(save: SaveState, heroId: string, job: string, ctx: BranchCtx): { save: SaveState; events: ProgressEvent[]; gems: number } {
  const hero = findHero(save, heroId);
  const t = heroTemplate(ctx, hero.templateId);
  const blocker = heroProfessionBlocker(save, heroId);
  if (blocker) throw new HeroError('hero_busy', blocker);
  const current = chosenBranch(hero, ctx);
  if (!current) throw new HeroError('branch_locked', `${t.name}: ветка ещё не выбрана`);
  assertBranch(hero, job, ctx);
  if (current.job === job) throw new HeroError('bad_branch', `${t.name}: эта ветка уже выбрана`);
  const gems = branchChangeCost(hero, ctx);
  if (save.currency.gems < gems) throw new HeroError('not_enough_gems', `Смена ветки: нужно ${groupDigits(gems)} гемов, есть ${groupDigits(save.currency.gems)}`);
  let next = setBranch(save, heroId, job, (hero.branchChanges ?? 0) + 1);
  if (gems > 0) next = { ...next, currency: { ...next.currency, gems: next.currency.gems - gems } };
  next = dropUnwearable(next, heroId, ctx);
  return { save: next, events: [{ type: 'branchChosen', heroId, branch: job, changed: true, gems }], gems };
}
