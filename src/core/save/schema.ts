import { z } from 'zod';

export const SAVE_VERSION = 3;

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

/** v3 (K8). Сохранённая расстановка отряда: 5 слотов, id героя или null. */
export const PresetSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  squad: z.array(z.string().nullable()).length(5),
});

export const BountyRewardsSchema = z.object({
  gold: z.number().int().nonnegative(),
  /** Опыт каждому герою, ходившему на поручение. */
  jobExp: z.number().int().nonnegative(),
  gems: z.number().int().nonnegative(),
});

/**
 * v3 (K9). Поручение на доске — снимок шаблона из data/bounties.json на момент обновления доски,
 * чтобы правка конфига не ломала уже выданные поручения.
 */
export const BountySchema = z.object({
  /** Уникальный id поручения (не шаблона). */
  id: z.string().min(1),
  templateId: z.string(),
  rarity: z.string(),
  durationMinutes: z.number().positive(),
  heroCount: z.number().int().positive(),
  /** Нужна ли в группе хотя бы одна профессия этой роли. */
  role: z.enum(['tank', 'damage', 'healer', 'support']).nullable(),
  rewards: BountyRewardsSchema,
});

/** v3 (K9). Поручение в работе: герои и время (мс, как offline.lastClaimAt). */
export const ActiveBountySchema = BountySchema.extend({
  heroIds: z.array(z.string()).min(1),
  startedAt: z.number(),
  endsAt: z.number(),
});

export const BountiesStateSchema = z.object({
  board: z.array(BountySchema),
  /** День последнего обновления доски ('1970-01-01' — ещё не обновлялась). */
  lastRefreshDay: DayStringSchema,
  /** Ручных обновлений доски за lastRefreshDay. */
  refreshesUsed: z.number().int().nonnegative(),
  active: z.array(ActiveBountySchema),
});

/** v3 (K10). Счётчики достижений (ключ → значение) и id полученных достижений. */
export const AchievementsStateSchema = z.object({
  counters: z.record(z.string(), z.number().int().nonnegative()),
  claimed: z.array(z.string()),
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
  /** v3 (K8). Пресеты отряда. */
  presets: z.array(PresetSchema),
  /** v3 (K9). Доска поручений. */
  bounties: BountiesStateSchema,
  /** v3 (K10). Достижения. */
  achievements: AchievementsStateSchema,
});

export type HeroState = z.infer<typeof HeroStateSchema>;
export type SaveState = z.infer<typeof SaveStateSchema>;
export type DailyState = z.infer<typeof DailyStateSchema>;
export type ItemInstance = z.infer<typeof ItemInstanceSchema>;
export type Preset = z.infer<typeof PresetSchema>;
export type Bounty = z.infer<typeof BountySchema>;
export type ActiveBounty = z.infer<typeof ActiveBountySchema>;
export type BountiesState = z.infer<typeof BountiesStateSchema>;
export type AchievementsState = z.infer<typeof AchievementsStateSchema>;

/** День по умолчанию для newGame/миграций, пока UI не передал настоящий. */
export const DEFAULT_DAY = '1970-01-01';

/** Пустые суточные счётчики на день day. */
export function emptyDaily(day: string): DailyState {
  return { day, fastRewardsUsed: 0, quests: {}, claimedQuests: [], activityClaimed: [] };
}

/** v3. Пустая доска поручений (обновится при первом ensureBoard с настоящим днём). */
export function emptyBounties(): BountiesState {
  return { board: [], lastRefreshDay: DEFAULT_DAY, refreshesUsed: 0, active: [] };
}
