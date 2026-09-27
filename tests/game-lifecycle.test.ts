import { describe, expect, it } from 'vitest';
import { AppLifecycle, clampDelta, limitRate, MAX_FRAME_MS, type LoopLike } from '../src/game/lifecycle';
import { SheetLru, textureBytes } from '../src/game/spriteCache';

const MB = 1048576;

describe('SheetLru (U: кэш листов юнитов)', () => {
  it('выгружает самые давние сверх бюджета', () => {
    const lru = new SheetLru(20 * MB);
    lru.add('a', 8 * MB);
    lru.add('b', 8 * MB);
    lru.add('c', 8 * MB);
    expect(lru.trim()).toEqual(['a']);
    expect(lru.ids()).toEqual(['b', 'c']);
    expect(lru.bytes).toBe(16 * MB);
  });

  it('использованный лист становится свежим', () => {
    const lru = new SheetLru(20 * MB);
    lru.add('a', 8 * MB);
    lru.add('b', 8 * MB);
    lru.touch('a');
    lru.add('c', 8 * MB);
    expect(lru.trim()).toEqual(['b']);
  });

  it('удерживаемые сценой не выгружаются, даже сверх бюджета', () => {
    const lru = new SheetLru(10 * MB);
    for (const id of ['a', 'b', 'c']) {
      lru.add(id, 8 * MB);
      lru.hold(id);
    }
    expect(lru.trim()).toEqual([]);
    lru.release('a');
    lru.release('b');
    expect(lru.trim()).toEqual(['a', 'b']);
    expect(lru.ids()).toEqual(['c']);
  });

  it('удержания считаются (две сцены держат один лист)', () => {
    const lru = new SheetLru(0);
    lru.add('a', MB);
    lru.hold('a');
    lru.hold('a');
    lru.release('a');
    expect(lru.trim()).toEqual([]);
    lru.release('a');
    expect(lru.trim()).toEqual(['a']);
  });

  it('размер текстуры — w×h×4', () => {
    expect(textureBytes(1792, 1152) / MB).toBeCloseTo(7.875);
  });
});

function fakeLoop(): LoopLike & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    running: true,
    fpsLimit: 0,
    hasFpsLimit: false,
    _limitRate: 0,
    sleep() {
      log.push('sleep');
      this.running = false;
    },
    wake() {
      log.push('wake');
      this.running = true;
    },
    resetDelta() {
      log.push('reset');
    },
  };
}

describe('AppLifecycle (U: пауза и FPS)', () => {
  it('спит, пока есть хоть одна причина, и просыпается с обнулённым отсчётом', () => {
    const loop = fakeLoop();
    const app = new AppLifecycle(loop);
    app.pause('hidden');
    app.pause('blur');
    expect(loop.log).toEqual(['sleep']);
    app.resume('hidden');
    expect(app.paused).toBe(true);
    expect(loop.running).toBe(false);
    app.resume('blur');
    // Сначала сброс дельты, потом пробуждение — первый кадр после паузы не получает всё время сна.
    expect(loop.log).toEqual(['sleep', 'reset', 'wake']);
    expect(app.paused).toBe(false);
  });

  it('лишний resume ничего не будит', () => {
    const loop = fakeLoop();
    new AppLifecycle(loop).resume('hidden');
    expect(loop.log).toEqual([]);
  });

  it('30 FPS — ограничитель с допуском на дрожание кадров; 60 — без ограничителя', () => {
    const loop = fakeLoop();
    const app = new AppLifecycle(loop);
    app.setFpsCap(30);
    expect(loop.hasFpsLimit).toBe(true);
    expect(loop.fpsLimit).toBe(30);
    expect(loop._limitRate).toBeCloseTo(limitRate(30));
    // На экране 60 Гц два кадра (33.3 мс) должны проходить ограничитель.
    expect(2 * (1000 / 60)).toBeGreaterThanOrEqual(loop._limitRate);
    expect(1000 / 60).toBeLessThan(loop._limitRate);
    // Цикл перезапущен — Phaser выбирает функцию шага при запуске.
    expect(loop.log).toEqual(['sleep', 'reset', 'wake']);
    app.setFpsCap(60);
    expect(loop.hasFpsLimit).toBe(false);
    expect(loop._limitRate).toBe(0);
  });

  it('смена FPS на паузе не будит игру', () => {
    const loop = fakeLoop();
    const app = new AppLifecycle(loop);
    app.pause('hidden');
    app.setFpsCap(30);
    expect(loop.running).toBe(false);
    expect(loop.hasFpsLimit).toBe(true);
  });

  it('шаг боя ограничен', () => {
    expect(clampDelta(16)).toBe(16);
    expect(clampDelta(5000)).toBe(MAX_FRAME_MS);
    expect(clampDelta(-3)).toBe(0);
  });
});
