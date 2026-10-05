import { describe, expect, it } from 'vitest';
import { loadFullContext } from '../scripts/lib/content-node';
import { enemySquad, recommendedPower, stagePower } from '../src/core';

const ctx = loadFullContext();

describe('порядок знакомства и честный ориентир кампании', () => {
  it('Ива встречается раньше Попоринга в фактическом порядке первой главы', () => {
    const chapter = ctx.content.stages.filter(s => s.chapter === 'chapter1');
    const willow = chapter.findIndex(s => s.enemies.some(e => e?.unit === 'mob_tank'));
    const poporing = chapter.findIndex(s => s.enemies.some(e => e?.unit === 'mob_poporing'));
    expect(willow).toBeGreaterThanOrEqual(0);
    expect(poporing).toBeGreaterThan(willow);
  });

  it('ориентир 26k у сложной встречи не усиливает её врагов и не поднимает соседнюю', () => {
    const old = { ...ctx, features: { ...ctx.features, power: { ...ctx.features.power,
      recommendedStages: { ...ctx.features.power.recommendedStages, ch9_s10: 0.3593 } } } };
    expect(recommendedPower('ch9_s10', ctx)).toBe(26000);
    expect(recommendedPower('ch9_s11', ctx)).toBe(18700);
    expect(stagePower('ch9_s10', ctx)).toBe(stagePower('ch9_s10', old));
    expect(enemySquad('ch9_s10', ctx)).toEqual(enemySquad('ch9_s10', old));
  });
});
