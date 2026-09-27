/**
 * Конвертирует старые листы assets/ro/manifest.json в реестр спрайтов (assets/sprites.legacy.json).
 *   npm run assets:legacy
 * Нужно, пока нет листов v2: игра читает только единый формат реестра.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnimName, LegacySprites } from '../src/pipeline/sprites';
import { ROOT } from './lib/content-node';

interface RoSprite {
  key: string;
  kind: string;
  sheet: string;
  cell_px: [number, number];
  columns: number;
  portrait?: string;
  actions: Record<string, { row: number; frame_count: number; duration_ms: number[] }>;
}

const ro = JSON.parse(readFileSync(join(ROOT, 'assets/ro/manifest.json'), 'utf8')) as { sprites: RoSprite[] };

// id в игре отличаются от имён файлов RO.
const RENAME: Record<string, string> = { priestess: 'priest' };
// В старых листах героев ряд idle — стойка спиной; боевая стойка — ready.
const HERO_ROWS: Record<string, AnimName> = { ready: 'idle', attack: 'attack', hurt: 'hurt', death: 'death' };
const MOB_ROWS: Record<string, AnimName> = { idle: 'idle', walk: 'walk', attack: 'attack', hurt: 'hurt', death: 'death' };
// Размер клетки на экране: около 250 px для обычных, 375 px для боссов.
const SCREEN_CELL = 250;

const out: LegacySprites = { sprites: [] };
for (const s of ro.sprites) {
  const map = s.kind === 'hero' ? HERO_ROWS : MOB_ROWS;
  const anims: LegacySprites['sprites'][number]['anims'] = {};
  for (const [from, to] of Object.entries(map)) {
    const a = s.actions[from];
    if (!a) continue;
    anims[to] = { row: a.row, frames: a.frame_count, ms: a.duration_ms, loop: to === 'idle' || to === 'walk' };
  }
  const [w, h] = s.cell_px;
  out.sprites.push({
    id: RENAME[s.key] ?? s.key,
    file: s.sheet.replace(/^assets\//, ''),
    cell: [w, h],
    anchor: [w / 2, h - 6],
    columns: s.columns,
    scale: Math.round(((SCREEN_CELL * (w / 320)) / w) * 1000) / 1000,
    anims,
    portrait: s.portrait?.replace(/^assets\//, ''),
  });
}
writeFileSync(join(ROOT, 'assets/sprites.legacy.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`assets/sprites.legacy.json: ${out.sprites.length} спрайтов`);
