import progressionJson from '../../data/progression.json';
import { buildContent, COMBAT, ProgressionConfigSchema, type GameContext, type RawFile } from '../core';

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

/** Контекст для прогрессии и кампании. */
export const GAME: GameContext = {
  content: CONTENT,
  progression: ProgressionConfigSchema.parse(progressionJson),
  combat: COMBAT,
};

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
