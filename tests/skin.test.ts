import { describe, expect, it } from 'vitest';
import { SKIN_FOR, SKIN_SLICE, SKIN_TILES, tileCorner } from '../src/game/skin';
import { RARITY } from '../src/game/theme';

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

  it('все ключи, на которые ссылается SKIN_FOR, и состояния кнопок существуют', () => {
    for (const k of Object.values(SKIN_FOR)) expect(SKIN_TILES[k], k).toBeDefined();
    for (const k of ['skin_btn', 'skin_btn_secondary', 'skin_btn_ghost', 'skin_btn_gold', 'skin_btn_active', 'skin_btn_danger', 'skin_tab', 'skin_tab_active']) {
      expect(SKIN_TILES[k], k).toBeDefined();
      expect(SKIN_TILES[`${k}_pressed`], `${k}_pressed`).toBeDefined();
    }
    expect(SKIN_TILES.skin_btn_disabled).toBeDefined();
    expect(SKIN_FOR.ui_btn_primary).toBe('skin_btn_gold');
  });

  it('цвета редкости — единый источник theme RARITY', () => {
    expect(Object.keys(RARITY)).toEqual(['green', 'blue', 'purple', 'gold', 'red']);
    for (const v of Object.values(RARITY)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });
});
