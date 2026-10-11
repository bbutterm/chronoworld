import type { SaveState } from '../save/schema';
import type { Content } from '../types';
import { itemPools } from './chest';
import { progressChapter } from './gates';
import type { EquipmentConfig } from './load';
import type { DropRule } from './schema';

type PoolsCtx = { equipment: EquipmentConfig; content: Pick<Content, 'chapters' | 'stages'> };

/** Правило выпадения главы с номером chapter (order): своё правило главы, иначе общее (без chapter). */
export function chapterDropRule(chapter: number, ctx: PoolsCtx): DropRule | undefined {
  const chapterId = ctx.content.chapters.find((c) => c.order === chapter)?.id;
  const rules = ctx.equipment.drops.rules;
  return rules.find((r) => r.chapter === chapterId) ?? rules.find((r) => !r.chapter);
}

/**
 * «Вещь главы» для Таверны и Лавки: те же предметы, что падают в кампании главы игрока (progressChapter) —
 * minChapter ≤ глава и ≥ itemsFromChapter её правила (data/drops.json → rules). Главы 1–3 — все открытые вещи,
 * с главы 4 — только вещи своей главы: нож главы 1 в главе 8 больше не выпадает.
 */
export function chapterItemPools(save: Pick<SaveState, 'campaign'>, ctx: PoolsCtx): ReturnType<typeof itemPools> {
  const chapter = progressChapter(save, ctx);
  return itemPools(ctx.equipment.items, chapter, chapterDropRule(chapter, ctx)?.itemsFromChapter);
}
