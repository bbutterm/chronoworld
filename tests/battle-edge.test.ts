import { describe, expect, it } from 'vitest';
import { simulateBattle, slotPosition, type BattleEvent, type BattleResult, type CombatConfig, type Content, type Squad } from '../src/core';
import { loadContent } from '../scripts/lib/content-node';
import { cfg, content, skill, unitDef } from './helpers';

const GAME = loadContent();
const MELEE = ['guard', 'warrior', 'assassin', 'guard', 'warrior'];
const RANGED = ['archer', 'mage', 'priest', 'archer', 'mage'];
const SQUAD = ['guard', 'warrior', 'archer', 'mage', 'priest'];

const of = <T extends BattleEvent['type']>(log: BattleEvent[], type: T) =>
  log.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);

/** Общие инварианты любого боя: конец один и последний, мёртвые молчат, числа конечные. */
function checkInvariants(r: BattleResult): void {
  const ends = of(r.log, 'end');
  expect(ends).toHaveLength(1);
  expect(r.log[r.log.length - 1]).toBe(ends[0]);
  expect(r.duration).toBeLessThanOrEqual(cfg.timeLimitSeconds);
  const dead = new Set<string>();
  let lastT = 0;
  for (const e of r.log) {
    expect(e.t).toBeGreaterThanOrEqual(lastT);
    lastT = e.t;
    if (e.type === 'death') {
      expect(dead.has(e.unit)).toBe(false);
      dead.add(e.unit);
    }
    if (e.type === 'turn' || e.type === 'move' || e.type === 'attack' || e.type === 'ult') expect(dead.has(e.unit)).toBe(false);
    if (e.type === 'damage' || e.type === 'heal') expect(dead.has(e.target)).toBe(false);
    if (e.type === 'damage') {
      expect(Number.isFinite(e.amount)).toBe(true);
      expect(Number.isFinite(e.hp)).toBe(true);
    }
    if (e.type === 'move') {
      expect(Number.isFinite(e.duration)).toBe(true);
      expect(e.to.every(Number.isFinite)).toBe(true);
    }
  }
  if (r.reason === 'wipe') {
    const loser = r.winner === 'A' ? 'B' : 'A';
    for (const u of r.units) if (u.side === loser) expect(r.report[u.uid].alive).toBe(false);
    const winners = r.units.filter((u) => u.side === r.winner);
    if (winners.length > 0) expect(winners.some((u) => r.report[u.uid].alive)).toBe(true);
  }
}

function run(c: Content, a: Squad, b: Squad, seed: number, combat?: CombatConfig): BattleResult {
  const r = simulateBattle(c, a, b, seed, { combat });
  checkInvariants(r);
  // Детерминизм сохраняется и в крайних случаях.
  expect(simulateBattle(c, a, b, seed, { combat }).log).toEqual(r.log);
  return r;
}

describe('крайние случаи боя', () => {
  it('одни ближние против одних дальних: ближние доходят и бьют, бой заканчивается', () => {
    for (let seed = 1; seed <= 10; seed++) {
      for (const [a, b] of [
        [MELEE, RANGED],
        [RANGED, MELEE],
      ]) {
        const r = run(GAME, a, b, seed);
        const meleeSide = a === MELEE ? 'A' : 'B';
        const meleeHits = of(r.log, 'attack').filter((e) => e.unit.startsWith(meleeSide) && e.kind === 'melee');
        expect(meleeHits.length).toBeGreaterThan(0);
      }
    }
  });

  it('1 против 5 и 5 против 1', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const r1 = run(GAME, ['warrior'], SQUAD, seed);
      expect(r1).toMatchObject({ winner: 'B', reason: 'wipe' });
      const r2 = run(GAME, SQUAD, [null, null, null, null, 'warrior'], seed);
      expect(r2).toMatchObject({ winner: 'A', reason: 'wipe' });
    }
  });

  it('пустые слоты посередине отряда', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const r = run(GAME, ['guard', null, 'archer', null, 'priest'], [null, 'warrior', null, 'mage', null], seed);
      expect(r.units.map((u) => u.uid).sort()).toEqual(['A0', 'A2', 'A4', 'B1', 'B3']);
    }
  });

  it('пустая сторона — бой сразу заканчивается без ошибок', () => {
    expect(run(GAME, [null, null, null, null, null], SQUAD, 1)).toMatchObject({ winner: 'B', reason: 'wipe', duration: 0 });
    expect(run(GAME, SQUAD, [], 1)).toMatchObject({ winner: 'A', reason: 'wipe', duration: 0 });
    expect(run(GAME, [], [], 1)).toMatchObject({ winner: 'B', reason: 'wipe', duration: 0 });
  });

  it('последние бойцы обеих сторон под смертельным DoT: бой кончается на первой смерти', () => {
    const poison = { id: 'poison', name: 'Яд', turns: 5, dot: { k: 10 } };
    const c = content(
      [unitDef('toxic', { skills: { basic: 'venom', passives: [] } }, { hp: 500, atk: 100 })],
      [skill('venom', { effects: [{ type: 'status', status: poison }] })],
    );
    const winners = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const r = run(c, ['toxic'], ['toxic'], seed);
      expect(r.reason).toBe('wipe');
      const deaths = of(r.log, 'death');
      expect(deaths).toHaveLength(1);
      expect(deaths[0].killer).toBeNull();
      const dotHit = of(r.log, 'damage').find((e) => e.target === deaths[0].unit && e.hp === 0);
      expect(dotHit?.dot).toBe(true);
      expect(r.winner).not.toBe(deaths[0].unit[0]);
      winners.add(r.winner);
    }
    // Кто умрёт первым, решает seed — ни одна сторона не в привилегии.
    expect(winners).toEqual(new Set(['A', 'B']));
  });

  it('DoT от уже погибшего наложившего продолжает тикать', () => {
    const poison = { id: 'poison', name: 'Яд', turns: 10, dot: { k: 3 } };
    const c = content(
      [
        unitDef('toxic', { skills: { basic: 'venom', passives: [] } }, { hp: 100, atk: 100, spd: 200 }),
        unitDef('brute', { skills: { basic: 'shot', passives: [] } }, { hp: 1000, atk: 200 }),
      ],
      [skill('venom', { effects: [{ type: 'status', status: poison }] })],
    );
    const r = run(c, ['toxic', 'brute'], ['brute'], 3);
    const toxicDeath = of(r.log, 'death').find((e) => e.unit === 'A0');
    expect(toxicDeath).toBeDefined();
    const later = of(r.log, 'damage').filter((e) => e.t > toxicDeath!.t && e.source === 'A0' && e.dot);
    expect(later.length).toBeGreaterThan(0);
  });

  it('юниты с ATK 0 не ломают бой: минимальный урон, лечение 0', () => {
    const c = content(
      [
        unitDef('weak', { skills: { basic: 'shot', passives: [] } }, { hp: 50, atk: 0 }),
        unitDef('healer', { skills: { basic: 'mend', passives: [] } }, { hp: 50, atk: 0 }),
        unitDef('weakmelee', { skills: { basic: 'hit', passives: [] } }, { hp: 50, atk: 0 }),
      ],
      [skill('mend', { target: { side: 'ally', pick: 'lowestHp', includeSelf: true }, effects: [{ type: 'heal', k: 1 }] })],
    );
    // Минимум формулы отдельно от последующего множителя ярости долгого боя.
    const r = run(c, ['weak', 'healer', 'weakmelee'], ['weak', 'weakmelee'], 1, { ...cfg, enrage: undefined });
    for (const e of of(r.log, 'damage')) expect(e.amount).toBe(cfg.damage.minDamage);
    for (const e of of(r.log, 'heal')) expect(e.amount).toBe(0);
    expect(of(r.log, 'damage').length).toBeGreaterThan(0);
  });
});

describe('ближний боец не застревает', () => {
  // Почти стоячий боец (0.5 ед. за тик) не может дойти до цели.
  const c = content([
    unitDef('snail', { skills: { basic: 'hit', passives: [] } }, { hp: 100_000, atk: 1, moveSpeed: 5 }),
    unitDef('dummy', { skills: { basic: 'shot', passives: [] } }, { hp: 100_000, atk: 1 }),
  ]);
  const b0 = slotPosition('B', 0);
  const b1 = slotPosition('B', 1);
  const near = (p: [number, number], q: { x: number; y: number }) => Math.hypot(p[0] - q.x, p[1] - q.y) <= cfg.movement.meleeRange + 1;

  it(`через retargetSeconds (${cfg.movement.retargetSeconds} с) берёт ближайшего другого врага`, () => {
    const r = run(c, ['snail'], ['dummy', 'dummy'], 1);
    const moves = of(r.log, 'move').filter((e) => e.unit === 'A0');
    expect(near(moves[0].to, b0)).toBe(true);
    const switched = moves.find((e) => near(e.to, b1) && !near(e.to, b0));
    expect(switched).toBeDefined();
    expect(switched!.t).toBeGreaterThanOrEqual(cfg.movement.retargetSeconds);
  });

  it('порог берётся из конфига', () => {
    const combat: CombatConfig = { ...cfg, timeLimitSeconds: 20, movement: { ...cfg.movement, retargetSeconds: 1000 } };
    const r = run(c, ['snail'], ['dummy', 'dummy'], 1, combat);
    const moves = of(r.log, 'move').filter((e) => e.unit === 'A0');
    expect(moves.every((e) => near(e.to, b0))).toBe(true);
  });

  it('если других врагов нет — продолжает идти к своей цели', () => {
    const r = run(c, ['snail'], ['dummy'], 1, { ...cfg, timeLimitSeconds: 20 });
    const moves = of(r.log, 'move').filter((e) => e.unit === 'A0');
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((e) => near(e.to, b0))).toBe(true);
  });

  it('в штатных боях героев переключение не срабатывает (лог как без него)', () => {
    const off: CombatConfig = { ...cfg, movement: { ...cfg.movement, retargetSeconds: 1e9 } };
    for (let seed = 1; seed <= 20; seed++) {
      for (const [a, b] of [
        [SQUAD, SQUAD],
        [MELEE, RANGED],
        [MELEE, MELEE],
      ]) {
        expect(simulateBattle(GAME, a, b, seed).log).toEqual(simulateBattle(GAME, a, b, seed, { combat: off }).log);
      }
    }
  });
});
