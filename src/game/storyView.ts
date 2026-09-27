/**
 * Сюжет в UI без Phaser (тесты — tests/story.test.ts): кто говорит и чей портрет показать.
 */
import { heroGender, heroName, storyOrder, type Gender, type GameContext, type HeroState, type SaveState, type SpeakerDef, type StageInfo, type StoryContext, type StoryDef, type StoryScene } from '../core';
import { genderedSpriteId } from '../pipeline/sprites';
import { heroSprite } from './flow';
import { hasSprite } from './spriteRegistry';

export interface SpeakerView {
  name: string;
  /** id спрайта для портрета; null — картинки нет (UI ставит иконку скина). */
  sprite: string | null;
  /** Пол говорящего героя (из карточки или по имени сюжетной карточки) — для бюста; не герой — нет. */
  gender?: Gender;
}

/** hero1..heroN → карточка сюжетного героя N-го по порядку сюжета (progression.heroes: start, затем recruits), если она у игрока есть. */
export function speakerHero(key: string, save: SaveState, ctx: GameContext) {
  const m = /^hero(\d+)$/.exec(key);
  const templateId = m ? storyOrder(ctx)[Number(m[1]) - 1] : undefined;
  return templateId ? save.heroes.find((h) => h.templateId === templateId) : undefined;
}

/** Пол сюжетной карточки по имени спикера (рекрут до вступления: «Грета» → f). */
function genderByName(name: string, ctx: GameContext): Gender | undefined {
  return Object.values(ctx.content.heroes).find((t) => t.name === name)?.gender;
}

/**
 * Спрайт портрета спикера: 'hero' — класс карточки героя (нет героя — лист Новичка);
 * 'unit:<id>' — спрайт юнита (юнита нет — null); иначе id профессии, а если такой нет — id спрайта как есть.
 * gender — пол говорящего: лист профессии `<спрайт>_<m|f>`, если есть (Грета с портретом novice → novice_f).
 */
export function portraitSprite(portrait: string, ctx: GameContext, hero?: SaveState['heroes'][number], gender?: Gender): string | null {
  if (portrait === 'hero') {
    if (hero) return heroSprite(hero, ctx);
    const start = ctx.content.jobs.novice?.visual.sprite;
    return start ? genderedSpriteId(start, gender, hasSprite) : null;
  }
  if (portrait.startsWith('unit:')) return ctx.content.units[portrait.slice(5)]?.visual.sprite ?? null;
  const job = ctx.content.jobs[portrait]?.visual.sprite;
  return job ? genderedSpriteId(job, gender, hasSprite) : portrait;
}

/** Имя и портрет спикера реплики. Имя героев hero1..heroN — из карточки игрока. */
export function speakerView(story: StoryDef | undefined, key: string, save: SaveState, ctx: GameContext): SpeakerView {
  const sp: SpeakerDef | undefined = story?.speakers[key];
  const hero = speakerHero(key, save, ctx);
  // Пол: карточка героя (hero1..N) → сюжетная карточка по имени спикера (рекрут до вступления) → нет.
  const gender = hero ? heroGender(hero, ctx) : sp ? genderByName(sp.name, ctx) : undefined;
  return {
    name: hero ? heroName(hero, ctx) : (sp?.name ?? key),
    sprite: sp ? portraitSprite(sp.portrait, ctx, hero, gender) : hero ? heroSprite(hero, ctx) : null,
    ...(gender ? { gender } : {}),
  };
}

/** Последний этап главы (босс) — после его первой победы глава пройдена. */
export function chapterLastStage(chapterId: string, ctx: GameContext): StageInfo | undefined {
  const stages = ctx.content.stages.filter((s) => s.chapter === chapterId);
  return stages[stages.length - 1];
}

/** Сцена — финал главы: «после этапа» на последнем этапе главы (T1-05: в авто-режиме сама не листается). */
export function isChapterFinale(scene: Pick<StoryScene, 'trigger' | 'stageId' | 'chapter'>, ctx: GameContext): boolean {
  return scene.trigger === 'afterStage' && !!scene.stageId && chapterLastStage(scene.chapter, ctx)?.id === scene.stageId;
}

/** Подпись сцены в списке «История»: «Вступление», «Перед этапом 4», «После этапа 4», «Финал главы». */
export function sceneLabel(scene: StoryScene, ctx: GameContext): string {
  if (scene.trigger === 'chapterStart') return 'Вступление';
  if (isChapterFinale(scene, ctx)) return 'Финал главы';
  const stage = ctx.content.stages.find((s) => s.id === scene.stageId);
  const n = stage ? stage.globalIndex + 1 : '?';
  return scene.trigger === 'beforeStage' ? `Перед этапом ${n}${stage?.boss ? ' (босс)' : ''}` : `После этапа ${n}`;
}

/** «История» (P3 / T1-03): увиденные сцены главы в порядке сюжета. */
export function seenChapterScenes(save: SaveState, chapterId: string, ctx: StoryContext): StoryScene[] {
  const seen = new Set(save.seenScenes);
  return ctx.story.scenes.filter((s) => s.chapter === chapterId && seen.has(s.id));
}

/** Экран «Глава пройдена» (T1-03): итоги главы и новый герой. */
export interface ChapterSummary {
  chapterId: string;
  /** Номер главы с 1 и её название. */
  number: number;
  name: string;
  /** Пройдено этапов главы / всего. */
  cleared: number;
  stages: number;
  /** Награды первых прохождений этапов главы (сумма по data/campaign). */
  gold: number;
  jobExp: number;
  /** Сколько предметов в инвентаре (трофеи). */
  items: number;
  /** Герой, присоединившийся после босса главы (progression.heroes.recruits), если он уже у игрока. */
  recruit?: HeroState;
  /** Следующая глава (для «Глава N ›»): индекс в content.chapters, номер и название. */
  next?: { index: number; number: number; name: string };
}

export function chapterSummary(save: SaveState, chapterId: string, ctx: GameContext): ChapterSummary {
  const chapters = ctx.content.chapters;
  const index = chapters.findIndex((c) => c.id === chapterId);
  const stages = ctx.content.stages.filter((s) => s.chapter === chapterId);
  const cleared = stages.filter((s) => save.campaign.cleared.includes(s.id)).length;
  const last = stages[stages.length - 1];
  const rc = last ? ctx.progression.heroes.recruits.find((r) => r.afterStage === last.id) : undefined;
  const recruit = rc ? save.heroes.find((h) => h.templateId === rc.template) : undefined;
  const nextChapter = index >= 0 ? chapters[index + 1] : undefined;
  return {
    chapterId,
    number: index + 1,
    name: chapters[index]?.name ?? chapterId,
    cleared,
    stages: stages.length,
    gold: stages.reduce((sum, s) => sum + s.rewards.gold, 0),
    jobExp: stages.reduce((sum, s) => sum + s.rewards.jobExp, 0),
    items: save.inventory.items.length,
    recruit,
    next: nextChapter ? { index: index + 1, number: index + 2, name: nextChapter.name } : undefined,
  };
}

/** Время в пути (с начала игры): «1 ч 12 мин», «8 мин». */
export function playTimeText(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60000));
  const h = Math.floor(min / 60);
  return h ? `${h} ч ${min % 60} мин` : `${min} мин`;
}
