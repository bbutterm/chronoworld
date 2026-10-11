import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFullContext } from '../scripts/lib/content-node';
import { homeLayout } from '../src/game/homeLayout';
import { composeDish, DISH_PX, type Pixels } from '../src/game/kitchenDishArt';
import { GAME_W } from '../src/game/layout';
import { S } from '../src/game/theme';

/** Кухня на «Городе» (docs/design/kitchen.md): вход под Лавкой, экран зарегистрирован, без золотых кнопок и тостов; картинки блюд. */

type Box = { x: number; y: number; w: number; h: number };
const overlap = (a: Box, b: Box) => Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
const SRC = (f: string) => readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8');

describe('Кухня: вход на «Городе»', () => {
  it.each([1220, 1730])('под Лавкой, вровень с Таверной, ни с чем не пересекается (низ %s)', (bottom) => {
    const L = homeLayout(bottom);
    const all: Box[] = [L.tavern, L.shop, L.kitchen, L.quests, L.achievements];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlap(all[i], all[j])).toBe(false);
    expect(L.kitchen.x).toBe(L.shop.x);
    expect(L.kitchen.w).toBe(L.shop.w);
    expect(L.kitchen.y + L.kitchen.h / 2).toBeCloseTo(L.tavern.y + L.tavern.h / 2);
    expect(L.shop.y - L.shop.h / 2).toBeCloseTo(L.tavern.y - L.tavern.h / 2);
    expect(L.kitchen.y - L.kitchen.h / 2 - (L.shop.y + L.shop.h / 2)).toBeCloseTo(S.s);
    expect(L.kitchen.x + L.kitchen.w / 2).toBeLessThanOrEqual(GAME_W - S.l + 0.5);
    // Лавка остаётся витриной, а не полоской.
    expect(L.shop.h).toBeGreaterThanOrEqual(300);
  });

  it('сцена Kitchen зарегистрирована, баннер «Новая функция!» ведёт на неё', () => {
    expect(SRC('main.ts')).toMatch(/KitchenScene/);
    expect(SRC('game/unlockBanner.ts')).toMatch(/kitchen: \{ scene: 'Kitchen' \}/);
    expect(SRC('game/viewLayout.ts')).toMatch(/'Kitchen'/);
  });

  it('экран Кухни: ни одной золотой кнопки и тоста (подтверждение — confirm)', () => {
    const src = SRC('game/scenes/KitchenScene.ts');
    expect(src).not.toMatch(/ui_btn_primary|variant: 'primary'|\bcta\(|\btoast\(/);
    expect(src).toMatch(/confirm\(/);
  });

  it('экран: рецепты по совету и силе, картинки блюд, совет повара, «Полно» у полной ячейки; плитка — название блюда', () => {
    const src = SRC('game/scenes/KitchenScene.ts');
    expect(src).toMatch(/sortRecipes\(this\.st\.recipes, this\.advice\)/);
    expect(src).toMatch(/kitchenAdvice\(/);
    expect(src).toMatch(/dishIcon\(/);
    expect(src).toMatch(/'Полно'/);
    expect(SRC('game/kitchenEntry.ts')).not.toMatch(/'Готово'/);
  });
});

describe('Кухня: картинки блюд из иконок продуктов', () => {
  const cfg = loadFullContext().kitchen!;
  /** Иконка-заглушка 24×24: непрозрачный прямоугольник своего цвета (цвет — по номеру продукта). */
  const fake = (i: number): Pixels => {
    const data = new Uint8ClampedArray(24 * 24 * 4);
    for (let y = 6; y < 20; y++) for (let x = 6; x < 18; x++) data.set([40 + i * 40, 200 - i * 30, 90 + i * 25, 255], (y * 24 + x) * 4);
    return { w: 24, h: 24, data };
  };
  const icons: Record<string, Pixels> = Object.fromEntries(cfg.ingredients.map((g, i) => [g.id, fake(i)]));
  const opaque = (d: Uint8ClampedArray) => {
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  };
  const hasColor = (d: Uint8ClampedArray, p: Pixels) => {
    const c = p.data.slice((10 * 24 + 10) * 4, (10 * 24 + 10) * 4 + 3);
    for (let i = 0; i < d.length; i += 4) if (d[i] === c[0] && d[i + 1] === c[1] && d[i + 2] === c[2] && d[i + 3] === 255) return true;
    return false;
  };

  it('у каждого блюда своя картинка на холсте DISH_PX²: основа и продукты, детерминированно', () => {
    const seen = new Set<string>();
    for (const r of cfg.recipes) {
      const a = composeDish(r.dish!, icons);
      expect(a).toHaveLength(DISH_PX * DISH_PX * 4);
      expect(composeDish(r.dish!, icons)).toEqual(a);
      expect(opaque(a), r.id).toBeGreaterThan(DISH_PX * 6);
      // Продукты блюда видны (прожаренный главный — в тёплом оттенке, его цвет другой).
      const shown = r.dish!.items.filter((_id, i) => !(i === 0 && r.dish!.cooked));
      for (const id of shown) expect(hasColor(a, icons[id]), `${r.id}: ${id}`).toBe(true);
      seen.add(Array.from(a).join(','));
    }
    expect(seen.size).toBe(cfg.recipes.length);
  });

  it('иконки не загрузились — остаётся основа (тарелка, стакан…), без ошибок', () => {
    for (const r of cfg.recipes) expect(opaque(composeDish(r.dish!, {})), r.id).toBeGreaterThan(DISH_PX * 4);
  });
});

describe('Кухня: полученные продукты видны в итогах', () => {
  it('экспедиция (одна и «Забрать всё»), охота и сундук показывают поле ingredients иконками продуктов', () => {
    const entry = SRC('game/kitchenEntry.ts');
    // Чипы — иконки продуктов (foodSpec) в общем rewardRow; строка итога — названия из data/kitchen.json.
    expect(entry).toMatch(/export function foodChips[\s\S]*foodSpec\(g\.icon\)/);
    expect(entry).toMatch(/export function floatFood[\s\S]*rewardRow\(/);
    expect(entry).toMatch(/export function foodLine[\s\S]*pantryText\(/);
    const exp = SRC('game/scenes/ExpeditionsScene.ts');
    expect(exp.match(/floatFood\(this, [^;]*r\.ingredients\);/g)).toHaveLength(2);
    expect(exp.match(/foodLine\(r\.ingredients\)/g)).toHaveLength(2);
    expect(SRC('game/scenes/HuntScene.ts')).toMatch(/items\.push\(\.\.\.foodChips\(g\.ingredients\)\)/);
    const camp = SRC('game/scenes/CampaignScene.ts');
    expect(camp).toMatch(/foodLine\(r\.ingredients\)/);
    expect(camp).toMatch(/restartWithReward\([^;]*r\.ingredients\);/);
    expect(camp).toMatch(/floatFood\(this, [^;]*food\);/);
  });
});
