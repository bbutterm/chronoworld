import { describe, expect, it } from 'vitest';
import { actEquipBest, buildUnit, gearUpgrades, heroGearStats, heroItemStats, heroPower, itemScore, newGame, refinedStats, withGear, type HeroState, type ItemInstance } from '../src/core';
import { equipmentComparison } from '../src/game/flow';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const hero: HeroState = { id: 'alan', templateId: 'alan', rarity: 'green', level: 20 };
const shirt = ctx.equipment.items.cotton_shirt;
const suit = ctx.equipment.items.adventurers_suit;
const item = (id: string, itemId: string, equippedBy: string | null = null, card?: string): ItemInstance => ({ id, itemId, equippedBy, ...(card ? { card } : {}) });
const fresh = (items: ItemInstance[]) => ({ ...newGame(ctx, 0), heroes: [hero], inventory: { items } });

describe('recipient-aware equipment contributions', () => {
  it('does not replace Osiris armor with a bare +3.5 item-score upgrade that lowers hero power', () => {
    const save = fresh([item('worn', shirt.id, hero.id, 'card_osiris'), item('free', suit.id)]);
    const before = JSON.stringify(save);
    expect(heroPower(hero, ctx, save)).toBe(947);
    expect(itemScore(suit, ctx.features.power) - itemScore(shirt, ctx.features.power)).toBe(3.5);
    expect(gearUpgrades(save, hero.id, ctx)).toEqual([]);
    const result = actEquipBest(save, hero.id, ctx);
    expect(result.equipped).toEqual([]);
    expect(heroPower(hero, ctx, result.save)).toBe(947);
    expect(JSON.stringify(save)).toBe(before);
  });

  it('recognizes a card-bearing candidate, applies it, and reports its actual weighted contribution', () => {
    const worn = item('worn', suit.id, hero.id);
    const candidate = item('free', shirt.id, null, 'card_osiris');
    const save = fresh([worn, candidate]);
    const diff = itemScore({ stats: heroItemStats(hero, shirt, candidate, ctx) }, ctx.features.power) - itemScore({ stats: heroItemStats(hero, suit, worn, ctx) }, ctx.features.power);
    const result = actEquipBest(save, hero.id, ctx);
    expect(result.equipped).toEqual([{ slot: 'armor', instanceId: 'free', itemId: shirt.id, replaces: 'worn', gain: diff }]);
    expect(heroPower(hero, ctx, result.save)).toBeGreaterThan(heroPower(hero, ctx, save));
    expect(Math.abs(heroPower(hero, ctx, result.save) - heroPower(hero, ctx, save) - diff)).toBeLessThan(1);
    expect(gearUpgrades(result.save, hero.id, ctx)).toEqual([]);
  });

  it.each([
    { ...hero, level: 1 }, hero,
    { ...hero, rarity: 'purple' as const, level: 60, branch: 'knight' },
    { ...hero, rarity: 'purple' as const, level: 60, branch: 'crusader' },
  ])('uses recipient level, rarity and branch, ignoring precomputed gear: $level $rarity $branch', (recipient) => {
    const candidate = { ...item('free', shirt.id, null, 'card_osiris'), refine: 4 };
    const base = buildUnit(recipient, ctx, { hp: 0, atk: 0, def: 0, spd: 0 }).stats;
    const stats = heroItemStats(recipient, shirt, candidate, ctx);
    expect(stats.hp).toBe((refinedStats(shirt, 4, ctx).hp ?? 0) + Math.round(base.hp * 0.25));
    const geared = withGear(ctx, fresh([{ ...candidate, equippedBy: hero.id }]));
    expect(heroItemStats(recipient, shirt, candidate, geared)).toEqual(stats);
  });

  it('missing card, missing hunt and missing hero preserve bare refined stats', () => {
    const { hunt: _hunt, ...noHunt } = ctx;
    const bare = { hp: 60, atk: 0, def: 0, spd: 0 };
    expect(heroItemStats(hero, shirt, item('x', shirt.id, null, 'removed_card'), ctx)).toEqual(bare);
    expect(heroItemStats(hero, shirt, item('x', shirt.id, null, 'card_osiris'), noHunt)).toEqual(bare);
    expect(heroItemStats(undefined, shirt, item('x', shirt.id, null, 'card_osiris'), ctx)).toEqual(bare);
    const save = fresh([item('worn', shirt.id, hero.id, 'card_osiris'), item('free', suit.id)]);
    expect(gearUpgrades(save, hero.id, noHunt)[0]?.gain).toBe(3.5);
  });

  it('sums single-item bonuses once, rounds each card separately and never mutates inputs', () => {
    const cards = { ...ctx, hunt: { cards: [{ id: 'small', name: 'Small', slot: 'armor' as const, text: '', bonus: { hp: 0.0006 } }] } };
    const items = [item('a', shirt.id, hero.id, 'small'), item('b', 'knife', hero.id, 'small')];
    const save = fresh(items);
    const snapshot = JSON.stringify({ save, equipment: cards.equipment });
    const contributions = items.map((i) => heroItemStats(hero, ctx.equipment.items[i.itemId], i, cards));
    const sum = heroGearStats(save, hero.id, cards);
    for (const key of ['hp', 'atk', 'def', 'spd'] as const) expect(sum[key]).toBe(contributions.reduce((n, s) => n + s[key], 0));
    const base = buildUnit(hero, ctx).stats.hp;
    expect(sum.hp).toBe(60 + 2 * Math.round(base * 0.0006));
    expect(JSON.stringify({ save, equipment: cards.equipment })).toBe(snapshot);
  });

  it('keeps restrictions, other owners and deterministic ties', () => {
    const save = fresh([item('other', 'valkyrie_armor', 'another'), item('restricted', 'saint_robe', null, 'card_osiris'), item('z', shirt.id, null, 'card_osiris'), item('a', shirt.id, null, 'card_osiris')]);
    expect(gearUpgrades(save, hero.id, ctx).map((u) => u.instanceId)).toEqual(['a']);
    expect(gearUpgrades(save, 'missing', ctx)).toEqual([]);
  });
});

describe('equipment comparison presentation', () => {
  const power = ctx.features.power;
  it('handles empty slots, equal stats and unambiguous gains/losses', () => {
    expect(equipmentComparison(undefined, { hp: 60 }, power)).toEqual({ text: '+6 мощь · +60 ОЗ', tone: 'positive', gain: 6 });
    expect(equipmentComparison({ hp: 60 }, { hp: 60 }, power)).toEqual({ text: '0 мощь · без изменений', tone: 'neutral', gain: 0 });
    expect(equipmentComparison({ hp: 60 }, {}, power)).toEqual({ text: '−6 мощь · −60 ОЗ', tone: 'negative', gain: -6 });
  });
  it('uses weighted power for mixed tradeoffs while keeping losses out of green text', () => {
    expect(equipmentComparison(shirt.stats, suit.stats, power)).toEqual({ text: '+3,5 мощь · −10 ОЗ  +3 ЗАЩ', tone: 'neutral', gain: 3.5 });
    expect(equipmentComparison(suit.stats, shirt.stats, power).tone).toBe('neutral');
    expect(equipmentComparison({ hp: 10 }, { spd: 2 }, power)).toMatchObject({ tone: 'neutral', gain: 0 });
  });
  it('shows the same card-aware contribution used by automatic equipment', () => {
    const worn = heroItemStats(hero, shirt, item('w', shirt.id, hero.id, 'card_osiris'), ctx);
    const candidate = heroItemStats(hero, suit, item('c', suit.id), ctx);
    const comparison = equipmentComparison(worn, candidate, power);
    expect(comparison.gain).toBeLessThan(0);
    expect(comparison.tone).toBe('neutral');
    expect(comparison.text).toContain('−');
  });
});
