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
});

export type JobDef = z.infer<typeof JobSchema>;
export type ProgressionConfig = z.infer<typeof ProgressionConfigSchema>;
