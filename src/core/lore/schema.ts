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
/** data/lore/jobs.json — id профессии (data/jobs) → описание гильдии/профессии. */
export const JobsLoreSchema = file(text);
/** data/lore/world.json — главы (id главы data/campaign) и записи о мире. */
export const WorldLoreSchema = z.object({
  $schema: z.string().optional(),
  $comment: z.string().optional(),
  chapters: z.record(z.string(), ChapterLoreSchema).default({}),
  world: z.array(WorldEntrySchema).default([]),
});

export type MonsterLore = z.infer<typeof MonsterLoreSchema>;
export type HeroLore = z.infer<typeof HeroLoreSchema>;
export type ChapterLore = z.infer<typeof ChapterLoreSchema>;
export type WorldEntry = z.infer<typeof WorldEntrySchema>;

/** Весь лор, собранный из data/lore (пустые разделы, если файлов нет). */
export interface Lore {
  monsters: Record<string, MonsterLore>;
  items: Record<string, string>;
  heroes: Record<string, HeroLore>;
  jobs: Record<string, string>;
  chapters: Record<string, ChapterLore>;
  world: WorldEntry[];
}
