import { describe, expect, it } from 'vitest';
import { computeView, supportsAdaptiveLayout } from '../src/game/viewLayout';
import { scrollLayout } from '../src/game/scroll';
import { campaignLayout } from '../src/game/runtimeUiLayout';

describe('компактный Telegram сохраняет ширину и даёт содержимому отдельную прокрутку', () => {
  it.each([[360, 640], [390, 844]])('безопасные области и кнопки остаются доступны на %s×%s', (w, h) => {
    const v = computeView(w, h, 2, { top: 136, bottom: 34, left: 0, right: 0 }, 2, true);
    const cssScale = v.cssW / v.worldW;
    const cssY = (y: number) => v.cssTop + (y - v.worldY) * cssScale;
    expect(cssScale).toBeCloseTo(w / 1080);
    expect(cssY(0)).toBeCloseTo(136);
    expect(cssY(v.safeBottom)).toBeCloseTo(h - 34);
    expect(v.uiHeight).toBeCloseTo((h - 170) / cssScale);
    expect(40 * cssScale).toBeGreaterThanOrEqual(13);
    expect(132 * cssScale).toBeGreaterThanOrEqual(44);
    const list = scrollLayout(2800, 200, v.safeBottom - 350);
    const end = scrollLayout(2800, 200, list.bottom, list.maxOffset);
    expect(end.y + 2800).toBeCloseTo(list.bottom);
    expect(cssY(list.bottom)).toBeLessThan(cssY(v.safeBottom - 170));
  });

  it('не меняет стандартный телефон или планшет и не растягивает изображение', () => {
    for (const [w, h] of [[360, 640], [390, 844], [768, 1024], [1600, 600]]) {
      const { adaptive, ...next } = computeView(w, h, 2, undefined, 2, true);
      const { adaptive: legacy, ...previous } = computeView(w, h, 2);
      expect(next).toEqual(previous);
      expect(adaptive).toBe(w <= 600 && h > w);
      expect(legacy).toBe(false);
    }
    const v = computeView(360, 640, 3, { top: 136, bottom: 34, left: 0, right: 0 }, 2, true);
    expect(v.cssW / v.worldW).toBeCloseTo(v.cssH / v.worldH);
  });

  it('изменение безопасной высоты сохраняет позицию списка и ограничивает её после расширения', () => {
    expect(scrollLayout(2400, 200, 1000, 1250).offset).toBe(1250);
    expect(scrollLayout(2400, 200, 2100, 1250).offset).toBe(500);
    const tiny = scrollLayout(500, 200, 230, 999);
    expect(tiny.thumbHeight).toBeLessThanOrEqual(tiny.height);
    expect(tiny.y + 500).toBe(tiny.bottom);
  });

  it('переключает только адаптированные сцены и восстанавливает поле боя целиком', () => {
    expect(supportsAdaptiveLayout('Campaign')).toBe(true);
    expect(supportsAdaptiveLayout('Adventure')).toBe(true);
    expect(supportsAdaptiveLayout('Hero')).toBe(true);
    expect(supportsAdaptiveLayout('Ascend')).toBe(true);
    for (const scene of ['Heroes', 'HeroPick', 'Stage', 'Squad']) expect(supportsAdaptiveLayout(scene)).toBe(true);
    for (const scene of ['Battle', 'Home', 'Tavern', 'TavernEvening', 'Result']) expect(supportsAdaptiveLayout(scene)).toBe(false);
    const insets = { top: 136, bottom: 34, left: 0, right: 0 };
    const map = computeView(360, 640, 1, insets, 2, supportsAdaptiveLayout('Campaign'));
    const battle = computeView(360, 640, 1, insets, 2, supportsAdaptiveLayout('Battle'));
    expect(map.uiHeight).toBe(1410);
    expect(battle.uiHeight).toBe(1920);
    expect(battle.worldY).toBeLessThanOrEqual(0);
    expect(battle.worldY + battle.worldH).toBeGreaterThanOrEqual(1920);
    expect(map).toEqual(computeView(360, 640, 1, insets, 2, true));
    for (const scene of ['Hero', 'Ascend', 'Heroes', 'HeroPick', 'Stage', 'Squad']) {
      const hero = computeView(360, 640, 1, insets, 2, supportsAdaptiveLayout(scene));
      expect(hero.adaptive).toBe(true);
      expect(hero.uiHeight).toBe(1410);
      expect(hero.cssW / hero.worldW).toBeCloseTo(1 / 3);
      expect(hero).toEqual(map);
    }
  });

  it.each([1, 3, 5])('все %s этапов и отряд достигаются без уменьшения CTA и добычи', n => {
    const c = campaignLayout(1220, n, true);
    expect(c.mapBottom - c.mapTop).toBe((n - 1) * 180);
    expect(c.bodyBottom).toBeLessThan(c.rowY - 96);
    expect(c.rowY + 72).toBeLessThan(c.cardY - c.cardH / 2);
    expect(c.claimH / 3).toBe(44);
    expect(c.cardY + c.cardH / 2).toBeLessThanOrEqual(1220);
    const end = scrollLayout(c.bodyHeight, c.bodyTop, c.bodyBottom, Number.MAX_SAFE_INTEGER);
    expect(end.y + c.bodyHeight).toBe(c.bodyBottom);
    expect(c.bodyHeight).toBeGreaterThan(c.bodyBottom - c.bodyTop);
  });
});
