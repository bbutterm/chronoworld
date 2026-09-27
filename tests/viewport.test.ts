import { describe, expect, it } from 'vitest';
import { BLEED_X, BLEED_Y, GAME_H, GAME_W } from '../src/game/layout';
import { computeView } from '../src/game/viewLayout';

describe('P8: раскладка холста (viewLayout)', () => {
  it('9:16 — ровно поле 1080×1920, без полей', () => {
    const v = computeView(540, 960, 1);
    expect([v.worldX, v.worldY, v.worldW, v.worldH]).toEqual([0, 0, GAME_W, GAME_H]);
    expect([v.cssLeft, v.cssTop, v.cssW, v.cssH]).toEqual([0, 0, 540, 960]);
  });

  it('19.5:9 — поле по центру, сверху и снизу видны поля, холст на весь экран', () => {
    const v = computeView(390, 844, 3);
    expect(v.worldW).toBe(GAME_W);
    expect(v.worldY).toBeLessThan(-150);
    expect(v.worldY + v.worldH).toBeGreaterThan(GAME_H + 150);
    expect(v.cssH).toBeCloseTo(844, 3);
    expect(v.cssTop).toBeCloseTo(0, 3);
  });

  it('плотность: не больше MAX_DPR, но не мельче прежнего «1080 по ширине»', () => {
    expect(computeView(360, 640, 2).backW).toBe(720);
    expect(computeView(390, 844, 3).backW).toBe(1080);
    expect(computeView(430, 932, 3).backW).toBe(1080);
    expect(computeView(768, 1024, 2).density).toBe(2);
    expect(computeView(390, 844, 3, undefined, 3).backW).toBe(1170);
  });

  it('безопасные отступы: поле целиком ниже выреза', () => {
    const v = computeView(390, 844, 3, { top: 47, right: 0, bottom: 34, left: 0 });
    const s = v.cssW / v.worldW;
    expect(v.cssTop + (0 - v.worldY) * s).toBeGreaterThanOrEqual(47 - 1e-6);
    expect(v.cssTop + (GAME_H - v.worldY) * s).toBeLessThanOrEqual(844 - 34 + 1e-6);
  });

  it('очень широкое окно — поля не больше BLEED, остальное пустое', () => {
    const v = computeView(1600, 600, 1);
    expect(v.worldX).toBe(-BLEED_X);
    expect(v.worldW).toBe(GAME_W + 2 * BLEED_X);
    expect(v.cssW).toBeLessThan(1600);
    const tall = computeView(300, 1200, 1);
    expect(tall.worldY).toBe(-BLEED_Y);
  });
});
