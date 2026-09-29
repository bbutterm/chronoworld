import type { Content } from '../types';
import type { SaveState } from '../save/schema';

/**
 * Ворота предметов по главам (data/items → minChapter): знаменитые предметы RO не должны падать в самом начале.
 * Каждый источник предметов (этапы, сундук и быстрые награды, Лавка, охота) выбирает только предметы
 * с minChapter ≤ «своей» главы. Номер главы — номер на маршруте (поле order в data/campaign: 1…10; глава 9 может
 * отсутствовать, номера после неё не сдвигаются — ворота предметов не «переезжают» при вставке главы).
 */

/** Номер главы на маршруте (order) по id; неизвестная глава — 1 (самые строгие ворота). */
export function chapterNumber(chapterId: string, ctx: { content: Pick<Content, 'chapters'> }): number {
  return ctx.content.chapters.find((c) => c.id === chapterId)?.order ?? 1;
}

/** Глава игрока (номер на маршруте) — глава самого дальнего пройденного этапа; ничего не пройдено — 1. Для Лавки и охоты. */
export function progressChapter(save: Pick<SaveState, 'campaign'>, ctx: { content: Pick<Content, 'chapters' | 'stages'> }): number {
  const cleared = new Set(save.campaign.cleared);
  let chapter = 1;
  for (const s of ctx.content.stages) {
    if (!cleared.has(s.id)) continue;
    const n = chapterNumber(s.chapter, ctx);
    if (n > chapter) chapter = n;
  }
  return chapter;
}
