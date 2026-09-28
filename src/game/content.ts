import achievementsJson from '../../data/achievements.json';
import bountiesJson from '../../data/bounties.json';
import cardsJson from '../../data/cards.json';
import dropsJson from '../../data/drops.json';
import eventsJson from '../../data/events.json';
import progressionJson from '../../data/progression.json';
import questsJson from '../../data/quests.json';
import summonJson from '../../data/summon.json';
import towerJson from '../../data/tower.json';
import unlocksJson from '../../data/unlocks.json';
import { buildGameContext, type FullContext, type RawFile } from '../core';

export type { FullContext };

const toFiles = (mods: Record<string, unknown>): RawFile[] =>
  Object.entries(mods)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, data]) => ({ file, data }));

/**
 * Контекст для всех экранов — та же сборка, что в Node (scripts/lib/content-node.ts → loadFullContext): buildGameContext.
 * Файлы data/units, skills, jobs, campaign, heroes, items собираются при сборке — новые подхватываются сами.
 * Битый конфиг — ContentError при старте со списком всех проблем; `npm run content:check` ловит это раньше.
 */
export const GAME: FullContext = buildGameContext({
  units: toFiles(import.meta.glob('../../data/units/*.json', { eager: true, import: 'default' })),
  skills: toFiles(import.meta.glob('../../data/skills/*.json', { eager: true, import: 'default' })),
  jobs: toFiles(import.meta.glob('../../data/jobs/*.json', { eager: true, import: 'default' })),
  chapters: toFiles(import.meta.glob('../../data/campaign/*.json', { eager: true, import: 'default' })),
  heroes: toFiles(import.meta.glob('../../data/heroes/*.json', { eager: true, import: 'default' })),
  items: toFiles(import.meta.glob('../../data/items/*.json', { eager: true, import: 'default' })),
  progression: progressionJson,
  cards: cardsJson,
  summon: summonJson,
  quests: questsJson,
  drops: dropsJson,
  tower: towerJson,
  bounties: bountiesJson,
  achievements: achievementsJson,
  unlocks: unlocksJson,
  events: eventsJson,
  stories: toFiles(import.meta.glob('../../data/story/*.json', { eager: true, import: 'default' })),
});

/** Юниты, навыки, профессии и этапы кампании. */
export const CONTENT = GAME.content;

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
