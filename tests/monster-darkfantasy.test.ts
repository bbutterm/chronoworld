import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { forEachCase } from './helpers';
import { normalizeV2, type SpritesV2 } from '../src/pipeline/sprites';
import { packSheet } from '../src/pipeline/sheetPack';
import fixtures from './fixtures/monster-darkfantasy-ready25.json';

const read = (path: string) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const defs = normalizeV2(read('assets/sprites/sprites.json') as SpritesV2, read('assets/sprites/fixes.json'));

describe('готовые dark-fantasy монстры: прежнее движение и полная обрезка кадров', () => {
  it('каждый готовый монстр сохраняет сетку, точку ног, темп, удар и пропущенные кадры', () => forEachCase(fixtures, (f) => f.id, (f) => {
    const def = defs.find(d => d.id === f.id)!;
    expect(def.file).toBe(f.file);
    expect(def.cell).toEqual(f.cell);
    expect(def.anchor).toEqual(f.anchor);
    expect(def.columns).toBe(f.columns);
    for (const [name, expected] of Object.entries(f.anims)) {
      const actual = def.anims[name as keyof typeof def.anims]!;
      expect(actual.row).toBe(expected.row);
      expect(actual.frames).toBe(expected.frames);
      expect(actual.ms).toEqual(expected.ms);
      expect(actual.loop).toBe('loop' in expected ? expected.loop : undefined);
      expect(actual.hitFrame).toBe('hitFrame' in expected ? expected.hitFrame : undefined);
      expect(actual.cols ?? Array.from({ length: actual.frames }, (_, i) => i)).toEqual(expected.source_columns);
    }
  }));

  it('упаковка каждого готового монстра удерживает все видимые пиксели и исходные координаты', () => forEachCase(fixtures, (f) => f.id, (f) => {
    const def = defs.find(d => d.id === f.id)!;
    const packed = packSheet(def)!;
    expect(packed).not.toBeNull();
    expect(packed.width).toBeLessThanOrEqual(2048);
    expect(packed.height).toBeLessThanOrEqual(2048);
    for (const [name, a] of Object.entries(f.anims)) {
      for (const col of a.source_columns) {
        const cut = packed.frames.find(p => p.name === a.row * f.columns + col)!;
        const b = f.frameBoxes[name as keyof typeof f.frameBoxes][col];
        expect(cut).toBeDefined();
        expect(cut.dx).toBeLessThanOrEqual(b[0]);
        expect(cut.dy).toBeLessThanOrEqual(b[1]);
        expect(cut.dx + cut.w).toBeGreaterThanOrEqual(b[2]);
        expect(cut.dy + cut.h).toBeGreaterThanOrEqual(b[3]);
        expect(cut.sx - cut.dx).toBe(col * f.cell[0]);
        expect(cut.sy - cut.dy).toBe(a.row * f.cell[1]);
      }
    }
  }));
});
