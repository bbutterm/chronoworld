import { PACKS, WEBP, type AssetPack } from 'virtual:asset-pack';

/**
 * Адреса картинок в прод-сборке (docs/content/performance.md, «Загрузка»):
 *   - WebP без потерь вместо PNG, если браузер его показывает и у файла есть WebP-копия (≈ −40 % байт, пиксели те же);
 *   - «пакет загрузки»: всё, что грузит экран загрузки, одним хэшированным файлом (один запрос вместо ~85).
 * В dev (vite serve) и в тестах пакета и копий нет — всё как раньше, PNG по своим путям.
 * Без Phaser: модуль читают и чистые помощники.
 */

const webpSet = new Set(WEBP);
let webp = false;

/**
 * Проверка WebP (с альфой, без потерь) — асинхронная: декодируем картинку 1×1. Запускается при загрузке модуля
 * (main.ts импортирует его задолго до экрана загрузки); пока ответа нет, считаем, что WebP нет, — берутся PNG.
 */
export const webpReady: Promise<boolean> =
  typeof Image === 'undefined' || webpSet.size === 0
    ? Promise.resolve(false)
    : new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve((webp = img.width === 1 && img.height === 1));
        img.onerror = () => resolve(false);
        img.src = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';
      });

const clean = (path: string) => path.replace(/^\.?\//, '');

/** URL файла из assets/ (путь как в манифесте/реестре): WebP-копия, если есть и браузер умеет, иначе сам файл. */
export function assetUrl(path: string): string {
  const p = clean(path);
  return webp && webpSet.has(p) ? `webp/${p.slice(0, -'.png'.length)}.webp` : path;
}

/** Пакет загрузки под этот браузер (null — dev или сборка без пакета). */
export function bootPack(): AssetPack | null {
  if (!PACKS) return null;
  return webp ? PACKS.webp : PACKS.png;
}

/**
 * Разложить загруженный пакет на blob:-адреса (путь в assets/ → URL). Загрузчик Phaser берёт файлы по ним —
 * без сети. После загрузки адреса освобождает revokePack.
 */
export function unpack(pack: AssetPack, data: ArrayBuffer): Map<string, string> {
  const out = new Map<string, string>();
  // Один Blob на весь пакет и срезы без копирования.
  const all = new Blob([data]);
  for (const [path, [offset, length, type]] of Object.entries(pack.files)) {
    if (offset + length > data.byteLength) continue;
    out.set(path, URL.createObjectURL(all.slice(offset, offset + length, type)));
  }
  return out;
}

export function revokePack(urls: Map<string, string>): void {
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
}

export const packPath = clean;

/** Место значка в листе пакета: [лист — путь в пакете, x, y, w, h] (scripts/lib/boot-sheets.ts). */
export type SheetSlot = [sheet: string, x: number, y: number, w: number, h: number];

/** Значок склеен в лист пакета загрузки — где он там лежит (или undefined: обычный файл). */
export function sheetSlot(pack: AssetPack, path: string): SheetSlot | undefined {
  return pack.sheets?.[clean(path)];
}

/**
 * Листы значков из пакета: одна картинка на лист, декодируется один раз (а не картинка на каждый значок).
 * null — лист не загрузился (значки тогда грузятся отдельными файлами).
 */
export function sheetLoader(urls: ReadonlyMap<string, string>): (sheet: string) => Promise<HTMLImageElement | null> {
  const images = new Map<string, Promise<HTMLImageElement | null>>();
  return (sheet) => {
    let p = images.get(sheet);
    if (!p) {
      const url = urls.get(sheet);
      p = url
        ? new Promise((resolve) => {
            const img = new Image();
            img.onload = () => void img.decode().then(() => resolve(img), () => resolve(img));
            img.onerror = () => resolve(null);
            img.src = url;
          })
        : Promise.resolve(null);
      images.set(sheet, p);
    }
    return p;
  };
}

/**
 * Значок из листа — отдельный canvas его размера (Phaser делает из него текстуру под ключом значка, как из картинки).
 * Пиксели те же: в листах только непрозрачные и полностью прозрачные пиксели, canvas их не меняет.
 */
export function sheetPiece(img: HTMLImageElement, [, x, y, w, h]: SheetSlot): HTMLCanvasElement | null {
  if (x + w > img.width || y + h > img.height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  return canvas;
}
