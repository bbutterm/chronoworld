import { describe, expect, it } from 'vitest';
import { actSummon, autoFormation, grantTavernWelcome, heroRole, newGame, setSquad, squadPower, type HeroState, type SaveState } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { canHealAllies, squadChoices } from '../src/game/squadChoice';

const ctx = loadFullContext();
const hero = (id: string, templateId = id, extra: Partial<HeroState> = {}): HeroState => ({ id, templateId, rarity: 'green', level: 1, ...extra });
const roster = (): SaveState => {
  const base = newGame(ctx, 0);
  return { ...base, summon: { ...base.summon, firstTenDone: true }, heroes: ['alan', 'bran', 'vika', 'dorn', 'kai', 'greta', 'iris'].map((id) => hero(id)) };
};

describe('one-slot squad choice after the first summon', () => {
  it('does not invent a decision for the starter, no-healer or too-small roster', () => {
    expect(squadChoices(newGame(ctx, 0), ctx)).toEqual([]);
    const save = roster();
    expect(squadChoices({ ...save, campaign: { ...save.campaign, cleared: ['ch1_s10'] } }, ctx)).toEqual([]);
    expect(squadChoices({ ...save, heroes: save.heroes.filter((h) => heroRole(h, ctx) !== 'healer') }, ctx)).toEqual([]);
    expect(squadChoices({ ...save, heroes: save.heroes.slice(0, 4) }, ctx)).toEqual([]);
  });

  it('keeps four cards common, changes one, preserves the tank and puts healing in the rear', () => {
    const save = roster();
    const before = structuredClone(save);
    const [healing, fighters] = squadChoices(save, ctx);
    expect(healing.id).toBe('healing');
    expect(fighters.id).toBe('fighters');
    expect(healing.squad.filter((id) => fighters.squad.includes(id))).toHaveLength(4);
    expect(healing.squad.slice(2)).toContain(healing.heroId);
    expect(healing.squad).toContain('alan');
    expect(fighters.squad).toContain('alan');
    expect(healing.squad).not.toContain(fighters.heroId);
    expect(fighters.squad).not.toContain(healing.heroId);
    expect(save).toEqual(before);
    for (const option of [healing, fighters]) {
      expect(option.squad.filter(Boolean)).toHaveLength(5);
      expect(() => setSquad(save, option.squad)).not.toThrow();
      expect(option.power).toBe(squadPower({ ...save, squad: option.squad }, ctx));
    }
  });

  it('uses the strongest healer copy and never selects duplicate cards', () => {
    const save = roster();
    save.heroes.push(hero('vika_strong', 'vika', { rarity: 'purple', level: 20 }), hero('alan_copy', 'alan', { rarity: 'blue', level: 10 }));
    const [healing, fighters] = squadChoices(save, ctx);
    expect(healing.heroId).toBe('vika_strong');
    for (const option of [healing, fighters]) {
      expect(() => setSquad(save, option.squad)).not.toThrow();
      const templates = option.squad.map((id) => save.heroes.find((h) => h.id === id)!.templateId);
      expect(new Set(templates).size).toBe(5);
    }
  });

  it('recognises support healing and never advertises Тео as a no-healing alternative', () => {
    const save = roster();
    save.heroes.push(hero('teo'));
    expect(heroRole(hero('teo'), ctx)).toBe('support');
    expect(canHealAllies(hero('teo'), ctx)).toBe(true);
    expect(canHealAllies(hero('vika'), ctx)).toBe(true);
    expect(canHealAllies(hero('bran'), ctx)).toBe(false);
    expect(canHealAllies(hero('bran', 'bran', { rarity: 'purple', level: 50, branch: 'bard' }), ctx)).toBe(true);
    const [healing, fighters] = squadChoices(save, ctx);
    expect(canHealAllies(save.heroes.find((h) => h.id === healing.heroId)!, ctx)).toBe(true);
    for (const id of fighters.squad) expect(canHealAllies(save.heroes.find((h) => h.id === id)!, ctx)).toBe(false);
  });

  it('replaces the same card when healer and fighter copies have different branches', () => {
    const save = roster();
    save.heroes.push(hero('vika_monk', 'vika', { rarity: 'purple', level: 40, branch: 'monk' }));
    const [healing, fighters] = squadChoices(save, ctx);
    expect(fighters.heroId).toBe('vika_monk');
    expect(healing.heroId).toBe('vika');
    expect(healing.squad).not.toContain('vika_monk');
    expect(() => setSquad(save, healing.squad)).not.toThrow();
    expect(() => setSquad(save, fighters.squad)).not.toThrow();
  });

  it('is stable on reopen and never consumes currency, cards or changes progression', () => {
    const save = roster();
    const first = squadChoices(save, ctx);
    const changed = setSquad(save, first[0].squad);
    expect(squadChoices(changed, ctx)).toEqual(first);
    expect({ ...changed, squad: save.squad }).toEqual(save);
    expect(autoFormation(save, ctx)).toEqual(autoFormation(changed, ctx));
  });

  it('returns valid options or no comparison for 100 real first-ten outcomes', () => {
    let available = 0;
    for (let seed = 0; seed < 100; seed++) {
      let save = newGame(ctx, seed);
      save.campaign.cleared = ctx.content.stages.slice(0, 6).map((s) => s.id);
      save = grantTavernWelcome(save, ctx).save;
      save = actSummon(save, '2026-10-03', 10, 'scroll', ctx).save;
      const options = squadChoices(save, ctx);
      if (options.length) available++;
      for (const option of options) {
        expect(() => setSquad(save, option.squad)).not.toThrow();
        if (option.id === 'fighters') for (const id of option.squad) expect(canHealAllies(save.heroes.find((h) => h.id === id)!, ctx)).toBe(false);
      }
    }
    // С 10.10 первый ×10 даёт не меньше 2 героев (остальное — награды), а не 10: выбор пятого слота есть реже —
    // при 6+ героях. Проверка корректности вариантов выше прежняя; здесь — что выбор вообще встречается заметно часто.
    expect(available).toBeGreaterThan(30);
  });
});
