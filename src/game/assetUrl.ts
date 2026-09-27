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
