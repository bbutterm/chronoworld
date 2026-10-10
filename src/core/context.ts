/**
 * N1: единая сборка полного контекста игры из сырых данных.
 * Ядро файлы не читает: Node — scripts/lib/content-node.ts (readRawGameData), браузер — src/game/content.ts (import.meta.glob).
 * Все этапы (контент, прогрессия, K-функции, экипировка, башня, экспедиции/достижения) проверяются независимо,
 * ошибки собираются в один список — content:check показывает всё сразу.
 */
import { COMBAT } from './config';
import { buildContent, ContentError, type RawFile } from './content/build';
import { buildItems, parseDrops, withEquipment, type EquipmentContext } from './equipment';
import { parseEventsConfig, validateEventsConfig, type EventsContext } from './events';
import { parseFeaturesConfig, withFeatures, type FeatureContext } from './features';
import { parseHeroesConfig, validateHeroesConfig } from './heroes/config';
import { storyOrder } from './heroes/card';
import { parseExpeditionEvents, parseMetaConfig, validateExpeditionEvents, validateExpeditions, withMeta, type ExpeditionEventsConfig, type MetaContext } from './meta';
import { ProgressionConfigSchema } from './progression/schema';
import type { GameContext } from './progression/types';
import { buildStory, type StoryContext } from './story/story';
import { parseTowerConfig, withTower, type TowerContext } from './tower';
import { parseHuntConfig, validateHunt } from './hunt/hunt';
import type { HuntConfig } from './hunt/schema';
import type { CombatConfig, Content } from './types';
import { parseUnlocks, validateUnlocks } from './unlocks/unlocks';
import { parseShopConfig, withShop, type ShopConfig } from './shop';
import { parseCodesConfig, type CodesConfig } from './codes';
import { parseKitchenConfig } from './kitchen/kitchen';
import type { KitchenConfig } from './kitchen/schema';
import { parseAutobattlerConfig, validateAutobattlerConfig, type AutobattlerConfig } from './autobattler';

/** Полный контекст игры: прогрессия и кампания + K-функции, экипировка, башня, пресеты / экспедиции / достижения. */
export type FullContext = FeatureContext & EquipmentContext & TowerContext & MetaContext & StoryContext & EventsContext & {
  hunt: HuntConfig;
  /** Гильдейский автобатлер; отсутствует в старых/минимальных наборах контента. */
  autobattler?: AutobattlerConfig;
  /** Лавка (data/shop.json); нет файла — Лавки нет. */
  shop?: ShopConfig;
  /** Коды из настроек (data/codes.json); нет файла — кодов нет. */
  codes?: CodesConfig;
  /** Кухня в Таверне (data/kitchen.json); нет файла — Кухни нет, продукты не выпадают. */
  kitchen?: KitchenConfig;
  /** События экспедиций (data/expedition_events.json); нет файла — экспедиции без событий. */
  expeditionEvents?: ExpeditionEventsConfig;
};

/** Сырые данные data/ — содержимое JSON без разбора. */
export interface RawGameData {
  units: RawFile[];
  skills: RawFile[];
  jobs: RawFile[];
  chapters: RawFile[];
  /** data/heroes/*.json — шаблоны карточек героев. */
  heroes: RawFile[];
  items: RawFile[];
  progression: unknown;
  /** data/cards.json — редкости, уровень, вознесение, смена ветки, карты героя за этапы. */
  cards: unknown;
  /** data/summon.json — Таверна. */
  summon: unknown;
  quests: unknown;
  drops: unknown;
  tower: unknown;
  autobattler?: unknown;
  /** data/expeditions.json — экспедиции (K9) и лимиты пресетов (K8). */
  expeditions: unknown;
  achievements: unknown;
  /** data/expedition_events.json — события экспедиций («текстовые приключения»); нет — без событий. */
  expeditionEvents?: unknown;
  /** data/events.json — «Вход 7 дней», «7 дней новичка», системные письма. */
  events: unknown;
  /** data/hunt.json — «Охота на босса». */
  hunt: unknown;
  /** data/unlocks.json — этапы открытия функций. Нет — всё открыто сразу (Таверна и Башня — по своим файлам). */
  unlocks?: unknown;
  /** data/shop.json — Лавка (нет — Лавки нет). */
  shop?: unknown;
  /** data/codes.json — коды из настроек (нет — кодов нет). */
  codes?: unknown;
  /** data/kitchen.json — Кухня (нет — Кухни нет). */
  kitchen?: unknown;
  /** data/story/*.json — сюжет глав (нет — без сюжета). */
  stories?: RawFile[];
  /** По умолчанию — data/combat.json (COMBAT). */
  combat?: CombatConfig;
}

export interface GameContextResult {
  /** Полный контекст — только если ошибок нет. */
  ctx?: FullContext;
  /** Контент юнитов/навыков/профессий/кампании — если он собрался (даже при ошибках в других файлах). */
  content?: Content;
  problems: string[];
}

/** '../../data/items/a.json' (import.meta.glob) → 'data/items/a.json', чтобы ошибки выглядели одинаково в Node и браузере. */
const normalize = (files: readonly RawFile[]): RawFile[] => files.map((f) => ({ file: f.file.replace(/^(\.\.?\/)+/, ''), data: f.data }));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Добавить имя файла, если сообщение его ещё не содержит. */
const withFile = (label: string, msg: string) => (/(^|\s)data\//.test(msg) ? msg : `${label}: ${msg}`);

/** Собрать контекст, не бросая исключений: все ошибки — в problems. */
export function collectGameContext(raw: RawGameData): GameContextResult {
  const problems: string[] = [];
  const stage = <T>(label: string, fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof ContentError) problems.push(...e.problems);
      else problems.push(withFile(label, message(e)));
      return undefined;
    }
  };

  const content = stage('data/units / data/skills / data/jobs / data/campaign', () =>
    buildContent({
      units: normalize(raw.units),
      skills: normalize(raw.skills),
      jobs: normalize(raw.jobs),
      chapters: normalize(raw.chapters),
      heroes: normalize(raw.heroes ?? []),
    }),
  );
  const progression = stage('data/progression.json', () => {
    const r = ProgressionConfigSchema.safeParse(raw.progression);
    if (!r.success) {
      throw new Error(r.error.issues.map((i) => `${i.path.length ? i.path.map(String).join('.') : '(корень)'}: ${i.message}`).join('; '));
    }
    return r.data;
  });
  const items = normalize(raw.items);
  const unlocks = raw.unlocks === undefined ? undefined : stage('data/unlocks.json', () => parseUnlocks(raw.unlocks));
  const heroesCfg = stage('data/cards.json / data/summon.json', () => parseHeroesConfig(raw.cards, raw.summon, unlocks));

  if (!content || !progression || !heroesCfg) {
    // Без контента перекрёстные проверки невозможны — проверяем хотя бы схемы остальных файлов.
    stage('data/progression.json / data/quests.json', () => parseFeaturesConfig(raw.progression, raw.quests));
    stage('data/items', () => buildItems(items));
    stage('data/drops.json', () => parseDrops(raw.drops));
    stage('data/tower.json', () => parseTowerConfig(raw.tower));
    stage('data/expeditions.json / data/achievements.json', () => parseMetaConfig(raw.expeditions, raw.achievements));
    stage('data/events.json', () => parseEventsConfig(raw.events));
    stage('data/hunt.json', () => parseHuntConfig(raw.hunt));
    if (raw.shop !== undefined) stage('data/shop.json', () => parseShopConfig(raw.shop));
    if (raw.codes !== undefined) stage('data/codes.json', () => parseCodesConfig(raw.codes));
    if (raw.kitchen !== undefined) stage('data/kitchen.json', () => parseKitchenConfig(raw.kitchen));
    if (raw.expeditionEvents !== undefined) stage('data/expedition_events.json', () => parseExpeditionEvents(raw.expeditionEvents));
    return { content, problems };
  }

  const base: GameContext = {
    content,
    progression,
    combat: raw.combat ?? COMBAT,
    cards: heroesCfg.cards,
    summon: heroesCfg.summon,
    ...(unlocks ? { unlocks } : {}),
  };
  if (unlocks) validateUnlocks(unlocks, content, problems);
  validateHeroesConfig(base, problems);
  const features = stage('data/progression.json / data/quests.json', () => withFeatures(base, raw.progression, raw.quests).features);
  const equipment = stage('data/items / data/drops.json', () => withEquipment(base, items, raw.drops).equipment);
  const tower = stage('data/tower.json', () => withTower(base, raw.tower).tower);
  const meta = stage('data/expeditions.json / data/achievements.json', () => withMeta(base, raw.expeditions, raw.achievements).meta);
  if (meta) validateExpeditions(meta.expeditions, content, equipment?.items, problems);
  const expeditionEvents = raw.expeditionEvents === undefined ? undefined : stage('data/expedition_events.json', () => parseExpeditionEvents(raw.expeditionEvents));
  if (expeditionEvents && meta) validateExpeditionEvents(expeditionEvents, meta.expeditions.locations, base, problems);
  const story = stage('data/story', () => buildStory(normalize(raw.stories ?? []), content, problems, storyOrder(base)));
  const events = stage('data/events.json', () => parseEventsConfig(raw.events));
  if (events) validateEventsConfig(events, base, problems);
  const hunt = stage('data/hunt.json', () => parseHuntConfig(raw.hunt));
  if (hunt) validateHunt(hunt, content, problems);
  const shop = raw.shop === undefined || !equipment ? undefined : stage('data/shop.json', () => withShop({ ...base, equipment }, raw.shop).shop);
  const codes = raw.codes === undefined ? undefined : stage('data/codes.json', () => parseCodesConfig(raw.codes));
  const kitchen = raw.kitchen === undefined ? undefined : stage('data/kitchen.json', () => parseKitchenConfig(raw.kitchen));
  const autobattler = raw.autobattler === undefined ? undefined : stage('data/autobattler.json', () => parseAutobattlerConfig(raw.autobattler));
  if (autobattler) validateAutobattlerConfig(autobattler, base, problems);

  if (problems.length || !features || !equipment || !tower || !meta || !story || !events || !hunt) return { content, problems };
  return {
    ctx: { ...base, features, equipment, tower, meta, story, events, hunt, ...(shop ? { shop } : {}), ...(codes ? { codes } : {}), ...(kitchen ? { kitchen } : {}), ...(expeditionEvents ? { expeditionEvents } : {}), ...(autobattler ? { autobattler } : {}) },
    content,
    problems,
  };
}

/**
 * Полный контекст из сырых данных: buildContent + ProgressionConfigSchema + withFeatures + withEquipment + withTower + withMeta.
 * Любые ошибки → один ContentError со списком всех проблем (с именами файлов).
 */
export function buildGameContext(raw: RawGameData): FullContext {
  const r = collectGameContext(raw);
  if (!r.ctx) throw new ContentError(r.problems);
  return r.ctx;
}
