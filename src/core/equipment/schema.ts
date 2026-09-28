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
  /** Веса редкостей предмета; без поля — rarityWeights правила выпадения этой главы (rules). */
  rarityWeights: RarityWeightsSchema.optional(),
  /** Осколки «отстающего» сюжетного героя (как у поручений). */
  shards: ChestRollSchema.optional(),
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

/** data/drops.json. Правило этапа — первое с chapter = глава этапа, иначе первое без chapter. */
export const DropsConfigSchema = z.object({
  $schema: z.string().optional(),
  $comment: z.string().optional(),
  rules: z.array(DropRuleSchema).min(1),
  /** Трофеи сундука простоя и быстрых наград; нет поля — в сундуке только золото и опыт. */
  chest: ChestDropsSchema.optional(),
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
