import { z } from 'zod';
import { CardRaritySchema } from '../heroes/schema';

export const SAVE_VERSION = 4;

/**
 * v4. Экземпляр карточки героя (docs/design/heroes.md): шаблон data/heroes/<templateId>.json, редкость и уровень.
 * Имя, пол, класс, роль и навыки — из шаблона (heroes/card.ts heroCard). id экземпляра (h1, h2…) не меняется —
 * на него ссылаются отряд, пресеты, поручения и надетые предметы.
 */
export const HeroStateSchema = z.object({
  id: z.string(),
  templateId: z.string(),
  rarity: CardRaritySchema,
  level: z.number().int().positive(),
  /** Замок: карточку нельзя отдать в корм. */
  locked: z.boolean().optional(),
  /** «Новый!» — карточка из Таверны, которую игрок ещё не открывал (UI снимает markHeroSeen). */
  isNew: z.boolean().optional(),
});

/** v4. Состояние Таверны. */
export const SummonStateSchema = z.object({
  /** Номер следующего вызова summon — часть seed (hash(createdAt, seq)). */
  seq: z.number().int().nonnegative(),
  /** Всего призвано карточек. */
  total: z.number().int().nonnegative(),
  /** Призывов подряд без редкости гаранта (summon.json → pity). */
  sincePurple: z.number().int().nonnegative(),
  /** Первый призыв ×10 уже был (гарантированный фиолетовый выдан). */
  firstTenDone: z.boolean(),
  /** День последнего бесплатного призыва 'YYYY-MM-DD' (бесплатный доступен, только если день новее). */
  freeDay: z.string().optional(),
  /** Бесплатных призывов, взятых в freeDay. Нет поля — 1 (если freeDay есть). */
  freeUsed: z.number().int().nonnegative().optional(),
  /** Подарок открытия Таверны выдан. */
  welcomeGiven: z.boolean(),
  /** Шаблоны, которые у игрока когда-либо были (значок «Новый!» и будущая коллекция). */
  discovered: z.array(z.string()),
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
  /** Опыт в общий пул героев (v4; раньше — каждому герою группы). */
  jobExp: z.number().int().nonnegative(),
  gems: z.number().int().nonnegative(),
  /** v4. Осколки «отстающего» сюжетного героя (heroes/shards.ts shardTarget). Нет поля — 0. */
  shards: z.number().int().nonnegative().optional(),
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
  /** v4: heroExp — общий пул опыта героев (тратится кнопкой «Улучшить», heroes/level.ts). */
  resources: z.object({ gold: z.number().int().nonnegative(), heroExp: z.number().int().nonnegative() }),
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
  currency: z.object({
    gems: z.number().int().nonnegative(),
    /** v4. Свитки призыва (1 свиток = 1 призыв в Таверне). */
    scrolls: z.number().int().nonnegative(),
  }),
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
  /** v4. Осколки сюжетных героев: id шаблона → сколько. */
  shards: z.record(z.string(), z.number().int().nonnegative()),
  /** v4. Таверна. */
  summon: SummonStateSchema,
  /**
   * v4. Одноразовые сообщения игроку (например, после миграции сохранения): sanitizeSave отдаёт их в warnings
   * и убирает. Нет поля — сообщений нет.
   */
  notices: z.array(z.string()).optional(),
  /**
   * Увиденные сюжетные сцены (id из data/story) — каждая показывается один раз. Поле добавлено без смены версии:
   * в старых сохранениях его нет — по умолчанию пусто.
   */
  seenScenes: z.array(z.string()).default([]),
  /**
   * Показанные баннеры «Новая функция!» (id из data/unlocks.json) — каждый один раз. Поле добавлено без смены версии и
   * намеренно без default: нет поля — сохранение старше таблицы открытий, sanitizeSave (initSeenUnlocks) отмечает
   * показанным всё, что игрок уже открыл.
   */
  seenUnlocks: z.array(z.string()).optional(),
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
export type SummonState = z.infer<typeof SummonStateSchema>;
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

/** v4. Таверна новой игры. */
export function emptySummon(): SummonState {
  return { seq: 0, total: 0, sincePurple: 0, firstTenDone: false, welcomeGiven: false, discovered: [] };
}

/** v3. Пустая доска поручений (обновится при первом ensureBoard с настоящим днём). */
export function emptyBounties(): BountiesState {
  return { board: [], lastRefreshDay: DEFAULT_DAY, refreshesUsed: 0, active: [] };
}
