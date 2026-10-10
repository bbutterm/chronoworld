/**
 * Листы мелких иконок для пакета загрузки (vite.config.ts, docs/qa/load-2026-10-10.md).
 *
 * Экран загрузки получал ~200 значков 24×24 (ui/icons/item_*, skill_*) отдельными картинками: у каждой — свой
 * blob:-адрес, загрузка <img>, декодирование. На слабом телефоне это сотни миллисекунд-секунды главного потока, хотя
 * байт там всего ~50 КБ. Здесь они склеиваются в несколько листов PNG с палитрой (≤ 256 цветов на лист), а игра
 * (BootScene) нарезает лист на те же текстуры под теми же ключами.
 *
 * Без потерь и без сторонних библиотек (только zlib из Node): берутся только PNG без чересстрочности, 8 бит на канал
 * (палитра — 1/2/4/8 бит) и с «двоичной» прозрачностью (альфа 0 или 255) — такие пиксели проходят через canvas
 * без изменений. Полностью прозрачный пиксель хранится как (0, 0, 0, 0). Всё остальное остаётся отдельным файлом.
 */
import { deflateSync, inflateSync } from 'node:zlib';

export interface Rgba {
  width: number;
  height: number;
  /** RGBA, 4 байта на пиксель. */
  data: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: Buffer[]): number {
  let c = 0xffffffff;
  for (const b of parts) for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** PNG → RGBA. null — формат, который здесь не поддержан (файл останется отдельной картинкой). */
export function decodePng(png: Buffer): Rgba | null {
  if (png.length < 33 || !png.subarray(0, 8).equals(SIGNATURE)) return null;
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = -1;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (pos + 8 <= png.length) {
    const len = png.readUInt32BE(pos);
    const name = png.toString('latin1', pos + 4, pos + 8);
    const body = png.subarray(pos + 8, pos + 8 + len);
    if (body.length !== len) return null;
    if (name === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      type = body[9];
      if (body[10] !== 0 || body[11] !== 0 || body[12] !== 0) return null; // сжатие/фильтр/чересстрочность
    } else if (name === 'PLTE') palette = body;
    else if (name === 'tRNS') trns = body;
    else if (name === 'IDAT') idat.push(body);
    else if (name === 'IEND') break;
    pos += 12 + len;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!channels || !width || !height) return null;
  if (type === 3 ? ![1, 2, 4, 8].includes(depth) || !palette : depth !== 8) return null;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const bpp = Math.max(1, (channels * depth) >> 3);
  const stride = (width * channels * depth + 7) >> 3;
  if (raw.length < height * (stride + 1)) return null;
  const rows = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = rows.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0;
      const b = up ? up[i] : 0;
      const c = up && i >= bpp ? up[i - bpp] : 0;
      let v: number;
      if (f === 0) v = src[i];
      else if (f === 1) v = src[i] + a;
      else if (f === 2) v = src[i] + b;
      else if (f === 3) v = src[i] + ((a + b) >> 1);
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = src[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else return null;
      out[i] = v & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = rows.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (type === 3) {
        const perByte = 8 / depth;
        const idx = depth === 8 ? row[x] : (row[Math.floor(x / perByte)] >> ((perByte - 1 - (x % perByte)) * depth)) & ((1 << depth) - 1);
        if (idx * 3 + 2 >= palette!.length) return null;
        data[o] = palette![idx * 3];
        data[o + 1] = palette![idx * 3 + 1];
        data[o + 2] = palette![idx * 3 + 2];
        data[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (type === 0 || type === 4) {
        const g = row[x * channels];
        data[o] = data[o + 1] = data[o + 2] = g;
        data[o + 3] = type === 4 ? row[x * 2 + 1] : trns && trns.length >= 2 && trns.readUInt16BE(0) === g ? 0 : 255;
      } else {
        data[o] = row[x * channels];
        data[o + 1] = row[x * channels + 1];
        data[o + 2] = row[x * channels + 2];
        data[o + 3] =
          type === 6
            ? row[x * 4 + 3]
            : trns && trns.length >= 6 && trns.readUInt16BE(0) === data[o] && trns.readUInt16BE(2) === data[o + 1] && trns.readUInt16BE(4) === data[o + 2]
              ? 0
              : 255;
      }
    }
  }
  return { width, height, data };
}

function chunk(name: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(name, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32([head.subarray(4), body]), 0);
  return Buffer.concat([head, body, crc]);
}

/** Индексы палитры (1 байт на пиксель) → PNG с палитрой и tRNS. Строки без фильтра или «вверх» — что короче. */
export function encodeIndexedPng(width: number, height: number, indices: Uint8Array, palette: readonly number[]): Buffer {
  const filtered = (filter: 0 | 2) => {
    const raw = Buffer.alloc(height * (width + 1));
    for (let y = 0; y < height; y++) {
      raw[y * (width + 1)] = filter;
      for (let x = 0; x < width; x++) {
        const v = indices[y * width + x];
        raw[y * (width + 1) + 1 + x] = filter === 2 && y > 0 ? (v - indices[(y - 1) * width + x]) & 0xff : v;
      }
    }
    return deflateSync(raw, { level: 9 });
  };
  const a = filtered(0);
  const b = filtered(2);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  const plte = Buffer.alloc(palette.length * 3);
  const trns = Buffer.alloc(palette.length);
  palette.forEach((c, i) => {
    plte[i * 3] = (c >>> 24) & 0xff;
    plte[i * 3 + 1] = (c >>> 16) & 0xff;
    plte[i * 3 + 2] = (c >>> 8) & 0xff;
    trns[i] = c & 0xff;
  });
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('tRNS', trns), chunk('IDAT', a.length <= b.length ? a : b), chunk('IEND', Buffer.alloc(0))]);
}

/** Где в листе лежит файл: лист (путь в пакете) и прямоугольник [x, y, w, h]. */
export type SheetSlot = [sheet: string, x: number, y: number, w: number, h: number];

export interface BootSheets {
  /** Путь листа в пакете → PNG. */
  sheets: Map<string, Buffer>;
  /** Путь файла в assets/ → место в листе. */
  slots: Record<string, SheetSlot>;
}

/** Цвета картинки (RGBA как одно число), или null, если есть полупрозрачность. Прозрачное — 0. */
function colorsOf(img: Rgba): Set<number> | null {
  const out = new Set<number>();
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] !== 0 && d[i + 3] !== 255) return null;
    out.add(d[i + 3] ? ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | 255) >>> 0 : 0);
  }
  return out;
}

const PALETTE = 256;

/**
 * Склеить подходящие картинки (`files`: путь → PNG) в листы. Подходят PNG ровно cell×cell с двоичной альфой.
 * Раскладка детерминирована (пути по алфавиту, первый лист, где хватает палитры), `columns` клеток в ряд.
 * Меньше `minFiles` подходящих — листов нет (не стоит лишнего декодирования).
 */
export function buildBootSheets(files: ReadonlyMap<string, Buffer>, { cell = 24, columns = 16, prefix = 'sheet/icons', minFiles = 8 } = {}): BootSheets {
  const groups: { colors: Set<number>; items: [string, Rgba][] }[] = [];
  for (const path of [...files.keys()].sort()) {
    if (!path.endsWith('.png')) continue;
    const img = decodePng(files.get(path)!);
    if (!img || img.width !== cell || img.height !== cell) continue;
    const colors = colorsOf(img);
    if (!colors || colors.size > PALETTE) continue;
    let group = groups.find((g) => {
      let n = g.colors.size;
      for (const c of colors) if (!g.colors.has(c) && ++n > PALETTE) return false;
      return true;
    });
    // Прозрачный цвет (0) — в палитре каждого листа всегда: им заполнены пустые клетки.
    if (!group) groups.push((group = { colors: new Set([0]), items: [] }));
    for (const c of colors) group.colors.add(c);
    group.items.push([path, img]);
  }
  const sheets = new Map<string, Buffer>();
  const slots: Record<string, SheetSlot> = {};
  if (groups.reduce((n, g) => n + g.items.length, 0) < minFiles) return { sheets, slots };
  groups.forEach((g, gi) => {
    const palette = [...g.colors].sort((a, b) => a - b);
    const index = new Map(palette.map((c, i) => [c, i]));
    const cols = Math.min(columns, g.items.length);
    const rows = Math.ceil(g.items.length / cols);
    const width = cols * cell;
    const height = rows * cell;
    const pixels = new Uint8Array(width * height).fill(index.get(0)!);
    const name = `${prefix}-${gi}.png`;
    g.items.forEach(([path, img], i) => {
      const ox = (i % cols) * cell;
      const oy = Math.floor(i / cols) * cell;
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          const o = (y * cell + x) * 4;
          const d = img.data;
          const c = d[o + 3] ? ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | 255) >>> 0 : 0;
          pixels[(oy + y) * width + ox + x] = index.get(c)!;
        }
      }
      slots[path] = [name, ox, oy, cell, cell];
    });
    sheets.set(name, encodeIndexedPng(width, height, pixels, palette));
  });
  return { sheets, slots };
}
