import { describe, expect, it } from 'vitest';
import { orderActives, simulateBattle, type BattleEvent, type SkillDef } from '../src/core';
import { cfg, content, skill, unitDef } from './helpers';

type Ev<T extends BattleEvent['type']> = Extract<BattleEvent, { type: T }>;
const of = <T extends BattleEvent['type']>(log: BattleEvent[], type: T) => log.filter((e): e is Ev<T> => e.type === type);

/** Живучий манекен: стоит и бьёт слабо. */
const dummy = unitDef('dummy', {}, { hp: 1_000_000, atk: 1, spd: 100 });

describe('активные навыки: перезарядка, приоритет, каст', () => {
  const c = content(
    [unitDef('sw', { skills: { basic: 'shot', actives: ['bash', 'magnum', 'provoke'], passives: [] } }, { hp: 1_000_000, spd: 100 }), dummy],
    [
      skill('bash', { cooldown: 5 }),
      skill('magnum', { cooldown: 15 }),
      skill('provoke', { cooldown: 10 }),
    ],
  );

  it('без приоритета — открытый позже раньше; priority переопределяет', () => {
    const s = (id: string, priority = 0) => ({ id, priority }) as SkillDef;
    expect(orderActives([s('a'), s('b'), s('c')]).map((x) => x.id)).toEqual(['c', 'b', 'a']);
    expect(orderActives([s('a', 5), s('b'), s('c')]).map((x) => x.id)).toEqual(['a', 'c', 'b']);
  });

  it('готовый навык важнее обычной атаки, каждый — не чаще своей перезарядки', () => {
    const r = simulateBattle(c, ['sw'], ['dummy'], 1);
    const mine = of(r.log, 'attack').filter((e) => e.unit === 'A0');
    // Первые три хода — навыки по приоритету: провокация, магнум, баш.
    expect(mine.slice(0, 3).map((e) => e.skill)).toEqual(['provoke', 'magnum', 'bash']);
    expect(mine[0].name).toBe('provoke');
    expect(mine[0].cooldown).toBe(10);
    for (const [id, cd] of [['bash', 5], ['magnum', 15], ['provoke', 10]] as const) {
      const ts = mine.filter((e) => e.skill === id).map((e) => e.t);
      expect(ts.length).toBeGreaterThan(1);
      for (let i = 1; i < ts.length; i++) expect(ts[i] - ts[i - 1]).toBeGreaterThanOrEqual(cd - 1e-6);
    }
    // В промежутках — обычная атака.
    expect(mine.some((e) => e.skill === 'shot')).toBe(true);
    expect(r.report.A0.skills).toBe(mine.filter((e) => e.skill !== 'shot').length);
  });

  it('навык без перезарядки с кастом: кастует, бьёт, снова кастует — обычной атаки нет', () => {
    const c2 = content(
      [unitDef('wiz', { skills: { basic: 'shot', actives: ['bolt'], passives: [] } }, { hp: 1_000_000 }), dummy],
      [skill('bolt', { cooldown: 0, castTime: 2 })],
    );
    const r = simulateBattle(c2, ['wiz'], ['dummy'], 1);
    const casts = of(r.log, 'cast').filter((e) => e.unit === 'A0' && e.action === 'start');
    const hits = of(r.log, 'attack').filter((e) => e.unit === 'A0');
    expect(hits.every((e) => e.skill === 'bolt')).toBe(true);
    expect(casts.length).toBeGreaterThan(10);
    // Удар — ровно через castTime после начала каста.
    for (let i = 0; i < hits.length; i++) expect(hits[i].t - casts[i].t).toBeCloseTo(2, 5);
  });

  it('оглушение сбивает каст', () => {
    const c3 = content(
      [
        unitDef('wiz', { skills: { basic: 'shot', actives: ['bolt'], passives: [] } }, { hp: 1_000_000, spd: 100 }),
        unitDef('stunner', { skills: { basic: 'shot', actives: ['stun'], passives: [] } }, { hp: 1_000_000, atk: 1, spd: 300 }),
      ],
      [
        skill('bolt', { cooldown: 0, castTime: 5 }),
        skill('stun', { cooldown: 3, effects: [{ type: 'status', status: { id: 'st', name: 'Оглушение', turns: 1, stun: true } }] }),
      ],
    );
    const r = simulateBattle(c3, ['wiz'], ['stunner'], 1);
    expect(of(r.log, 'cast').some((e) => e.unit === 'A0' && e.action === 'interrupt')).toBe(true);
  });

  it('лечение с onlyWounded ждёт раненых — до тех пор юнит бьёт обычной атакой', () => {
    const c4 = content(
      [unitDef('pr', { skills: { basic: 'shot', actives: ['heal'], passives: [] } }, { hp: 1_000_000, atk: 1 }), dummy],
      [skill('heal', { cooldown: 3, target: { side: 'ally', pick: 'lowestHp', onlyWounded: true, includeSelf: true }, effects: [{ type: 'heal', k: 1 }] })],
    );
    const r = simulateBattle(c4, ['pr'], ['dummy'], 1);
    const mine = of(r.log, 'attack').filter((e) => e.unit === 'A0');
    const firstHeal = mine.findIndex((e) => e.skill === 'heal');
    const firstDmg = of(r.log, 'damage').find((e) => e.target === 'A0')!;
    expect(firstHeal).toBeGreaterThanOrEqual(0);
    expect(mine[firstHeal].t).toBeGreaterThanOrEqual(firstDmg.t);
    expect(mine.slice(0, firstHeal).every((e) => e.skill === 'shot')).toBe(true);
  });

  it('ближний навык по площади бьёт всех по селектору, а не только цель сражения', () => {
    const c5 = content(
      [unitDef('sw', { skills: { basic: 'hit', actives: ['magnum'], passives: [] } }, { hp: 1_000_000 }), dummy],
      [skill('magnum', { range: 'melee', cooldown: 5, target: { side: 'enemy', pick: 'all' } })],
    );
    // Радиус задевания снят: здесь проверяется только выбор по селектору (радиус — tests/battle-qa.test.ts, T2-07).
    const wide = { ...cfg, movement: { ...cfg.movement, meleeAoeRadius: 10_000 } };
    const r = simulateBattle(c5, ['sw'], ['dummy', 'dummy'], 1, { combat: wide });
    const m = of(r.log, 'attack').find((e) => e.unit === 'A0' && e.skill === 'magnum')!;
    expect(m.targets).toHaveLength(2);
  });

  it('детерминизм', () => {
    expect(simulateBattle(c, ['sw'], ['dummy'], 5).log).toEqual(simulateBattle(c, ['sw'], ['dummy'], 5).log);
  });
});
