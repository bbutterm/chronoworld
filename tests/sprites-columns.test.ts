import { describe, expect, it } from 'vitest';
import { normalizeV2, type SpritesV2 } from '../src/pipeline/sprites';

// Phaser режет лист на кадры по его ширине: у XL-листов (6 колонок) кадр ряда r — r × 6 + i.
// Если взять общее columns манифеста (8), ряд walk начнётся с середины ряда idle.
const json: SpritesV2 = {
  schema: 2,
  columns: 8,
  classes: {
    monster: { cell: [240, 224], anchor: [100, 120], anims: ['idle', 'walk'] },
    boss_xl: { cell: [296, 272], anchor: [96, 218], columns: 6, anims: ['idle', 'walk'] },
  },
  anims: { idle: { frames: 4, ms: 150, loop: true }, walk: { frames: 6, ms: 100, loop: true } },
  sprites: [
    { id: 'm', class: 'monster', file: 'm.png' },
    { id: 'xl', class: 'boss_xl', file: 'xl.png' },
  ],
};

describe('колонки листа v2', () => {
  it('обычный класс — columns манифеста, XL — свои', () => {
    const [m, xl] = normalizeV2(json);
    expect(m.columns).toBe(8);
    expect(xl.columns).toBe(6);
    expect(xl.cell).toEqual([296, 272]);
    expect(xl.anchor).toEqual([96, 218]);
  });
});
