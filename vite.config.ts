import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { ASSETS_DIR, collectUsedAssets } from './scripts/lib/used-assets.ts';

/**
 * O: в dist попадают только ассеты, которые игра может запросить (scripts/lib/used-assets.ts),
 * по тем же относительным путям, что и в assets/ — URL в рантайме не меняются.
 * Отчёт: `npm run assets:report`.
 */
function usedAssetsPlugin(): Plugin {
  const root = import.meta.dirname;
  return {
    name: 'idle-rpg:used-assets',
    apply: 'build',
    generateBundle() {
      const used = collectUsedAssets(root);
      for (const file of used.files) {
        const src = join(root, ASSETS_DIR, file);
        if (!existsSync(src)) {
          this.warn(`assets/${file} не найден (ссылки: ${used.refs[file].join(', ')}) — в игре будет плейсхолдер`);
          continue;
        }
        this.emitFile({ type: 'asset', fileName: file, source: readFileSync(src) });
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  // Арт лежит в assets/ и отдаётся с корня, пути берутся из assets/manifest.json.
  // В dev отдаём всю папку; при сборке копирует только нужное usedAssetsPlugin.
  publicDir: command === 'build' ? false : 'assets',
  base: './',
  plugins: [usedAssetsPlugin()],
  // Phaser целиком ~1.2 МБ — это нормально для Mini App
  build: { chunkSizeWarningLimit: 2000 },
  server: { host: true },
  test: {
    include: ['tests/**/*.test.ts'],
  },
}));
