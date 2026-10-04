import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id: латиница в нижнем регистре, цифры и _');

/**
 * Функции, которые открываются по ходу кампании (как в AFK Arena). Код экранов знает каждую по id, поэтому новый id —
 * это правка кода (UI) + строка в data/unlocks.json. id лежат в сохранениях (save.seenUnlocks) — не переименовывать.
 */
export const FEATURE_IDS = ['fast_rewards', 'quests', 'speed_x2', 'achievements', 'tavern', 'bounties', 'tower', 'hunt', 'shop', 'refine', 'autobattler'] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];

/** Иконки баннера: имена из src/game/skin.ts (ICONS) и mug — кружка Таверны (tavernEntry.ts). */
export const UNLOCK_ICONS = [
  'map', 'helmet', 'home', 'gear', 'gift', 'bag', 'lock', 'chest', 'scroll', 'tower', 'trophy', 'swords', 'check', 'back', 'next', 'hourglass', 'flag', 'star', 'mug',
] as const;
export type UnlockIcon = (typeof UNLOCK_ICONS)[number];

/** Длина описания — влезает в баннер «Новая функция!» в 3 строки. */
export const UNLOCK_TEXT_MAX = 140;
/** Реплика Гаррета — как строка сюжета (src/core/story/schema.ts, STORY_LINE_MAX). */
export const UNLOCK_LINE_MAX = 120;

export const UnlockDefSchema = z.object({
  id: z.enum(FEATURE_IDS),
  /** Этап кампании: функция открывается после его первого прохождения. */
  stage: id,
  /** Название на баннере и в подписи замка («Башня испытаний»). */
  title: z.string().min(1).max(40),
  /** Что это и зачем — одна-две фразы. */
  description: z.string().min(1).max(UNLOCK_TEXT_MAX),
  icon: z.enum(UNLOCK_ICONS),
  /** Необязательная реплика капитана Гаррета на баннере (контент-день: можно дописать позже). */
  line: z.string().min(1).max(UNLOCK_LINE_MAX).optional(),
});

/** data/unlocks.json — единая таблица «функция → этап открытия». Нет строки у функции — она открыта сразу. */
export const UnlocksConfigSchema = z
  .object({
    $schema: z.string().optional(),
    $comment: z.string().optional(),
    features: z.array(UnlockDefSchema),
  })
  .superRefine((cfg, c) => {
    const seen = new Set<string>();
    cfg.features.forEach((f, i) => {
      if (seen.has(f.id)) c.addIssue({ code: 'custom', path: ['features', i, 'id'], message: `функция ${f.id} указана дважды` });
      seen.add(f.id);
    });
  });

export type UnlockDef = z.infer<typeof UnlockDefSchema>;
export type UnlocksConfig = z.infer<typeof UnlocksConfigSchema>;
