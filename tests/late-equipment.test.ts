import { describe, expect, it } from 'vitest';
import {
  addItems, buildUnit, canEquip, equip, heroGearStats, heroSlots, insertCard, itemPools,
  newGame, rollChestLoot, rollDrops, validateEquipment, withGear,
  type ItemDef, type SaveState,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const chapters = [7, 8, 9, 10] as const;
const items = ctx.equipment.items;
const rare = (chapter: number, slot: ItemDef['slot']) => Object.values(items).find(i => i.minChapter === chapter && i.rarity === 'rare' && i.slot === slot)!;
const value = (item: ItemDef) => (item.stats.hp ?? 0) * 0.1 + (item.stats.atk ?? 0) * 2 + (item.stats.def ?? 0) * 1.5 + (item.stats.spd ?? 0) * 0.5;

describe('поздняя экипировка: добыча собственной главы вместо вещей пиратов', () => {
  it('контент валиден, каждый поздний пул содержит все четыре слота и обе рабочие редкости', () => {
    expect(validateEquipment(ctx.equipment, ctx)).toEqual([]);
    for (const chapter of chapters) {
      const pools = itemPools(items, chapter, chapter);
      expect(pools.common).toEqual([]);
      expect(pools.rare).toHaveLength(2);
      expect(pools.epic).toHaveLength(4);
      expect(new Set([...pools.rare, ...pools.epic].map(id => items[id].slot))).toEqual(new Set(['weapon', 'armor', 'helmet', 'boots']));
    }
  });

  it.each(chapters)('глава %i: первое прохождение, повтор и сундук исключают старую и будущую экипировку', chapter => {
    const chapterId = `chapter${chapter}`;
    const stage = ctx.content.stages.find(s => s.chapter === chapterId && !s.boss)!;
    const boss = ctx.content.stages.find(s => s.chapter === chapterId && s.boss)!;
    const first: string[] = [], replay: string[] = [], bosses: string[] = [];
    for (let seed = 1; seed <= 1600; seed++) {
      const once = rollDrops(stage.id, seed, true, ctx);
      expect(once).toHaveLength(1);
      first.push(...once);
      replay.push(...rollDrops(stage.id, seed, false, ctx));
      if (seed <= 32) {
        const reward = rollDrops(boss.id, seed, true, ctx);
        expect(reward).toHaveLength(1);
        bosses.push(...reward);
      }
    }
    const chest = rollChestLoot(chapterId, 4096, 713, ctx);
    expect(chest).toEqual(rollChestLoot(chapterId, 4096, 713, ctx));
    expect(chest.items.length).toBeGreaterThan(200);
    for (const id of [...first, ...replay, ...bosses, ...chest.items]) expect(items[id].minChapter, id).toBe(chapter);
    expect(bosses.every(id => items[id].rarity === 'epic')).toBe(true);
    expect(new Set(bosses.map(id => items[id].slot))).toEqual(new Set(['weapon', 'armor', 'helmet', 'boots']));
    // Редкий пул существует: его вес больше не перенормируется в 100% эпиков.
    const rareShare = first.filter(id => items[id].rarity === 'rare').length / first.length;
    expect(rareShare).toBeGreaterThan(0.5);
    expect(rareShare).toBeLessThan(0.6);
    expect(new Set(replay.map(id => items[id].rarity))).toEqual(new Set(['rare', 'epic']));
    expect(new Set(chest.items.map(id => items[id].rarity))).toEqual(new Set(['rare', 'epic']));
  });

  it('редкие ступени прибавляют 8–12% ценности, без разгона ATK или SPD; до главы7 они не выпадают', () => {
    const preceding = { helmet: items.pirate_bandana, boots: items.sea_boots };
    for (const chapter of chapters) {
      for (const slot of ['helmet', 'boots'] as const) {
        const current = rare(chapter, slot);
        const ratio = value(current) / value(preceding[slot]);
        expect(ratio, `${chapter}/${slot}`).toBeGreaterThanOrEqual(1.08);
        expect(ratio, `${chapter}/${slot}`).toBeLessThanOrEqual(1.12);
        expect(current.stats.atk ?? 0).toBe(0);
        expect(current.stats.spd ?? 0).toBe(preceding[slot].stats.spd ?? 0);
        preceding[slot] = current;
      }
    }
    const before = new Set(Object.values(itemPools(items, 6)).flat());
    for (const item of Object.values(items).filter(i => i.minChapter >= 7)) expect(before.has(item.id)).toBe(false);
  });

  it('новые вещи используют обычные слоты, совместимы с ролями и картами, не теряют старую заточку при замене', () => {
    let save: SaveState = newGame(ctx, 0, '2026-10-04');
    const hero = { ...save.heroes[0], level: 50, rarity: 'purple' as const, branch: 'knight' };
    save = { ...save, heroes: save.heroes.map(h => h.id === hero.id ? hero : h) };
    const helm = rare(10, 'helmet'), boots = rare(10, 'boots');
    for (const template of Object.values(ctx.content.heroes)) {
      const recipient = { id: `test_${template.id}`, templateId: template.id, level: 50, rarity: 'purple' as const };
      expect(canEquip(recipient, helm, ctx)).toBe(true);
      expect(canEquip(recipient, boots, ctx)).toBe(true);
    }
    save = addItems(save, ['pirate_bandana', 'sea_boots', helm.id, boots.id]).save;
    const [oldHelm, oldBoots, newHelm, newBoots] = save.inventory.items;
    const card = ctx.hunt.cards!.find(c => c.slot === 'helmet')!;
    save = { ...save, inventory: { ...save.inventory, items: save.inventory.items.map(i => i.id === oldHelm.id ? { ...i, refine: 5, card: card.id, locked: true } : i) } };
    save = equip(equip(save, hero.id, oldHelm.id, ctx), hero.id, oldBoots.id, ctx);
    save = equip(equip(save, hero.id, newHelm.id, ctx), hero.id, newBoots.id, ctx);
    expect(Object.keys(heroSlots(save, hero.id, ctx)).sort()).toEqual(['boots', 'helmet']);
    expect(save.inventory.items.find(i => i.id === oldHelm.id)).toMatchObject({ equippedBy: null, refine: 5, card: card.id, locked: true });
    save = { ...save, hunt: { ...save.hunt!, cards: { ...save.hunt?.cards, [card.id]: 1 } } };
    save = insertCard(save, newHelm.id, card.id, ctx);
    expect(save.inventory.items.find(i => i.id === newHelm.id)?.card).toBe(card.id);
    expect(() => insertCard({ ...save, hunt: { ...save.hunt!, cards: { [card.id]: 1 } } }, newBoots.id, card.id, ctx)).toThrow(/слот/);
    const plain = buildUnit(hero, ctx), geared = buildUnit(hero, withGear(ctx, save));
    const bonus = heroGearStats(save, hero.id, ctx);
    expect(geared.stats.hp).toBe(plain.stats.hp + bonus.hp);
    expect(geared.stats.def).toBe(plain.stats.def + bonus.def);
    expect(geared.stats.atk).toBe(plain.stats.atk + bonus.atk);
  });
});
