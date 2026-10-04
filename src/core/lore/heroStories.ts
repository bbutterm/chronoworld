/**
 * История героя кусочками (data/lore/hero_stories.json): новый кусочек на уровнях 10, 20, 30, … до предела уровня
 * (красная редкость — 100). Кусочки 10–50 общие (детство, гильдия первой профессии); с 60 (HERO_STORY_BRANCH_FROM) — свои
 * у каждой из двух веток второй профессии (поле branch = id профессии из branches карточки героя).
 *
 * Общий кусочек открыт, если самая высокая копия героя дошла до его уровня. Кусочек ветки открыт, если до уровня дошла
 * копия героя НА ЭТОЙ ВЕТКЕ. Второе условие (BUG-167) — место в кампании: у кусочка с unlockAfterStage (своим или по
 * правилу unlockByLevel файла, подставляется при разборе лора) этот этап должен быть пройден (save.campaign.cleared) —
 * опыт в запасе у позднего игрока не должен открывать поворот главы 8 и финал раньше, чем их покажет кампания. Прочитанное не пропадает (копию отдали в корм, ветку сменили — «дневник всех путей»):
 * save.heroStoryRead[templateId] — уровни прочитанных общих кусочков, save.heroStoryRead[`${templateId}:${ветка}`] — уровни
 * прочитанных кусочков ветки (формат сохранения прежний: словарь «ключ → уровни»). Чистые функции от сохранения и лора;
 * без Date и Math.random.
 */
import type { SaveState } from '../save/schema';
import type { Content } from '../types';
import { stageLabel } from '../unlocks/unlocks';
import type { HeroStoryPiece, Lore } from './schema';

/** Шаг порогов: кусочек каждые 10 уровней. */
export const HERO_STORY_STEP = 10;
/** Выше этого уровня кусочков нет (предел красной редкости). */
export const HERO_STORY_MAX = 100;
/** С этого уровня кусочки делятся по ветке второй профессии (ветка выбирается на фиолетовом, его предел — 60). */
export const HERO_STORY_BRANCH_FROM = 60;

/** Пороги кусочков для героя с пределом уровня maxLevel: 10, 20, … ≤ min(maxLevel, 100). */
export function heroStoryLevels(maxLevel: number): number[] {
  const out: number[] = [];
  for (let l = HERO_STORY_STEP; l <= Math.min(maxLevel, HERO_STORY_MAX); l += HERO_STORY_STEP) out.push(l);
  return out;
}

/** Общие пороги (до ветки): 10 … 50. */
export const heroStoryCommonLevels = (maxLevel: number) => heroStoryLevels(maxLevel).filter((l) => l < HERO_STORY_BRANCH_FROM);
/** Пороги ветки: 60 … 100 (у каждой ветки свои кусочки). */
export const heroStoryBranchLevels = (maxLevel: number) => heroStoryLevels(maxLevel).filter((l) => l >= HERO_STORY_BRANCH_FROM);

/** Ключ кусочка внутри истории героя: «40» — общий, «knight:60» — ветки. */
export const heroStoryPieceKey = (p: Pick<HeroStoryPiece, 'level' | 'branch'>) => (p.branch ? `${p.branch}:${p.level}` : String(p.level));

/** Ключ в save.heroStoryRead: id героя (общие кусочки) или `id:ветка`. */
export const heroStoryReadKey = (templateId: string, branch?: string) => (branch ? `${templateId}:${branch}` : templateId);

type StorySave = Pick<SaveState, 'heroes'> & Partial<Pick<SaveState, 'heroStoryRead' | 'campaign'>>;

/** Самый высокий уровень среди копий героя у игрока (0 — героя нет); с branch — только среди копий на этой ветке. */
export function heroPeakLevel(save: Pick<SaveState, 'heroes'>, templateId: string, branch?: string): number {
  let best = 0;
  for (const h of save.heroes) {
    if (h.templateId !== templateId) continue;
    const reached = branch
      ? Math.max(h.branch === branch ? h.level : 0, h.journey?.branchLevels?.[branch] ?? 0)
      : Math.max(h.level, h.journey?.peakLevel ?? 0);
    best = Math.max(best, reached);
  }
  return best;
}

/** Ветки, на которых стоят копии героя: сначала ветка самой высокой копии. Нет выбранных веток — пусто. */
export function heroStoryBranches(save: Pick<SaveState, 'heroes'>, templateId: string): string[] {
  const peak = new Map<string, number>();
  for (const h of save.heroes) if (h.templateId === templateId && h.branch) peak.set(h.branch, Math.max(peak.get(h.branch) ?? 0, h.level));
  return [...peak.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([b]) => b);
}

/** Уровни прочитанных кусочков героя (без branch — общих, с branch — этой ветки). */
export function heroStoryReadLevels(save: Partial<Pick<SaveState, 'heroStoryRead'>>, templateId: string, branch?: string): ReadonlySet<number> {
  return new Set(save.heroStoryRead?.[heroStoryReadKey(templateId, branch)] ?? []);
}

export interface HeroStoryEntry extends HeroStoryPiece {
  /** Ключ кусочка (heroStoryPieceKey). */
  key: string;
  open: boolean;
  /** Уровень копии героя дошёл до порога (без учёта места в кампании). */
  levelReached: boolean;
  /** Этап-замок unlockAfterStage пройден (нет замка — true). */
  stageReached: boolean;
  /** Открыт и прочитан. */
  read: boolean;
  /**
   * Чей это путь: common — общий кусочек; mine — кусочек ветки, на которой стоит копия героя; other — ветка, которой
   * у игрока сейчас нет (кусочек открыт, только если прочитан раньше — «дневник всех путей»).
   */
  path: 'common' | 'mine' | 'other';
}

/**
 * Все кусочки истории героя: общие по уровню, затем кусочки веток — сначала «свои» (ветка самой высокой копии первой),
 * потом другие, внутри ветки по уровню. Истории нет — пустой список.
 */
export function heroStoryPieces(save: StorySave, templateId: string, lore: Pick<Lore, 'heroStories'>): HeroStoryEntry[] {
  const list = lore.heroStories[templateId] ?? [];
  const mine = heroStoryBranches(save, templateId);
  const order = [...mine];
  for (const p of list) if (p.branch && !order.includes(p.branch)) order.push(p.branch);
  const rank = (p: HeroStoryPiece) => (p.branch ? 1 + order.indexOf(p.branch) : 0);
  const peaks = new Map<string, number>();
  const peakOf = (branch?: string) => {
    const k = branch ?? '';
    if (!peaks.has(k)) peaks.set(k, heroPeakLevel(save, templateId, branch));
    return peaks.get(k)!;
  };
  const cleared = new Set(save.campaign?.cleared ?? []);
  return [...list]
    .sort((a, b) => rank(a) - rank(b) || a.level - b.level)
    .map((p) => {
      const wasRead = heroStoryReadLevels(save, templateId, p.branch).has(p.level);
      const levelReached = peakOf(p.branch) >= p.level;
      const stageReached = !p.unlockAfterStage || cleared.has(p.unlockAfterStage);
      const open = (levelReached && stageReached) || wasRead;
      const path: HeroStoryEntry['path'] = !p.branch ? 'common' : mine.includes(p.branch) ? 'mine' : 'other';
      return { ...p, key: heroStoryPieceKey(p), open, levelReached, stageReached, read: open && wasRead, path };
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

/** Отметить прочитанными все открытые кусочки героя (общие и всех веток). Нового нет — тот же объект save. */
export function markHeroStoryRead<S extends StorySave>(save: S, templateId: string, lore: Pick<Lore, 'heroStories'>): S {
  const fresh = heroStoryPieces(save, templateId, lore).filter((p) => p.open && !p.read);
  if (!fresh.length) return save;
  const next: Record<string, number[]> = { ...(save.heroStoryRead ?? {}) };
  for (const p of fresh) {
    const k = heroStoryReadKey(templateId, p.branch);
    next[k] = [...new Set([...(next[k] ?? []), p.level])].sort((a, b) => a - b);
  }
  return { ...save, heroStoryRead: next };
}

/**
 * Кусочки, которые открылись между двумя сохранениями (было закрыто в before, открыто в after) — для тоста
 * «Открыта история: …» после «Улучшить» и после выбора или смены ветки.
 */
export function newlyOpenedStories(before: StorySave, after: StorySave, templateId: string, lore: Pick<Lore, 'heroStories'>): HeroStoryPiece[] {
  const was = new Set(heroStoryPieces(before, templateId, lore).filter((p) => p.open).map((p) => p.key));
  return heroStoryPieces(after, templateId, lore)
    .filter((p) => p.open && !was.has(p.key))
    .map(({ level, title, text, branch, unlockAfterStage }) => ({ level, title, text, ...(branch ? { branch } : {}), ...(unlockAfterStage ? { unlockAfterStage } : {}) }));
}

/**
 * Подпись сюжетного замка кусочка: «после главы 8» (этап — последний в главе) или «после этапа 8-16». Номер этапа, не
 * название: название может само оказаться спойлером.
 */
export function heroStoryGateLabel(stageId: string, content: Pick<Content, 'stages' | 'chapters'>): string {
  const st = content.stages.find((s) => s.id === stageId);
  if (!st) return `после этапа ${stageId}`;
  const ch = content.chapters.find((c) => c.id === st.chapter);
  const last = Math.max(...content.stages.filter((s) => s.chapter === st.chapter).map((s) => s.index));
  return st.index === last ? `после главы ${ch?.order ?? '?'}` : `после этапа ${stageLabel(stageId, content as Content)}`;
}
