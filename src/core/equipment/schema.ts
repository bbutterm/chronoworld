import { z } from 'zod';

/**
 * K6. Схемы экипировки: предметы (data/items/*.json) и выпадение (data/drops.json).
 * Статы предметов — плоские прибавки к hp/atk/def/spd (без процентов, без улучшений).
 */

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id: латиница в нижнем регистре, цифры и _');

export const SLOTS = ['weapon', 'armor', 'helmet', 'boots'] as const;
export const RARITIES = ['common', 'rare', 'epic'] as const;

export const SlotSchema = z.enum(SLOTS);
export const RaritySchema = z.enum(RARITIES);

/** Плоская прибавка к статам героя; отсутствующий стат = 0. */
export const ItemStatsSchema = z
  .object({
    hp: z.number().int().nonnegative(),
    atk: z.number().int().nonnegative(),
    def: z.number().int().nonnegative(),
    spd: z.number().int().nonnegative(),
  })
  .partial();

export const ItemDefSchema = z.object({
  id,
  /** Название для игрока (русский). */
  name: z.string().min(1),
  slot: SlotSchema,
  rarity: RaritySchema,
  stats: ItemStatsSchema,
  /**
   * Ограничение по профессии: id профессий-«корней» ветки. Предмет может надеть герой, чья профессия
   * есть в списке или происходит от неё (["archer"] → лучник, охотник, бард). Нет поля — может любой.
   */
  jobs: z.array(id).min(1).optional(),
  /** false — предмет не выпадает с этапов (только из других источников). По умолчанию true. */
  drop: z.boolean().default(true),
  /**
   * С какой главы (номер с 1, по порядку data/campaign) предмет может выпасть или появиться в Лавке, охоте, сундуке.
   * Источник берёт главу игрока (этап — свою главу); предметы с minChapter больше неё в выбор не попадают.
   * Обычные эпики — 2, знаменитые предметы RO (Слейпнир…) — 3. По умолчанию 1 (с самого начала).
   */
  minChapter: z.number().int().min(1).default(1),
});

/** data/items/<файл>.json — список предметов (файлы удобно делить по слотам). */
export const ItemsFileSchema = z.object({
  $schema: z.string().optional(),
  items: z.array(ItemDefSchema).min(1),
});

/** Веса редкостей (относительные, не проценты); нулевой вес — редкость не выпадает. */
export const RarityWeightsSchema = z
  .object({ common: z.number().nonnegative(), rare: z.number().nonnegative(), epic: z.number().nonnegative() })
  .partial()
  .refine((w) => Object.values(w).some((v) => (v ?? 0) > 0), 'хотя бы один вес редкости > 0');

export const DropRuleSchema = z.object({
  /** Для какой главы правило; без поля — правило по умолчанию для остальных глав. */
  chapter: id.optional(),
  /** Шанс выпадения одного предмета за победу (0..1), кроме первого прохождения. */
  chance: z.number().min(0).max(1),
  rarityWeights: RarityWeightsSchema,
  /** Первое прохождение этапа: ровно один гарантированный предмет. */
  firstClearGuaranteed: z.boolean().default(true),
  /** Веса редкостей для гарантированного предмета; без поля — rarityWeights. */
  firstClearRarityWeights: RarityWeightsSchema.optional(),
  /** Первая победа над боссом главы (этап boss): веса редкостей; без поля — firstClearRarityWeights (LT-06: эпик своей главы). */
  bossFirstClearRarityWeights: RarityWeightsSchema.optional(),
  /**
   * Только «свои» предметы (LT-06): из пула берутся вещи с minChapter не меньше этого номера главы (и, как всегда, не больше
   * главы источника) — в главах 4–7 не падают вещи главы 1. Редкость без таких вещей не выпадает (вес уходит остальным).
   */
  itemsFromChapter: z.number().int().min(1).optional(),
});

/** Бросок сундука за тик: с шансом chance — count штук. */
export const ChestRollSchema = z.object({
  chance: z.number().min(0).max(1),
  count: z.number().int().min(1),
});

/**
 * Трофеи сундука простоя (и быстрых наград) для главы: бросаются за каждый полный тик накопленного времени.
 * Глава — глава последнего пройденного этапа.
 */
export const ChestRuleSchema = z.object({
  /** Для какой главы правило; без поля — правило по умолчанию для остальных глав. */
  chapter: id.optional(),
  /** Шанс одного предмета за тик (0..1). */
  item: z.number().min(0).max(1),
  /** Только вещи с minChapter не меньше этого номера главы (как DropRule.itemsFromChapter). */
  itemsFromChapter: z.number().int().min(1).optional(),
  /** Веса редкостей предмета; без поля — rarityWeights правила выпадения этой главы (rules). */
  rarityWeights: RarityWeightsSchema.optional(),
  /**
   * Карта случайного героя за тик (шансы; не больше одной карты за тик): blue — синяя, purple — фиолетовая.
   * Сумма шансов ≤ 1.
   */
  heroCards: z.object({ blue: z.number().min(0).max(1).default(0), purple: z.number().min(0).max(1).default(0) }).refine((c) => c.blue + c.purple <= 1, 'сумма шансов карт за тик ≤ 1').optional(),
  /** Гемы (редко). */
  gems: ChestRollSchema.optional(),
  /** Свитки призыва (очень редко). */
  scrolls: ChestRollSchema.optional(),
});

/** Трофеи сундука: длина тика и правила по главам. */
export const ChestDropsSchema = z.object({
  /** Минут простоя на один бросок (тик). Неполный тик не бросается. */
  tickMinutes: z.number().int().min(5).max(720),
  rules: z.array(ChestRuleSchema).min(1),
});

/** Жёсткий предел заточки (схема сохранения): maxLevel в конфиге — не больше. */
export const REFINE_HARD_MAX = 20;

/**
 * «Заточка» снаряжения (кузнец RO, +1…+maxLevel) — главный сток золота. Статы предмета: база × (1 + bonusByLevel[N]).
 * Цена шага +N → +N+1: cost.base[редкость] × cost.growth^N (округление до 2 значащих цифр). Шаг на +N ломает вещь
 * с шансом breakChance[N−1] (бросок Rng по seed из сохранения); золото списывается в любом случае.
 */
export const RefineConfigSchema = z
  .object({
  maxLevel: z.number().int().min(1).max(REFINE_HARD_MAX),
  /**
   * Накопленная прибавка к статам предмета на +N (доля базы): bonusByLevel[N], N = 0…maxLevel. Длина maxLevel+1,
   * [0] = 0, не убывает. Шаги растут по ступеням: +1…+4 скромные, +8…+10 — огромные (+10 = +250%).
   */
  bonusByLevel: z.array(z.number().min(0).max(20)),
  cost: z.object({
    /** Цена первого шага (+0 → +1) по редкости, золото. */
    base: z.object({ common: z.number().int().positive(), rare: z.number().int().positive(), epic: z.number().int().positive() }),
    /** Во сколько раз дорожает каждый следующий шаг. */
    growth: z.number().min(1).max(4),
  }),
  /**
   * Шанс сломать (уничтожить) вещь при шаге на +N: breakChance[N−1], N = 1…maxLevel (0 — безопасный шаг).
   * Длина — ровно maxLevel, шансы не убывают. Нет поля — заточка всегда успешна.
   */
  breakChance: z.array(z.number().min(0).max(0.99)).optional(),
  /** «Надёжная заточка»: цена шага × safeGoldMult, шанс поломки ÷ safeBreakDiv. Нет полей — только обычная. */
  safeGoldMult: z.number().min(1).max(100).optional(),
  safeBreakDiv: z.number().min(1).max(100).optional(),
  /**
   * «Благословенная руда» (RO Blessed Ore): один шаг заточки без риска поломки (золото — как за обычный шаг).
   * Падает с боссов: первая победа над боссом главы, этаж-босс Башни, первая атака дня в Охоте (если взят порог);
   * min…max штук (равновероятно, Rng от seed награды). Нет поля — руды нет.
   */
  blessedOre: z.object({ min: z.number().int().min(1), max: z.number().int().min(1).max(20) }).refine((o) => o.max >= o.min, 'max ≥ min').optional(),
})
  .superRefine((cfg, c) => {
    const k = cfg.bonusByLevel;
    if (k.length !== cfg.maxLevel + 1) c.addIssue({ code: 'custom', path: ['bonusByLevel'], message: `нужно ровно ${cfg.maxLevel + 1} значений (+0…+${cfg.maxLevel})` });
    if (k[0] !== 0) c.addIssue({ code: 'custom', path: ['bonusByLevel', 0], message: 'на +0 прибавка 0' });
    k.forEach((v, i) => {
      if (i > 0 && v < k[i - 1]) c.addIssue({ code: 'custom', path: ['bonusByLevel', i], message: 'прибавка не должна убывать с уровнем' });
    });
    if ((cfg.safeGoldMult === undefined) !== (cfg.safeBreakDiv === undefined)) c.addIssue({ code: 'custom', path: ['safeGoldMult'], message: 'safeGoldMult и safeBreakDiv задаются вместе' });
    const b = cfg.breakChance;
    if (!b) return;
    if (b.length !== cfg.maxLevel) c.addIssue({ code: 'custom', path: ['breakChance'], message: `нужно ровно ${cfg.maxLevel} шансов (по одному на шаг +1…+${cfg.maxLevel})` });
    b.forEach((v, i) => {
      if (i > 0 && v < b[i - 1]) c.addIssue({ code: 'custom', path: ['breakChance', i], message: 'шанс поломки не должен убывать с уровнем' });
    });
  });

/** data/drops.json. Правило этапа — первое с chapter = глава этапа, иначе первое без chapter. */
export const DropsConfigSchema = z.object({
  $schema: z.string().optional(),
  $comment: z.string().optional(),
  rules: z.array(DropRuleSchema).min(1),
  /** Трофеи сундука простоя и быстрых наград; нет поля — в сундуке только золото и опыт. */
  chest: ChestDropsSchema.optional(),
  /** Заточка снаряжения; нет поля — заточки нет. */
  refine: RefineConfigSchema.optional(),
});

export type Slot = z.infer<typeof SlotSchema>;
export type Rarity = z.infer<typeof RaritySchema>;
export type ItemStats = z.infer<typeof ItemStatsSchema>;
export type ItemDef = z.infer<typeof ItemDefSchema>;
export type RarityWeights = z.infer<typeof RarityWeightsSchema>;
export type DropRule = z.infer<typeof DropRuleSchema>;
export type DropsConfig = z.infer<typeof DropsConfigSchema>;
export type ChestRoll = z.infer<typeof ChestRollSchema>;
export type ChestRule = z.infer<typeof ChestRuleSchema>;
export type ChestDrops = z.infer<typeof ChestDropsSchema>;
export type RefineConfig = z.infer<typeof RefineConfigSchema>;
