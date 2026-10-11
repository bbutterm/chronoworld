import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { homeLayout } from '../src/game/homeLayout';
import { GAME_W } from '../src/game/layout';
import { S } from '../src/game/theme';

/** Кухня на «Городе» (docs/design/kitchen.md): вход под Лавкой, экран зарегистрирован, без золотых кнопок и тостов. */

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
