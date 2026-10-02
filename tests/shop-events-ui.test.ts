import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * Лавка и События (полировка UI, итерация 8B; docs/design/ui-polish-research.md §3, §5): плитки без золотых кнопок,
 * одна главная «Купить» — в листе товара, раскладка влезает в поле 1080×1920 (худший случай 9:16 — 360×640).
 */

vi.mock('phaser', () => ({ default: { Scene: class {}, GameObjects: { Events: { DESTROY: 'destroy' } }, BlendModes: { ADD: 1 } } }));

const Shop = await import('../src/game/scenes/ShopScene');
const Events = await import('../src/game/scenes/EventsScene');
const { CONTENT_BOTTOM } = await import('../src/game/screen');
const { GAME_W } = await import('../src/game/layout');
const { S } = await import('../src/game/theme');

const SRC = (f: string) => readFileSync(join(import.meta.dirname, '..', 'src', 'game', 'scenes', f), 'utf8');

/** Разряды в игре — неразрывными пробелами; в ожиданиях — обычными. */
const sp = (s: string) => s.replace(/\u00a0|\u202f/g, ' ');

type Box = { x: number; y: number; w: number; h: number };
const overlap = (a: Box, b: Box) => Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;

describe('Лавка: сетка товаров', () => {
  const tileW = (Shop.SHOP_L.bannerW - (Shop.SHOP_L.cols - 1) * Shop.SHOP_L.gap) / Shop.SHOP_L.cols;
  const tiles: Box[] = Array.from({ length: 8 }, (_, i) => ({ ...Shop.tilePos(i), w: tileW, h: Shop.SHOP_L.tileH }));

  it('8 плиток 4 × 2 в полях экрана, не наезжают друг на друга и на витрину, влезают до навигации на 9:16', () => {
    for (const t of tiles) {
      expect(t.x - t.w / 2).toBeGreaterThanOrEqual(S.l - 0.5);
      expect(t.x + t.w / 2).toBeLessThanOrEqual(GAME_W - S.l + 0.5);
      expect(t.y - t.h / 2).toBeGreaterThanOrEqual(Shop.SHOP_L.bannerTop + Shop.SHOP_L.bannerH);
      expect(t.y + t.h / 2).toBeLessThanOrEqual(CONTENT_BOTTOM);
    }
    for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) expect(overlap(tiles[i], tiles[j])).toBe(false);
  });

  it('цена на плитке короткая (900K), в листе — полная; количество на иконке — только у наборов', () => {
    expect(Shop.priceLabel(900_000, true)).toBe('900K');
    expect(sp(Shop.priceLabel(900_000, false))).toBe('900 000');
    expect(sp(Shop.priceLabel(36_000, true))).toBe('36 000');
    expect(Shop.slotAmount({ kind: 'scrolls', count: 1 })).toBe('×1');
    expect(sp(Shop.slotAmount({ kind: 'heroExp', count: 18_000 }))).toBe('+18 000');
    expect(Shop.slotAmount({ kind: 'gold', count: 240_000 })).toBe('+240K');
    expect(Shop.slotAmount({ kind: 'item', count: 1 })).toBe('');
    expect(Shop.slotAmount({ kind: 'heroCard', count: 1 })).toBe('');
  });

  it('таймер нового товара — часы и минуты с ведущим нулём', () => {
    expect(Shop.timerText(21 * 3_600_000 + 5 * 60_000)).toBe('21 ч 05 мин');
    expect(Shop.timerText(7 * 60_000)).toBe('7 мин');
  });

  it('одна главная кнопка: золотых «Купить» на плитках нет, «Купить» — cta в листе товара', () => {
    const src = SRC('ShopScene.ts');
    expect(src).not.toMatch(/ui_btn_primary/);
    expect(src.match(/\bcta\(/g)?.length).toBe(1);
    expect(src).toMatch(/bottomSheet\(/);
    expect(src).not.toMatch(/Нажмите/);
  });
});

describe('События: плитки входа и задания', () => {
  const top = 700;
  const tiles: Box[] = [1, 2, 3, 4, 5, 6, 7].map((d) => {
    const p = Events.loginTilePos(d, top);
    return { x: p.x, y: p.y, w: p.w, h: Events.EV_L.tileH };
  });

  it('7 дней: 4 + 3 (день 7 — на две колонки), в полях экрана, без наложений', () => {
    expect(tiles[6].w).toBeGreaterThan(tiles[0].w * 2);
    expect(tiles[6].y).toBe(tiles[4].y);
    for (const t of tiles) {
      expect(t.x - t.w / 2).toBeGreaterThanOrEqual(S.l - 0.5);
      expect(t.x + t.w / 2).toBeLessThanOrEqual(GAME_W - S.l + 0.5);
    }
    for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) expect(overlap(tiles[i], tiles[j])).toBe(false);
  });

  it('задания: «Забрать» сверху, в процессе — дальше, полученные и закрытые — внизу (порядок внутри групп сохранён)', () => {
    const t = (id: string, s: Partial<{ ready: boolean; claimed: boolean; locked: boolean }>) => ({ id, ready: false, claimed: false, locked: false, ...s });
    const got = Events.sortTasks([t('a', { claimed: true }), t('b', {}), t('c', { ready: true }), t('d', { locked: true }), t('e', {})]);
    expect(got.map((x) => x.id)).toEqual(['c', 'b', 'e', 'a', 'd']);
  });

  it('без длинных пояснений и золотых кнопок в плитках', () => {
    const src = SRC('EventsScene.ts');
    expect(src).not.toMatch(/ui_btn_primary/);
    expect(src).not.toMatch(/Пропуски не сбрасывают|Нажмите|нажатием/);
    // e2e (scripts/e2e.mjs) забирает день 1 по имени готовой плитки.
    expect(src).toMatch(/loginClaim_\$\{d\.day\}/);
  });
});
