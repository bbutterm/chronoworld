import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id: латиница в нижнем регистре, цифры и _');

const Reward = z.object({ jobExp: z.number().int().nonnegative(), gold: z.number().int().nonnegative() });

/**
 * Тексты «между этапами» (docs/design/lore-route.md §5): пределы длины в символах. Больше — ошибка схемы
 * (content:check ✗): на экране телефона 360×640 длиннее не читается.
 */
export const PAGE_LIMITS = {
  /** Заголовок страницы (эпизод, легенда, летопись, находка). */
  title: 60,
  /** Подзаголовок эпизода и подпись легенды. */
  subtitle: 80,
  /** Эпиграф эпизода. */
  quote: 200,
  episode: 900,
  legend: 400,
  chronicle: 800,
  finding: 300,
  /** Комментарий героя к находке. */
  comment: 120,
} as const;

const line = (max: number, what: string) => z.string().min(1).max(max, `${what}: не длиннее ${max} символов`);

/** Типы находок: записка, надпись (на камне, стене, табличке), слух, вещь. Влияют только на значок и подпись. */
export const FINDING_KINDS = ['note', 'inscription', 'rumor', 'item'] as const;

/**
 * Находка после первой победы на этапе (§5.4): карточка в итогах боя, потом — в «Летописи» → «Находки».
 * id уникален по всем главам и лежит в сохранении (save.findings) — после выпуска не переименовывать.
 */
export const FindingSchema = z.object({
  id,
  title: line(PAGE_LIMITS.title, 'название находки'),
  text: line(PAGE_LIMITS.finding, 'текст находки'),
  kind: z.enum(FINDING_KINDS).default('note'),
  /** Комментарий героя одной строкой: speaker — имя как в сюжете («Бран»). */
  comment: z.object({ speaker: z.string().min(1), text: line(PAGE_LIMITS.comment, 'комментарий к находке') }).optional(),
});

/** «Эпизод N» (§5.1): полноэкранная страница перед первым входом в главу (до сцены chapterStart). */
export const EpisodeSchema = z.object({
  /** Название эпизода («Король порингов»); номер «Эпизод N» UI ставит сам по порядку главы. */
  title: line(PAGE_LIMITS.title, 'название эпизода'),
  subtitle: line(PAGE_LIMITS.subtitle, 'подзаголовок эпизода').optional(),
  /** Эпиграф — одна фраза курсивом над текстом (без кавычек: UI ставит «»). */
  quote: line(PAGE_LIMITS.quote, 'эпиграф эпизода').optional(),
  /** Проза; абзацы — через пустую строку (\n\n). */
  text: line(PAGE_LIMITS.episode, 'текст эпизода'),
});

/** Легенда локации (§5.2): свиток сразу после эпизода (вторая страница), потом — «Летопись» → «Мир». */
export const LegendSchema = z.object({
  title: line(PAGE_LIMITS.title, 'название легенды'),
  text: line(PAGE_LIMITS.legend, 'текст легенды'),
  /** Подпись («из путевых записей лесника Пайона»); UI ставит тире. */
  source: line(PAGE_LIMITS.subtitle, 'подпись легенды').optional(),
});

/** Летопись главы (§5.3): запись хрониста после финала главы (на экране «Глава пройдена»), потом — в «Летописи». */
export const ChapterChronicleSchema = z.object({
  title: line(PAGE_LIMITS.title, 'название летописи'),
  text: line(PAGE_LIMITS.chronicle, 'текст летописи'),
});

export const StageSchema = z.object({
  id,
  name: z.string(),
  boss: z.boolean().default(false),
  /**
   * Вставной этап: добавлен в уже выпущенную главу (глава 1 — ch1_s11…s18 между ch1_s1…s10). Не двигает рост силы врагов
   * (1 + enemyStatGrowthPerStage)^N: у вставного этапа N — как у предыдущего обычного, у следующих этапов (и глав) — прежний.
   * Сила вставного этапа задаётся mult. Порядок в игре — порядок в массиве stages.
   */
  inserted: z.boolean().optional(),
  /** 5 слотов (0–1 фронт, 2–4 тыл): id юнита из data/units (kind monster/boss) или null. */
  enemies: z
    .array(z.object({ unit: id, mult: z.number().positive().default(1) }).nullable())
    .length(5),
  /** Награда за победу (jobExp — в общий пул опыта героев, v4). */
  rewards: Reward,
  /** Доход офлайн-сундука в минуту, пока это последний пройденный этап. */
  offlinePerMinute: Reward,
  /** Находка после первой победы (2–4 на главу, не на каждом этапе). */
  finding: FindingSchema.optional(),
});

/**
 * Темы глав (фон боя и карты, музыка и эмбиент — src/game/backdrops.ts, sceneAudio.ts). Привязка — к теме, а не к месту
 * главы в кампании: слоты переезжают (docs/design/lore-route.md §4.2), арт и звук едут вместе с содержимым.
 * swamp — «Проклятые топи» (теперь только ярус Башни).
 */
export const CHAPTER_THEMES = ['meadow', 'sewer', 'orc', 'desert', 'grove', 'shipwreck', 'clocktower', 'crypt', 'labyrinth', 'niflheim', 'swamp'] as const;
export type ChapterTheme = (typeof CHAPTER_THEMES)[number];

/** data/campaign/<chapter>.json — глава; порядок глав — по полю order. */
export const ChapterSchema = z.object({
  $schema: z.string().optional(),
  id,
  name: z.string(),
  /**
   * Номер главы на маршруте (docs/design/lore-route.md §0): «Глава N», «Эпизод N», номер этапа «N-K», ворота предметов
   * minChapter. Главы идут по возрастанию order; пропуск допустим (глава 9 ещё не написана — после 8 идёт 10).
   */
  order: z.number().int().positive(),
  /** Тема фона и музыки (CHAPTER_THEMES). Нет — по id слота (chapterTheme), иначе луг. */
  theme: z.enum(CHAPTER_THEMES).optional(),
  stages: z.array(StageSchema).min(1),
  episode: EpisodeSchema.optional(),
  legend: LegendSchema.optional(),
  chronicle: ChapterChronicleSchema.optional(),
});

export type StageDef = z.infer<typeof StageSchema>;
export type ChapterDef = z.infer<typeof ChapterSchema>;
export type FindingDef = z.infer<typeof FindingSchema>;
export type FindingKind = (typeof FINDING_KINDS)[number];
export type EpisodeDef = z.infer<typeof EpisodeSchema>;
export type LegendDef = z.infer<typeof LegendSchema>;
export type ChapterChronicleDef = z.infer<typeof ChapterChronicleSchema>;

/** Этап с положением в кампании (вычисляется при сборке контента). */
export interface StageInfo extends StageDef {
  chapter: string;
  /** Номер внутри главы, с 0. */
  index: number;
  /** Сквозной номер по всей кампании, с 0 — по нему растёт сила врагов. */
  globalIndex: number;
}

/**
 * Тема слота, если в файле главы нет поля theme: маршрут из 10 глав (lore-route §0) — канализация, орки, Альдебаран,
 * лабиринт. Слоты 2, 3, 7 переписываются отдельно, поле theme в их файлах может появиться позже.
 */
const SLOT_THEMES: Record<string, ChapterTheme> = {
  chapter1: 'meadow',
  chapter2: 'sewer',
  chapter3: 'orc',
  chapter4: 'desert',
  chapter5: 'grove',
  chapter6: 'shipwreck',
  chapter7: 'clocktower',
  chapter8: 'crypt',
  chapter9: 'labyrinth',
  chapter10: 'niflheim',
};

/** Тема главы: поле theme, иначе тема слота по id, иначе луг. */
export function chapterTheme(chapter: Pick<ChapterDef, 'id' | 'theme'> | undefined): ChapterTheme {
  if (!chapter) return 'meadow';
  return chapter.theme ?? SLOT_THEMES[chapter.id] ?? 'meadow';
}
