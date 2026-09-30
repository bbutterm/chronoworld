/**
 * Летопись (лор мира Ragnarok Online): тексты о монстрах, предметах, героях, профессиях и мире — data/lore/*.json.
 * Формат зафиксирован (его пишет писатель): у каждого файла `entries` (или `chapters`/`world` у world.json).
 * Все файлы необязательны: нет файла или записи — в игре просто нет текста. Длина — мягкие пределы (content:check ⚠).
 */
import { z } from 'zod';

const text = z.string().min(1);

/** Мягкие пределы длины (символов): больше — content:check предупреждает (на экране телефона текст не влезет в карточку). */
export const LORE_LIMITS = {
  /** Основной текст записи (монстр, глава, запись мира, история героя). */
  text: 700,
  /** Цитата монстра. */
  quote: 140,
  /** Подзаголовок (прозвище монстра, название главы/записи). */
  title: 60,
  /** Легенда предмета и строка профессии. */
  item: 300,
  job: 400,
  /** Черта героя и их число. */
  quirk: 140,
  quirks: 6,
  /** Кусочек истории героя (hero_stories.json): заголовок и текст — жёсткие пределы схемы. */
  storyTitle: 60,
  storyText: 500,
} as const;

export const MonsterLoreSchema = z.object({
  /** Прозвище / подзаголовок («Розовое желе лугов»). */
  title: text,
  text,
  /** Реплика или поговорка — курсивом. */
  quote: text.optional(),
});

export const HeroLoreSchema = z.object({
  story: text,
  quirks: z.array(text),
});

/**
 * Кусочек истории героя: открывается, когда копия героя доходит до уровня level (docs/design/story.md §4). Кусочки
 * уровней 10–50 общие; с 60 (HERO_STORY_BRANCH_FROM) — у каждой ветки второй профессии свои, поле branch — id профессии
 * ветки из branches карточки (data/heroes). Такой кусочек открывает копия героя на этой ветке.
 */
export const HeroStoryPieceSchema = z.object({
  level: z.number().int().positive(),
  /** Ветка второй профессии (id профессии из branches героя); нет — кусочек общий. */
  branch: z.string().regex(/^[a-z0-9_]+$/, 'branch — id профессии: латиница a-z, цифры и _').optional(),
  title: z.string().min(1).max(LORE_LIMITS.storyTitle, `заголовок: не длиннее ${LORE_LIMITS.storyTitle} символов`),
  text: z.string().min(1).max(LORE_LIMITS.storyText, `текст: не длиннее ${LORE_LIMITS.storyText} символов`),
});

export const ChapterLoreSchema = z.object({
  title: text,
  /** Номер эпизода RO («Эпизод 1»), если есть. */
  episode: text.optional(),
  location: text,
  text,
});

export const WorldEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/, 'id — латиница a-z, цифры и _'),
  title: text,
  text,
  /** Этап, после первой победы на котором запись открывается. Нет — открыта сразу. */
  unlockAfterStage: z.string().optional(),
});

const file = <T extends z.ZodTypeAny>(entry: T) =>
  z.object({ $schema: z.string().optional(), $comment: z.string().optional(), entries: z.record(z.string(), entry).default({}) });

/** data/lore/monsters.json — id юнита (data/units) → запись бестиария. */
export const MonstersLoreSchema = file(MonsterLoreSchema);
/** data/lore/items.json — id предмета (data/items) → строка-легенда. */
export const ItemsLoreSchema = file(text);
/** data/lore/heroes.json — id карточки героя (data/heroes) → история и черты. */
export const HeroesLoreSchema = file(HeroLoreSchema);
/**
 * data/lore/hero_stories.json — id карточки героя → кусочки истории по уровням: общие 10–50 и по ветке второй профессии
 * 60–100 (для каждой из двух веток), не выше предела уровня. Пороги и полноту проверяет validateLore (content:check).
 */
export const HeroStoriesLoreSchema = file(z.array(HeroStoryPieceSchema));
/** data/lore/jobs.json — id профессии (data/jobs) → описание гильдии/профессии. */
export const JobsLoreSchema = file(text);
/** data/lore/world.json — главы (id главы data/campaign) и записи о мире. */
export const WorldLoreSchema = z.object({
  $schema: z.string().optional(),
  $comment: z.string().optional(),
  chapters: z.record(z.string(), ChapterLoreSchema).default({}),
  world: z.array(WorldEntrySchema).default([]),
});

/** Предел строки-комментария из data/lore/lines.json. */
export const LINE_MAX = 140;

/** Виды строк-комментариев (§5.8) и где они показываются. */
export const LINE_KINDS = {
  refineSuccess: 'заточка удалась (окно-итог заточки)',
  refineBreak: 'вещь сломалась при заточке',
  defeat: 'итоги поражения (строка Гаррета)',
  towerFloor: 'этаж Башни взят (надпись на стене)',
  expeditionReturn: 'экспедиция вернулась',
  loading: 'экран загрузки',
} as const;
export type LineKind = keyof typeof LINE_KINDS;

const lineList = z.array(z.string().min(1).max(LINE_MAX, `строка: не длиннее ${LINE_MAX} символов`)).default([]);

/** data/lore/lines.json — строки-комментарии по видам; UI берёт случайную строку вида. Пустой список — строки нет. */
export const LinesLoreSchema = z
  .object({
    $schema: z.string().optional(),
    $comment: z.string().optional(),
    refineSuccess: lineList,
    refineBreak: lineList,
    defeat: lineList,
    towerFloor: lineList,
    expeditionReturn: lineList,
    loading: lineList,
  })
  .strict();

export type MonsterLore = z.infer<typeof MonsterLoreSchema>;
export type HeroLore = z.infer<typeof HeroLoreSchema>;
export type HeroStoryPiece = z.infer<typeof HeroStoryPieceSchema>;
export type ChapterLore = z.infer<typeof ChapterLoreSchema>;
export type WorldEntry = z.infer<typeof WorldEntrySchema>;

/** Весь лор, собранный из data/lore (пустые разделы, если файлов нет). */
export interface Lore {
  monsters: Record<string, MonsterLore>;
  items: Record<string, string>;
  heroes: Record<string, HeroLore>;
  /** Истории героев кусочками по уровням (data/lore/hero_stories.json), по возрастанию level. */
  heroStories: Record<string, HeroStoryPiece[]>;
  jobs: Record<string, string>;
  chapters: Record<string, ChapterLore>;
  world: WorldEntry[];
  /** Строки-комментарии (data/lore/lines.json). */
  lines: Record<LineKind, string[]>;
}
