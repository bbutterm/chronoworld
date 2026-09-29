import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id: латиница в нижнем регистре, цифры и _');

/** Максимальная длина реплики — влезает в плашку диалога на 360×640 в 3 строки. */
export const STORY_LINE_MAX = 120;

/**
 * Кто говорит. portrait: 'hero' — портрет текущей профессии героя (для hero1..heroN), id профессии
 * (портрет её спрайта), id спрайта или 'unit:<unitId>' (спрайт юнита из data/units). Нет картинки — UI ставит иконку.
 */
export const SpeakerSchema = z.object({
  name: z.string().min(1),
  portrait: z.string().min(1),
  /**
   * Крупная иллюстрация NPC (как в RO — Кафра и др.): файл assets/ui/illust/<illust>.png (≈ 320×480, фон прозрачный).
   * Когда спикер говорит, диалог показывает её в полный рост слева над плашкой вместо портрета в рамке.
   */
  illust: id.optional(),
});

export const StoryLineSchema = z.object({
  /** Ключ из speakers. hero1..heroN — герои сохранения по порядку (имя берётся из сохранения). */
  speaker: z.string().min(1),
  text: z.string().min(1).max(STORY_LINE_MAX, `реплика длиннее ${STORY_LINE_MAX} символов`),
});

/** Когда показать сцену: начало главы, перед первым боем этапа, после первой победы на этапе. */
export const STORY_TRIGGERS = ['chapterStart', 'beforeStage', 'afterStage'] as const;

export const StorySceneSchema = z.object({
  /** Уникален по всем главам — по нему сцена помечается увиденной в сохранении. */
  id,
  trigger: z.enum(STORY_TRIGGERS),
  /** Обязателен для beforeStage / afterStage, запрещён для chapterStart. */
  stageId: id.optional(),
  /** Баннер босса после диалога — только у beforeStage босс-этапа. */
  bossIntro: z.object({ title: z.string().min(1), subtitle: z.string().optional() }).optional(),
  lines: z.array(StoryLineSchema).min(1).max(6),
});

/** data/story/<chapter>.json — сюжетные сцены главы. */
export const StorySchema = z.object({
  $schema: z.string().optional(),
  $comment: z.string().optional(),
  /** id главы из data/campaign. */
  chapter: id,
  speakers: z.record(z.string(), SpeakerSchema),
  scenes: z.array(StorySceneSchema),
});

export type SpeakerDef = z.infer<typeof SpeakerSchema>;
export type StoryLine = z.infer<typeof StoryLineSchema>;
export type StoryTriggerType = (typeof STORY_TRIGGERS)[number];
export type StorySceneDef = z.infer<typeof StorySceneSchema>;
export type StoryDef = z.infer<typeof StorySchema>;
