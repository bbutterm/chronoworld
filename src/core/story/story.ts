/**
 * Сюжет глав (data/story/<chapter>.json): разбор, перекрёстные проверки и выбор сцены для показа.
 * Ядро только решает, какие сцены пора показать, и помечает их увиденными; бой и прогрессия от сюжета не зависят.
 */
import type { z } from 'zod';
import { stageStatus } from '../campaign/campaign';
import type { RawFile } from '../content/build';
import type { GameContext } from '../progression/types';
import type { SaveState } from '../save/schema';
import type { Content } from '../types';
import { StorySchema, type StoryDef, type StorySceneDef } from './schema';

/** Сцена с главой, к которой она относится. */
export interface StoryScene extends StorySceneDef {
  chapter: string;
}

export interface StoryIndex {
  /** id главы → файл сюжета. */
  chapters: Record<string, StoryDef>;
  /** Все сцены всех глав. */
  scenes: StoryScene[];
}

export interface StoryContext {
  story: StoryIndex;
}

/** Контекст сюжета без сцен (для глав без data/story). */
export const EMPTY_STORY: StoryIndex = { chapters: {}, scenes: [] };

/**
 * Разобрать файлы сюжета и проверить ссылки. Проблемы — в problems (с именем файла):
 * глава и этапы существуют, этап принадлежит главе файла, stageId есть у before/afterStage и нет у chapterStart,
 * спикеры объявлены, id сцен уникальны по всем главам, одна сцена на пару (trigger, stageId),
 * bossIntro — только у beforeStage босс-этапа.
 */
export function buildStory(files: readonly RawFile[], content: Content, problems: string[]): StoryIndex {
  const out: StoryIndex = { chapters: {}, scenes: [] };
  const sceneFile = new Map<string, string>();
  for (const f of files) {
    const r = (StorySchema as z.ZodType<StoryDef>).safeParse(f.data);
    if (!r.success) {
      for (const i of r.error.issues) problems.push(`${f.file}: ${i.path.map(String).join('.') || '(корень)'} — ${i.message}`);
      continue;
    }
    const story = r.data;
    const p = (msg: string) => problems.push(`${f.file}: ${msg}`);
    if (!content.chapters.some((c) => c.id === story.chapter)) p(`глава ${story.chapter} не найдена в data/campaign`);
    if (out.chapters[story.chapter]) p(`сюжет главы ${story.chapter} уже объявлен в другом файле`);
    out.chapters[story.chapter] = story;
    const slots = new Set<string>();
    story.scenes.forEach((s, i) => {
      const where = `сцена ${s.id}`;
      const prev = sceneFile.get(s.id);
      if (prev) p(`${where}: id уже занят (${prev})`);
      sceneFile.set(s.id, f.file);
      if (s.trigger === 'chapterStart') {
        if (s.stageId) p(`${where}: у chapterStart не бывает stageId`);
      } else if (!s.stageId) {
        p(`${where}: для ${s.trigger} нужен stageId`);
      } else {
        const stage = content.stages.find((x) => x.id === s.stageId);
        if (!stage) p(`${where}: этап ${s.stageId} не найден в data/campaign`);
        else if (stage.chapter !== story.chapter) p(`${where}: этап ${s.stageId} из главы ${stage.chapter}, а сюжет — главы ${story.chapter}`);
        if (s.bossIntro && (s.trigger !== 'beforeStage' || (stage && !stage.boss))) p(`${where}: bossIntro — только у beforeStage босс-этапа`);
      }
      if (s.trigger === 'chapterStart' && s.bossIntro) p(`${where}: bossIntro — только у beforeStage босс-этапа`);
      const slot = `${s.trigger}:${s.stageId ?? ''}`;
      if (slots.has(slot)) p(`${where}: вторая сцена ${s.trigger}${s.stageId ? ` для ${s.stageId}` : ''} (scenes[${i}])`);
      slots.add(slot);
      s.lines.forEach((l, j) => {
        if (!story.speakers[l.speaker]) p(`${where}: lines[${j}] — спикер ${l.speaker} не объявлен в speakers`);
      });
      out.scenes.push({ ...s, chapter: story.chapter });
    });
  }
  return out;
}

/** Что происходит в игре — повод показать сюжет. */
export type StoryTrigger =
  /** Игрок открыл карту главы. */
  | { type: 'chapterStart'; chapter: string }
  /** Перед боем на этапе (до старта боя). */
  | { type: 'beforeStage'; stageId: string }
  /** После победы на этапе; firstClear — этап пройден впервые (событие stageCleared.firstTime). */
  | { type: 'afterStage'; stageId: string; firstClear: boolean };

const seenSet = (save: SaveState) => new Set(save.seenScenes);

/**
 * Сцены, которые надо показать сейчас, по порядку (обычно 0–1, перед первым этапом главы — до двух).
 * Только не увиденные (save.seenScenes) и только при первом прохождении:
 * - chapterStart — пока первый этап главы открыт и не пройден;
 * - beforeStage — пока этап не пройден (на повторах нет); перед первым этапом главы сначала chapterStart;
 * - afterStage — только при firstClear.
 */
export function pendingScenes(save: SaveState, trigger: StoryTrigger, ctx: GameContext & StoryContext): StoryScene[] {
  const seen = seenSet(save);
  const find = (pred: (s: StoryScene) => boolean) => ctx.story.scenes.filter((s) => !seen.has(s.id) && pred(s)).slice(0, 1);
  const chapterStart = (chapter: string) => find((s) => s.trigger === 'chapterStart' && s.chapter === chapter);
  const stage = 'stageId' in trigger ? ctx.content.stages.find((s) => s.id === trigger.stageId) : undefined;

  switch (trigger.type) {
    case 'chapterStart': {
      const first = ctx.content.stages.find((s) => s.chapter === trigger.chapter && s.index === 0);
      if (!first || stageStatus(save, first.id, ctx) !== 'open') return [];
      return chapterStart(trigger.chapter);
    }
    case 'beforeStage': {
      if (!stage || stageStatus(save, stage.id, ctx) !== 'open') return [];
      const before = find((s) => s.trigger === 'beforeStage' && s.stageId === stage.id);
      return stage.index === 0 ? [...chapterStart(stage.chapter), ...before] : before;
    }
    case 'afterStage': {
      if (!stage || !trigger.firstClear) return [];
      return find((s) => s.trigger === 'afterStage' && s.stageId === stage.id);
    }
  }
}

/** Пометить сцены увиденными (новое сохранение; уже увиденные не дублируются). */
export function markScenesSeen(save: SaveState, ids: readonly string[]): SaveState {
  const seen = seenSet(save);
  const add = ids.filter((id) => !seen.has(id) && seen.add(id));
  return add.length ? { ...save, seenScenes: [...save.seenScenes, ...add] } : save;
}
