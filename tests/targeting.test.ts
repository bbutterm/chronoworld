import { describe, expect, it } from 'vitest';
import { Rng, TargetSchema, selectTargets } from '../src/core';
import { cfg, unit } from './helpers';

const T = (t: Record<string, unknown>) => TargetSchema.parse(t);
const rng = () => new Rng(1);

// Враги: фронт — слоты 0,1; тыл — 2,3,4.
const enemies = () => [
  unit('B', 0, 690, 1125),
  unit('B', 1, 690, 1535),
  unit('B', 2, 930, 920),
  unit('B', 3, 930, 1330),
  unit('B', 4, 930, 1740),
];

describe('selectTargets', () => {
  it('nearest по реальному расстоянию', () => {
    const me = unit('A', 1, 390, 1535);
    expect(selectTargets(me, T({ side: 'enemy', pick: 'nearest', row: 'front' }), [], enemies(), rng(), cfg).map((u) => u.uid)).toEqual(['B1']);
    const top = unit('A', 2, 150, 920);
    expect(selectTargets(top, T({ side: 'enemy', pick: 'nearest', row: 'front' }), [], enemies(), rng(), cfg)[0].uid).toBe('B0');
  });

  it('ряд пуст — берём другой ряд (rowFallback), иначе никого', () => {
    const e = enemies();
    e[0].alive = false;
    e[1].alive = false;
    const me = unit('A', 0, 390, 1125);
    // B2 и B3 на одном расстоянии — меньший слот
    expect(selectTargets(me, T({ side: 'enemy', pick: 'nearest', row: 'front' }), [], e, rng(), cfg)[0].uid).toBe('B2');
    expect(selectTargets(me, T({ side: 'enemy', pick: 'nearest', row: 'front', rowFallback: false }), [], e, rng(), cfg)).toEqual([]);
  });

  it('lowestHp и lowestHpPct, равенство — меньший слот', () => {
    const e = enemies();
    e[3].hp = 100;
    e[4].hp = 100;
    const me = unit('A', 0, 390, 1125);
    expect(selectTargets(me, T({ side: 'enemy', pick: 'lowestHp' }), [], e, rng(), cfg)[0].uid).toBe('B3');
    const allies = [unit('A', 0, 0, 0, { hp: 900, maxHp: 1800 }), unit('A', 1, 0, 0, { hp: 400, maxHp: 1000 })];
    expect(selectTargets(allies[0], T({ side: 'ally', pick: 'lowestHpPct', includeSelf: true }), allies, [], rng(), cfg)[0].uid).toBe('A1');
  });

  it('onlyWounded: никого раненых — пустой список', () => {
    const allies = [unit('A', 0, 0, 0), unit('A', 1, 0, 0)];
    expect(selectTargets(allies[0], T({ side: 'ally', pick: 'lowestHpPct', includeSelf: true, onlyWounded: true }), allies, [], rng(), cfg)).toEqual([]);
  });

  it('союзники: без includeSelf себя не берём; nearest count 2 с собой = я + ближайший', () => {
    const allies = [unit('A', 0, 390, 1125), unit('A', 1, 390, 1535), unit('A', 2, 150, 920)];
    expect(selectTargets(allies[0], T({ side: 'ally', pick: 'all' }), allies, [], rng(), cfg).map((u) => u.uid)).toEqual(['A1', 'A2']);
    expect(selectTargets(allies[0], T({ side: 'ally', pick: 'nearest', count: 2, includeSelf: true }), allies, [], rng(), cfg).map((u) => u.uid)).toEqual(['A0', 'A2']);
  });

  it('random — только живые, без повторов, по seed', () => {
    const e = enemies();
    e[0].alive = false;
    const t = T({ side: 'enemy', pick: 'random', count: 3 });
    const a = selectTargets(unit('A', 0, 0, 0), t, [], e, new Rng(5), cfg).map((u) => u.uid);
    const b = selectTargets(unit('A', 0, 0, 0), t, [], e, new Rng(5), cfg).map((u) => u.uid);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
    expect(a).not.toContain('B0');
  });

  it('self', () => {
    const me = unit('A', 0, 0, 0);
    expect(selectTargets(me, T({ side: 'ally', pick: 'self' }), [me], [], rng(), cfg)).toEqual([me]);
  });
});
