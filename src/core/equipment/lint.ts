import type { HuntConfig } from '../hunt/schema';
import type { ShopConfig } from '../shop/schema';
import type { Content } from '../types';
import { itemPools } from './chest';
import { chapterNumber } from './gates';
import type { EquipmentConfig } from './load';
import { RARITIES, SLOTS, type Rarity, type RarityWeights } from './schema';

/**
 * content:check — ворота предметов по главам (data/items → minChapter) во всех источниках предметов.
 * Ошибки: источник, который в своей главе может дать только закрытые предметы (правило выпадения или сундука
 * с шансом предмета, товар Лавки с его fromStage, редкость порога охоты — ни в одной главе).
 * Предупреждения: предмет открыт позже последней главы (не выпадает нигде), у главы нет открытых предметов слота,
 * вес редкости в правиле главы, где такой редкости ещё нет (вес молча уходит другим редкостям).
 */
export interface GateLintContext {
  content: Content;
  equipment: EquipmentConfig;
  shop?: ShopConfig;
  hunt?: HuntConfig;
}

const positive = (w: RarityWeights | undefined): Rarity[] => RARITIES.filter((r) => (w?.[r] ?? 0) > 0);

export function lintItemGates(ctx: GateLintContext): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { items, drops } = ctx.equipment;
  const chapters = ctx.content.chapters.map((c) => c.id);
  const last = chapters.length;
  const pools = (chapter: number) => itemPools(items, chapter);

  for (const def of Object.values(items)) {
    if ((def.minChapter ?? 1) > last && def.drop) warnings.push(`предмет ${def.id}: minChapter ${def.minChapter}, а глав ${last} — пока не выпадает нигде`);
  }
  chapters.forEach((chapterId, i) => {
    const n = i + 1;
    for (const slot of SLOTS) {
      const any = Object.values(items).some((d) => d.drop && d.slot === slot && (d.minChapter ?? 1) <= n);
      if (!any) warnings.push(`глава ${n} (${chapterId}): нет открытых предметов слота ${slot} (minChapter)`);
    }
  });

  // Правило главы: своё или по умолчанию (без chapter).
  const ruleFor = <R extends { chapter?: string }>(rules: readonly R[], chapterId: string) =>
    rules.find((r) => r.chapter === chapterId) ?? rules.find((r) => !r.chapter);

  for (const chapterId of chapters) {
    const n = chapterNumber(chapterId, ctx);
    const rule = ruleFor(drops.rules, chapterId);
    const pool = itemPools(items, n, rule?.itemsFromChapter);
    if (rule) {
      for (const [field, w] of [
        ['rarityWeights', rule.rarityWeights],
        ['firstClearRarityWeights', rule.firstClearRarityWeights],
        ['bossFirstClearRarityWeights', rule.bossFirstClearRarityWeights],
      ] as const) {
        if (!w) continue;
        const open = positive(w).filter((r) => pool[r].length > 0);
        if (!open.length) errors.push(`drops.rules (${chapterId}): ${field} даёт только предметы, закрытые в главе ${n} (minChapter)`);
        for (const r of positive(w)) {
          if (!pool[r].length && rule.chapter === chapterId) warnings.push(`drops.rules (${chapterId}): вес ${r} > 0, но предметов ${r} в главе ${n} нет (minChapter) — поставьте 0`);
        }
      }
    }
    const chest = drops.chest ? ruleFor(drops.chest.rules, chapterId) : undefined;
    if (chest && chest.item > 0) {
      const w = chest.rarityWeights ?? rule?.rarityWeights ?? { common: 1 };
      const chestPool = itemPools(items, n, chest.itemsFromChapter);
      if (!positive(w).some((r) => chestPool[r].length > 0)) errors.push(`drops.chest.rules (${chapterId}): шанс предмета ${chest.item}, но в главе ${n} все его редкости закрыты (minChapter)`);
    }
  }

  if (ctx.shop) {
    const stageChapter = new Map(ctx.content.stages.map((s) => [s.id, s.chapter]));
    for (const g of ctx.shop.goods) {
      if (g.kind !== 'item' || !g.rarity) continue;
      const from = g.fromStage ? chapterNumber(stageChapter.get(g.fromStage) ?? chapters[0], ctx) : 1;
      if (!pools(from)[g.rarity].length) {
        const first = chapters.findIndex((_, i) => pools(i + 1)[g.rarity!].length > 0);
        errors.push(
          `data/shop.json: товар ${g.id} открыт с главы ${from}, но предметов ${g.rarity} там нет (minChapter)` +
            (first >= 0 ? ` — поставьте fromStage на этап главы ${first + 1}` : ''),
        );
      }
    }
  }

  if (ctx.hunt) {
    ctx.hunt.tiers.forEach((t, i) => {
      const r = t.rewards.item;
      if (r && !chapters.some((_, c) => pools(c + 1)[r].length > 0)) errors.push(`data/hunt.json: tiers.${i} — предметов ${r} нет ни в одной главе (minChapter)`);
    });
  }
  return { errors, warnings };
}
