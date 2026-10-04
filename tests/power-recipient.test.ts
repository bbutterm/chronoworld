import { describe, expect, it } from 'vitest';
import {
  addHeroCard, addItems, buildUnit, heroGearStats, heroPower, newGame, unitPower, withGear,
  type FullContext, type HeroState, type SaveState,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();

/** Замороженный прежний публичный алгоритм: сохранить именно его семантику и округление. */
function legacyPower(hero: HeroState, context: FullContext, save?: SaveState): number {
  return unitPower(buildUnit(hero, save ? withGear(context, save) : context), context);
}

/** Это тестовая матрица, а не сохранение, выдаваемое за законное прохождение. */
function fixture(): SaveState {
  let save = newGame(ctx, 0);
  for (const templateId of Object.keys(ctx.content.heroes)) {
    if (!save.heroes.some((hero) => hero.templateId === templateId)) save = addHeroCard(save, templateId, 'gold').save;
  }
  save = addItems(save, Object.keys(ctx.equipment.items)).save;
  // Экипировка разных получателей одновременно: у старого алгоритма она пересчитывалась вся.
  const items = save.inventory.items.map((item, i) => ({
    ...item, equippedBy: save.heroes[i % save.heroes.length].id, refine: i % 11,
    card: ctx.hunt.cards?.find((card) => card.slot === ctx.equipment.items[item.itemId].slot)?.id,
  }));
  return { ...save, inventory: { ...save.inventory, items } };
}

describe('Мощь одного получателя без построения экипировки всей коллекции', () => {
  it('совпадает с прежним алгоритмом на всех героях, редкостях, ветках, адвансах и выучке', () => {
    const base = fixture();
    for (const rarity of ctx.cards.rarities) for (const branchIndex of [0, 1]) {
      for (const focus of [undefined, 'resolve', 'precision', 'guard'] as const) {
        const save: SaveState = { ...base, heroes: base.heroes.map((hero) => {
          const branch = ctx.content.heroes[hero.templateId].branches[branchIndex].job;
          return { ...hero, rarity: rarity.id, level: rarity.maxLevel, branch, journey: { peakLevel: rarity.maxLevel, branchLevels: { [branch]: rarity.maxLevel }, ...(focus ? { focus } : {}) } };
        }) };
        for (const hero of save.heroes) {
          for (const level of new Set([1, Math.floor(rarity.maxLevel / 2), rarity.maxLevel])) {
            const preview = { ...hero, level };
            expect(heroPower(preview, ctx, save)).toBe(legacyPower(preview, ctx, save));
          }
        }
      }
    }
  });

  it('берёт процентные MVP-бонусы из настоящего экземпляра, а не из просмотра будущего уровня', () => {
    const base = fixture();
    const hero: HeroState = { ...base.heroes[0], rarity: 'red', level: 100, branch: 'knight', journey: { focus: 'resolve' } };
    const armor = Object.values(ctx.equipment.items).find((item) => item.slot === 'armor')!;
    const card = ctx.hunt.cards!.find((candidate) => candidate.slot === 'armor' && candidate.bonus.hp)!;
    const save: SaveState = { ...base, heroes: base.heroes.map((h) => h.id === hero.id ? hero : h), inventory: { items: [{ id: 'it999', itemId: armor.id, equippedBy: hero.id, refine: 7, card: card.id }] } };
    const preview = { ...hero, level: 1 };
    const actualGear = heroGearStats(save, hero.id, ctx);
    const previewSave = { ...save, heroes: save.heroes.map((h) => h.id === hero.id ? preview : h) };
    expect(actualGear.hp).toBeGreaterThan(heroGearStats(previewSave, hero.id, ctx).hp);
    expect(heroPower(preview, ctx, save)).toBe(legacyPower(preview, ctx, save));
    expect(heroPower(preview, ctx, save)).toBe(unitPower(buildUnit(preview, ctx, actualGear), ctx));
  });

  it('сохраняет ctx.heroGear без save/оборудования, игнорирует неизвестные предметы и orphan ids как раньше', () => {
    const save = fixture(), hero = save.heroes[0];
    const prebuilt = { ...ctx, heroGear: { [hero.id]: { hp: 123, atk: 45, def: 6, spd: 7 } } };
    expect(heroPower(hero, prebuilt)).toBe(legacyPower(hero, prebuilt));
    const noEquipment = { ...prebuilt, equipment: undefined };
    expect(heroPower(hero, noEquipment, save)).toBe(unitPower(buildUnit(hero, noEquipment), noEquipment));
    const unknown: SaveState = { ...save, inventory: { items: [{ id: 'it999', itemId: 'content_removed', equippedBy: hero.id, refine: 10, card: 'removed_card' }] } };
    expect(heroPower(hero, prebuilt, unknown)).toBe(legacyPower(hero, prebuilt, unknown));
    expect(heroPower(hero, prebuilt, unknown)).toBe(heroPower(hero, ctx));
    const orphan = { ...hero, id: 'unknown_hero_instance' };
    const orphanSave: SaveState = { ...save, inventory: { items: [{ ...save.inventory.items[0], equippedBy: orphan.id }] } };
    expect(heroPower(orphan, ctx, orphanSave)).toBe(legacyPower(orphan, ctx, orphanSave));
    expect(heroPower(orphan, ctx, orphanSave)).toBe(heroPower(orphan, ctx));
  });

  it('сразу отражает надевание и заточку нового save без общего кэша', () => {
    const save = fixture(), hero = save.heroes[0], item = save.inventory.items[0];
    const before: SaveState = { ...save, inventory: { items: [{ ...item, equippedBy: null, refine: 0 }] } };
    const equipped: SaveState = { ...save, inventory: { items: [{ ...item, equippedBy: hero.id, refine: 0 }] } };
    const refined: SaveState = { ...save, inventory: { items: [{ ...item, equippedBy: hero.id, refine: 10 }] } };
    expect(heroPower(hero, ctx, before)).toBe(legacyPower(hero, ctx, before));
    expect(heroPower(hero, ctx, equipped)).toBeGreaterThan(heroPower(hero, ctx, before));
    expect(heroPower(hero, ctx, refined)).toBeGreaterThan(heroPower(hero, ctx, equipped));
    expect(heroPower(hero, ctx, refined)).toBe(legacyPower(hero, ctx, refined));
    expect(heroPower(hero, ctx, before)).toBe(legacyPower(hero, ctx, before));
  });
});
