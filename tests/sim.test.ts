import { describe, expect, it } from 'vitest';
import { parseSquad, runSeries, swapCheck } from '../src/core';

const SQUAD = parseSquad('guard,warrior,archer,mage,priest');

describe('симулятор', () => {
  it('parseSquad: пустые слоты и добивка до 5', () => {
    expect(parseSquad('guard,-,mage')).toEqual(['guard', null, 'mage', null, null]);
    expect(() => parseSquad('a,b,c,d,e,f')).toThrow();
  });

  it('1000 боёв быстрее 2 секунд', () => {
    const started = performance.now();
    const r = runSeries(SQUAD, SQUAD, 1000);
    const ms = performance.now() - started;
    expect(r.n).toBe(1000);
    expect(ms).toBeLessThan(2000);
  });

  it('результаты серии воспроизводимы', () => {
    expect(runSeries(SQUAD, SQUAD, 50, 1)).toEqual(runSeries(SQUAD, SQUAD, 50, 1));
  });

  it('зеркальный бой длится в пределах 20–45 секунд', () => {
    const r = runSeries(SQUAD, SQUAD, 300);
    expect(r.avgDuration).toBeGreaterThanOrEqual(20);
    expect(r.avgDuration).toBeLessThanOrEqual(45);
  });

  it('ни одна замена героя в зеркальном отряде не даёт винрейт выше 65%', () => {
    const worst = swapCheck(SQUAD, 300).reduce((m, r) => Math.max(m, r.winRate), 0);
    expect(worst).toBeLessThanOrEqual(0.65);
  }, 60_000);
});
