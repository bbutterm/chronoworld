import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeV2, type SpriteDef, type SpritesV2 } from '../src/pipeline/sprites';
import { battleSpriteHitArea, battleSpritePresentation, separateBattleSprites, type BattlePresentedUnit, type BattlePresentationBounds } from '../src/game/battlePresentation';

const sprites = normalizeV2(JSON.parse(readFileSync('assets/sprites/sprites.json', 'utf8')) as SpritesV2);
const sprite = (id: string): SpriteDef => sprites.find(s => s.id === id)!;
const arena: BattlePresentationBounds = { minX: 40, maxX: 1040, minY: 400, maxY: 1638 };
const unit = (id: string, side: 'A' | 'B', x: number, y: number): BattlePresentedUnit => ({
  side, active: true, faceDir: side === 'A' ? 1 : -1, displayX: x, displayY: y,
  presentation: battleSpritePresentation(sprite(id), sprite(id).scale, arena), node: { scaleX: 1, scaleY: 1 },
});
const worldBounds = (u: BattlePresentedUnit, body = false) => {
  const b = u.presentation[body ? 'body' : 'animated'];
  return {
    left: u.displayX + (u.faceDir < 0 ? -b.right : b.left) * u.node.scaleX,
    right: u.displayX + (u.faceDir < 0 ? -b.left : b.right) * u.node.scaleX,
    top: u.displayY + b.top * u.node.scaleY,
    bottom: u.displayY + b.bottom * u.node.scaleY,
  };
};

describe('BUG158: finite large battle silhouettes with original foot anchors', () => {
  it('fits the actual Lord attack and death bounds, keeps a large boss, and does not alter the art', () => {
    const def = sprite('lord_of_death');
    const original = structuredClone(def);
    const p = battleSpritePresentation(def, def.scale, arena);
    expect((278 - 4) * def.scale).toBeCloseTo(876.8); // Reproduced overflowing attack at native3.2.
    expect(p.scale).toBe(2);
    expect(p.animated).toEqual({ left: -184, top: -420, right: 364, bottom: 98 });
    expect(p.animated.right - p.animated.left).toBe(548);
    expect((def.top ?? 0) * p.scale).toBeGreaterThan((sprite('knight_m').top ?? 0) * sprite('knight_m').scale);
    expect(p.large).toBe(true);
    expect(def).toEqual(original);
  });

  it('reserves wide attack frames even if the idle alone would have fit', () => {
    const def = structuredClone(sprite('lord_of_death'));
    def.boxes!.idle = [90, 200, 120, 218];
    expect(battleSpritePresentation(def, 3.2, arena).scale).toBe(2);
    // A smaller actual sheet retains its previous fractional native scale without arbitrary round-down.
    expect(battleSpritePresentation(sprite('knight_m'), 3.2, arena).scale).toBe(3.2);
    // A normal minion's broad attack/death frame gets fitted, without squeezing every enemy into a giant's lane.
    expect(battleSpritePresentation(sprite('banshee'), 3.2, arena).large).toBe(false);
    expect(battleSpritePresentation(sprite('loli_ruri'), 3.2, arena).large).toBe(false);
  });

  it('the tappable body follows Lord\'s asymmetric real anchor and is mirrored without adding blank cells or weapons', () => {
    const def = sprite('lord_of_death');
    const p = battleSpritePresentation(def, 3.2, arena);
    const normal = battleSpriteHitArea(p, ...def.cell, def.anchor[0] / def.cell[0], def.anchor[1] / def.cell[1], false);
    const flipped = battleSpriteHitArea(p, ...def.cell, 1 - def.anchor[0] / def.cell[0], def.anchor[1] / def.cell[1], true);
    expect(normal).toEqual({ x: 24, y: 20, width: 217, height: 247 });
    expect(flipped).toEqual({ x: 55, y: 20, width: 217, height: 247 });
    // Previous centered45% hit area excluded this visibly opaque left section of the flipped torso.
    const visibleSourceX = def.cell[0] - 225;
    expect(visibleSourceX).toBeGreaterThanOrEqual(flipped.x);
    expect(visibleSourceX).toBeLessThan(flipped.x + flipped.width);
    expect(flipped.x).toBeGreaterThan(0);
    expect(flipped.x + flipped.width).toBeLessThan(def.cell[0]);
  });

  it('separates the real late-stage party from Lord without changing side, facing, scale or y-depth', () => {
    const party = [
      unit('knight_m', 'A', 422.4, 1049), unit('wizard_m', 'A', 422.4, 1369),
      unit('hunter_f', 'A', 229.2, 889), unit('sage_f', 'A', 229.2, 1209), unit('priest_f', 'A', 229.2, 1529),
    ];
    const lord = unit('lord_of_death', 'B', 657.6, 1369);
    const originalY = [...party, lord].map(u => u.displayY);
    separateBattleSprites([...party, lord], arena);
    const boss = worldBounds(lord);
    for (const hero of party) expect(worldBounds(hero, true).right + 20).toBeLessThanOrEqual(boss.left + 0.00001);
    expect([...party, lord].map(u => u.displayY)).toEqual(originalY);
    expect(lord.presentation.scale).toBe(2);
    expect(lord.faceDir).toBe(-1);
    // The melee weapon reaches towards the boss while its wielder remains visible.
    expect(worldBounds(party[0]).right).toBeGreaterThan(boss.left);
  });

  it('keeps the full registered animation envelope on screen through either facing and the existing ult growth', () => {
    for (const side of ['A', 'B'] as const) for (const faceDir of [-1, 1] as const) {
      const big = unit('lord_of_death', side, side === 'A' ? 70 : 1010, 1840);
      big.faceDir = faceDir;
      big.node.scaleX = big.node.scaleY = 1.12;
      const foe = unit('knight_m', side === 'A' ? 'B' : 'A', 540, 900);
      separateBattleSprites([big, foe], arena);
      for (const u of [big, foe]) {
        const b = worldBounds(u);
        expect(b.left).toBeGreaterThanOrEqual(arena.minX - 0.00001);
        expect(b.right).toBeLessThanOrEqual(arena.maxX + 0.00001);
        expect(b.top).toBeGreaterThanOrEqual(arena.minY - 0.00001);
        expect(b.bottom).toBeLessThanOrEqual(arena.maxY + 0.00001);
      }
      expect(big.presentation.scale).toBe(2);
    }
  });

  it('retains settled positions of corpses and stops reserving a dead boss silhouette', () => {
    const lord = unit('lord_of_death', 'B', 500, 1200);
    const hero = unit('knight_m', 'A', 540, 1200);
    lord.active = false;
    separateBattleSprites([lord, hero], arena);
    expect(lord.displayX).toBe(500);
    expect(lord.displayY).toBe(1200);
    expect(hero.displayX).toBe(540);
  });

  it('has a finite conservative fallback for legacy art without bboxes', () => {
    const def = { ...sprite('lord_of_death'), boxes: undefined, cell: [4000, 4000] as [number, number], anchor: [2000, 3000] as [number, number] };
    const p = battleSpritePresentation(def, 3.2, arena);
    expect(p.scale).toBeGreaterThan(0);
    expect((p.animated.right - p.animated.left)).toBeLessThanOrEqual((arena.maxX - arena.minX) * 0.56);
    expect((p.animated.bottom - p.animated.top)).toBeLessThanOrEqual((arena.maxY - arena.minY) * 0.56);
  });
});
