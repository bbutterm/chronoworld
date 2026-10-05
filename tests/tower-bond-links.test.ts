import { describe, expect, it } from 'vitest';
import fixture from './fixtures/tower-bond-legal-checkpoint.json';
import {
  abandonTowerRun,
  buildUnit,
  chooseTowerPath,
  deserialize,
  fightTowerFloor,
  serialize,
  setSquad,
  skipTowerBlessing,
  squadUnits,
  startTowerRun,
  towerRunSquad,
  withGear,
  type SaveState,
  type UnitDef,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const DAY = '2026-10-20';
/** Unedited legal data2 seed3 endpoint: active floor11 run, completed quests and real gear. */
const checkpoint = () => deserialize(JSON.stringify(fixture));

function heroId(save: SaveState, templateId: string): string {
  const hero = save.heroes.find(h => h.templateId === templateId && h.companion)
    ?? save.heroes.find(h => h.templateId === templateId);
  if (!hero) throw new Error(`Missing fixture hero ${templateId}`);
  return hero.id;
}
function startWith(templates: string[]): SaveState {
  let save = checkpoint();
  save = abandonTowerRun(save, DAY, ctx).save;
  const squad = [0, 1, 2, 3, 4].map(i => templates[i] ? heroId(save, templates[i]) : null);
  save = startTowerRun(save, squad, ctx);
  if (save.tower.run?.pending?.kind === 'blessing') save = skipTowerBlessing(save, ctx);
  return save;
}
function plain(save: SaveState, id: string): UnitDef {
  const hero = save.heroes.find(h => h.id === id);
  if (!hero) throw new Error(`Missing fixture card ${id}`);
  return buildUnit(hero, withGear(ctx, save));
}
function towerUnit(save: SaveState, id: string): UnitDef {
  const unit = towerRunSquad(save, ctx).squad.find(u => u?.id === id);
  if (!unit) throw new Error(`Missing run participant ${id}`);
  return unit;
}
function frozen<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) frozen(nested);
    Object.freeze(value);
  }
  return value;
}

describe('personal RPG links in a Tower run', () => {
  it('restores a genuinely earned Bran/Dorn ATK link on the exact active legal checkpoint', () => {
    const save = checkpoint();
    const bran = 'h18';
    const dorn = 'h10';
    expect(save.tavern?.quests).toContain('bq_bran');
    expect(save.tower.run?.floor).toBe(11);
    expect(save.tower.run?.squad).toContain(bran);
    expect(save.tower.run?.squad).toContain(dorn);
    for (const id of [bran, dorn]) {
      expect(towerUnit(save, id).stats.atk).toBe(Math.round(plain(save, id).stats.atk * 1.05));
    }
    // Alan is in the common squad but absent from this run: his DEF8% link must not reach Bran here.
    expect(save.squad).toContain('h1');
    expect(save.tower.run?.squad).not.toContain('h1');
    expect(towerUnit(save, bran).stats.def).toBe(plain(save, bran).stats.def);
  });

  it('keeps earned links after a legal change of the common squad', () => {
    const save = checkpoint();
    const changed = setSquad(save, [heroId(save, 'lira'), null, null, null, null]);
    expect(changed.tower.run).toBe(save.tower.run);
    for (const id of ['h18', 'h10']) {
      expect(towerUnit(changed, id).stats.atk).toBe(Math.round(plain(changed, id).stats.atk * 1.05));
    }
  });

  it('does not activate a common-squad link when its partner is absent from the run', () => {
    const save = startWith(['alan', 'lira']);
    const alan = heroId(save, 'alan');
    const bran = heroId(save, 'bran');
    const changed = setSquad(save, [alan, bran, null, null, null]);
    expect(changed.tavern?.quests).toContain('bq_alan');
    expect(towerUnit(changed, alan)).toEqual(plain(changed, alan));
  });

  it('does not grant an uncompleted quest link, even with both heroes in the run', () => {
    const save = checkpoint();
    const unearned: SaveState = { ...save, tavern: { ...save.tavern, quests: [] } };
    const result = towerRunSquad(unearned, ctx);
    expect(result.squad).toEqual(save.tower.run!.squad.map(id => id ? plain(unearned, id) : null));
  });

  it('old saves without tavern progress keep their exact unlinked unit definitions', () => {
    const save = checkpoint();
    const legacy: SaveState = { ...save, tavern: undefined };
    expect(towerRunSquad(legacy, ctx).squad).toEqual(save.tower.run!.squad.map(id => id ? plain(legacy, id) : null));
  });

  it('a missing run partner does not receive or grant the learned bonus', () => {
    const save = startWith(['bran', 'lira']);
    const bran = heroId(save, 'bran');
    const dorn = heroId(save, 'dorn');
    const changed = setSquad(save, [bran, dorn, null, null, null]);
    expect(changed.tavern?.quests).toContain('bq_bran');
    expect(towerUnit(changed, bran)).toEqual(plain(changed, bran));
  });

  it('stacks both genuinely completed ATK links on Bran once and in the established order', () => {
    const save = startWith(['dorn', 'bran', 'meilin']);
    expect(save.tavern?.quests).toEqual(expect.arrayContaining(['bq_bran', 'bq_meilin']));
    const changed = setSquad(save, [heroId(save, 'lira'), null, null, null, null]);
    const bran = heroId(changed, 'bran');
    const dorn = heroId(changed, 'dorn');
    const meilin = heroId(changed, 'meilin');
    const base = plain(changed, bran).stats.atk;
    expect(towerUnit(changed, bran).stats.atk).toBe(Math.round(Math.round(base * 1.05) * 1.04));
    expect(towerUnit(changed, dorn).stats.atk).toBe(Math.round(plain(changed, dorn).stats.atk * 1.05));
    expect(towerUnit(changed, meilin).stats.atk).toBe(Math.round(plain(changed, meilin).stats.atk * 1.04));
  });

  it('applies HP and DEF links from actual completed quests without changing wounds or other stats', () => {
    const save = startWith(['iris', 'alan', 'bran']);
    expect(save.tavern?.quests).toEqual(expect.arrayContaining(['bq_iris', 'bq_alan']));
    const iris = heroId(save, 'iris');
    const alan = heroId(save, 'alan');
    const bran = heroId(save, 'bran');
    const run = save.tower.run!;
    const wounded: SaveState = { ...save, tower: { ...save.tower, run: { ...run, hp: { ...run.hp, [iris]: 555, [alan]: 420, [bran]: 730 } } } };
    const common = setSquad(wounded, [heroId(wounded, 'lira'), null, null, null, null]);
    const squad = towerRunSquad(common, ctx);
    expect(towerUnit(common, alan).stats).toEqual({
      ...plain(common, alan).stats,
      hp: Math.round(plain(common, alan).stats.hp * 1.04),
      def: Math.round(plain(common, alan).stats.def * 1.08),
    });
    expect(towerUnit(common, iris).stats.hp).toBe(Math.round(plain(common, iris).stats.hp * 1.04));
    expect(towerUnit(common, bran).stats.def).toBe(Math.round(plain(common, bran).stats.def * 1.08));
    expect(squad.hp).toEqual(common.tower.run!.hp);
  });

  it('counts real equipped/refined/card bonuses once before the learned ATK multiplier', () => {
    const save = checkpoint();
    const hero = save.heroes.find(h => h.id === 'h10')!;
    const raw = buildUnit(hero, ctx);
    const geared = plain(save, hero.id);
    expect(geared.stats.atk).toBeGreaterThan(raw.stats.atk);
    expect(save.inventory.items.some(item => item.equippedBy === hero.id)).toBe(true);
    expect(towerUnit(save, hero.id).stats).toEqual({ ...geared.stats, atk: Math.round(geared.stats.atk * 1.05) });
    expect(towerUnit(save, hero.id).skills).toEqual(geared.skills);
    expect(towerUnit(save, hero.id).skillPower).toBe(geared.skillPower);
  });

  it('matches permanent RPG assembly for the same party while keeping the Tower party separate', () => {
    const save = checkpoint();
    const sameParty = setSquad(save, save.tower.run!.squad);
    expect(towerRunSquad(save, ctx).squad).toEqual(squadUnits(sameParty, withGear(ctx, sameParty)).squad);
  });

  it('does not mutate a frozen save, resources, equipment, actor identities or HP fractions', () => {
    const save = frozen(checkpoint());
    const before = serialize(save);
    const first = towerRunSquad(save, ctx);
    expect(towerRunSquad(save, ctx)).toEqual(first);
    expect(serialize(save)).toBe(before);
    expect(first.squad.map(u => u?.id ?? null)).toEqual(save.tower.run!.squad);
    expect(first.hp).toEqual(save.tower.run!.hp);
  });

  it('passes the linked max HP and unchanged wound fractions into the actual deterministic floor battle', () => {
    let save = startWith(['alan', 'bran', 'iris', 'dorn', 'lira']);
    const alan = heroId(save, 'alan');
    const run = save.tower.run!;
    save = { ...save, tower: { ...save.tower, run: { ...run, hp: { ...run.hp, [alan]: 420 } } } };
    save = setSquad(save, [heroId(save, 'lira'), null, null, null, null]);
    const at = save.tower.run!.paths.findIndex(kind => kind === 'battle' || kind === 'elite' || kind === 'boss');
    expect(at).toBeGreaterThanOrEqual(0);
    save = chooseTowerPath(save, at, ctx);
    const before = serialize(save);
    const result = fightTowerFloor(save, DAY, ctx);
    expect(fightTowerFloor(save, DAY, ctx).result).toEqual(result.result);
    expect(serialize(save)).toBe(before);
    const unit = result.result.units.find(u => u.side === 'A' && u.unitId === alan)!;
    const maxHp = Math.round(plain(save, alan).stats.hp * 1.04);
    expect(unit.maxHp).toBe(maxHp);
    expect(unit.hp).toBe(Math.round(maxHp * 0.42));
  });
});
