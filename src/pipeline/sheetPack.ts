/**
 * Упаковка листа юнита в памяти (без Phaser — проверяется в тестах; docs/content/performance.md, «Листы юнитов»).
 *
 * Лист v2 — сетка клеток родного размера RO: клетка 224×192…340×376, а фигура в ней занимает ~10 %, плюс пустые
 * клетки у анимаций короче 8 кадров. Целиком в видеопамяти лист весит 8–15 МБ (w×h×4), бой из 10 листов — >100 МБ.
 * Поэтому после загрузки из листа вырезаются только кадры, которые игра проигрывает, каждый — по габаритам своей
 * анимации (bbox в sprites.json, объединение всех её кадров), и складываются плотно. Пиксели копируются 1:1 (без
 * масштаба и пересжатия), а кадры получают «обрезку» (trim) Phaser: размер кадра для спрайта остаётся размером клетки,
 * точка ног и отражение работают как с полным листом.
 * Эффекты боя (assets/effects) ужимаются так же, но габариты кадров считаются по альфе при загрузке (packAlphaGrid).
 */
import type { SpriteDef } from './sprites';

/** Прозрачный зазор между кадрами, px: фильтр NEAREST на дробном масштабе не цепляет соседа. */
export const PACK_GAP = 1;
/** Предел стороны текстуры (как у листов). */
export const PACK_MAX = 2048;

export interface PackedFrame {
  /** Имя кадра — как у addSpriteSheet: ряд × колонки + колонка. */
  name: number;
  /** Откуда в исходном листе. */
  sx: number;
  sy: number;
  w: number;
  h: number;
  /** Куда в упакованной текстуре. */
  x: number;
  y: number;
  /** Смещение вырезки внутри клетки (trim). */
  dx: number;
  dy: number;
}

export interface PackedSheet {
  width: number;
  height: number;
  frames: PackedFrame[];
}

/** Нужные кадры листа: по анимациям реестра (с учётом пропусков fixes.json) и всегда кадр 0 — с него создаётся спрайт. */
function wantedFrames(def: SpriteDef): FrameCut[] {
  const [cw, ch] = def.cell;
  const out = new Map<number, FrameCut>();
  const boxOf = (anim: string): [number, number, number, number] => {
    const b = def.boxes?.[anim];
    if (!b) return [0, 0, cw, ch];
    const x0 = Math.max(0, Math.min(cw, b[0]));
    const y0 = Math.max(0, Math.min(ch, b[1]));
    return [x0, y0, Math.max(x0 + 1, Math.min(cw, b[2])), Math.max(y0 + 1, Math.min(ch, b[3]))];
  };
  for (const [anim, a] of Object.entries(def.anims)) {
    if (!a) continue;
    const box = boxOf(anim);
    for (let i = 0; i < a.frames; i++) {
      const col = a.cols?.[i] ?? i;
      const name = a.row * def.columns + col;
      if (!out.has(name)) out.set(name, { name, row: a.row, col, box });
    }
  }
  if (!out.has(0)) {
    const idle = Object.entries(def.anims).find(([, a]) => a?.row === 0)?.[0];
    out.set(0, { name: 0, row: 0, col: 0, box: idle ? boxOf(idle) : [0, 0, cw, ch] });
  }
  return [...out.values()];
}

function shelf(items: { w: number; h: number }[], width: number): { pos: [number, number][]; w: number; h: number } {
  const pos: [number, number][] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  let maxW = 0;
  for (const it of items) {
    if (x > 0 && x + it.w > width) {
      y += rowH + PACK_GAP;
      x = 0;
      rowH = 0;
    }
    pos.push([x, y]);
    x += it.w + PACK_GAP;
    maxW = Math.max(maxW, x - PACK_GAP);
    rowH = Math.max(rowH, it.h);
  }
  return { pos, w: maxW, h: y + rowH };
}

/** Кадр до раскладки: имя, клетка (ряд, колонка) и вырезка в клетке [x0, y0, x1, y1]. */
export interface FrameCut {
  name: number;
  row: number;
  col: number;
  box: [number, number, number, number];
}

/**
 * Раскладка кадров: полки, кадры по убыванию высоты; ширина полки подбирается под наименьшую площадь текстуры.
 * null — раскладка не влезла в PACK_MAX.
 */
export function packFrames(cuts: FrameCut[], cell: [number, number]): PackedSheet | null {
  const [cw, ch] = cell;
  const frames = cuts.map((f) => ({ ...f, w: f.box[2] - f.box[0], h: f.box[3] - f.box[1] }));
  if (!frames.length) return null;
  // Устойчивый порядок: по высоте, затем по имени — одинаковые анимации ложатся рядом.
  frames.sort((a, b) => b.h - a.h || a.name - b.name);
  const minW = Math.max(...frames.map((f) => f.w));
  let best: { pos: [number, number][]; w: number; h: number } | null = null;
  for (let width = minW; width <= PACK_MAX; width += 16) {
    const r = shelf(frames, width);
    if (r.h > PACK_MAX) continue;
    if (!best || r.w * r.h < best.w * best.h) best = r;
  }
  if (!best) return null;
  const layout = best;
  return {
    width: layout.w,
    height: layout.h,
    frames: frames.map((f, i) => ({
      name: f.name,
      sx: f.col * cw + f.box[0],
      sy: f.row * ch + f.box[1],
      w: f.w,
      h: f.h,
      x: layout.pos[i][0],
      y: layout.pos[i][1],
      dx: f.box[0],
      dy: f.box[1],
    })),
  };
}

/**
 * Лист юнита: кадры анимаций по bbox анимации из sprites.json (без чтения пикселей). Нет bbox у анимации — кадр
 * целой клеткой. null — лист грузится как есть: старые листы без bbox (legacy) или раскладка не влезла в PACK_MAX.
 */
export function packSheet(def: SpriteDef): PackedSheet | null {
  if (!def.boxes) return null;
  return packFrames(wantedFrames(def), def.cell);
}

/**
 * Лист эффекта (сетка columns × ряды, кадры 0..frames-1 по порядку): у эффектов bbox в каталоге нет, поэтому габариты
 * каждого кадра — по альфе пикселей (rgba — данные getImageData всего листа шириной width). Пустой кадр — 1×1
 * прозрачный. null — раскладка не влезла.
 */
export function packAlphaGrid(rgba: ArrayLike<number>, width: number, cell: [number, number], columns: number, frames: number): PackedSheet | null {
  const [cw, ch] = cell;
  const cuts: FrameCut[] = [];
  for (let i = 0; i < frames; i++) {
    const row = Math.floor(i / columns);
    const col = i % columns;
    let x0 = cw;
    let y0 = ch;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < ch; y++) {
      let p = ((row * ch + y) * width + col * cw) * 4 + 3;
      for (let x = 0; x < cw; x++, p += 4) {
        if (!rgba[p]) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
    // Пустой кадр — 1×1 из угла клетки (там прозрачно: иначе bbox был бы непустым).
    cuts.push({ name: i, row, col, box: x1 < 0 ? [0, 0, 1, 1] : [x0, y0, x1 + 1, y1 + 1] });
  }
  return packFrames(cuts, cell);
}
