/// <reference types="vite/client" />

/** Пакет загрузки и WebP-копии ассетов — генерирует сборка (vite.config.ts, assetPackPlugin); в dev пусто. */
declare module 'virtual:asset-pack' {
  /** Пакет: url файла (от корня сайта) и где в нём лежит каждый файл: путь в assets/ → [смещение, длина, MIME]. */
  export interface AssetPack {
    url: string;
    bytes: number;
    files: Record<string, [number, number, string]>;
    /** Значки, склеенные в листы (scripts/lib/boot-sheets.ts): путь в assets/ → [лист — ключ в files, x, y, w, h]. */
    sheets?: Record<string, [string, number, number, number, number]>;
  }
  /** Два варианта пакета: только PNG и с WebP там, где он есть (выбирается по поддержке WebP). null — dev. */
  export const PACKS: { png: AssetPack; webp: AssetPack } | null;
  /** PNG (пути в assets/), у которых в dist есть WebP-копия: webp/<путь без .png>.webp. */
  export const WEBP: readonly string[];
}
