/**
 * O: какие файлы из assets/ игра может запросить во время работы.
 * Используется сборкой (vite.config.ts копирует в dist только их), `npm run assets:report` и тестами.
 *
 * Что считается нужным:
 *   - все `file` / `atlasXml` из assets/manifest.json (BootScene грузит манифест целиком);
 *   - анимированные кадры из assets/effects/effects.json (отдельно от статичных fallback);
 *   - из реестра спрайтов (legacy + v2, v2 перекрывает по id) — только спрайты, на которые ссылается контент
 *     (visual.sprite у юнитов и профессий): лист `file` и `portrait`.
 * JSON-файлы manifest.json, sprites.json, sprites.legacy.json импортируются в бандл при сборке — копировать не нужно.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildRegistry, type LegacySprites, type SpritesV2 } from '../../src/pipeline/sprites.ts';
import { AMBIENCE, MUSIC } from '../../src/game/audioCatalog.ts';

export const ASSETS_DIR = 'assets';

interface ManifestEntry {
  file?: string | null;
  atlasXml?: string;
}
export interface AssetInputs {
  manifest: { assets: Record<string, ManifestEntry> };
  effects?: { effects: { id: string; file: string }[] };
  legacy?: LegacySprites;
  v2?: SpritesV2;
  /** id спрайтов, на которые ссылается контент. */
  spriteIds: Iterable<string>;
  /** Значки навыков от художника: пути внутри assets/ (ui/icons/skill_<id>.png) — грузятся все, что есть. */
  skillIcons?: string[];
  /** Прочие файлы, которые игра находит по имени (бюсты RO, фоны глав): пути внутри assets/. */
  extra?: string[];
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
  for (const effect of input.effects?.effects ?? []) add(effect.file, `effect:${effect.id}`);
  for (const file of input.skillIcons ?? []) add(file, `skillIcon:${file.replace(/^.*\/|\.png$/g, '')}`);
  for (const file of input.extra ?? []) add(file, `file:${file}`);
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
    // Листы героя по полу (<id>_f / <id>_m) игра выбирает сама (flow.ts heroSprite) — в данных на них ссылок нет.
    // Лист первой профессии без пола (`archer_first`) — варианты по полу называются по классу (`archer_f`).
    const byClass = id.replace(/_first$/, '');
    for (const variant of new Set([`${id}_f`, `${id}_m`, `${byClass}_f`, `${byClass}_m`])) {
      add(registry[variant]?.file, `sprite:${variant}`);
      add(registry[variant]?.portrait, `sprite:${variant}`);
    }
  }
  return { files: Object.keys(refs).sort(), refs, missingSprites };
}

const readJson = <T>(path: string): T | undefined => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : undefined);

/** id спрайтов из data/units и data/jobs (visual.sprite) — без полной сборки контента, чтобы не зависеть от её ошибок. */
export function contentSpriteIds(root: string): string[] {
  const ids = new Set<string>();
  type Visual = { visual?: { sprite?: unknown } };
  const addVisual = (v: Visual | undefined) => {
    const sprite = v?.visual?.sprite;
    if (typeof sprite === 'string' && sprite) ids.add(sprite);
  };
  // data/heroes: свой лист карточки (сюжетные hero_<имя>_<класс>) и листы веток, если заданы.
  for (const dir of ['data/units', 'data/jobs', 'data/heroes']) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs).filter((n) => n.endsWith('.json'))) {
      const data = readJson<Visual & { branches?: Visual[]; forms?: Visual[] }>(join(abs, f));
      addVisual(data);
      for (const form of [...(data?.branches ?? []), ...(data?.forms ?? [])]) addVisual(form);
    }
  }
  // data/story: спикеры-NPC (portrait: "npc_<имя>") — лист NPC из assets/sprites/npcs, портрет вырезается из стойки.
  const story = join(root, 'data/story');
  if (existsSync(story)) {
    for (const f of readdirSync(story).filter((n) => n.endsWith('.json'))) {
      const speakers = readJson<{ speakers?: Record<string, { portrait?: unknown }> }>(join(story, f))?.speakers ?? {};
      for (const sp of Object.values(speakers)) if (typeof sp.portrait === 'string' && sp.portrait.startsWith('npc_')) ids.add(sp.portrait);
    }
  }
  return [...ids].sort();
}

/** Нужные файлы для репозитория в `root` (читает assets/ и data/ с диска). */
export function collectUsedAssets(root: string): UsedAssets {
  const assets = join(root, ASSETS_DIR);
  return usedAssets({
    manifest: readJson(join(assets, 'manifest.json')) ?? { assets: {} },
    effects: readJson(join(assets, 'effects/effects.json')),
    legacy: readJson(join(assets, 'sprites.legacy.json')),
    v2: readJson(join(assets, 'sprites/sprites.json')),
    spriteIds: contentSpriteIds(root),
    skillIcons: skillIconFiles(root),
    extra: [...bustFiles(root), ...illustFiles(root), ...themeBackgroundFiles(root), ...audioFiles(root), ...roItemFiles(root), ...damageDigitFiles(root)],
  });
}

/** Иллюстрации NPC для диалогов (src/game/illust.ts): assets/ui/illust/<id>.png. */
export function illustFiles(root: string): string[] {
  const dir = join(root, ASSETS_DIR, 'ui/illust');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => /^[a-z0-9_]+\.png$/.test(n))
    .sort()
    .map((n) => `ui/illust/${n}`);
}

/** Бюсты RO для портретов в рамке (src/game/portraitFrame.ts): assets/ro/portraits/hero_*_portrait.png. */
export function bustFiles(root: string): string[] {
  const dir = join(root, ASSETS_DIR, 'ro/portraits');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => /^hero_[a-z0-9_]+_portrait\.png$/.test(n))
    .sort()
    .map((n) => `ro/portraits/${n}`);
}

/** Фоны от художника: главы (src/game/backdrops.ts) — bg_battle_ch<N>.*, bg_map_ch<N>.*, болотный ярус Башни — bg_battle_swamp.*, bg_map_swamp.*; Таверна (src/game/tavernArt.ts) — bg_tavern.*. */
export function themeBackgroundFiles(root: string): string[] {
  const dir = join(root, ASSETS_DIR, 'backgrounds');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => /^(bg_(battle|map)_(ch\d+|swamp)|bg_tavern)\.(jpg|png|webp)$/.test(n))
    .sort()
    .map((n) => `backgrounds/${n}`);
}

/** Файлы, на которые ссылаются дорожки музыки и фона (audioCatalog.ts, поле files). */
const TRACK_FILES = new Set<string>([...Object.values(MUSIC), ...Object.values(AMBIENCE)].flatMap((t) => [...t.files]));

/**
 * Звуки и музыка от владельца (src/game/audio.ts): assets/audio/<id>.(ogg|m4a|mp3) — игра берёт подходящий формат.
 * Музыка (music_*) — только файлы, на которые ссылается каталог MUSIC: запасной трек без дорожки в сборку не едет
 * (треки RO — до 1.45 МБ каждый).
 */
export function audioFiles(root: string): string[] {
  const dir = join(root, ASSETS_DIR, 'audio');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => /^[a-z0-9_]+\.(ogg|m4a|mp3)$/.test(n))
    .filter((n) => !n.startsWith('music_') || TRACK_FILES.has(n.replace(/\.[a-z0-9]+$/, '')))
    .sort()
    .map((n) => `audio/${n}`);
}

/** assets/ui/icons/skill_*.png (src/game/skillIcons.ts грузит все такие файлы). */
export function skillIconFiles(root: string): string[] {
  const dir = join(root, ASSETS_DIR, 'ui/icons');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => /^skill_[a-z0-9_]+\.png$/.test(n))
    .sort()
    .map((n) => `ui/icons/${n}`);
}

/**
 * Иконки и картинки предметов RO (src/game/itemIcons.ts): assets/ui/icons/item_<id>.png (грузит экран загрузки)
 * и assets/ui/collection/item_<id>.png (окно предмета, по требованию).
 */
export function roItemFiles(root: string, dirs: readonly string[] = ['ui/icons', 'ui/collection']): string[] {
  const out: string[] = [];
  for (const d of dirs) {
    const dir = join(root, ASSETS_DIR, d);
    if (!existsSync(dir)) continue;
    for (const n of readdirSync(dir).filter((n) => /^item_[a-z0-9_]+\.png$/.test(n)).sort()) out.push(`${d}/${n}`);
  }
  return out;
}

/** Атлас цифр урона RO (src/game/numberFont.ts): PNG грузит экран загрузки, рамки кадров — JSON в бандле. */
export function damageDigitFiles(root: string): string[] {
  return existsSync(join(root, ASSETS_DIR, 'fx/damage/numbers.png')) ? ['fx/damage/numbers.png'] : [];
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

/**
 * Файлы, которые грузит экран загрузки (BootScene): манифест (кроме заменённых скином), значки навыков и
 * файлы портретов спрайтов из контента. Сборка кладёт их в «пакет загрузки» (vite.config.ts). Это только подсказка
 * сборке: игра сама берёт из пакета то, что в нём есть, остальное грузит по отдельности.
 */
export function bootFiles(root: string, skinReplaced: ReadonlySet<string>): string[] {
  const assets = join(root, ASSETS_DIR);
  const manifest = readJson<{ assets: Record<string, ManifestEntry> }>(join(assets, 'manifest.json')) ?? { assets: {} };
  const out = new Set<string>();
  for (const [id, a] of Object.entries(manifest.assets)) {
    if (!a.file || skinReplaced.has(id)) continue;
    out.add(clean(a.file));
    if (a.atlasXml) out.add(clean(a.atlasXml));
  }
  for (const f of skillIconFiles(root)) out.add(f);
  for (const f of [...roItemFiles(root, ['ui/icons']), ...damageDigitFiles(root)]) out.add(f);
  const registry = buildRegistry(readJson(join(assets, 'sprites.legacy.json')), readJson(join(assets, 'sprites/sprites.json')));
  for (const id of contentSpriteIds(root)) {
    const p = registry[id]?.portrait;
    if (p) out.add(clean(p));
  }
  return [...out].filter((f) => existsSync(join(assets, f))).sort();
}
