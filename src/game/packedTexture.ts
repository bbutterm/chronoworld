import Phaser from 'phaser';
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
