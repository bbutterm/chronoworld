import { canEquip } from '../equipment/equipment';
import type { ItemDef } from '../equipment/schema';
import type { GameContext } from '../progression/types';
import type { HeroState, SaveState } from '../save/schema';
import { branchOf, heroName, heroTemplate, maxLevelOf } from './card';
import { HeroError, type HeroErrorCode } from './errors';
import { heroProfessionBlocker } from './branch';
import { findHero } from './level';
import { fodderBlocker } from './merge';
import { BRANCH_RARITY, rarityIndex, type CardRarity } from './schema';
import { rememberHeroJourney } from './training';

type CopyUpgradeContext = GameContext & { equipment?: { items: Record<string, ItemDef> } };

/** Предварительный расчёт обмена: id в heroId принадлежит копии, предоставляющей более высокую редкость. */
export interface HeroCopyUpgradeOption {
  heroId: string;
  from: CardRarity;
  to: CardRarity;
  donorLevel: number;
  /** Собственная выбранная/восстановленная ветка цели после обмена; чужой выбор сюда не переносится. */
  targetBranch?: string;
  canUpgrade: boolean;
  blocker: string | null;
  /** id экземпляров вещей, которые станут несовместимы с профессией и вернутся в инвентарь. */
  unequipped: string[];
}

type Blocker = { code: HeroErrorCode; message: string };

function copyUpgradeBlocker(save: SaveState, hero: HeroState, copy: HeroState, ctx: GameContext): Blocker | null {
  const name = heroName(hero, ctx);
  if (copy.id === hero.id || copy.templateId !== hero.templateId || rarityIndex(copy.rarity) <= rarityIndex(hero.rarity)) {
    return { code: 'bad_fodder', message: `${name}: нужна другая копия этого героя с более высокой редкостью` };
  }
  const t = heroTemplate(ctx, hero.templateId);
  if (rarityIndex(copy.rarity) > rarityIndex(t.maxRarity)) {
    return { code: 'bad_fodder', message: `${name}: редкость копии превышает предел героя` };
  }
  const targetBusy = heroProfessionBlocker(save, hero.id);
  if (targetBusy) return { code: 'hero_busy', message: targetBusy };
  const protectedCopy = fodderBlocker(save, copy.id, ctx);
  if (protectedCopy) return { code: 'fodder_busy', message: heroProfessionBlocker(save, copy.id) ?? protectedCopy };
  const cap = maxLevelOf(ctx, hero.rarity);
  if (copy.level > cap || (copy.grantedLevel ?? 1) > cap) {
    return { code: 'bad_fodder', message: `${name}: уровень копии выше предела ${cap} новой редкости; подаренные уровни нельзя уменьшить` };
  }
  return null;
}

function exchangedHeroes(hero: HeroState, copy: HeroState, ctx: GameContext): [HeroState, HeroState] {
  const restored = !hero.branch && rarityIndex(copy.rarity) >= rarityIndex(BRANCH_RARITY)
    ? branchOf(heroTemplate(ctx, hero.templateId), hero.journey?.lastBranch)?.job
    : undefined;
  const upgraded = { ...hero, rarity: copy.rarity, ...(restored ? { branch: restored } : {}) };
  if (copy.branch && rarityIndex(hero.rarity) < rarityIndex(BRANCH_RARITY)) {
    // История ветки принадлежит донору; текущую профессию ниже фиолетового нельзя сохранять в branch.
    const { branch: _branch, ...remembered } = rememberHeroJourney(copy);
    return [upgraded, { ...remembered, rarity: hero.rarity }];
  }
  return [upgraded, { ...copy, rarity: hero.rarity }];
}

function unwearableAfterExchange(save: SaveState, heroes: readonly HeroState[], ctx: CopyUpgradeContext): string[] {
  const items = ctx.equipment?.items;
  if (!items) return [];
  const byId = new Map(heroes.map((h) => [h.id, h]));
  return save.inventory.items.filter((it) => {
    const hero = it.equippedBy ? byId.get(it.equippedBy) : undefined;
    const def = items[it.itemId];
    return hero && def && !canEquip(hero, def, ctx);
  }).map((it) => it.id);
}

/** Проверить конкретную копию перед выбором и повторно перед подтверждением. Сохранение не изменяется. */
export function heroCopyUpgradeInfo(save: SaveState, heroId: string, copyId: string, ctx: CopyUpgradeContext): HeroCopyUpgradeOption {
  const hero = findHero(save, heroId);
  const copy = findHero(save, copyId);
  const failure = copyUpgradeBlocker(save, hero, copy, ctx);
  const changed = failure ? undefined : exchangedHeroes(hero, copy, ctx);
  return {
    heroId: copy.id,
    from: hero.rarity,
    to: copy.rarity,
    donorLevel: copy.level,
    ...(changed?.[0].branch ? { targetBranch: changed[0].branch } : {}),
    canUpgrade: failure === null,
    blocker: failure?.message ?? null,
    unequipped: changed ? unwearableAfterExchange(save, changed, ctx) : [],
  };
}

/** Все более редкие копии того же героя, включая занятые: доступные и сильнейшие первыми. */
export function heroCopyUpgradeOptions(save: SaveState, heroId: string, ctx: CopyUpgradeContext): HeroCopyUpgradeOption[] {
  const hero = findHero(save, heroId);
  return save.heroes
    .filter((h) => h.id !== heroId && h.templateId === hero.templateId && rarityIndex(h.rarity) > rarityIndex(hero.rarity))
    .map((h) => heroCopyUpgradeInfo(save, heroId, h.id, ctx))
    .sort((a, b) => Number(b.canUpgrade) - Number(a.canUpgrade) || rarityIndex(b.to) - rarityIndex(a.to) || a.donorLevel - b.donorLevel || (a.heroId < b.heroId ? -1 : a.heroId > b.heroId ? 1 : 0));
}

/**
 * Развить выбранного героя сильной свободной копией. Редкости меняются местами; обе личности, уровни, оплаты и вещи
 * остаются своими. Никакие карточки или ресурсы не появляются и не исчезают. Донор сначала должен вернуть оплату
 * и снять специализацию; подаренные уровни никогда не срезаются ради переноса. Двойное подтверждение отвергается,
 * поскольку прежняя копия после обмена уже имеет более низкую редкость.
 */
export function upgradeHeroFromCopy(save: SaveState, heroId: string, copyId: string, ctx: CopyUpgradeContext): {
  save: SaveState;
  heroId: string;
  copyId: string;
  from: CardRarity;
  to: CardRarity;
  unequipped: string[];
} {
  const hero = findHero(save, heroId);
  const copy = findHero(save, copyId);
  const failure = copyUpgradeBlocker(save, hero, copy, ctx);
  if (failure) throw new HeroError(failure.code, failure.message);
  const changed = exchangedHeroes(hero, copy, ctx);
  const byId = new Map(changed.map((h) => [h.id, h]));
  const unequipped = unwearableAfterExchange(save, changed, ctx);
  const off = new Set(unequipped);
  return {
    save: {
      ...save,
      heroes: save.heroes.map((h) => byId.get(h.id) ?? h),
      inventory: off.size ? { ...save.inventory, items: save.inventory.items.map((it) => off.has(it.id) ? { ...it, equippedBy: null } : it) } : save.inventory,
    },
    heroId,
    copyId,
    from: hero.rarity,
    to: copy.rarity,
    unequipped,
  };
}
