import achievementsJson from '../../data/achievements.json';
import expeditionsJson from '../../data/expeditions.json';
import expeditionEventsJson from '../../data/expedition_events.json';
import cardsJson from '../../data/cards.json';
import dropsJson from '../../data/drops.json';
import eventsJson from '../../data/events.json';
import huntJson from '../../data/hunt.json';
import progressionJson from '../../data/progression.json';
import questsJson from '../../data/quests.json';
import shopJson from '../../data/shop.json';
import codesJson from '../../data/codes.json';
import kitchenJson from '../../data/kitchen.json';
import summonJson from '../../data/summon.json';
import towerJson from '../../data/tower.json';
import autobattlerJson from '../../data/autobattler.json';
import unlocksJson from '../../data/unlocks.json';
import { buildGameContext, parseLore, type FullContext, type Lore, type RawFile } from '../core';

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
  // Повторов пройденных этапов нет (campaign.replay: false). Песочница адвансов (VITE_ADVANCE_LAB) проходит все этапы
  // заранее — там бои на пройденных этапах нужны для просмотра форм, поэтому повторы в ней включены.
  progression: import.meta.env?.VITE_ADVANCE_LAB === '1' ? { ...progressionJson, campaign: { ...progressionJson.campaign, replay: true } } : progressionJson,
  cards: cardsJson,
  summon: summonJson,
  quests: questsJson,
  drops: dropsJson,
  tower: towerJson,
  autobattler: autobattlerJson,
  expeditions: expeditionsJson,
  expeditionEvents: expeditionEventsJson,
  achievements: achievementsJson,
  unlocks: unlocksJson,
  events: eventsJson,
  hunt: huntJson,
  shop: shopJson,
  codes: codesJson,
  kitchen: kitchenJson,
  stories: toFiles(import.meta.glob('../../data/story/*.json', { eager: true, import: 'default' })),
});

/**
 * Летопись (data/lore/*.json): тексты о мире, монстрах, предметах, героях и профессиях. Файлы необязательны и читаются
 * текстом: нет файла, пустой или битый — раздел пуст, игра работает (ошибки покажет npm run content:check).
 */
const loreParsed = parseLore(toFiles(import.meta.glob('../../data/lore/*.json', { eager: true, query: '?raw', import: 'default' })));
if (loreParsed.problems.length) console.warn('Летопись:', loreParsed.problems.join('\n'));
export const LORE: Lore = loreParsed.lore;

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
