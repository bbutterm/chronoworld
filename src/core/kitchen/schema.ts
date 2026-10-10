import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id: латиница в нижнем регистре, цифры и _');

/**
 * Кухня в Таверне (docs/design/kitchen.md): продукты (ингредиенты) копятся из экспедиций, охоты, повторов кампании и
 * сундука простоя, докупаются за золото; раз в день из них готовится одно блюдо — прибавка отряду до смены дня.
 * Иконки продуктов и блюд — имена контурных иконок скина (src/game/skin.ts, ICONS).
 */
export const KITCHEN_ICONS = ['meat', 'apple', 'carrot', 'honey', 'milk', 'pot'] as const;
export type KitchenIcon = (typeof KITCHEN_ICONS)[number];

/** Прибавки блюда, проценты: atk/hp/def — к статам отряда в бою; exp — к опыту героев за этапы кампании. */
export const KitchenBuffSchema = z
  .object({
    atk: z.number().positive().max(50).optional(),
    hp: z.number().positive().max(50).optional(),
    def: z.number().positive().max(50).optional(),
    exp: z.number().positive().max(100).optional(),
  })
  .refine((b) => b.atk !== undefined || b.hp !== undefined || b.def !== undefined || b.exp !== undefined, 'у блюда нужна хотя бы одна прибавка');

export const IngredientSchema = z.object({
  id,
  /** Название для игрока («Мясо»). */
  name: z.string().min(1).max(24),
  icon: z.enum(KITCHEN_ICONS),
  /** Цена одной штуки в золоте на главе 1 (дальше × (1 + shop.chapterGrowth × (глава − 1)), до 2 значащих цифр). */
  price: z.number().int().positive(),
  /** Вес при случайной выдаче (экспедиции, охота, повторы, сундук). */
  weight: z.number().positive(),
});

export const RecipeSchema = z.object({
  id,
  name: z.string().min(1).max(24),
  /** Короткая строка о блюде (RO-кухня) — для карточки рецепта. */
  description: z.string().min(1).max(90),
  icon: z.enum(KITCHEN_ICONS),
  /** Продукт → штук на одно блюдо. */
  cost: z.record(id, z.number().int().positive()),
  buff: KitchenBuffSchema,
});

const range = z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() }).refine((r) => r.max >= r.min, 'max не меньше min');

export const KitchenConfigSchema = z
  .object({
    $schema: z.string().optional(),
    $comment: z.string().optional(),
    ingredients: z.array(IngredientSchema).min(1),
    recipes: z.array(RecipeSchema).min(1),
    /** Откуда берутся продукты (все броски — от seed источника, docs/design/kitchen.md). */
    sources: z.object({
      /** Вернувшаяся экспедиция: случайно от min до max штук. */
      expedition: range,
      /** Попытка охоты (бой или «Зачистка»), взят хотя бы первый порог: min + ⌊порог / tiersPerExtra⌋, не больше max. */
      hunt: z
        .object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative(), tiersPerExtra: z.number().int().positive() })
        .refine((r) => r.max >= r.min, 'max не меньше min'),
      /** Победный повтор этапа с наградой: с шансом chance — count штук. */
      replay: z.object({ chance: z.number().min(0).max(1), count: z.number().int().positive() }),
      /** Полный тик сундука простоя: с шансом chancePerTick — одна штука. */
      chest: z.object({ chancePerTick: z.number().min(0).max(1) }),
    }),
    /** Покупка продуктов за золото: не больше dailyLimit штук в день; цена растёт с главой. */
    shop: z.object({ dailyLimit: z.number().int().nonnegative(), chapterGrowth: z.number().nonnegative() }),
  })
  .superRefine((cfg, c) => {
    const ing = new Set<string>();
    cfg.ingredients.forEach((g, i) => {
      if (ing.has(g.id)) c.addIssue({ code: 'custom', path: ['ingredients', i, 'id'], message: `продукт ${g.id} указан дважды` });
      ing.add(g.id);
    });
    const rec = new Set<string>();
    cfg.recipes.forEach((r, i) => {
      if (rec.has(r.id)) c.addIssue({ code: 'custom', path: ['recipes', i, 'id'], message: `блюдо ${r.id} указано дважды` });
      rec.add(r.id);
      const keys = Object.keys(r.cost);
      if (!keys.length) c.addIssue({ code: 'custom', path: ['recipes', i, 'cost'], message: 'у блюда нужен хотя бы один продукт' });
      for (const k of keys) if (!ing.has(k)) c.addIssue({ code: 'custom', path: ['recipes', i, 'cost', k], message: `продукт ${k} не найден в ingredients` });
    });
  });

export type KitchenBuff = z.infer<typeof KitchenBuffSchema>;
export type Ingredient = z.infer<typeof IngredientSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
export type KitchenConfig = z.infer<typeof KitchenConfigSchema>;
