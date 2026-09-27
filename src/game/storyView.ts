/**
 * Сюжет в UI без Phaser (тесты — tests/story.test.ts): кто говорит и чей портрет показать.
 */
import type { GameContext, HeroState, SaveState, SpeakerDef, StageInfo, StoryContext, StoryDef, StoryScene } from '../core';
import { heroSprite } from './flow';

export interface SpeakerView {
  name: string;
  /** id спрайта для портрета; null — картинки нет (UI ставит иконку скина). */
  sprite: string | null;
}

/** hero1..heroN → герой сохранения по порядку. */
export function speakerHero(key: string, save: SaveState) {
  const m = /^hero(\d+)$/.exec(key);
  return m ? save.heroes[Number(m[1]) - 1] : undefined;
}

/**
 * Спрайт портрета спикера: 'hero' — текущая профессия героя (нет героя — стартовая профессия);
 * 'unit:<id>' — спрайт юнита (юнита нет — null); иначе id профессии, а если такой нет — id спрайта как есть.
 */
export function portraitSprite(portrait: string, ctx: GameContext, hero?: SaveState['heroes'][number]): string | null {
  if (portrait === 'hero') return hero ? heroSprite(hero, ctx) : (ctx.content.jobs[ctx.progression.heroes.startJob]?.visual.sprite ?? null);
  if (portrait.startsWith('unit:')) return ctx.content.units[portrait.slice(5)]?.visual.sprite ?? null;
  return ctx.content.jobs[portrait]?.visual.sprite ?? portrait;
}

/** Имя и портрет спикера реплики. Имя героев hero1..heroN — из сохранения (игрок мог их переименовать). */
export function speakerView(story: StoryDef | undefined, key: string, save: SaveState, ctx: GameContext): SpeakerView {
  const sp: SpeakerDef | undefined = story?.speakers[key];
  const hero = speakerHero(key, save);
  return {
    name: hero?.name ?? sp?.name ?? key,
    sprite: sp ? portraitSprite(sp.portrait, ctx, hero) : hero ? heroSprite(hero, ctx) : null,
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
  /** Герой, присоединившийся после босса главы (progression.heroes.recruits), если он уже в отряде. */
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
  // Рекрут — последний герой с этим именем (имя из progression).
  const recruit = rc ? [...save.heroes].reverse().find((h) => h.name === rc.name) : undefined;
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
