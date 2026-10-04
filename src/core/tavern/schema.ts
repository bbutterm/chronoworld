import { z } from 'zod';
import { SpeakerSchema, STORY_LINE_MAX } from '../story/schema';

/**
 * Вечера в «Двух колоколах» и близость с сюжетными героями (docs/design/tavern-evenings.md).
 * Файл data/story/tavern.json — поле kind: "tavern" отличает его от сюжета глав.
 */

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id: латиница в нижнем регистре, цифры и _');

/** Реплик в вечере (без ответов на выбор) — от и до. */
export const EVENING_LINES_MIN = 8;
export const EVENING_LINES_MAX = 16;
/** Подпись варианта выбора — влезает в кнопку на 360 px в две строки. */
export const CHOICE_TEXT_MAX = 60;

/** Реплика только если в выборе choice выбран вариант is ('none' — выбор не сделан). */
export const WhenSchema = z.object({ choice: id, is: z.string().min(1) });

export const TavernLineSchema = z.object({
  speaker: z.string().min(1),
  text: z.string().min(1).max(STORY_LINE_MAX, `реплика длиннее ${STORY_LINE_MAX} символов`),
  when: WhenSchema.optional(),
});

export const ChoiceOptionSchema = z.object({
  id,
  text: z.string().min(1).max(CHOICE_TEXT_MAX, `вариант длиннее ${CHOICE_TEXT_MAX} символов`),
  /** Близость: id карточки сюжетного героя → +1 / +2. */
  bond: z.record(z.string(), z.number().int().min(1).max(2)).default({}),
  /** Что ответят на этот выбор (1–4 реплики). */
  reply: z.array(TavernLineSchema).min(1).max(4),
});

export const ChoiceSchema = z.object({
  /** Уникален по всему файлу — лежит в сохранении (save.tavern.choices). */
  id,
  /** Вопрос над кнопками (коротко, кто спрашивает — видно по последней реплике). */
  prompt: z.string().min(1).max(STORY_LINE_MAX),
  options: z.array(ChoiceOptionSchema).min(2).max(3),
});

export const TavernStepSchema = z.union([TavernLineSchema, z.object({ choice: ChoiceSchema })]);

export const EveningSchema = z.object({
  /** tav_<глава>… — лежит в сохранении, после выпуска не переименовывать. */
  id,
  /** id главы: вечер открывается первой победой над её боссом. */
  after: id,
  title: z.string().min(1).max(40),
  subtitle: z.string().min(1).max(60).optional(),
  steps: z.array(TavernStepSchema).min(1),
});

export const PersonalSceneSchema = z.object({
  id,
  title: z.string().min(1).max(40),
  steps: z.array(TavernStepSchema).min(1).max(12),
});

/** Условие личного задания: alive — герой задания жив к концу боя, noLoss — никто из отряда не пал, fast — быстрее seconds. */
export const QuestConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('alive') }),
  z.object({ type: z.literal('noLoss') }),
  z.object({ type: z.literal('fast'), seconds: z.number().positive() }),
]);

export const BondQuestSchema = z.object({
  id,
  title: z.string().min(1).max(40),
  /** Описание задания (что за бой и зачем) — до 240 символов. */
  text: z.string().min(1).max(240),
  /** Враги — этого этапа кампании (этап должен быть пройден). */
  stage: id,
  /** Множитель силы врагов (hp/atk/def). */
  mult: z.number().positive().max(5).default(1),
  condition: QuestConditionSchema,
  /** Подпись условия для экрана: «Победить, не потеряв Вику». */
  goal: z.string().min(1).max(60),
  reward: z.object({
    gold: z.number().int().nonnegative().optional(),
    gems: z.number().int().nonnegative().optional(),
    scrolls: z.number().int().nonnegative().optional(),
  }),
  /** Реплика героя после успеха. */
  after: TavernLineSchema.optional(),
});

export const BondLinkSchema = z.object({
  id,
  name: z.string().min(1).max(40),
  /** Второй герой связки (id карточки). */
  partner: z.string().min(1),
  stat: z.enum(['atk', 'hp', 'def']),
  /** Прибавка в процентах обоим героям связки. */
  pct: z.number().int().min(1).max(20),
  /** Короткое пояснение для карточки героя. */
  text: z.string().min(1).max(120),
});

export const BondHeroSchema = z.object({
  scene: PersonalSceneSchema,
  quest: BondQuestSchema,
  link: BondLinkSchema,
});

export const TavernSchema = z.object({
  $schema: z.string().optional(),
  $comment: z.string().optional(),
  kind: z.literal('tavern'),
  speakers: z.record(z.string(), SpeakerSchema),
  bond: z.object({
    /** Потолок близости. */
    max: z.number().int().positive(),
    /** Близость за вечер герою, который был в отряде. */
    squadGain: z.number().int().nonnegative(),
    /** Порог личной сцены и личного задания. */
    sceneAt: z.number().int().positive(),
    questAt: z.number().int().positive(),
    /** Доверие за рост героя; максимум среди копий, без повторного начисления при сбросе. */
    journey: z.object({
      levels: z.array(z.number().int().min(1).max(100)),
      profession: z.number().int().nonnegative(),
      rarity: z.enum(['green', 'blue', 'purple', 'gold', 'red']),
      rarityPoints: z.number().int().nonnegative(),
      max: z.number().int().nonnegative(),
    }).optional(),
  }),
  evenings: z.array(EveningSchema),
  /** id карточки сюжетного героя → личная сцена, задание, связка. */
  heroes: z.record(z.string(), BondHeroSchema),
});

export type WhenDef = z.infer<typeof WhenSchema>;
export type TavernLine = z.infer<typeof TavernLineSchema>;
export type ChoiceDef = z.infer<typeof ChoiceSchema>;
export type ChoiceOptionDef = z.infer<typeof ChoiceOptionSchema>;
export type TavernStep = z.infer<typeof TavernStepSchema>;
export type EveningDef = z.infer<typeof EveningSchema>;
export type PersonalSceneDef = z.infer<typeof PersonalSceneSchema>;
export type BondQuestDef = z.infer<typeof BondQuestSchema>;
export type BondLinkDef = z.infer<typeof BondLinkSchema>;
export type BondHeroDef = z.infer<typeof BondHeroSchema>;
export type TavernDef = z.infer<typeof TavernSchema>;
