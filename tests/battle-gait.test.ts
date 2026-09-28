import { describe, expect, it } from 'vitest';
import { gaitReset, gaitStep, type GaitState } from '../src/game/battleGait';

const fresh = (x = 0, y = 0): GaitState => ({ lastX: x, lastY: y, vx: 0, vy: 0, walking: false });

/** Прогнать n кадров по 16 мс со скоростью (px/мс) и видом шага; вернуть последнее направление. */
function run(g: GaitState, n: number, vx: number, vy: number, move: 'walk' | 'dash' | null) {
  let dir: ReturnType<typeof gaitStep> = null;
  for (let i = 0; i < n; i++) dir = gaitStep(g, g.lastX + vx * 16, g.lastY + vy * 16, 16, move);
  return dir;
}

describe('походка бойца (без лунной походки)', () => {
  it('свой шаг вперёд — ходьба лицом по ходу (A вправо, B влево)', () => {
    const a = fresh();
    expect(run(a, 20, 0.32, 0, 'walk')).toBe(1);
    expect(a.walking).toBe(true);
    const b = fresh();
    expect(run(b, 20, -0.32, 0, 'walk')).toBe(-1);
    expect(b.walking).toBe(true);
  });

  it('свой шаг назад — лицом назад, а не спиной вперёд', () => {
    const a = fresh();
    expect(run(a, 20, -0.32, 0, 'walk')).toBe(-1);
  });

  it('сдвиг разведением без своего шага — не ходьба, лицом к врагу', () => {
    const g = fresh();
    expect(run(g, 20, -0.5, 0, null)).toBeNull();
    expect(g.walking).toBe(false);
  });

  it('шаг, который разведение гасит (фигура стоит), — не ходьба', () => {
    const g = fresh();
    expect(run(g, 20, 0, 0, 'walk')).toBeNull();
    expect(g.walking).toBe(false);
  });

  it('рывок — лицом по ходу, но без анимации ходьбы', () => {
    const g = fresh();
    expect(run(g, 6, -1.5, 0, 'dash')).toBe(-1);
    expect(g.walking).toBe(false);
  });

  it('почти вертикальный шаг — ходьба, направление по x не навязывается', () => {
    const g = fresh();
    expect(run(g, 20, 0.01, 0.3, 'walk')).toBe(0);
    expect(g.walking).toBe(true);
  });

  it('гистерезис: замедление чуть ниже порога старта не обрывает ходьбу, остановка — обрывает', () => {
    const g = fresh();
    run(g, 20, 0.32, 0, 'walk');
    run(g, 30, 0.07, 0, 'walk');
    expect(g.walking).toBe(true);
    run(g, 30, 0, 0, 'walk');
    expect(g.walking).toBe(false);
  });

  it('сброс после «Пропустить» — скорость нулевая', () => {
    const g = fresh();
    run(g, 20, 0.32, 0, 'walk');
    gaitReset(g, 500, 900);
    expect(gaitStep(g, 500, 900, 16, 'walk')).toBeNull();
  });
});
