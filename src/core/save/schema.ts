import { z } from 'zod';
import { GenderSchema } from '../progression/schema';

export const SAVE_VERSION = 3;

export const HeroStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  /**
   * Пол героя (m/f): у сюжетных героев фиксирован (progression.heroes.names/recruits), у прочих — случайный от seed
   * сохранения. Нет поля (старые сохранения) — sanitizeSave выводит по имени (progression/heroes.ts heroGender), иначе 'm'.
   */
  gender: GenderSchema.optional(),
  job: z.string(),
  jobLevel: z.number().int().positive(),
  /** Опыт внутри текущего уровня. */
  jobExp: z.number().int().nonnegative(),
  /** Пройденные профессии и уровень, на котором с них ушли (для навыков при keepSkillsOnJobChange). */
  jobHistory: z.array(z.object({ job: z.string(), jobLevel: z.number().int().positive() })).default([]),
  /**
   * P9 (T1-02). Опыт, накопленный на максимальном уровне профессии, пока герой не сменил её (не больше
   * progression/exp.ts expBankCap). При смене профессии начисляется новой профессии. Нет поля — 0 (старые
   * сохранения). UI: progression/exp.ts expBankStatus.
   */
  bankedExp: z.number().int().nonnegative().optional(),
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
  /**
   * P11 (T4-07). Дни, суточный набор которых уже выдан (сброс счётчиков был или день принят «в долг»).
   * Новый сброс вперёд — только для дня, которого здесь нет: переводом часов туда-обратно второй раз
   * тот же день не получить, а после возврата часов из будущего сброс идёт с ближайшей реальной полуночи.
   * Нет поля (старые сохранения) — считается [day]. Хранятся последние DAILY_DAYS_KEEP.
   */
  usedDays: z.array(DayStringSchema).optional(),
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
  offline: z.object({
    lastClaimAt: z.number(),
    /**
     * P11 (T4-06/T4-09). «Долг» сундука, мс: сколько времени уже выплачено наперёд, когда часы были впереди.
     * При переводе часов назад якорь lastClaimAt сдвигается на now, а долг = min(скачок, лимит сундука) —
     * следующие столько мс реального времени сундук не копит. Нет поля — 0.
     */
    debtMs: z.number().nonnegative().optional(),
    /**
     * P11 (T4-10). Накоплено по ставке прежних этапов: при первом прохождении этапа с новой ставкой доход
     * до этого момента фиксируется здесь, а lastClaimAt = now. Минуты входят в общий лимит capHours.
     */
    banked: z
      .object({ minutes: z.number().int().nonnegative(), gold: z.number().int().nonnegative(), jobExp: z.number().int().nonnegative() })
      .optional(),
  }),
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
  /**
   * Увиденные сюжетные сцены (id из data/story) — каждая показывается один раз. Поле добавлено без смены версии:
   * в старых сохранениях его нет — по умолчанию пусто.
   */
  seenScenes: z.array(z.string()).default([]),
  /**
   * P11 (T4-05). Сцены «после этапа», которые пора показать, но ещё не показаны (очередь). Попадают сюда
   * вместе с победой (actPlayStage), уходят — когда показаны (markScenesSeen). Нет поля — пусто.
   */
  storyQueue: z.array(z.string()).optional(),
  /**
   * Экран «Глава пройдена» ждёт показа: id главы, босс которой побеждён впервые. Ставится вместе с победой
   * (actPlayStage), снимается, когда игрок уходит с экрана (clearChapterDone). Перезагрузка при открытом экране —
   * он покажется снова при запуске / заходе в кампанию. Нет поля (старые сохранения) — ждать нечего.
   */
  pendingChapterDone: z.string().optional(),
  /**
   * P11 (T4-01). Ревизия записи: растёт на 1 при каждой записи в хранилище. Вкладка, у которой ревизия
   * меньше записанной, устарела и писать не должна. Нет поля — 0.
   */
  revision: z.number().int().nonnegative().optional(),
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

/** P11 (T4-07). Сколько последних дней помнит daily.usedDays. */
export const DAILY_DAYS_KEEP = 60;

/** Пустые суточные счётчики на день day. */
export function emptyDaily(day: string): DailyState {
  return { day, fastRewardsUsed: 0, quests: {}, claimedQuests: [], activityClaimed: [] };
}

/** v3. Пустая доска поручений (обновится при первом ensureBoard с настоящим днём). */
export function emptyBounties(): BountiesState {
  return { board: [], lastRefreshDay: DEFAULT_DAY, refreshesUsed: 0, active: [] };
}
