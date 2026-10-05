import { z } from 'zod';
import { CardRaritySchema } from '../heroes/schema';
import { TowerSaveSchema } from '../tower/runSchema';
import { AutobattlerSaveSchema } from '../autobattler/schema';

export const SAVE_VERSION = 7;

/**
 * v4. Экземпляр карточки героя (docs/design/heroes.md): шаблон data/heroes/<templateId>.json, редкость и уровень.
 * Имя, пол, класс, роль и навыки — из шаблона (heroes/card.ts heroCard). id экземпляра (h1, h2…) не меняется —
 * на него ссылаются отряд, пресеты, экспедиции и надетые предметы.
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
  /**
   * v6. Ветка второй профессии (id профессии из branches шаблона), выбранная на фиолетовом. Нет поля — не выбрана:
   * герой воюет формой первой профессии (у фиолетового и выше — «Выберите ветку!»).
   */
  branch: z.string().optional(),
  /** v6. Сколько раз ветку меняли (первая смена бесплатно — data/cards.json → branchChange). Нет поля — 0. */
  branchChanges: z.number().int().nonnegative().optional(),
  /**
   * Догоняющий уровень сюжетного героя (heroes/roster.ts catchUpLevel): до этого уровня герой пришёл даром. Опыт и
   * золото за уровни ниже grantedLevel не возвращаются при отдаче в корм (merge.ts) — иначе дар превращался бы в ресурсы.
   * Нет поля — 1.
   */
  grantedLevel: z.number().int().positive().optional(),
  /** Личная копия персонажа: сохраняет идентичность при развитии профессии. */
  companion: z.boolean().optional(),
  /** Фактически оплаченная тренировка; выданные уровни не создают возврат ресурсов. */
  training: z.object({
    exp: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    gold: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }).optional(),
  /** Достигнутые вехи сохраняются при бесплатном сбросе тренировки. */
  journey: z.object({
    peakLevel: z.number().int().min(1).max(100).optional(),
    branchLevels: z.record(z.string(), z.number().int().min(1).max(100)).optional(),
    /** Последний собственный выбор пути: восстанавливается при возвращении фиолетовой редкости. */
    lastBranch: z.string().optional(),
    focus: z.enum(['resolve', 'precision', 'guard']).optional(),
  }).optional(),
});

/** v4. Состояние Таверны. */
export const SummonStateSchema = z.object({
  /** Номер следующего вызова summon — часть seed (hash(createdAt, seq)). */
  seq: z.number().int().nonnegative(),
  /** Всего призвано карточек. */
  total: z.number().int().nonnegative(),
  /** Призывов подряд без фиолетовой (гарант фиолетовой, summon.json → pity). */
  sincePurple: z.number().int().nonnegative(),
  /** v6. Призывов подряд без синей или выше (гарант синей). Нет поля — 0. */
  sinceBlue: z.number().int().nonnegative().optional(),
  /** Первый призыв ×10 уже был (гарант первого ×10 выдан). */
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
  /**
   * Заточка +N (как у кузнеца в RO): статы предмета × (1 + bonusByLevel[N]), data/drops.json → refine.
   * Без смены версии: нет поля — +0 (старые сохранения читаются как есть). Выше maxLevel конфига (было +15 до
   * введения поломки, сейчас +10) — sanitizeSave ограничивает до maxLevel.
   */
  refine: z.number().int().min(0).max(20).optional(),
  /** Вставленная карта MVP (id из data/hunt.json → cards; equipment/cards.ts). Без смены версии: нет поля — слот пуст. */
  card: z.string().optional(),
  /** Защита от пакетного разбора и продажи. */
  locked: z.boolean().optional(),
});

/** v3 (K8). Сохранённая расстановка отряда: 5 слотов, id героя или null. */
export const PresetSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  squad: z.array(z.string().nullable()).length(5),
});

/**
 * v6. Добыча экспедиции — бросается при отправке (детерминированно, meta/expeditions.ts rollExpeditionLoot) и хранится
 * снимком, чтобы правка data/expeditions.json не меняла уже начатые экспедиции.
 */
export const ExpeditionRewardsSchema = z.object({
  gold: z.number().int().nonnegative(),
  /** Опыт в общий пул героев. */
  jobExp: z.number().int().nonnegative(),
  gems: z.number().int().nonnegative(),
  /** v7. Карты случайных героев: сколько синих и фиолетовых (герои — при получении, heroes/cardDrops.ts). */
  heroCards: z.object({ blue: z.number().int().nonnegative(), purple: z.number().int().nonnegative() }),
  scrolls: z.number().int().nonnegative(),
  /** id предметов из data/items. */
  items: z.array(z.string()),
});

/** Событие экспедиции: id из data/expedition_events.json, когда случается (мс) и решение (если уже принято). */
export const ExpeditionEventStateSchema = z.object({
  id: z.string().min(1),
  at: z.number(),
  /** Выбранный вариант; нет — ждёт решения (при «Забрать» — вариант по умолчанию). */
  choice: z.string().optional(),
  /** Удался ли вариант. */
  ok: z.boolean().optional(),
  /** Выбрано само (игрок не решил до «Забрать»). */
  auto: z.boolean().optional(),
  /** Кто действовал и второй герой (для «сблизились»): id героев. */
  actor: z.string().optional(),
  partner: z.string().optional(),
  /** Найденный предмет (id из data/items). */
  item: z.string().optional(),
});

/** v6. Экспедиция в пути: локация, длительность, отряд (id героев), мощь отряда при отправке, время (мс) и добыча. */
export const ActiveExpeditionSchema = z.object({
  /** id локации из data/expeditions.json (на локации — одна экспедиция). */
  location: z.string().min(1),
  hours: z.number().positive(),
  heroIds: z.array(z.string()).min(1),
  power: z.number().int().nonnegative(),
  startedAt: z.number(),
  endsAt: z.number(),
  rewards: ExpeditionRewardsSchema,
  /**
   * События в пути («текстовые приключения», meta/expedition-events.ts): выпадают при отправке. Без смены версии:
   * нет поля (экспедиция из старого сохранения) — событий нет.
   */
  events: z.array(ExpeditionEventStateSchema).optional(),
});

/** Запись Летописи экспедиций. */
export const ExpeditionJournalEntrySchema = z.object({ at: z.number(), location: z.string(), text: z.string() });

/** «Сблизились» в экспедиции: пара героев (id), где и когда. Отдельно от других систем близости. */
export const ExpeditionBondSchema = z.object({ heroes: z.tuple([z.string(), z.string()]), location: z.string(), at: z.number() });

/**
 * v6. Экспедиции (K9, заменили доску поручений). Ключ сохранения `bounties` оставлен историческим — как id функции
 * в data/unlocks.json и счётчик bounties_done (миграция v5 → v6 — save/migrate-expeditions.ts migrateBountiesToExpeditions).
 */
export const ExpeditionsStateSchema = z.object({
  active: z.array(ActiveExpeditionSchema),
  /** Летопись экспедиций (последние записи; без смены версии — нет поля, пусто). */
  journal: z.array(ExpeditionJournalEntrySchema).optional(),
  /** Кто с кем сблизился в экспедициях (без смены версии — нет поля, пусто). */
  bonds: z.array(ExpeditionBondSchema).optional(),
});

/** v3 (K10). Счётчики достижений (ключ → значение) и id полученных достижений. */
export const AchievementsStateSchema = z.object({
  counters: z.record(z.string(), z.number().int().nonnegative()),
  claimed: z.array(z.string()),
});

/**
 * v5. Набор наград (события, почта): золото, гемы, опыт в общий пул, свитки призыва, карточки героев (id шаблона,
 * выдаются на базовой редкости шаблона). Нет поля — 0 / нет. Та же форма — в data/events.json.
 */
export const RewardBundleSchema = z.object({
  gold: z.number().int().nonnegative().optional(),
  gems: z.number().int().nonnegative().optional(),
  /** Опыт в общий пул героев. */
  jobExp: z.number().int().nonnegative().optional(),
  /** Свитки призыва Таверны. */
  scrolls: z.number().int().nonnegative().optional(),
  /** Карточки героев: id шаблона из data/heroes (редкость — baseRarity шаблона). */
  heroes: z.array(z.string()).optional(),
  /** v6. Карты случайных героев: сколько синих и фиолетовых (целые; герой каждой — случайный при получении). */
  heroCards: z.object({ blue: z.number().int().nonnegative().optional(), purple: z.number().int().nonnegative().optional() }).optional(),
  /** v6. «Контракт героя»: герой на выбор игрока этой редкости (ветку — тоже на выбор). Попадает в save.pendingPicks. */
  heroPicks: z.array(z.object({ rarity: CardRaritySchema })).optional(),
});

/** v6. Невыбранный «Контракт героя»: редкость и откуда (id события/письма — для подписи). */
export const HeroPickSchema = z.object({
  rarity: CardRaritySchema,
  source: z.string(),
});

/** v5. Письмо в почте. */
export const LetterSchema = z.object({
  /** m1, m2… — номер письма в этом сохранении. */
  id: z.string().min(1),
  /** id письма из data/events.json → mail.letters (системные письма; каждое доставляется один раз). */
  source: z.string().optional(),
  from: z.string(),
  title: z.string(),
  body: z.string(),
  /** День доставки 'YYYY-MM-DD'. */
  day: DayStringSchema,
  rewards: RewardBundleSchema,
  read: z.boolean(),
  /** Вложение забрано (письмо без вложения — всегда false). */
  claimed: z.boolean(),
});

/** v5. Почта: письма (новые — первыми) и id уже доставленных системных писем. */
export const MailStateSchema = z.object({
  /** Номер последнего выданного id письма. */
  seq: z.number().int().nonnegative(),
  letters: z.array(LetterSchema),
  delivered: z.array(z.string()),
});

/**
 * v5. События новичка (data/events.json): «Вход 7 дней» и «7 дней новичка». Появляется при первом открытии игры
 * с настоящим днём (events/events.ts touchEvents). Нет поля — события ещё не начинались.
 */
export const EventsStateSchema = z.object({
  /** День старта (первое открытие) — от него считаются дни «7 дней новичка». */
  startDay: DayStringSchema,
  /** Последний день, засчитанный во вход. */
  lastDay: DayStringSchema,
  /** Сколько разных дней игрок открывал игру (пропуски не сбрасывают, как в AFK). */
  loginDays: z.number().int().positive(),
  /** Номера дней входа (1…7), награда за которые получена. */
  loginClaimed: z.array(z.number().int().positive()),
  /** id заданий «7 дней новичка», очки за которые получены. */
  newbieTasks: z.array(z.string()),
  /** Пороги очков новичка, сундук за которые получен. */
  newbieMilestones: z.array(z.number().int().positive()),
});

/**
 * Слот Лавки — снимок товара из data/shop.json на момент обновления (правка конфига не меняет уже выставленное):
 * конкретный предмет / герой карты, количество, цена, запас и сколько уже куплено.
 */
export const ShopSlotSchema = z.object({
  /** id товара из data/shop.json → goods. */
  good: z.string(),
  kind: z.enum(['item', 'heroCard', 'heroExp', 'scrolls', 'gold']),
  /** kind item: id предмета (data/items). */
  itemId: z.string().optional(),
  /** v6. kind heroCard: герой (шаблон, выбран при обновлении ассортимента) и редкость карты. */
  hero: z.string().optional(),
  rarity: CardRaritySchema.optional(),
  count: z.number().int().positive(),
  currency: z.enum(['gold', 'gems']),
  price: z.number().int().positive(),
  stock: z.number().int().positive(),
  bought: z.number().int().nonnegative(),
});

/** Лавка (src/core/shop): ассортимент дня, ручные обновления и покупки за день (для лимитов perDay). */
export const ShopStateSchema = z.object({
  /** День ассортимента 'YYYY-MM-DD'. */
  day: DayStringSchema,
  /** Ручных обновлений за day. */
  refreshes: z.number().int().nonnegative(),
  slots: z.array(ShopSlotSchema),
  /** id товара → покупок за day (лимит perDay). */
  boughtToday: z.record(z.string(), z.number().int().nonnegative()),
});

/**
 * «Охота на босса» (hunt/hunt.ts): день последней попытки, попыток в этот день и лучший урон по каждому боссу
 * (id юнита из data/hunt.json → bosses) — для «Зачистки». Поле добавлено без смены версии: нет поля — ещё не охотились.
 */
export const HuntStateSchema = z.object({
  day: DayStringSchema,
  used: z.number().int().nonnegative(),
  best: z.record(z.string(), z.number().int().nonnegative()),
  /** MVP-охота (docs/design/mvp-hunt.md), без смены версии: побед над каждым MVP (id юнита). Нет поля — ни одной. */
  kills: z.record(z.string(), z.number().int().nonnegative()).optional(),
  /** Невставленные карты MVP: id карты → штук. */
  cards: z.record(z.string(), z.number().int().nonnegative()).optional(),
  /** Уровень MVP охотника (hunt.ts huntRank): победа на нём — выше, поражение — ниже. Нет поля — по лучшему урону. */
  level: z.number().int().nonnegative().optional(),
  /** Побед подряд без карты (гарантия hunt.mvp.cardPity). */
  dry: z.number().int().nonnegative().optional(),
});

export const SaveStateSchema = z.object({
  version: z.literal(SAVE_VERSION),
  createdAt: z.number(),
  heroes: z.array(HeroStateSchema).min(1),
  /** Последний выданный hN: удалённые копии не освобождают идентификатор персонажа. */
  heroSeq: z.number().int().nonnegative().optional(),
  /** 5 слотов отряда: id героя или null. */
  squad: z.array(z.string().nullable()).length(5),
  campaign: z.object({ cleared: z.array(z.string()) }),
  /** Суточный бюджет наград за повторные победы; тренировка остаётся доступной. */
  campaignFarm: z.object({ day: DayStringSchema, wins: z.number().int().nonnegative() }).optional(),
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
    /** «Благословенная руда» (заточка без риска поломки, падает с боссов). Без смены версии: нет поля — 0. */
    blessedOre: z.number().int().nonnegative().optional(),
  }),
  /** v2. Башня (K4): floor — лучший этаж; забег-рогалик и осколки — необязательные поля (tower/runSchema.ts, без смены версии). */
  tower: TowerSaveSchema,
  /** Самостоятельный матч с нормализованными героями и собственной экономикой. */
  autobattler: AutobattlerSaveSchema.optional(),
  /** v2. Резерв под экипировку (K6): экземпляры предметов, equippedBy — id героя или null. */
  inventory: z.object({
    items: z.array(ItemInstanceSchema),
    /**
     * Номер следующей попытки заточки — часть seed броска поломки (refineSeed(createdAt, refineSeq)). Растёт с каждой
     * попыткой, поэтому перезагрузка страницы не даёт «перебросить» исход. Без смены версии: нет поля — 0.
     */
    refineSeq: z.number().int().nonnegative().optional(),
    /** Не переиспользовать ID удалённых предметов при следующей выдаче. */
    itemSeq: z.number().int().nonnegative().optional(),
  }),
  /** v3 (K8). Пресеты отряда. */
  presets: z.array(PresetSchema),
  /** v6 (K9). Экспедиции в пути (ключ исторический: до v6 здесь была доска поручений). */
  bounties: ExpeditionsStateSchema,
  /** v3 (K10). Достижения. */
  achievements: AchievementsStateSchema,
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
  /** Кампанийные решения; default — пропуск, без морального ответа за игрока. */
  campaignChoices: z.record(z.string(), z.string()).optional(),
  /**
   * Показанные баннеры «Новая функция!» (id из data/unlocks.json) — каждый один раз. Поле добавлено без смены версии и
   * намеренно без default: нет поля — сохранение старше таблицы открытий, sanitizeSave (initSeenUnlocks) отмечает
   * показанным всё, что игрок уже открыл. Стоит сразу после seenScenes и до mail (newGame и initSeenUnlocks кладут его
   * туда же): serialize(deserialize(x)) === serialize(x).
   */
  seenUnlocks: z.array(z.string()).optional(),
  /**
   * v5. Почта (подарки, компенсации, письмо «Добро пожаловать»). Порядок ключей важен для
   * serialize(deserialize(x)) === serialize(x): newGame кладёт mail сразу после seenScenes, events появляется позже
   * (touchEvents) — раньше необязательных полей ниже.
   */
  mail: MailStateSchema,
  /** v5. «Вход 7 дней» и «7 дней новичка». Нет поля — ещё не начинались (начнутся при открытии игры). */
  events: EventsStateSchema.optional(),
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
  /** Лавка (src/core/shop). Поле добавлено без смены версии: нет поля — лавку ещё не открывали. */
  shop: ShopStateSchema.optional(),
  /** Охота на босса. Нет поля — ещё не охотились (без смены версии). */
  hunt: HuntStateSchema.optional(),
  /** v6. Невыбранные «Контракты героя» (награды событий): экран выбора героя и ветки. Нет поля — нет. */
  pendingPicks: z.array(HeroPickSchema).optional(),
  /**
   * Находки (id из data/campaign → stages[].finding), которые игрок уже получил — карточка показана в итогах боя.
   * Без смены версии: нет поля — пусто (находки пройденных этапов «Летопись» всё равно покажет).
   */
  findings: z.array(z.string()).optional(),
  /**
   * Показанные страницы глав: `episode:<глава>` (эпизод и легенда — одним показом) и `chronicle:<глава>` (летопись
   * после финала). Каждая показывается сама один раз, потом живёт в «Летописи». Без смены версии: нет поля — пусто.
   */
  seenPages: z.array(z.string()).optional(),
  /**
   * Прочитанные кусочки истории героев (data/lore/hero_stories.json): id карточки → уровни-пороги прочитанных кусочков
   * (src/core/lore/heroStories.ts). Прочитанный кусочек остаётся открытым, даже если копию героя отдали в корм.
   * Без смены версии: нет поля — ничего не прочитано.
   */
  heroStoryRead: z.record(z.string(), z.array(z.number().int().positive())).optional(),
  /**
   * Вечера в «Двух колоколах» и близость (src/core/tavern, docs/design/tavern-evenings.md): seen — показанные вечера и
   * личные сцены, choices — id выбора → id варианта, bond — id карточки сюжетного героя → близость, quests — выполненные
   * личные задания. Без смены версии: нет поля — ничего не видено, близость 0.
   */
  tavern: z
    .object({
      seen: z.array(z.string()).optional(),
      choices: z.record(z.string(), z.string()).optional(),
      bond: z.record(z.string(), z.number().int().nonnegative()).optional(),
      quests: z.array(z.string()).optional(),
      /** Участники первой победы последнего этапа главы. Повреждённая запись не ломает основной прогресс. */
      chapterSquads: z.record(z.string(), z.array(z.string()).max(5).catch([])).catch({}).optional(),
    })
    .optional(),
  /**
   * Использованные одноразовые коды (src/core/codes, data/codes.json) — в нижнем регистре. Без смены версии: нет поля —
   * ни один одноразовый код не вводили. Многоразовые коды сюда не пишутся.
   */
  codesUsed: z.array(z.string()).optional(),
  /** Облачные квитанции и независимый недельный зачёт, совместимые со старыми сохранениями. */
  online: z.object({
    appliedGrantIds: z.array(z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)).default([]),
    mvpWeek: z.object({
      week: z.string().regex(/^\d{4}-W\d{2}$/),
      value: z.number().finite().nonnegative(),
    }).optional(),
    towerWeek: z.object({
      week: z.string().regex(/^\d{4}-W\d{2}$/),
      value: z.number().finite().nonnegative(),
    }).optional(),
  }).optional(),
});

export type HeroState = z.infer<typeof HeroStateSchema>;
export type SaveState = z.infer<typeof SaveStateSchema>;
export type SummonState = z.infer<typeof SummonStateSchema>;
export type DailyState = z.infer<typeof DailyStateSchema>;
export type ItemInstance = z.infer<typeof ItemInstanceSchema>;
export type Preset = z.infer<typeof PresetSchema>;
export type ExpeditionRewards = z.infer<typeof ExpeditionRewardsSchema>;
export type ActiveExpedition = z.infer<typeof ActiveExpeditionSchema>;
export type ExpeditionEventState = z.infer<typeof ExpeditionEventStateSchema>;
export type ExpeditionJournalEntry = z.infer<typeof ExpeditionJournalEntrySchema>;
export type ExpeditionBond = z.infer<typeof ExpeditionBondSchema>;
export type ExpeditionsState = z.infer<typeof ExpeditionsStateSchema>;
export type AchievementsState = z.infer<typeof AchievementsStateSchema>;
export type RewardBundle = z.infer<typeof RewardBundleSchema>;
export type Letter = z.infer<typeof LetterSchema>;
export type MailState = z.infer<typeof MailStateSchema>;
export type EventsState = z.infer<typeof EventsStateSchema>;
export type ShopSlot = z.infer<typeof ShopSlotSchema>;
export type ShopState = z.infer<typeof ShopStateSchema>;
export type HuntState = z.infer<typeof HuntStateSchema>;
export type HeroPick = z.infer<typeof HeroPickSchema>;

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
  return { seq: 0, total: 0, sincePurple: 0, sinceBlue: 0, firstTenDone: false, welcomeGiven: false, discovered: [] };
}

/** v6. Нет экспедиций в пути. */
export function emptyExpeditions(): ExpeditionsState {
  return { active: [] };
}

/** v5. Пустая почта. */
export function emptyMail(): MailState {
  return { seq: 0, letters: [], delivered: [] };
}
