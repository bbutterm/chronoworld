import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { buildContent, COMBAT, ProgressionConfigSchema, type Content, type GameContext, type RawFile } from '../../src/core';

export const ROOT = resolve(import.meta.dirname, '../..');

export function readJsonDir(dir: string): RawFile[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const path = join(abs, f);
      try {
        return { file: relative(ROOT, path), data: JSON.parse(readFileSync(path, 'utf8')) };
      } catch (e) {
        return { file: relative(ROOT, path), data: { __parseError: String(e) } };
      }
    });
}

/** Контент с диска (для CLI и тестов). В браузере — src/game/content.ts через import.meta.glob. */
export function loadContent(): Content {
  return buildContent({
    units: readJsonDir('data/units'),
    skills: readJsonDir('data/skills'),
    jobs: readJsonDir('data/jobs'),
    chapters: readJsonDir('data/campaign'),
  });
}

/** Контекст для функций прогрессии и кампании. */
export function loadGameContext(): GameContext {
  return {
    content: loadContent(),
    progression: ProgressionConfigSchema.parse(JSON.parse(readFileSync(join(ROOT, 'data/progression.json'), 'utf8'))),
    combat: COMBAT,
  };
}

/** Файлы предметов экипировки (для withEquipment / buildEquipment). */
export const loadEquipmentFiles = () => readJsonDir('data/items');
