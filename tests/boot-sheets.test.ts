/**
 * Листы иконок пакета загрузки (scripts/lib/boot-sheets.ts, docs/qa/load-2026-10-10.md): склейка без потерь —
 * каждая иконка, вырезанная из листа, совпадает со своим PNG пиксель в пиксель; полупрозрачные и не 24×24 — отдельно.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildBootSheets, decodePng, encodeIndexedPng } from '../scripts/lib/boot-sheets';

const DIR = 'assets/ui/icons';
const files = new Map<string, Buffer>(readdirSync(DIR).filter((f) => f.endsWith('.png')).map((f) => [`ui/icons/${f}`, readFileSync(`${DIR}/${f}`)] as const));

describe('листы иконок пакета загрузки', () => {
  it('PNG с палитрой: запись и чтение без потерь', () => {
    const idx = Uint8Array.from([0, 1, 1, 0]);
    const img = decodePng(encodeIndexedPng(2, 2, idx, [0, 0xff0000ff]))!;
    expect([...img.data]).toEqual([0, 0, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0]);
  });

  it('каждая иконка из листа совпадает со своим файлом; раскладка детерминирована', () => {
    const { sheets, slots } = buildBootSheets(files);
    expect(Object.keys(slots).length).toBeGreaterThan(100);
    const decoded = new Map([...sheets].map(([k, v]) => [k, decodePng(v)!]));
    for (const [path, [sheet, x, y, w, h]] of Object.entries(slots)) {
      const src = decodePng(files.get(path)!)!;
      const s = decoded.get(sheet)!;
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++) {
          const a = ((y + j) * s.width + x + i) * 4;
          const b = (j * w + i) * 4;
          const px = src.data[b + 3] ? [...src.data.slice(b, b + 4)] : [0, 0, 0, 0];
          expect([...s.data.slice(a, a + 4)], `${path} ${i},${j}`).toEqual(px);
        }
    }
    expect(Object.keys(buildBootSheets(files).slots)).toEqual(Object.keys(slots));
  });
});
