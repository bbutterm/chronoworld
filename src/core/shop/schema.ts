import { z } from 'zod';
import { RaritySchema } from '../equipment/schema';
import { CardRaritySchema } from '../heroes/schema';

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id: латиница в нижнем регистре, цифры и _');

/**
 * Лавка (как магазин AFK Arena): 8 слотов, раз в день новый ассортимент, ручное обновление за гемы.
 * Виды товаров: предмет экипировки заданной редкости (конкретный предмет выбирается при обновлении), карта героя
 * (случайный герой редкости cardRarity, выбирается при обновлении), опыт в общий пул, свитки призыва, золото (за гемы).
 * Предметы — «своей главы» (как трофеи кампании: data/drops.json → rules → itemsFromChapter); опыт не предлагается,
 * когда его в запасе с избытком (heroExpAbundant) — узкое место тогда золото.
 */
export const SHOP_GOOD_KINDS = ['item', 'heroCard', 'heroExp', 'scrolls', 'gold'] as const;
export type ShopGoodKind = (typeof SHOP_GOOD_KINDS)[number];

export const SHOP_CURRENCIES = ['gold', 'gems'] as const;
export type ShopCurrency = (typeof SHOP_CURRENCIES)[number];

export const ShopGoodSchema = z
  .object({
    id,
    kind: z.enum(SHOP_GOOD_KINDS),
    /** Редкость предмета (только kind item): предмет — равновероятно среди предметов этой редкости с drop ≠ false. */
    rarity: RaritySchema.optional(),
    /** Редкость карты героя (только kind heroCard). */
    cardRarity: CardRaritySchema.optional(),
    /** Сколько штук за покупку (свитки, опыт, золото); у предмета и карты героя — 1. */
    count: z.number().int().positive().default(1),
    /** Цена одной покупки. */
    price: z.object({ currency: z.enum(SHOP_CURRENCIES), amount: z.number().int().positive() }),
    /** Сколько раз можно купить товар в слоте (до обновления). */
    stock: z.number().int().positive().default(1),
    /** Вес при выборе товара слота (относительный). */
    weight: z.number().positive(),
    /** Товар появляется только после первого прохождения этого этапа кампании. */
    fromStage: id.optional(),
    /** Товар больше не появляется после первого прохождения этого этапа (наборы опыта — только в начале игры). */
    untilStage: id.optional(),
    /** Не больше стольких покупок товара за день (с учётом ручных обновлений). Нет поля — без лимита. */
    perDay: z.number().int().positive().optional(),
  })
  .superRefine((g, c) => {
    if (g.kind === 'item' && !g.rarity) c.addIssue({ code: 'custom', path: ['rarity'], message: 'у товара-предмета нужна редкость (rarity)' });
    if (g.kind !== 'item' && g.rarity) c.addIssue({ code: 'custom', path: ['rarity'], message: 'rarity — только у товара-предмета (kind item)' });
    if (g.kind === 'item' && g.count !== 1) c.addIssue({ code: 'custom', path: ['count'], message: 'предмет продаётся по одному (count 1)' });
    if (g.kind === 'heroCard' && !g.cardRarity) c.addIssue({ code: 'custom', path: ['cardRarity'], message: 'у карты героя нужна редкость (cardRarity)' });
    if (g.kind !== 'heroCard' && g.cardRarity) c.addIssue({ code: 'custom', path: ['cardRarity'], message: 'cardRarity — только у карты героя (kind heroCard)' });
    if (g.kind === 'heroCard' && g.count !== 1) c.addIssue({ code: 'custom', path: ['count'], message: 'карта героя продаётся по одной (count 1)' });
    if (g.kind === 'gold' && g.price.currency === 'gold') c.addIssue({ code: 'custom', path: ['price', 'currency'], message: 'золото за золото не продаётся' });
    if (g.fromStage && g.untilStage && g.fromStage === g.untilStage) c.addIssue({ code: 'custom', path: ['untilStage'], message: 'fromStage и untilStage совпадают — товар никогда не появится' });
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
