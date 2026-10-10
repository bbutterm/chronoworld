/**
 * Тексты «между этапами» (docs/design/lore-route.md §5): эпизод и легенда главы (перед первым входом), летопись главы
 * (после финала), находки этапов (после первой победы). Тексты — в data/campaign (поля главы episode, legend, chronicle
 * и этапа finding); здесь — когда их показать и что уже видено. Чистые функции от сохранения и контента.
 */
import { stageStatus } from '../campaign/campaign';
import type { ChapterChronicleDef, ChapterDef, EpisodeDef, FindingDef, InterludeDef, LegendDef } from '../campaign/schema';
import type { GameContext } from '../progression/types';
import type { SaveState } from '../save/schema';
import type { Content } from '../types';
import { stageLabel } from '../unlocks/unlocks';

/** id показанной страницы в save.seenPages: эпизод и легенда главы показываются одним заходом. */
export const episodePageId = (chapterId: string) => `episode:${chapterId}`;
export const chroniclePageId = (chapterId: string) => `chronicle:${chapterId}`;

const seenPages = (save: Pick<SaveState, 'seenPages'>) => new Set(save.seenPages ?? []);

/** Страницы вступления главы: эпизод и (или) легенда. */
export interface IntroPages {
  chapterId: string;
  /** Номер главы с 1 («Эпизод N»). */
  number: number;
  /** Перерыв во времени — первой страницей, до эпизода. */
  interlude?: InterludeDef;
  episode?: EpisodeDef;
  legend?: LegendDef;
}

/** Глава и её номер на маршруте (order: «Эпизод 10» у Нифльхейма, даже пока главы 9 нет). */
const chapterOf = (chapterId: string, content: Pick<Content, 'chapters'>): { chapter: ChapterDef; number: number } | undefined => {
  const chapter = content.chapters.find((c) => c.id === chapterId);
  return chapter ? { chapter, number: chapter.order } : undefined;
};

/** Перерыв, эпизод и легенда главы (для «Летописи» — без условий показа); у главы их нет — undefined. */
export function introPages(chapterId: string, content: Pick<Content, 'chapters'>): IntroPages | undefined {
  const c = chapterOf(chapterId, content);
  if (!c || (!c.chapter.interlude && !c.chapter.episode && !c.chapter.legend)) return undefined;
  return { chapterId, number: c.number, ...(c.chapter.interlude ? { interlude: c.chapter.interlude } : {}), ...(c.chapter.episode ? { episode: c.chapter.episode } : {}), ...(c.chapter.legend ? { legend: c.chapter.legend } : {}) };
}

/**
 * Эпизод и легенду главы пора показать: они есть, ещё не показаны (save.seenPages) и это первый вход — первый этап
 * главы открыт и не пройден (то же условие, что у сцены chapterStart; игрок, прошедший главу до появления текста,
 * прочитает его в «Летописи»). Иначе undefined.
 */
export function pendingIntro(save: SaveState, chapterId: string, ctx: GameContext): IntroPages | undefined {
  const pages = introPages(chapterId, ctx.content);
  if (!pages || seenPages(save).has(episodePageId(chapterId))) return undefined;
  const first = ctx.content.stages.find((s) => s.chapter === chapterId && s.index === 0);
  if (!first || stageStatus(save, first.id, ctx) !== 'open') return undefined;
  return pages;
}

/** Летопись главы (без условий показа). */
export function chapterChronicle(chapterId: string, content: Pick<Content, 'chapters'>): ChapterChronicleDef | undefined {
  return chapterOf(chapterId, content)?.chapter.chronicle;
}

/** Пройдена ли глава (последний этап — в save.campaign.cleared). */
export function chapterCleared(save: Pick<SaveState, 'campaign'>, chapterId: string, content: Pick<Content, 'stages'>): boolean {
  const last = content.stages.filter((s) => s.chapter === chapterId).at(-1);
  return !!last && save.campaign.cleared.includes(last.id);
}

/**
 * Герои выросли: пройдена глава 4 (дальше — «Годы дорог» перед главой 5). С этого момента личные сцены в таверне
 * звучат взрослыми голосами (assets/voice: взрослая версия клипа — ключ-a.mp3).
 */
export function heroesGrown(save: Pick<SaveState, 'campaign'>, content: Pick<Content, 'chapters' | 'stages'>): boolean {
  const ch4 = content.chapters.find((c) => c.order === 4);
  return !!ch4 && chapterCleared(save, ch4.id, content);
}

/** Летопись главы пора показать: есть, глава пройдена, ещё не показана. */
export function pendingChronicle(save: SaveState, chapterId: string, content: Pick<Content, 'chapters' | 'stages'>): ChapterChronicleDef | undefined {
  const c = chapterChronicle(chapterId, content);
  if (!c || !chapterCleared(save, chapterId, content) || seenPages(save).has(chroniclePageId(chapterId))) return undefined;
  return c;
}

/** Отметить страницу показанной. Уже отмечена — тот же объект save. */
export function markPageSeen(save: SaveState, pageId: string): SaveState {
  if (seenPages(save).has(pageId)) return save;
  return { ...save, seenPages: [...(save.seenPages ?? []), pageId] };
}

// ---------- находки ----------

/** Находка этапа (или undefined). */
export function stageFinding(stageId: string, content: Pick<Content, 'stages'>): FindingDef | undefined {
  return content.stages.find((s) => s.id === stageId)?.finding;
}

/**
 * Находку этапа пора показать в итогах боя: победа на этапе первая, у этапа есть находка и её ещё нет в save.findings.
 */
export function pendingFinding(save: Pick<SaveState, 'findings'>, stageId: string, firstClear: boolean, content: Pick<Content, 'stages'>): FindingDef | undefined {
  if (!firstClear) return undefined;
  const f = stageFinding(stageId, content);
  return f && !(save.findings ?? []).includes(f.id) ? f : undefined;
}

/** Положить находку в сохранение (save.findings). Уже есть — тот же объект save. */
export function collectFinding(save: SaveState, findingId: string): SaveState {
  if ((save.findings ?? []).includes(findingId)) return save;
  return { ...save, findings: [...(save.findings ?? []), findingId] };
}

export interface FindingEntry {
  finding: FindingDef;
  stageId: string;
  chapterId: string;
  /** Номер главы на маршруте (order). */
  chapterNumber: number;
  /** «1-4». */
  stageLabel: string;
  /**
   * Найдена: есть в save.findings или этап пройден (находка не теряется, если итоги боя не показались — авто-режим,
   * «Пропустить», перезагрузка).
   */
  found: boolean;
}

/** Все находки кампании по порядку этапов. */
export function findingEntries(save: Pick<SaveState, 'campaign' | 'findings'>, content: Pick<Content, 'chapters' | 'stages'>): FindingEntry[] {
  const got = new Set(save.findings ?? []);
  const cleared = new Set(save.campaign.cleared);
  const out: FindingEntry[] = [];
  for (const st of content.stages) {
    if (!st.finding) continue;
    out.push({
      finding: st.finding,
      stageId: st.id,
      chapterId: st.chapter,
      chapterNumber: content.chapters.find((c) => c.id === st.chapter)?.order ?? 1,
      stageLabel: stageLabel(st.id, content as Content),
      found: got.has(st.finding.id) || cleared.has(st.id),
    });
  }
  return out;
}

/** Подпись вида находки. */
export const FINDING_KIND_NAMES: Record<FindingDef['kind'], string> = {
  note: 'Записка',
  inscription: 'Надпись',
  rumor: 'Слух',
  item: 'Вещь',
};

// ---------- проверка текстов ----------

/** Сколько находок на главу — событие, а не норма (§5.4). Больше — content:check предупредит. */
export const FINDINGS_PER_CHAPTER_MAX = 4;

/**
 * Проверка текстов глав и реплик: id находок уникальны по всей кампании (✗ — они в сохранениях), находок в главе
 * не больше FINDINGS_PER_CHAPTER_MAX; реплики barks — у боссов и мини-боссов: юнит с репликами не должен стоять
 * в одном этапе дважды — заговорят оба (⚠). Длины проверяет схема.
 */
export function validatePageTexts(content: Pick<Content, 'chapters' | 'units'>): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Map<string, string>();
  for (const ch of content.chapters) {
    const at = `data/campaign (${ch.id})`;
    let n = 0;
    for (const st of ch.stages) {
      const talkers = st.enemies.filter((e) => e && content.units[e.unit]?.barks).map((e) => e!.unit);
      const twice = talkers.find((id, i) => talkers.indexOf(id) !== i);
      if (twice) warnings.push(`${at}: этап ${st.id} — ${twice} с репликами (barks) стоит дважды, заговорят оба`);
      if (!st.finding) continue;
      n++;
      const prev = ids.get(st.finding.id);
      if (prev) errors.push(`${at}: этап ${st.id} — находка ${st.finding.id} уже есть на этапе ${prev} (id находок уникальны по всем главам)`);
      else ids.set(st.finding.id, st.id);
    }
    if (n > FINDINGS_PER_CHAPTER_MAX) warnings.push(`${at}: находок ${n} — больше ${FINDINGS_PER_CHAPTER_MAX}, находка перестаёт быть событием`);
  }
  return { errors, warnings };
}
