import { describe, expect, it } from 'vitest';
import { Rng, calcDamage, calcHeal } from '../src/core';
import { cfg } from './helpers';

describe('Rng', () => {
  it('детерминирован по seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 10 }, () => a.next());
    expect(Array.from({ length: 10 }, () => b.next())).toEqual(seqA);
    expect(new Rng(43).next()).not.toBe(seqA[0]);
  });

  it('выдаёт числа в [0; 1)', () => {
    const r = new Rng(1);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('calcDamage', () => {
  it('ATK × k × 100 / (100 + DEF) × r, r ∈ [0.95; 1.05], вниз', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 1000; i++) {
      const dmg = calcDamage(100, 1, 100, rng, cfg);
      expect(dmg).toBeGreaterThanOrEqual(47);
      expect(dmg).toBeLessThanOrEqual(52);
      expect(Number.isInteger(dmg)).toBe(true);
    }
  });

  it('учитывает множитель навыка', () => {
    const d1 = calcDamage(100, 1, 0, new Rng(9), cfg);
    const d2 = calcDamage(100, 2.5, 0, new Rng(9), cfg);
    expect(Math.abs(d2 - d1 * 2.5)).toBeLessThanOrEqual(3);
  });

  it('минимум 1', () => {
    expect(calcDamage(1, 0.1, 10000, new Rng(1), cfg)).toBe(1);
  });
});

describe('calcHeal', () => {
  it('ATK × k вниз', () => {
    expect(calcHeal(70, 1.5)).toBe(105);
    expect(calcHeal(71, 1.5)).toBe(106);
  });
});
