import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  buildContent,
  buildGameContext,
  COMBAT,
  parseHeroesConfig,
  parseUnlocks,
  ProgressionConfigSchema,
  type Content,
  type FullContext,
  type GameContext,
  type RawFile,
  type RawGameData,
} from '../../src/core';

export const ROOT = resolve(import.meta.dirname, '../..');

/** JSON-файлы папки dir (относительно root; по умолчанию — корень репозитория), по имени. */
export function readJsonDir(dir: string, root: string = ROOT): RawFile[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const path = join(abs, f);
      try {
        return { file: relative(root, path), data: JSON.parse(readFileSync(path, 'utf8')) };
      } catch (e) {
        return { file: relative(root, path), data: { __parseError: String(e) } };
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
    heroes: readJsonDir('data/heroes'),
  });
}

/** JSON-файл из корня репозитория (undefined, если файла нет — схема сообщит об ошибке). */
const readJsonFile = (rel: string, root: string = ROOT): unknown => {
  const path = join(root, rel);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
};

/** Сырые данные data/ для buildGameContext (в браузере то же собирает src/game/content.ts). root — другой корень (тесты генераторов). */
export function readRawGameData(root: string = ROOT): RawGameData {
  return {
    units: readJsonDir('data/units', root),
    skills: readJsonDir('data/skills', root),
    jobs: readJsonDir('data/jobs', root),
    chapters: readJsonDir('data/campaign', root),
    heroes: readJsonDir('data/heroes', root),
    items: readJsonDir('data/items', root),
    progression: readJsonFile('data/progression.json', root),
    cards: readJsonFile('data/cards.json', root),
    summon: readJsonFile('data/summon.json', root),
    quests: readJsonFile('data/quests.json', root),
    drops: readJsonFile('data/drops.json', root),
    tower: readJsonFile('data/tower.json', root),
    bounties: readJsonFile('data/bounties.json', root),
    achievements: readJsonFile('data/achievements.json', root),
    unlocks: readJsonFile('data/unlocks.json', root),
    events: readJsonFile('data/events.json', root),
    stories: readJsonDir('data/story', root),
  };
}

/** Полный контекст из data/ — тот же, что у игры (GAME). */
export function loadFullContext(): FullContext {
  return buildGameContext(readRawGameData());
}

/** Контекст для функций прогрессии и кампании (только кампания + прогрессия; полный — loadFullContext). */
export function loadGameContext(): GameContext {
  const unlocks = parseUnlocks(readJsonFile('data/unlocks.json'));
  return {
    content: loadContent(),
    progression: ProgressionConfigSchema.parse(JSON.parse(readFileSync(join(ROOT, 'data/progression.json'), 'utf8'))),
    combat: COMBAT,
    ...parseHeroesConfig(readJsonFile('data/cards.json'), readJsonFile('data/summon.json'), unlocks),
    unlocks,
  };
}

/** Файлы предметов экипировки (для withEquipment / buildEquipment). */
export const loadEquipmentFiles = () => readJsonDir('data/items');
