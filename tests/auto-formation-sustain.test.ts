import { describe, expect, it } from 'vitest';
import { loadFullContext } from '../scripts/lib/content-node';
import {
  arrangeSquad, autoFormation, duplicateCardsInSquad, enemySquad, formationRank, heroPower, heroRole, heroSustain,
  newGame, reserveSustain, setSquad, simulateBattle, squadUnits,
  type FormationCandidate, type HeroState, type SaveState,
} from '../src/core';
import { cardHero } from './helpers';

const ctx = loadFullContext();
const hero = (id: string, template: string, level: number, rarity?: HeroState['rarity']): HeroState => cardHero(ctx, template, level, { id, ...(rarity ? { rarity } : {}) });
const roster = (heroes: HeroState[]): SaveState => ({ ...newGame(ctx, 0), heroes, squad: [null, null, null, null, null] });
const ids = (candidates: readonly FormationCandidate[]) => candidates.map((candidate) => candidate.hero.id);

/** Reduced from the honest 3x7/seed2 ch4_s10 loss: existing levels/items, no extra rewards or purchases. */
function chapter4Roster(): SaveState {
  const save = roster([
    hero('h17', 'alan/knight', 42), hero('h29', 'iris/knight', 42), hero('h5', 'greta/blacksmith', 41),
    hero('h2', 'bran/hunter', 41), hero('h9', 'kai/wizard', 41, 'gold'),
    hero('h16', 'teo/priest', 14), hero('h41', 'vika', 23, 'blue'), hero('h95', 'vika/priest', 1),
  ]);
  const items = save.heroes.slice(0, 5).flatMap((member, memberIndex) =>
    ['sograt_scimitar', 'isis_mantle', 'pharaoh_headdress', 'desert_sandals'].map((itemId, slot) => ({
      id: `it${memberIndex * 4 + slot + 1}`, itemId, equippedBy: member.id,
    })),
  );
  items.push(...['mace', 'adventurers_suit', 'pharaoh_headdress', 'boots'].map((itemId, slot) => ({ id: `it${21 + slot}`, itemId, equippedBy: 'h16' })));
  return { ...save, squad: ['h17', 'h29', 'h5', 'h2', 'h9'], inventory: { ...save.inventory, items } };
}

describe('automatic formation: useful support', () => {
  it('recognizes support Teo through his actual basic heal, and seats him behind the frontline', () => {
    const priest = hero('teo', 'teo/priest', 14);
    expect(heroRole(priest, ctx)).toBe('support');
    expect(heroSustain(priest, ctx)).toMatchObject({ heals: true, shields: true });
    expect(heroSustain(priest, ctx).skills).toContain('basic_heal');
    expect(formationRank(priest, ctx)).toBe(3);
    expect(heroSustain(hero('monk', 'teo/monk', 30), ctx)).toMatchObject({ heals: false, shields: false });
  });

  it('ignores self-healing, self-shields and locked future skills', () => {
    expect(heroSustain(hero('alan', 'alan/knight', 100), ctx)).toMatchObject({ heals: false, shields: false });
    expect(heroSustain(hero('kai', 'kai/wizard', 100), ctx)).toMatchObject({ heals: false, shields: false });
    expect(heroSustain(hero('lira', 'lira', 49), ctx)).toMatchObject({ heals: false, shields: false });
    expect(heroSustain(hero('lira', 'lira', 50), ctx).shields).toBe(true);
  });

  it('checks passive chance and real effects, rather than trusting a healer label', () => {
    const bard = hero('bard', 'bran/bard', 30);
    expect(heroSustain(bard, ctx).heals).toBe(true);
    const altered = structuredClone(ctx);
    altered.content.skills.job_bard_apple_of_idun.chance = 0;
    expect(heroSustain(bard, altered).heals).toBe(false);
    const mislabeled = { ...hero('vika', 'vika', 1) };
    altered.content.jobs.acolyte.basic = 'basic_ranged';
    altered.content.heroes.vika.skills = [];
    delete altered.content.heroes.vika.ult;
    expect(heroRole(mislabeled, altered)).toBe('healer');
    expect(heroSustain(mislabeled, altered)).toMatchObject({ heals: false, shields: false });
  });

  it('chooses the already-owned Teo from the chapter4 wall instead of five stronger damage/tank heroes', () => {
    const save = chapter4Roster();
    const before = structuredClone(save);
    const support = save.heroes.find((member) => member.id === 'h16')!;
    const outgoing = save.heroes.find((member) => member.id === 'h2')!;
    expect(heroPower(support, ctx, save)).toBeLessThan(heroPower(outgoing, ctx, save) * 0.9);
    const squad = autoFormation(save, ctx);
    expect(squad).toEqual(['h17', 'h29', 'h5', 'h9', 'h16']);
    expect(squad).not.toContain('h95');
    expect(save).toStrictEqual(before);
    expect(duplicateCardsInSquad(save, squad)).toEqual([]);
    const units = squadUnits({ ...save, squad }, ctx).squad;
    const battle = simulateBattle(ctx.content, units, enemySquad('ch4_s10', ctx), 2, { combat: ctx.combat });
    expect(battle.report.A4.healingDone).toBeGreaterThan(0);
    expect(battle.report.A4.shieldGiven).toBeGreaterThan(0);
  });

  it('allows a trained blue healer in a purple team without requiring equal rarity', () => {
    const save = chapter4Roster();
    save.heroes = save.heroes.filter((member) => member.id !== 'h16' && member.id !== 'h95');
    const squad = autoFormation(save, ctx);
    expect(squad[4]).toBe('h41');
    expect(squad).toContain('h17');
  });

  it('keeps a green level1 healer out of a red level100 team', () => {
    const save = roster([
      hero('alan', 'alan/knight', 100), hero('iris', 'iris/knight', 100), hero('kai', 'kai/wizard', 100),
      hero('bran', 'bran/hunter', 100), hero('dorn', 'dorn/assassin', 100), hero('vika', 'vika', 1),
    ]);
    expect(autoFormation(save, ctx)).not.toContain('vika');
  });

  it('can reserve an actual ally shield, but prefers a viable healer when a shield is already present', () => {
    const chosen = [
      { hero: hero('alan', 'alan/knight', 30), power: 2000 },
      { hero: hero('kai', 'kai/wizard', 30), power: 1600 },
      { hero: hero('dorn', 'dorn/assassin', 30), power: 1500 },
    ];
    const shield = { hero: hero('otto', 'otto', 30, 'blue'), power: 1100 };
    const heal = { hero: hero('teo', 'teo/priest', 14), power: 800 };
    const protectedSquad = reserveSustain(chosen, [...chosen, shield], ctx);
    expect(ids(protectedSquad)).toEqual(['alan', 'kai', 'otto']);
    const restored = reserveSustain(protectedSquad, [...chosen, shield, heal], ctx);
    expect(ids(restored)).toContain('teo');
    expect(ids(restored)).toContain('alan');
  });

  it('never removes the only tank, even when that tank has the lowest power', () => {
    const chosen = [
      { hero: hero('alan', 'alan/knight', 30), power: 1000 },
      { hero: hero('kai', 'kai/wizard', 30), power: 1600 },
      { hero: hero('dorn', 'dorn/assassin', 30), power: 1500 },
    ];
    const heal = { hero: hero('teo', 'teo/priest', 14), power: 900 };
    expect(ids(reserveSustain(chosen, [...chosen, heal], ctx))).toEqual(['alan', 'kai', 'teo']);
  });

  it('can select a weaker healing copy of an existing template without adding a duplicate', () => {
    const chosen = [
      { hero: hero('alan', 'alan/knight', 30), power: 1600 },
      { hero: hero('kai', 'kai/wizard', 30), power: 1400 },
      { hero: hero('monk', 'teo/monk', 30), power: 1500 },
    ];
    const healer = { hero: hero('priest', 'teo/priest', 14), power: 900 };
    const selected = reserveSustain(chosen, [...chosen, healer], ctx);
    expect(ids(selected)).toEqual(['alan', 'kai', 'priest']);
    expect(new Set(selected.map((candidate) => candidate.hero.templateId)).size).toBe(selected.length);
  });

  it('respects caller ratios and returns original candidates without mutating hypothetical potential', () => {
    const chosen = [
      { hero: hero('alan', 'alan/knight', 30), power: 1600, pot: 1600 },
      { hero: hero('kai', 'kai/wizard', 30), power: 1400, pot: 1400 },
      { hero: hero('dorn', 'dorn/assassin', 30), power: 1500, pot: 1500 },
    ];
    const trainee = { hero: hero('teo', 'teo/priest', 1), power: 900, pot: 900 };
    const before = structuredClone({ chosen, trainee });
    expect(reserveSustain(chosen, [...chosen, trainee], ctx, { healRatio: 0.8 })).toEqual(chosen);
    const supported = reserveSustain(chosen, [...chosen, trainee], ctx);
    expect(supported[1]).toBe(trainee);
    expect(supported[1].pot).toBe(900);
    expect({ chosen, trainee }).toStrictEqual(before);
  });

  it('reserves a viable tank, while keeping an existing healer and avoiding a level1 tank in a veteran team', () => {
    const members = [hero('iris', 'iris/knight', 40), hero('kai', 'kai/wizard', 40), hero('dorn', 'dorn/assassin', 40), hero('bran', 'bran/hunter', 40), hero('vika', 'vika/priest', 40)];
    const save = roster([...members, hero('alan', 'alan/knight', 30)]);
    const squad = autoFormation(save, ctx);
    expect(squad[0]).toBe('alan');
    expect(squad[4]).toBe('vika');
    const untrained = roster([...members, hero('alan', 'alan', 1)]);
    expect(autoFormation(untrained, ctx)).not.toContain('alan');
  });

  it('supports explicit sustain:false while still reserving a viable frontline', () => {
    const save = chapter4Roster();
    expect(autoFormation(save, ctx, { sustain: false })).toEqual(save.squad);
    const chosen = save.heroes.slice(0, 5).map((member) => ({ hero: member, power: heroPower(member, ctx, save) }));
    const candidates = save.heroes.map((member) => ({ hero: member, power: heroPower(member, ctx, save) }));
    expect(reserveSustain(chosen, candidates, ctx, { sustain: false })).toEqual(chosen);
    const members = [hero('iris', 'iris/knight', 40), hero('kai', 'kai/wizard', 40), hero('dorn', 'dorn/assassin', 40), hero('bran', 'bran/hunter', 40), hero('greta', 'greta/blacksmith', 40)];
    expect(autoFormation(roster([...members, hero('alan', 'alan/knight', 30)]), ctx, { sustain: false })[0]).toBe('alan');
  });

  it('is stable under roster order changes and leaves manual composition available', () => {
    const save = chapter4Roster();
    expect(autoFormation({ ...save, heroes: [...save.heroes].reverse() }, ctx)).toEqual(autoFormation(save, ctx));
    const manual = setSquad(save, ['h17', 'h29', 'h5', 'h2', 'h9']);
    expect(arrangeSquad(manual, ctx).filter(Boolean).sort()).toEqual(manual.squad.filter(Boolean).sort());
    expect(manual.squad).not.toContain('h16');
  });
});
