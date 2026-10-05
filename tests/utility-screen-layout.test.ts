import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {}, GameObjects: { Events: { DESTROY: 'destroy' } }, BlendModes: { ADD: 1 } } }));

const { utilityListLayout, utilityRowHeight, utilityShopLayout } = await import('../src/game/utilityScreenLayout');
const { computeView } = await import('../src/game/viewLayout');
const { scrollLayout } = await import('../src/game/scroll');
const { CONTENT_TOP, NAV_H } = await import('../src/game/screen');
const { GAME_W } = await import('../src/game/layout');
const { S, TOUCH_COMFORT } = await import('../src/game/theme');

describe('служебные списки используют текущую безопасную высоту', () => {
  it.each([[360, 640], [390, 844]])('%s×%s: последние строки и общая награда остаются над навигацией', (w, h) => {
    for (const topInset of [136, 216]) {
      const v = computeView(w, h, 2, { top: topInset, bottom: 34, right: 0, left: 0 }, 2, true);
      const scale = v.cssW / v.worldW;
      const contentBottom = v.safeBottom - NAV_H - 20;
      for (const track of [0, 284]) {
        for (const claimAll of [false, true]) {
          const l = utilityListLayout(CONTENT_TOP + S.xs + track, contentBottom, claimAll);
          expect(l.bottom - l.top).toBeGreaterThan(200);
          expect(l.bottom).toBeLessThanOrEqual(contentBottom);
          const end = scrollLayout(3200, l.top, l.bottom, Number.MAX_SAFE_INTEGER);
          expect(end.y + 3200).toBeCloseTo(l.bottom);
          if (claimAll) {
            expect(l.bottom).toBeLessThan(l.claimY - TOUCH_COMFORT / 2);
            expect(l.claimY + TOUCH_COMFORT / 2).toBeLessThan(contentBottom);
          }
          expect(TOUCH_COMFORT * scale).toBeGreaterThanOrEqual(44);
        }
      }
    }
  });

  it('изменение высоты сохраняет прокрутку и безопасно ограничивает достигнутый конец', () => {
    const old = utilityListLayout(470, 1100, true);
    const next = utilityListLayout(470, 870, true);
    const expanded = utilityListLayout(470, 1550, false);
    expect(scrollLayout(1800, next.top, next.bottom, 700).offset).toBe(700);
    const oldEnd = scrollLayout(1800, old.top, old.bottom, Number.MAX_SAFE_INTEGER);
    const nextEnd = scrollLayout(1800, next.top, next.bottom, oldEnd.offset);
    expect(nextEnd.offset).toBe(oldEnd.offset);
    const expandedEnd = scrollLayout(1800, expanded.top, expanded.bottom, nextEnd.offset);
    expect(expandedEnd.y + 1800).toBeCloseTo(expanded.bottom);
  });
});

describe('магазин и строки сохраняют читаемую геометрию', () => {
  it('все восемь товаров доступны в двух колонках и не перекрываются', () => {
    const l = utilityShopLayout(true);
    expect(l.cols).toBe(2);
    expect(l.tileW / 3).toBeGreaterThan(150);
    const boxes = Array.from({ length: 8 }, (_, i) => l.tilePos(i));
    for (const box of boxes) {
      expect(box.x - l.tileW / 2).toBeGreaterThanOrEqual(S.l);
      expect(box.x + l.tileW / 2).toBeLessThanOrEqual(GAME_W - S.l);
      expect(box.y - l.tileH / 2).toBeGreaterThan(l.bannerH);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      expect(Math.abs(boxes[i].x - boxes[j].x) >= l.tileW || Math.abs(boxes[i].y - boxes[j].y) >= l.tileH).toBe(true);
    }
    const end = scrollLayout(l.height, 186, 1230, Number.MAX_SAFE_INTEGER);
    expect(end.y + boxes[7].y + l.tileH / 2).toBeLessThan(end.bottom);
    expect(end.y + boxes[7].y - l.tileH / 2).toBeGreaterThan(186);
  });

  it('десктоп сохраняет четыре колонки, а прогресс и награды получают разные строки', () => {
    expect(utilityShopLayout(false).cols).toBe(4);
    expect(utilityRowHeight(undefined, true)).toBeGreaterThanOrEqual(TOUCH_COMFORT);
    expect(utilityRowHeight({ progress: 2, target: 3, key: 'q', chips: [{ icon: 'gold', value: 100 }] }, true))
      .toBeGreaterThan(utilityRowHeight({ chips: [{ icon: 'gold', value: 100 }] }, true));
    expect(utilityRowHeight({ text: 'От кого' }, false)).toBe(150);
    expect(utilityRowHeight(undefined, false)).toBe(112);
  });
});
