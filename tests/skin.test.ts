import { describe, expect, it } from 'vitest';
import { SKIN_DARK_LABEL, SKIN_FOR, SKIN_SLICE, SKIN_TILES, tileCorner } from '../src/game/skin';
import { R, RARITY } from '../src/game/theme';

/** Материалы скина (docs/design/ui-polish-research.md, §3 правило 5, §4.3–4.5). */
describe('скин: поверхности и кнопки', () => {
  it('угол каждой плитки помещается в срез 9-slice', () => {
    for (const [key, spec] of Object.entries(SKIN_TILES)) expect(tileCorner(spec), key).toBeLessThanOrEqual(SKIN_SLICE);
  });

  it('у кнопок и слотов маленький угол — срез у низких плиток (h/2) его не режет', () => {
    for (const [key, spec] of Object.entries(SKIN_TILES)) {
      if (/^skin_(btn|slot|tab)/.test(key)) expect(tileCorner(spec), key).toBeLessThanOrEqual(32);
    }
  });

  it('радиусы — только токены R по ролям', () => {
    const allowed = new Set<number>([R.s, R.m, R.l, R.xl]);
    for (const [key, spec] of Object.entries(SKIN_TILES)) expect(allowed.has(spec.r), `${key}: ${spec.r}`).toBe(true);
    expect(SKIN_TILES.skin_btn_gold.r).toBe(R.m);
    expect(SKIN_TILES.skin_panel.r).toBe(R.l);
    expect(SKIN_TILES.skin_modal.r).toBe(R.xl);
  });

  it('три поверхности: без рамки, с тонкой рамкой, утопленная', () => {
    const { skin_surface: flat, skin_raised: raised, skin_sunken: sunken } = SKIN_TILES;
    expect(flat.border).toBeUndefined();
    expect(flat.shadow ?? 0).toBe(0);
    expect(flat.alpha).toBeGreaterThanOrEqual(0.7);
    expect(flat.alpha).toBeLessThanOrEqual(0.85);
    expect(raised.border).toBeDefined();
    expect(raised.bw).toBeGreaterThanOrEqual(2);
    expect(raised.bw).toBeLessThanOrEqual(3);
    expect(raised.shadow).toBeGreaterThan(0);
    expect(sunken.inset).toBeGreaterThan(0);
  });

  it('карточка по умолчанию (ui_panel) — спокойная поднятая, не тяжелее skin_raised', () => {
    const panel = SKIN_TILES[SKIN_FOR.ui_panel];
    expect(panel.bw ?? 0).toBeLessThanOrEqual(SKIN_TILES.skin_raised.bw ?? 0);
    expect(panel.r).toBe(SKIN_TILES.skin_raised.r);
  });

  it('все ключи, на которые ссылается SKIN_FOR, и состояния кнопок существуют', () => {
    for (const k of Object.values(SKIN_FOR)) expect(SKIN_TILES[k], k).toBeDefined();
    for (const k of ['skin_btn', 'skin_btn_secondary', 'skin_btn_ghost', 'skin_btn_gold', 'skin_btn_active', 'skin_btn_danger', 'skin_tab', 'skin_tab_active']) {
      expect(SKIN_TILES[k], k).toBeDefined();
      expect(SKIN_TILES[`${k}_pressed`], `${k}_pressed`).toBeDefined();
    }
    expect(SKIN_TILES.skin_btn_disabled).toBeDefined();
    expect(SKIN_FOR.ui_btn_primary).toBe('skin_btn_gold');
  });

  it('ghost — без фона и рамки, проявляется только при нажатии', () => {
    const g = SKIN_TILES.skin_btn_ghost;
    expect(g.border).toBeUndefined();
    expect(g.top).toMatch(/rgba\(0,\s*0,\s*0,\s*0\)/);
    expect(SKIN_TILES.skin_btn_ghost_pressed.top).not.toBe(g.top);
  });

  it('тёмная подпись — только на золотой кнопке', () => {
    expect([...SKIN_DARK_LABEL]).toEqual(['skin_btn_gold']);
  });

  it('цвета редкости — единый источник theme RARITY', () => {
    expect(Object.keys(RARITY)).toEqual(['green', 'blue', 'purple', 'gold', 'red']);
    for (const v of Object.values(RARITY)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });
});
