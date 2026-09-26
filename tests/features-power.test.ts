import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildUnit, enemySquad, heroPower, newGame, squadPower, stagePower, unitPower, withFeatures, type UnitDef } from '../src/core';
import { loadGameContext } from '../scripts/lib/content-node';

const root = join(import.meta.dirname, '..');
const read = (f: string) => JSON.parse(readFileSync(join(root, f), 'utf8'));
const ctx = withFeatures(loadGameContext(), read('data/progression.json'), read('data/quests.json'));

const unit = (patch: Partial<UnitDef> = {}): UnitDef => ({
  id: 'u',
  name: 'u',
  kind: 'hero',
  role: 'damage',
  stats: { hp: 1000, atk: 100, def: 20, spd: 100 },
  skills: { basic: 'b', passives: [] },
  visual: { sprite: 'x' },
  ...patch,
});

describe('K2 мощь', () => {
  it('unitPower по формуле из data/progression.json → power', () => {
    const k = ctx.features.power;
    const base = unit();
    expect(unitPower(base, ctx)).toBe(Math.round(1000 * k.hp + 100 * k.atk + 20 * k.def + 100 * k.spd));
    const skilled = unit({ skills: { basic: 'b', ult: 'u', passives: ['p1', 'p2'] } });
    expect(unitPower(skilled, ctx)).toBe(Math.round(unitPower(base, ctx) + k.perActive + 2 * k.perPassive));
    expect(Number.isInteger(unitPower(unit({ stats: { hp: 333, atk: 7, def: 3, spd: 91 } }), ctx))).toBe(true);
  });

  it('мощь растёт со статами', () => {
    expect(unitPower(unit({ stats: { hp: 2000, atk: 100, def: 20, spd: 100 } }), ctx)).toBeGreaterThan(unitPower(unit(), ctx));
  });

  it('heroPower = unitPower(buildUnit); растёт с джоб-уровнем', () => {
    const s = newGame(ctx, 0);
    const h = s.heroes[0];
    expect(heroPower(h, ctx)).toBe(unitPower(buildUnit(h, ctx), ctx));
    expect(heroPower({ ...h, jobLevel: 10 }, ctx)).toBeGreaterThan(heroPower(h, ctx));
  });

  it('squadPower — сумма героев в слотах, пустые слоты не считаются', () => {
    const s = newGame(ctx, 0);
    const byId = (id: string) => heroPower(s.heroes.find((h) => h.id === id)!, ctx);
    expect(squadPower(s, ctx)).toBe(s.squad.reduce((sum, id) => sum + (id ? byId(id) : 0), 0));
    const partial = { ...s, squad: [s.heroes[0].id, null, null, null, null] };
    expect(squadPower(partial, ctx)).toBe(byId(s.heroes[0].id));
    expect(squadPower({ ...s, squad: [null, null, null, null, null] }, ctx)).toBe(0);
  });

  it('stagePower — сумма врагов с ростом по кампании', () => {
    const [a, b] = ctx.content.stages;
    expect(stagePower(a.id, ctx)).toBe(enemySquad(a.id, ctx).reduce((sum, u) => sum + (u ? unitPower(u, ctx) : 0), 0));
    expect(stagePower(a.id, ctx)).toBeGreaterThan(0);
    expect(stagePower(b.id, ctx)).toBeGreaterThan(0);
    expect(stagePower(a.id, ctx)).toBe(stagePower(a.id, ctx));
  });
});
