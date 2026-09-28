import { z } from 'zod';
import { RaritySchema } from '../equipment/schema';

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id: латиница в нижнем регистре, цифры и _');

/**
 * Лавка (как магазин AFK Arena): 8 слотов, раз в день новый ассортимент, ручное обновление за гемы.
 * Виды товаров: предмет экипировки заданной редкости (конкретный предмет выбирается при обновлении), осколки
 * «отстающего» сюжетного героя, опыт в общий пул, свитки призыва, золото (за гемы).
 */
export const SHOP_GOOD_KINDS = ['item', 'shards', 'heroExp', 'scrolls', 'gold'] as const;
export type ShopGoodKind = (typeof SHOP_GOOD_KINDS)[number];

export const SHOP_CURRENCIES = ['gold', 'gems'] as const;
export type ShopCurrency = (typeof SHOP_CURRENCIES)[number];

export const ShopGoodSchema = z
  .object({
    id,
    kind: z.enum(SHOP_GOOD_KINDS),
    /** Редкость предмета (только kind item): предмет — равновероятно среди предметов этой редкости с drop ≠ false. */
    rarity: RaritySchema.optional(),
    /** Сколько штук за покупку (осколки, свитки, опыт, золото); у предмета — 1. */
    count: z.number().int().positive().default(1),
    /** Цена одной покупки. */
    price: z.object({ currency: z.enum(SHOP_CURRENCIES), amount: z.number().int().positive() }),
    /** Сколько раз можно купить товар в слоте (до обновления). */
    stock: z.number().int().positive().default(1),
    /** Вес при выборе товара слота (относительный). */
    weight: z.number().positive(),
    /** Товар появляется только после первого прохождения этого этапа кампании. */
    fromStage: id.optional(),
    /** Не больше стольких покупок товара за день (с учётом ручных обновлений). Нет поля — без лимита. */
    perDay: z.number().int().positive().optional(),
  })
  .superRefine((g, c) => {
    if (g.kind === 'item' && !g.rarity) c.addIssue({ code: 'custom', path: ['rarity'], message: 'у товара-предмета нужна редкость (rarity)' });
    if (g.kind !== 'item' && g.rarity) c.addIssue({ code: 'custom', path: ['rarity'], message: 'rarity — только у товара-предмета (kind item)' });
    if (g.kind === 'item' && g.count !== 1) c.addIssue({ code: 'custom', path: ['count'], message: 'предмет продаётся по одному (count 1)' });
    if (g.kind === 'gold' && g.price.currency === 'gold') c.addIssue({ code: 'custom', path: ['price', 'currency'], message: 'золото за золото не продаётся' });
  });

export const ShopConfigSchema = z
  .object({
    $schema: z.string().optional(),
    $comment: z.string().optional(),
    /** Слоты лавки (8, как в AFK): у каждого — список id товаров, из которых выбирается один по весам. */
    slots: z.array(z.array(id).min(1)).min(1).max(12),
    /** Ручное обновление ассортимента: цена в гемах n-го обновления за день (последняя повторяется) и лимит в день. */
    refresh: z.object({
      gemCosts: z.array(z.number().int().nonnegative()).min(1),
      maxPerDay: z.number().int().nonnegative(),
    }),
    /**
     * Рост с главой: цена в золоте и количество опыта/золота в наборах ×(1 + chapterGrowth × номер главы с 0)
     * (глава — последнего пройденного этапа). Иначе к главе 3 золото лавки ничего не стоит.
     */
    chapterGrowth: z.number().nonnegative(),
    goods: z.array(ShopGoodSchema).min(1),
  })
  .superRefine((cfg, c) => {
    const ids = new Set<string>();
    cfg.goods.forEach((g, i) => {
      if (ids.has(g.id)) c.addIssue({ code: 'custom', path: ['goods', i, 'id'], message: `товар ${g.id} указан дважды` });
      ids.add(g.id);
    });
    cfg.slots.forEach((s, i) =>
      s.forEach((g, j) => {
        if (!ids.has(g)) c.addIssue({ code: 'custom', path: ['slots', i, j], message: `товар ${g} не найден в goods` });
      }),
    );
  });

export type ShopGood = z.infer<typeof ShopGoodSchema>;
export type ShopConfig = z.infer<typeof ShopConfigSchema>;
