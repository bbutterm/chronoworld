import type { Content } from '../types';
import type { SaveState } from '../save/schema';

/**
 * Ворота предметов по главам (data/items → minChapter): знаменитые предметы RO не должны падать в самом начале.
 * Каждый источник предметов (этапы, сундук и быстрые награды, Лавка, охота) выбирает только предметы
 * с minChapter ≤ «своей» главы. Номер главы — с 1, по порядку content.chapters (data/campaign).
 */

/** Номер главы (с 1) по id; неизвестная глава — 1 (самые строгие ворота). */
export function chapterNumber(chapterId: string, ctx: { content: Pick<Content, 'chapters'> }): number {
  const i = ctx.content.chapters.findIndex((c) => c.id === chapterId);
  return i < 0 ? 1 : i + 1;
}

/** Глава игрока (с 1) — глава самого дальнего пройденного этапа; ничего не пройдено — 1. Для Лавки и охоты. */
export function progressChapter(save: Pick<SaveState, 'campaign'>, ctx: { content: Pick<Content, 'chapters' | 'stages'> }): number {
  const cleared = new Set(save.campaign.cleared);
  let chapter = 0;
  for (const s of ctx.content.stages) {
    if (!cleared.has(s.id)) continue;
    const i = ctx.content.chapters.findIndex((c) => c.id === s.chapter);
    if (i > chapter) chapter = i;
  }
  return chapter + 1;
}
