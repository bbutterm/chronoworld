import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACK_GAP, PACK_MAX, packAlphaGrid, packSheet } from '../src/pipeline/sheetPack';
import { buildRegistry, type SpriteFixes, type SpritesV2 } from '../src/pipeline/sprites';

const ROOT = join(import.meta.dirname, '..');
const json = <T>(p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8')) as T;
const registry = buildRegistry(json('assets/sprites.legacy.json'), json<SpritesV2>('assets/sprites/sprites.json'), json<SpriteFixes>('assets/sprites/fixes.json'));

describe('упаковка листов юнитов в памяти (sheetPack)', () => {
  it('каждый нужный кадр есть, не пересекается с соседями и лежит в пределах текстуры и клетки', () => {
    for (const def of Object.values(registry)) {
      const p = packSheet(def);
      // Старые листы без bbox грузятся как есть; все листы v2 упаковываются.
      expect(p === null, def.id).toBe(def.source === 'legacy');
      if (!p) continue;
      expect(p.width, def.id).toBeLessThanOrEqual(PACK_MAX);
      expect(p.height, def.id).toBeLessThanOrEqual(PACK_MAX);
      const names = new Set(p.frames.map((f) => f.name));
      expect(names.has(0), `${def.id}: кадр 0`).toBe(true);
      for (const a of Object.values(def.anims)) {
        for (let i = 0; i < (a?.frames ?? 0); i++) expect(names.has(a!.row * def.columns + (a!.cols?.[i] ?? i)), def.id).toBe(true);
      }
      for (const f of p.frames) {
        expect(f.x + f.w, def.id).toBeLessThanOrEqual(p.width);
        expect(f.y + f.h, def.id).toBeLessThanOrEqual(p.height);
        expect(f.dx + f.w, def.id).toBeLessThanOrEqual(def.cell[0]);
        expect(f.dy + f.h, def.id).toBeLessThanOrEqual(def.cell[1]);
        // Исходная вырезка — внутри своей клетки.
        expect(f.sx - f.dx, def.id).toBe((f.name % def.columns) * def.cell[0]);
        expect(f.sy - f.dy, def.id).toBe(Math.floor(f.name / def.columns) * def.cell[1]);
      }
      for (let i = 0; i < p.frames.length; i++) {
        for (let j = i + 1; j < p.frames.length; j++) {
          const a = p.frames[i];
          const b = p.frames[j];
          const apart = a.x + a.w + PACK_GAP <= b.x || b.x + b.w + PACK_GAP <= a.x || a.y + a.h + PACK_GAP <= b.y || b.y + b.h + PACK_GAP <= a.y;
          expect(apart, `${def.id}: кадры ${a.name} и ${b.name} пересекаются`).toBe(true);
        }
      }
    }
  });

  it('листы v2 в памяти в разы меньше полного листа', () => {
    let full = 0;
    let packed = 0;
    for (const def of Object.values(registry).filter((d) => d.source === 'v2')) {
      const p = packSheet(def)!;
      const rows = Math.max(...Object.values(def.anims).map((a) => a!.row)) + 1;
      full += def.cell[0] * def.columns * def.cell[1] * rows;
      packed += p.width * p.height;
    }
    expect(packed / full).toBeLessThan(0.2);
  });

  it('эффект: габариты каждого кадра по альфе, пустой кадр — 1×1', () => {
    // Сетка 2×2 клетки 10×8, 3 кадра: кадр 0 — пиксели (2,3) и (5,6), кадр 1 — пусто, кадр 2 — (9,7).
    const cell: [number, number] = [10, 8];
    const width = 20;
    const rgba = new Uint8ClampedArray(width * 16 * 4);
    const put = (x: number, y: number) => (rgba[(y * width + x) * 4 + 3] = 255);
    put(2, 3);
    put(5, 6);
    put(0 * 10 + 9, 8 + 7);
    const p = packAlphaGrid(rgba, width, cell, 2, 3)!;
    const f = (n: number) => p.frames.find((x) => x.name === n)!;
    expect([f(0).dx, f(0).dy, f(0).w, f(0).h, f(0).sx, f(0).sy]).toEqual([2, 3, 4, 4, 2, 3]);
    expect([f(1).w, f(1).h]).toEqual([1, 1]);
    expect([f(2).dx, f(2).dy, f(2).w, f(2).h, f(2).sx, f(2).sy]).toEqual([9, 7, 1, 1, 9, 15]);
  });
});
