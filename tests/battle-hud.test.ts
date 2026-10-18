import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { GameObjects: { Events: { DESTROY: 'destroy' } }, BlendModes: { ADD: 1 } } }));

const { CELL, PANEL_TOP, PANEL_Y, RING_R, RING_STEPS, cellXs, hpTone, ringStep } = await import('../src/game/battlePanel');
const { GAME_H, GAME_W } = await import('../src/game/layout');
const { COLOR_N } = await import('../src/game/theme');

/** Итерация 5 полировки: боевой HUD — медальоны героев внизу, компактная верхняя полоса, без уровней рядовых врагов. */
describe('бой: панель героев', () => {
  it('пять медальонов помещаются в ширину поля с полями', () => {
    const xs = cellXs(5);
    expect(xs).toHaveLength(5);
    expect(xs[0] - RING_R).toBeGreaterThan(24);
    expect(xs[4] + RING_R).toBeLessThan(GAME_W - 24);
    expect(xs[1] - xs[0]).toBe(CELL);
    // По центру: средний медальон — посередине.
    expect(xs[2]).toBe(GAME_W / 2);
  });

  it('панель у нижнего края 9:16 и целиком на поле', () => {
    expect(PANEL_Y).toBeGreaterThan(GAME_H * 0.85);
    expect(PANEL_TOP).toBeLessThan(PANEL_Y);
    expect(PANEL_Y + RING_R + 40).toBeLessThanOrEqual(GAME_H);
  });

  it('кольцо ульты: шаги, полное — только при 1', () => {
    expect(ringStep(0)).toBe(0);
    expect(ringStep(-1)).toBe(0);
    expect(ringStep(0.999)).toBe(RING_STEPS - 1);
    expect(ringStep(1)).toBe(RING_STEPS);
    expect(ringStep(5)).toBe(RING_STEPS);
    expect(ringStep(0.5)).toBe(RING_STEPS / 2);
  });

  it('цвет полоски HP: зелёный → жёлтый → красный', () => {
    expect(hpTone(1)).toBe(COLOR_N.positive);
    expect(hpTone(0.4)).toBe(COLOR_N.warning);
    expect(hpTone(0.1)).toBe(COLOR_N.negative);
  });
});
