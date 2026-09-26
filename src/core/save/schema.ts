import { z } from 'zod';

export const SAVE_VERSION = 2;

export const HeroStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  job: z.string(),
  jobLevel: z.number().int().positive(),
  /** Опыт внутри текущего уровня. */
  jobExp: z.number().int().nonnegative(),
  /** Пройденные профессии и уровень, на котором с них ушли (для навыков при keepSkillsOnJobChange). */
  jobHistory: z.array(z.object({ job: z.string(), jobLevel: z.number().int().positive() })).default([]),
});

/** День игрока 'YYYY-MM-DD' (вычисляет UI по своему часовому поясу, ядро получает строкой). */
export const DayStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'день: строка YYYY-MM-DD');

export const DailyStateSchema = z.object({
  /** День, к которому относятся счётчики. */
  day: DayStringSchema,
  /** Сколько раз за день взяты быстрые награды (бесплатные + за гемы). */
  fastRewardsUsed: z.number().int().nonnegative(),
  /** Счётчики событий для ежедневных заданий: вид события → сколько раз. */
  quests: z.record(z.string(), z.number().int().nonnegative()),
  /** id заданий, награда за которые уже получена сегодня. */
  claimedQuests: z.array(z.string()),
  /** Пороги очков активности, награда за которые уже получена сегодня. */
  activityClaimed: z.array(z.number().int().nonnegative()),
});

export const ItemInstanceSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  equippedBy: z.string().nullable(),
});

export const SaveStateSchema = z.object({
  version: z.literal(SAVE_VERSION),
  createdAt: z.number(),
  heroes: z.array(HeroStateSchema).min(1),
  /** 5 слотов отряда: id героя или null. */
  squad: z.array(z.string().nullable()).length(5),
  campaign: z.object({ cleared: z.array(z.string()) }),
  resources: z.object({ gold: z.number().int().nonnegative() }),
  offline: z.object({ lastClaimAt: z.number() }),
  /** Счётчик боёв — из него UI делает seed следующего боя. */
  battleSeq: z.number().int().nonnegative(),
  /** v2. Суточные счётчики (быстрые награды, задания). Сбрасываются при смене дня — features/daily.ts rollDay. */
  daily: DailyStateSchema,
  /** v2. Валюты сверх золота. gems — заглушка премиум-валюты (только из заданий, без реальных денег). */
  currency: z.object({ gems: z.number().int().nonnegative() }),
  /** v2. Резерв под башню испытаний (K4): последний пройденный этаж, 0 — не начата. */
  tower: z.object({ floor: z.number().int().nonnegative() }),
  /** v2. Резерв под экипировку (K6): экземпляры предметов, equippedBy — id героя или null. */
  inventory: z.object({ items: z.array(ItemInstanceSchema) }),
});

export type HeroState = z.infer<typeof HeroStateSchema>;
export type SaveState = z.infer<typeof SaveStateSchema>;
export type DailyState = z.infer<typeof DailyStateSchema>;
export type ItemInstance = z.infer<typeof ItemInstanceSchema>;

/** День по умолчанию для newGame/миграций, пока UI не передал настоящий. */
export const DEFAULT_DAY = '1970-01-01';

/** Пустые суточные счётчики на день day. */
export function emptyDaily(day: string): DailyState {
  return { day, fastRewardsUsed: 0, quests: {}, claimedQuests: [], activityClaimed: [] };
}
