/**
 * O: какие файлы из assets/ игра может запросить во время работы.
 * Используется сборкой (vite.config.ts копирует в dist только их), `npm run assets:report` и тестами.
 *
 * Что считается нужным:
 *   - все `file` / `atlasXml` из assets/manifest.json (BootScene грузит манифест целиком);
 *   - из реестра спрайтов (legacy + v2, v2 перекрывает по id) — только спрайты, на которые ссылается контент
 *     (visual.sprite у юнитов и профессий): лист `file` и `portrait`.
 * JSON-файлы manifest.json, sprites.json, sprites.legacy.json импортируются в бандл при сборке — копировать не нужно.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildRegistry, type LegacySprites, type SpritesV2 } from '../../src/pipeline/sprites.ts';

export const ASSETS_DIR = 'assets';

interface ManifestEntry {
  file?: string | null;
  atlasXml?: string;
}
export interface AssetInputs {
  manifest: { assets: Record<string, ManifestEntry> };
  legacy?: LegacySprites;
  v2?: SpritesV2;
  /** id спрайтов, на которые ссылается контент. */
  spriteIds: Iterable<string>;
}

export interface UsedAssets {
  /** Пути внутри assets/ (как в манифесте и реестре), отсортированы. */
  files: string[];
  /** Кто ссылается на файл: `manifest:<id>` / `sprite:<id>`. */
  refs: Record<string, string[]>;
  /** Спрайты из контента, которых нет в реестре (в игре будут плейсхолдеры). */
  missingSprites: string[];
}

const clean = (p: string) => p.replace(/^\.?\//, '');

/** Чистая часть: входные данные → список нужных файлов. */
export function usedAssets(input: AssetInputs): UsedAssets {
  const refs: Record<string, string[]> = {};
  const add = (file: string | null | undefined, ref: string) => {
    if (!file) return;
    (refs[clean(file)] ??= []).push(ref);
  };
  for (const [id, a] of Object.entries(input.manifest.assets)) {
    if (!a.file) continue;
    add(a.file, `manifest:${id}`);
    add(a.atlasXml, `manifest:${id}`);
  }
  const registry = buildRegistry(input.legacy, input.v2);
  const missingSprites: string[] = [];
  for (const id of [...new Set(input.spriteIds)].sort()) {
    const s = registry[id];
    if (!s) {
      missingSprites.push(id);
      continue;
    }
    add(s.file, `sprite:${id}`);
    add(s.portrait, `sprite:${id}`);
  }
  return { files: Object.keys(refs).sort(), refs, missingSprites };
}

const readJson = <T>(path: string): T | undefined => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : undefined);

/** id спрайтов из data/units и data/jobs (visual.sprite) — без полной сборки контента, чтобы не зависеть от её ошибок. */
export function contentSpriteIds(root: string): string[] {
  const ids = new Set<string>();
  for (const dir of ['data/units', 'data/jobs']) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs).filter((n) => n.endsWith('.json'))) {
      const data = readJson<{ visual?: { sprite?: unknown } }>(join(abs, f));
      const sprite = data?.visual?.sprite;
      if (typeof sprite === 'string' && sprite) ids.add(sprite);
    }
  }
  return [...ids].sort();
}

/** Нужные файлы для репозитория в `root` (читает assets/ и data/ с диска). */
export function collectUsedAssets(root: string): UsedAssets {
  const assets = join(root, ASSETS_DIR);
  return usedAssets({
    manifest: readJson(join(assets, 'manifest.json')) ?? { assets: {} },
    legacy: readJson(join(assets, 'sprites.legacy.json')),
    v2: readJson(join(assets, 'sprites/sprites.json')),
    spriteIds: contentSpriteIds(root),
  });
}

/** Все файлы в assets/ (пути внутри assets/, через `/`). */
export function listAssetFiles(root: string): string[] {
  const base = join(root, ASSETS_DIR);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(base, p).split('\\').join('/'));
    }
  };
  if (existsSync(base)) walk(base);
  return out.sort();
}
