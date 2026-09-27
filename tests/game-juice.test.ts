import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { barFrom, countUp, firstVisit, juiceOn, queueRewardFly, staggerIn, takeRewardFly } from '../src/game/juice';
import { motion, setReducedMotion } from '../src/game/state';

/** Сцена-заглушка: твины-счётчики только записываются (их onUpdate/onComplete вызывает тест). */
function fakeScene() {
  const counters: { from: number; to: number; delay?: number; duration?: number; onUpdate?: (t: { getValue(): number }) => void; onComplete?: () => void }[] = [];
  const scene = { tweens: { addCounter: (cfg: (typeof counters)[number]) => counters.push(cfg) } } as unknown as Phaser.Scene;
  return { scene, counters };
}

function fakeObj(y: number, alpha = 1) {
  const o = {
    scene: {},
    y,
    alpha,
    setAlpha(a: number) {
      o.alpha = a;
      return o;
    },
  };
  return o;
}

describe('juice: «сочность» меню и «Уменьшить анимацию»', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    setReducedMotion(false);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('настройка запоминается и выключает анимации', () => {
    setReducedMotion(true);
    expect(motion.reduced).toBe(true);
    expect(localStorage.getItem('chronoworld.reduceMotion')).toBe('1');
    expect(juiceOn()).toBe(false);
    setReducedMotion(false);
    expect(juiceOn()).toBe(true);
  });

  it('firstVisit: только первое открытие за сессию', () => {
    expect(firstVisit('t:screen')).toBe(true);
    expect(firstVisit('t:screen')).toBe(false);
  });

  it('полоса доезжает от прошлого значения; первый показ — от нуля; то же значение — без анимации', () => {
    expect(barFrom('t:bar', 0.4)).toBe(0);
    expect(barFrom('t:bar', 0.4)).toBeNull();
    expect(barFrom('t:bar', 0.7)).toBe(0.4);
    setReducedMotion(true);
    expect(barFrom('t:bar', 0.9)).toBeNull();
  });

  it('полёт награды достаётся только своему экрану и один раз', () => {
    queueRewardFly('Home', { x: 1, y: 2 }, { gold: 10, gems: 3 }, { burst: true });
    expect(takeRewardFly('Quests')).toBeNull();
    // Чужой экран забрал — отложенное сброшено (не «догонит» через несколько экранов).
    expect(takeRewardFly('Home')).toBeNull();
    queueRewardFly('Home', { x: 1, y: 2 }, { gold: 10, gems: 3 });
    expect(takeRewardFly('Home')).toMatchObject({ gold: 10, gems: 3, burst: false });
    expect(takeRewardFly('Home')).toBeNull();
  });

  it('staggerIn: строки выезжают за ≤ 250 мс и возвращаются на место; повторное открытие — без анимации', () => {
    const { scene, counters } = fakeScene();
    const rows = Array.from({ length: 8 }, (_, i) => [fakeObj(100 * i), fakeObj(100 * i + 10, 0.5)]);
    staggerIn(scene, 't:list', rows as unknown as Phaser.GameObjects.GameObject[][]);
    expect(counters).toHaveLength(8);
    for (const c of counters) expect((c.delay ?? 0) + (c.duration ?? 0)).toBeLessThanOrEqual(250);
    // До старта строки прозрачны и ниже своего места.
    expect(rows[3][0].alpha).toBe(0);
    expect(rows[3][0].y).toBeGreaterThan(300);
    for (const c of counters) c.onComplete?.();
    expect(rows[3][0]).toMatchObject({ y: 300, alpha: 1 });
    expect(rows[3][1]).toMatchObject({ y: 310, alpha: 0.5 });
    staggerIn(scene, 't:list', rows as unknown as Phaser.GameObjects.GameObject[][]);
    expect(counters).toHaveLength(8);
  });

  it('countUp: без анимации — сразу конечное значение', () => {
    const { scene, counters } = fakeScene();
    let shown = '';
    const t = { scene: {}, setText: (s: string) => ((shown = s), t) } as unknown as Phaser.GameObjects.Text;
    setReducedMotion(true);
    countUp(scene, t, 0, 12345);
    expect(shown).toBe('12 345');
    expect(counters).toHaveLength(0);
    setReducedMotion(false);
    countUp(scene, t, 0, 500);
    expect(shown).toBe('0');
    counters[0].onUpdate?.({ getValue: () => 250.4 });
    expect(shown).toBe('250');
    counters[0].onComplete?.();
    expect(shown).toBe('500');
  });
});
