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
import { buildTavern } from '../tavern/tavern';
import type { TavernDef } from '../tavern/schema';

/** Сцена с главой, к которой она относится. */
export interface StoryScene extends StorySceneDef {
  chapter: string;
}

export interface StoryIndex {
  /** id главы → файл сюжета. */
  chapters: Record<string, StoryDef>;
  /** Все сцены всех глав. */
  scenes: StoryScene[];
  /** Вечера в «Двух колоколах» и близость (data/story/tavern.json, kind: "tavern"); нет файла — нет вечеров. */
  tavern?: TavernDef;
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
 * bossIntro — только у beforeStage босс-этапа. Файл с kind: "tavern" — вечера в таверне (buildTavern; storyHeroes —
 * id карточек сюжетных героев для проверки близости).
 */
export function buildStory(files: readonly RawFile[], content: Content, problems: string[], storyHeroes: readonly string[] = []): StoryIndex {
  const out: StoryIndex = { chapters: {}, scenes: [] };
  const sceneFile = new Map<string, string>();
  for (const f of files) {
    // Вечера в таверне — свой формат (src/core/tavern), в сцены глав не попадают.
    if ((f.data as { kind?: unknown } | null)?.kind === 'tavern') {
      if (out.tavern) problems.push(`${f.file}: вечера в таверне уже объявлены в другом файле`);
      const t = buildTavern(f, content, problems, storyHeroes);
      if (t) out.tavern = t;
      continue;
    }
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
  const choices = new Map<string, StoryScene>();
  for (const scene of out.scenes) {
    const choice = scene.choice;
    if (!choice) continue;
    if (choices.has(choice.id)) problems.push(`сцена ${scene.id}: выбор ${choice.id} уже занят`);
    choices.set(choice.id, scene);
    const options = choice.options.map((o) => o.id);
    if (new Set(options).size !== options.length || options.includes('default')) problems.push(`сцена ${scene.id}: неверные варианты выбора`);
    const target = content.stages.find((s) => s.campaignChoice?.id === choice.id);
    const binding = target?.campaignChoice;
    if (!binding || binding.sceneId !== scene.id || binding.afterStageId !== scene.stageId || scene.trigger !== 'afterStage' || target?.chapter !== scene.chapter) problems.push(`сцена ${scene.id}: выбор не связан с этапом своей главы`);
    else if (JSON.stringify([...options].sort()) !== JSON.stringify(binding.variants.map((v) => v.optionId).sort())) problems.push(`сцена ${scene.id}: варианты выбора не совпадают с этапом`);
    for (const option of choice.options) for (const line of option.reply) {
      if (!out.chapters[scene.chapter]?.speakers[line.speaker]) problems.push(`сцена ${scene.id}: спикер ответа ${line.speaker} не объявлен`);
      if (line.when) problems.push(`сцена ${scene.id}: ответ выбора не должен иметь условие`);
    }
  }
  for (const stage of content.stages) if (stage.campaignChoice && !choices.has(stage.campaignChoice.id)) problems.push(`этап ${stage.id}: выбор ${stage.campaignChoice.id} не найден в сюжете`);
  for (const scene of out.scenes) for (const line of scene.lines) if (line.when) {
    const source = choices.get(line.when.choice);
    if (!source || source.chapter !== scene.chapter || (line.when.is !== 'default' && !source.choice!.options.some((o) => o.id === line.when!.is))) problems.push(`сцена ${scene.id}: неизвестное условие ${line.when.choice}/${line.when.is}`);
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
 * P11 (T4-05). Поставить в очередь сохранения (save.storyQueue) сцену «после этапа» stageId, если этап пройден
 * впервые и сцена не увидена. Зовётся вместе с победой (actPlayStage), чтобы сцена пережила перезагрузку
 * до того, как её показали. Нечего ставить — тот же объект save.
 */
export function queueAfterStage(save: SaveState, stageId: string, firstClear: boolean, ctx: StoryContext): SaveState {
  if (!firstClear) return save;
  const seen = seenSet(save);
  const queue = save.storyQueue ?? [];
  const add = ctx.story.scenes.filter((s) => s.trigger === 'afterStage' && s.stageId === stageId && !seen.has(s.id) && !queue.includes(s.id)).map((s) => s.id);
  return add.length ? { ...save, storyQueue: [...queue, ...add] } : save;
}

/** Сцены из очереди save.storyQueue (не увиденные, существующие), по порядку. */
export function queuedScenes(save: SaveState, ctx: StoryContext): StoryScene[] {
  const seen = seenSet(save);
  const out: StoryScene[] = [];
  for (const id of save.storyQueue ?? []) {
    const s = ctx.story.scenes.find((x) => x.id === id);
    if (s && !seen.has(id)) out.push(s);
  }
  return out;
}

/**
 * Сцены, которые надо показать сейчас, по порядку (обычно 0–1, перед первым этапом главы — до двух).
 * Только не увиденные (save.seenScenes) и только при первом прохождении:
 * - chapterStart — пока первый этап главы открыт и не пройден;
 * - beforeStage — пока этап не пройден (на повторах нет); перед первым этапом главы сначала chapterStart;
 * - afterStage — при firstClear или если сцена этого этапа стоит в очереди save.storyQueue.
 * P11 (T4-05): перед chapterStart и beforeStage сначала идут сцены из очереди (не показанные «после этапа»,
 * например, прерванные перезагрузкой) — так они покажутся при следующем заходе на карту кампании.
 */
export function pendingScenes(save: SaveState, trigger: StoryTrigger, ctx: GameContext & StoryContext): StoryScene[] {
  const seen = seenSet(save);
  const find = (pred: (s: StoryScene) => boolean) => ctx.story.scenes.filter((s) => !seen.has(s.id) && pred(s)).slice(0, 1);
  const chapterStart = (chapter: string) => find((s) => s.trigger === 'chapterStart' && s.chapter === chapter);
  const stage = 'stageId' in trigger ? ctx.content.stages.find((s) => s.id === trigger.stageId) : undefined;
  const queued = queuedScenes(save, ctx);
  const withQueue = (list: StoryScene[]) => [...queued, ...list.filter((s) => !queued.includes(s))];

  switch (trigger.type) {
    case 'chapterStart': {
      const first = ctx.content.stages.find((s) => s.chapter === trigger.chapter && s.index === 0);
      if (!first || stageStatus(save, first.id, ctx) !== 'open') return withQueue([]);
      return withQueue(chapterStart(trigger.chapter));
    }
    case 'beforeStage': {
      if (!stage || stageStatus(save, stage.id, ctx) !== 'open') return withQueue([]);
      const before = find((s) => s.trigger === 'beforeStage' && s.stageId === stage.id);
      return withQueue(stage.index === 0 ? [...chapterStart(stage.chapter), ...before] : before);
    }
    case 'afterStage': {
      if (!stage) return [];
      const inQueue = queued.filter((s) => s.trigger === 'afterStage' && s.stageId === stage.id);
      if (inQueue.length) return inQueue;
      if (!trigger.firstClear) return [];
      return find((s) => s.trigger === 'afterStage' && s.stageId === stage.id);
    }
  }
}

/** Пометить сцены увиденными (новое сохранение; уже увиденные не дублируются) и убрать их из очереди storyQueue. */
export function markScenesSeen(save: SaveState, ids: readonly string[]): SaveState {
  const seen = seenSet(save);
  const add = ids.filter((id) => !seen.has(id) && seen.add(id));
  const queue = save.storyQueue ?? [];
  const rest = queue.filter((id) => !ids.includes(id));
  if (!add.length && rest.length === queue.length) return save;
  const next: SaveState = { ...save, seenScenes: add.length ? [...save.seenScenes, ...add] : save.seenScenes };
  if (rest.length) next.storyQueue = rest;
  else delete next.storyQueue;
  return next;
}

/** Последний этап главы (босс): после его первой победы глава пройдена. */
export function lastStageOfChapter(chapterId: string, ctx: GameContext): GameContext['content']['stages'][number] | undefined {
  const stages = ctx.content.stages.filter((s) => s.chapter === chapterId);
  return stages[stages.length - 1];
}

/**
 * Первая победа на последнем этапе главы — в сохранение метка save.pendingChapterDone (экран «Глава пройдена»
 * переживёт перезагрузку). Не первая победа или не последний этап — тот же объект save.
 */
export function queueChapterDone(save: SaveState, stageId: string, firstClear: boolean, ctx: GameContext): SaveState {
  if (!firstClear) return save;
  const stage = ctx.content.stages.find((s) => s.id === stageId);
  if (!stage || lastStageOfChapter(stage.chapter, ctx)?.id !== stageId || save.pendingChapterDone === stage.chapter) return save;
  return { ...save, pendingChapterDone: stage.chapter };
}

/** Игрок ушёл с экрана «Глава пройдена» — метку снять. Метки нет — тот же объект save. */
export function clearChapterDone(save: SaveState): SaveState {
  if (save.pendingChapterDone === undefined) return save;
  const next = { ...save };
  delete next.pendingChapterDone;
  return next;
}
