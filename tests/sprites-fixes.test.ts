import { describe, expect, it } from 'vitest';
import { normalizeV2, type SpritesV2 } from '../src/pipeline/sprites';

const json: SpritesV2 = {
  schema: 2,
  columns: 8,
  classes: { monster: { cell: [240, 224], anchor: [100, 120], anims: ['idle', 'attack', 'death'] } },
  anims: { idle: { frames: 4, ms: 150, loop: true }, attack: { frames: 6, ms: 80, hitFrame: 3 }, death: { frames: 5, ms: 120 } },
  sprites: [{ id: 'tank', class: 'monster', file: 'sprites/monsters/tank.png' }],
};

describe('fixes.json: пропуск кадров', () => {
  it('без правок — все кадры, cols нет', () => {
    const [s] = normalizeV2(json);
    expect(s.anims.death).toMatchObject({ frames: 5 });
    expect(s.anims.death?.cols).toBeUndefined();
  });
  it('skip убирает кадры и сдвигает hitFrame', () => {
    const [s] = normalizeV2(json, { tank: { skip: { death: [2, 3], attack: [1] } } });
    expect(s.anims.death).toMatchObject({ frames: 3, cols: [0, 1, 4], ms: [120, 120, 120] });
    expect(s.anims.attack).toMatchObject({ frames: 5, cols: [0, 2, 3, 4, 5], hitFrame: 2 });
    expect(s.anims.idle?.cols).toBeUndefined();
  });
});
