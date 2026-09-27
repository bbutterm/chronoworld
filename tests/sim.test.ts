import { describe, expect, it } from 'vitest';
import { parseSquad, runSeries } from '../src/core';
import { loadContent } from '../scripts/lib/content-node';

const GAME = loadContent();
const SQUAD = parseSquad('guard,warrior,archer,mage,priest');

describe('симулятор', () => {
  it('parseSquad: пустые слоты и добивка до 5', () => {
    expect(parseSquad('guard,-,mage')).toEqual(['guard', null, 'mage', null, null]);
    expect(() => parseSquad('a,b,c,d,e,f')).toThrow();
  });

  it('1000 боёв быстрее 2 секунд', () => {
    const started = performance.now();
    expect(runSeries(GAME, SQUAD, SQUAD, 1000).n).toBe(1000);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('результаты серии воспроизводимы', () => {
    expect(runSeries(GAME, SQUAD, SQUAD, 50, 1)).toEqual(runSeries(GAME, SQUAD, SQUAD, 50, 1));
  });
});
