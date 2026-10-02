import type Phaser from 'phaser';
import type { PackedSheet } from '../pipeline/sheetPack';

/**
 * Текстура из упакованных кадров листа (src/pipeline/sheetPack.ts): кадры копируются из картинки 1:1 (без масштаба)
 * на плотный canvas, каждый кадр получает trim — для спрайта он размером с клетку (realWidth × realHeight), так что
 * origin, отражение и setDisplaySize работают как с полным листом. Имена кадров — как у addSpriteSheet.
 */
export function addPackedTexture(
  tm: Phaser.Textures.TextureManager,
  key: string,
  img: HTMLImageElement,
  pack: PackedSheet,
  cell: [number, number],
): Phaser.Textures.Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = pack.width;
  canvas.height = pack.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  for (const f of pack.frames) ctx.drawImage(img, f.sx, f.sy, f.w, f.h, f.x, f.y, f.w, f.h);
  // create, а не addCanvas: CanvasTexture сразу снимает getImageData — ещё одна копия пикселей в памяти.
  const tex = tm.create(key, canvas, pack.width, pack.height);
  if (!tex) return null;
  tex.add('__BASE', 0, 0, 0, pack.width, pack.height);
  for (const f of pack.frames) tex.add(f.name, 0, f.x, f.y, f.w, f.h)?.setTrim(cell[0], cell[1], f.dx, f.dy, f.w, f.h);
  return tex;
}

/** Пиксели картинки (RGBA) — для габаритов кадров по альфе. Временный canvas освобождается сразу. */
export function imagePixels(img: HTMLImageElement): Uint8ClampedArray | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  canvas.width = 0;
  canvas.height = 0;
  return data;
}

/** Место кадра в атласе (x, y — левый верхний угол самого кадра, без поля). */
export interface AtlasSlot {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Упаковка прямоугольников полками (без Phaser — проверяется в тестах): по убыванию высоты, слева направо.
 * Вокруг каждого кадра поле `gutter`: туда растягивается кромка кадра (blitExtruded), чтобы линейная фильтрация у края
 * брала пиксели самого кадра — как CLAMP_TO_EDGE у отдельной текстуры. Ширина атласа ≤ maxW, высота — по содержимому.
 */
export function shelfPack(items: readonly { key: string; w: number; h: number }[], maxW: number, gutter: number): { width: number; height: number; slots: AtlasSlot[] } {
  const order = [...items].sort((a, b) => b.h - a.h || b.w - a.w || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const slots: AtlasSlot[] = [];
  let x = 0;
  let y = 0;
  let shelf = 0;
  let width = 0;
  for (const it of order) {
    const cw = it.w + gutter * 2;
    const ch = it.h + gutter * 2;
    if (cw > maxW) throw new Error(`Кадр ${it.key} шире атласа (${it.w} > ${maxW - gutter * 2})`);
    if (x + cw > maxW) {
      y += shelf;
      x = 0;
      shelf = 0;
    }
    slots.push({ key: it.key, x: x + gutter, y: y + gutter, w: it.w, h: it.h });
    x += cw;
    shelf = Math.max(shelf, ch);
    width = Math.max(width, x);
  }
  return { width, height: y + shelf, slots };
}

/**
 * Скопировать кадр в атлас 1:1 (целые координаты — пиксели те же, что в отдельном canvas) и растянуть его крайние
 * строки и столбцы на поле gutter, углы — пикселем угла.
 */
export function blitExtruded(ctx: CanvasRenderingContext2D, src: CanvasImageSource, s: AtlasSlot, gutter: number): void {
  const { x, y, w, h } = s;
  ctx.drawImage(src, 0, 0, w, h, x, y, w, h);
  if (gutter <= 0) return;
  const g = gutter;
  ctx.drawImage(src, 0, 0, w, 1, x, y - g, w, g);
  ctx.drawImage(src, 0, h - 1, w, 1, x, y + h, w, g);
  ctx.drawImage(src, 0, 0, 1, h, x - g, y, g, h);
  ctx.drawImage(src, w - 1, 0, 1, h, x + w, y, g, h);
  ctx.drawImage(src, 0, 0, 1, 1, x - g, y - g, g, g);
  ctx.drawImage(src, w - 1, 0, 1, 1, x + w, y - g, g, g);
  ctx.drawImage(src, 0, h - 1, 1, 1, x - g, y + h, g, g);
  ctx.drawImage(src, w - 1, h - 1, 1, 1, x + w, y + h, g, g);
}

/**
 * Текстуры-«псевдонимы» над общим атласом: у каждого ключа свой объект Texture (его кадр __BASE — место в атласе),
 * но источник (и текстура в GPU) — один, атласа. Код, который рисует `scene.add.image(x, y, 'skin_btn')` или
 * nineslice по ключу, не меняется, а все такие картинки занимают один слот батча WebGL — меньше draw calls.
 * Удаление псевдонима не трогает общий источник. Ключи, которые уже есть, пропускаются. Возвращает, сколько добавлено.
 */
export function addAtlasAliases(tm: Phaser.Textures.TextureManager, atlas: Phaser.Textures.Texture, slots: readonly AtlasSlot[]): number {
  const TextureClass = atlas.constructor as typeof Phaser.Textures.Texture;
  const shared = atlas.source[0];
  let n = 0;
  for (const s of slots) {
    if (tm.exists(s.key)) continue;
    // Пустой список источников: свой TextureSource не создаётся (иначе — своя копия в GPU), кладём общий.
    const t = new TextureClass(tm, s.key, [] as unknown as HTMLImageElement);
    t.source.push(shared);
    t.add('__BASE', 0, s.x, s.y, s.w, s.h);
    const destroy = t.destroy;
    t.destroy = function (this: Phaser.Textures.Texture) {
      this.source = [];
      destroy.call(this);
    };
    (tm.list as Record<string, Phaser.Textures.Texture>)[s.key] = t;
    n++;
  }
  return n;
}
