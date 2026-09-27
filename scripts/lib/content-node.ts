import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  buildContent,
  buildGameContext,
  COMBAT,
  ProgressionConfigSchema,
  type Content,
  type FullContext,
  type GameContext,
  type RawFile,
  type RawGameData,
} from '../../src/core';

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

/** JSON-файл из корня репозитория (undefined, если файла нет — схема сообщит об ошибке). */
const readJsonFile = (rel: string): unknown => {
  const path = join(ROOT, rel);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
};

/** Сырые данные data/ для buildGameContext (в браузере то же собирает src/game/content.ts). */
export function readRawGameData(): RawGameData {
  return {
    units: readJsonDir('data/units'),
    skills: readJsonDir('data/skills'),
    jobs: readJsonDir('data/jobs'),
    chapters: readJsonDir('data/campaign'),
    items: readJsonDir('data/items'),
    progression: readJsonFile('data/progression.json'),
    quests: readJsonFile('data/quests.json'),
    drops: readJsonFile('data/drops.json'),
    tower: readJsonFile('data/tower.json'),
    bounties: readJsonFile('data/bounties.json'),
    achievements: readJsonFile('data/achievements.json'),
  };
}

/** Полный контекст из data/ — тот же, что у игры (GAME). */
export function loadFullContext(): FullContext {
  return buildGameContext(readRawGameData());
}

/** Контекст для функций прогрессии и кампании (только кампания + прогрессия; полный — loadFullContext). */
export function loadGameContext(): GameContext {
  return {
    content: loadContent(),
    progression: ProgressionConfigSchema.parse(JSON.parse(readFileSync(join(ROOT, 'data/progression.json'), 'utf8'))),
    combat: COMBAT,
  };
}

/** Файлы предметов экипировки (для withEquipment / buildEquipment). */
export const loadEquipmentFiles = () => readJsonDir('data/items');
