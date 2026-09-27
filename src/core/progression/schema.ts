import { z } from 'zod';
import { StatsSchema, UnitSchema, VisualSchema } from '../content/schema';

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id: латиница в нижнем регистре, цифры и _');

/** Пол героя: m — мужской, f — женский. Выбирает лист спрайта `<спрайт>_m` / `<спрайт>_f` (если есть). */
export const GenderSchema = z.enum(['m', 'f']);
export type Gender = z.infer<typeof GenderSchema>;

/**
 * Профессия (джоб). Герой игрока = профессия + джоб-уровень (+ история профессий).
 * Статы: baseStats + growth × (jobLevel − 1). Навыки открываются на уровнях из skills.
 * Навык с trigger — пассивка, без trigger — активный (в бою применяется по перезарядке и приоритету).
 */
export const JobSchema = z.object({
  $schema: z.string().optional(),
  id,
  name: z.string(),
  description: z.string().optional(),
  /** 0 — Новичок, 1 — первая профессия, 2 — вторая. */
  tier: z.number().int().min(0).max(2),
  /** Из каких профессий можно перейти (пусто только у tier 0). */
  from: z.array(id).default([]),
  maxJobLevel: z.number().int().positive(),
  role: UnitSchema.shape.role,
  baseStats: StatsSchema,
  /** Прирост статов за каждый джоб-уровень после первого. */
  growth: z.object({
    hp: z.number().nonnegative(),
    atk: z.number().nonnegative(),
    def: z.number().nonnegative(),
    spd: z.number().nonnegative(),
  }),
  /** Обычная атака профессии. */
  basic: id,
  skills: z.array(z.object({ jobLevel: z.number().int().positive(), skill: id })).default([]),
  visual: VisualSchema,
});

/** Окно первого прохождения этапа: [с, по] — часы от начала первой сессии модели игрока. */
const FitWindowSchema = z
  .tuple([z.number().nonnegative(), z.number().nonnegative()])
  .refine(([lo, hi]) => lo <= hi, 'окно [с, по]: «с» не больше «по»');

/**
 * data/progression.json → balance: цели регулятора `npx tsx scripts/balance-fit.ts` (docs/content/balance.md,
 * docs/CONTENT_RECIPES.md, рецепт 6). Главы берутся из data/campaign по order; exclude — главы, которые регулятор не трогает
 * (глава 1 подобрана по доле побед). Этап с окном в windows — окно оттуда; этап без окна в главе, где окна есть, — окно
 * предыдущего этапа. Глава без единого окна — окна по правилу default от окна босса прошлой главы.
 */
export const BalanceTargetsSchema = z.object({
  $comment: z.string().optional(),
  /** Сколько дней гонять модель игрока (минимум; поднимается сам, если окна дальше). */
  fitDays: z.number().int().positive().default(7),
  exclude: z.array(id).default([]),
  /** Окна по id этапа. */
  windows: z.record(id, FitWindowSchema).default({}),
  default: z
    .object({
      /** Начало главы: «с» окна босса прошлой главы + gapHours. */
      gapHours: z.number().nonnegative(),
      /** От «с» первой группы этапов до «с» последней (босса). */
      spanHours: z.number().nonnegative(),
      /** Этапы идут группами по wallEvery (стена «забери сундук» между группами); у группы одно «с». */
      wallEvery: z.number().int().positive(),
      /** Ширина окна: «по» = «с» + windowHours. */
      windowHours: z.number().nonnegative(),
    })
    // Правило по главам 2–3: глава ≈ 2–2.5 дня, стена каждые 3 этапа (как DEFAULT_FIT_RULE в scripts/lib/player-model.ts).
    .default({ gapHours: 12, spanHours: 42, wallEvery: 3, windowHours: 16.5 }),
});

/** data/progression.json — правила прогрессии (числа — заглушки до баланса). */
export const ProgressionConfigSchema = z.object({
  $comment: z.string().optional(),
  /**
   * Сюжетные герои — карточки из data/heroes (source: story). start — отряд новой игры (зелёные, ур. 1),
   * recruits — после первой победы на afterStage в отряд приходит карточка template (ур. 1).
   */
  heroes: z.object({
    start: z.array(id).min(1).max(5),
    recruits: z.array(z.object({ afterStage: id, template: id })).default([]),
  }),
  campaign: z.object({
    /** Рост статов врагов за каждый этап по порядку (0.08 = +8%). */
    enemyStatGrowthPerStage: z.number().nonnegative(),
    /** Давать ли награду за повтор пройденного этапа и какую долю. */
    replayRewardMultiplier: z.number().min(0).max(1),
  }),
  offline: z.object({
    capHours: z.number().positive(),
    /**
     * P9 (T1-01). Опыт сундука и быстрых наград в начале кампании: пока последний пройденный этап — один из
     * первых `stages` этапов кампании, опыт в час не больше stageRewardsPerHour × rewards.jobExp этого этапа
     * (и не больше offlinePerMinute.jobExp × 60). Так быстрые награды ускоряют, но не перескакивают смену
     * профессии после 4-го этапа. Нет поля — ограничения нет.
     */
    earlyExp: z.object({ stages: z.number().int().nonnegative(), stageRewardsPerHour: z.number().nonnegative() }).optional(),
  }),
  newGame: z.object({ gold: z.number().int().nonnegative() }),
  /** Цели регулятора сложности scripts/balance-fit.ts (игрой не читается). Нет поля — у регулятора нет целей. */
  balance: BalanceTargetsSchema.optional(),
});

export type JobDef = z.infer<typeof JobSchema>;
export type ProgressionConfig = z.infer<typeof ProgressionConfigSchema>;
export type BalanceTargets = z.infer<typeof BalanceTargetsSchema>;
