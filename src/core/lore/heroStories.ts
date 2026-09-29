/**
 * История героя кусочками (data/lore/hero_stories.json): новый кусочек на уровнях 10, 20, 30, … до предела уровня
 * (красная редкость — 100). Кусочек открыт, если самая высокая копия героя у игрока дошла до его уровня, или он уже
 * прочитан (save.heroStoryRead — прочитанное не пропадает, если копию отдали в корм). Чистые функции от сохранения
 * и лора; без Date и Math.random.
 */
import type { SaveState } from '../save/schema';
import type { HeroStoryPiece, Lore } from './schema';

/** Шаг порогов: кусочек каждые 10 уровней. */
export const HERO_STORY_STEP = 10;
/** Выше этого уровня кусочков нет (предел красной редкости). */
export const HERO_STORY_MAX = 100;

/** Пороги кусочков для героя с пределом уровня maxLevel: 10, 20, … ≤ min(maxLevel, 100). */
export function heroStoryLevels(maxLevel: number): number[] {
  const out: number[] = [];
  for (let l = HERO_STORY_STEP; l <= Math.min(maxLevel, HERO_STORY_MAX); l += HERO_STORY_STEP) out.push(l);
  return out;
}

type StorySave = Pick<SaveState, 'heroes'> & Partial<Pick<SaveState, 'heroStoryRead'>>;

/** Самый высокий уровень среди копий героя у игрока (0 — героя нет). */
export function heroPeakLevel(save: Pick<SaveState, 'heroes'>, templateId: string): number {
  let best = 0;
  for (const h of save.heroes) if (h.templateId === templateId && h.level > best) best = h.level;
  return best;
}

/** Уровни прочитанных кусочков героя. */
export function heroStoryReadLevels(save: Partial<Pick<SaveState, 'heroStoryRead'>>, templateId: string): ReadonlySet<number> {
  return new Set(save.heroStoryRead?.[templateId] ?? []);
}

export interface HeroStoryEntry extends HeroStoryPiece {
  open: boolean;
  /** Открыт и прочитан. */
  read: boolean;
}

/** Все кусочки истории героя по порядку уровней: открыт ли, прочитан ли. Истории нет — пустой список. */
export function heroStoryPieces(save: StorySave, templateId: string, lore: Pick<Lore, 'heroStories'>): HeroStoryEntry[] {
  const peak = heroPeakLevel(save, templateId);
  const read = heroStoryReadLevels(save, templateId);
  return (lore.heroStories[templateId] ?? []).map((p) => {
    const open = peak >= p.level || read.has(p.level);
    return { ...p, open, read: open && read.has(p.level) };
  });
}

/** Сколько открытых непрочитанных кусочков у героя (для отметки «новое»). */
export function heroStoryUnread(save: StorySave, templateId: string, lore: Pick<Lore, 'heroStories'>): number {
  return heroStoryPieces(save, templateId, lore).filter((p) => p.open && !p.read).length;
}

/** Непрочитанные кусочки всех полученных героев (для значка вкладки «Герои» Летописи). */
export function heroStoryUnreadTotal(save: StorySave, lore: Pick<Lore, 'heroStories'>): number {
  const ids = new Set(save.heroes.map((h) => h.templateId));
  let n = 0;
  for (const id of ids) n += heroStoryUnread(save, id, lore);
  return n;
}

/** Отметить прочитанными все открытые кусочки героя. Нового нет — тот же объект save. */
export function markHeroStoryRead<S extends StorySave>(save: S, templateId: string, lore: Pick<Lore, 'heroStories'>): S {
  const fresh = heroStoryPieces(save, templateId, lore).filter((p) => p.open && !p.read);
  if (!fresh.length) return save;
  const levels = [...heroStoryReadLevels(save, templateId), ...fresh.map((p) => p.level)].sort((a, b) => a - b);
  return { ...save, heroStoryRead: { ...(save.heroStoryRead ?? {}), [templateId]: levels } };
}

/**
 * Кусочки, которые открылись между двумя сохранениями (было закрыто в before, открыто в after) — для тоста
 * «Открыта история: …» после «Улучшить».
 */
export function newlyOpenedStories(before: StorySave, after: StorySave, templateId: string, lore: Pick<Lore, 'heroStories'>): HeroStoryPiece[] {
  const was = new Set(heroStoryPieces(before, templateId, lore).filter((p) => p.open).map((p) => p.level));
  return heroStoryPieces(after, templateId, lore)
    .filter((p) => p.open && !was.has(p.level))
    .map(({ level, title, text }) => ({ level, title, text }));
}
