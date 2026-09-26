import achievementsJson from '../../data/achievements.json';
import bountiesJson from '../../data/bounties.json';
import dropsJson from '../../data/drops.json';
import progressionJson from '../../data/progression.json';
import questsJson from '../../data/quests.json';
import towerJson from '../../data/tower.json';
import {
  buildContent,
  COMBAT,
  ProgressionConfigSchema,
  withEquipment,
  withFeatures,
  withMeta,
  withTower,
  type EquipmentContext,
  type FeatureContext,
  type GameContext,
  type MetaContext,
  type RawFile,
  type TowerContext,
} from '../core';

const toFiles = (mods: Record<string, unknown>): RawFile[] =>
  Object.entries(mods)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, data]) => ({ file, data }));

/** Весь контент из data/units и data/skills собирается при сборке — новые файлы подхватываются сами. */
export const CONTENT = buildContent({
  units: toFiles(import.meta.glob('../../data/units/*.json', { eager: true, import: 'default' })),
  skills: toFiles(import.meta.glob('../../data/skills/*.json', { eager: true, import: 'default' })),
  jobs: toFiles(import.meta.glob('../../data/jobs/*.json', { eager: true, import: 'default' })),
  chapters: toFiles(import.meta.glob('../../data/campaign/*.json', { eager: true, import: 'default' })),
});

const BASE: GameContext = {
  content: CONTENT,
  progression: ProgressionConfigSchema.parse(progressionJson),
  combat: COMBAT,
};

/** Полный контекст игры: прогрессия и кампания + K-функции (быстрые награды, мощь, задания), экипировка, башня,
 * пресеты / поручения / достижения (K8–K10). */
export type FullContext = FeatureContext & EquipmentContext & TowerContext & MetaContext;

/**
 * Контекст для всех экранов. Битый конфиг (progression/quests/items/drops/tower/bounties/achievements) — ошибка при старте
 * с описанием поля (FeatureError / EquipmentError / TowerError / MetaError), `npm run content:check` ловит это раньше.
 */
export const GAME: FullContext = withMeta(
  withTower(
    withEquipment(
      withFeatures(BASE, progressionJson, questsJson),
      toFiles(import.meta.glob('../../data/items/*.json', { eager: true, import: 'default' })),
      dropsJson,
    ),
    towerJson,
  ),
  bountiesJson,
  achievementsJson,
);

const ROLE_ORDER = ['tank', 'damage', 'support', 'healer'];

/** Герои для выбора: танки, урон (сначала ближний бой), поддержка, лекари. */
export const heroIds = () =>
  Object.values(CONTENT.units)
    .filter((u) => u.kind === 'hero')
    .sort(
      (a, b) =>
        ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
        Number(CONTENT.skills[b.skills.basic]?.range === 'melee') - Number(CONTENT.skills[a.skills.basic]?.range === 'melee') ||
        a.name.localeCompare(b.name, 'ru'),
    )
    .map((u) => u.id);
