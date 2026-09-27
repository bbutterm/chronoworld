import { z } from 'zod';
import { StatsSchema, UnitSchema, VisualSchema } from '../content/schema';

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id: латиница в нижнем регистре, цифры и _');

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
  jobChange: z.object({
    /** Минимальный джоб-уровень для перехода на tier 1 и tier 2. */
    tierLevel: z.object({ '1': z.number().int().positive(), '2': z.number().int().positive() }),
    /** Сбрасывать ли джоб-уровень в 1 после смены профессии. */
    resetJobLevel: z.boolean(),
    /**
     * P9 (T1-02). Опыт сверх максимума профессии (пока есть куда сменить) копится в hero.bankedExp — не больше,
     * чем нужно следующему тиру с 1-го уровня на 1 + bankLevels, и переходит в новую профессию. 0 — не копить.
     */
    bankLevels: z.number().int().nonnegative().default(5),
  }),
  /** Остаются ли навыки прошлых профессий после смены. */
  keepSkillsOnJobChange: z.boolean(),
  /** Опыт до следующего уровня: floor(base × level^power). */
  exp: z.object({
    base: z.number().positive(),
    power: z.number().positive(),
    /** Своя кривая для тира профессии ("0" — Новичок: быстро до первой профессии). */
    byTier: z.record(z.string(), z.object({ base: z.number().positive(), power: z.number().positive() })).optional(),
  }),
  heroes: z.object({
    count: z.number().int().positive(),
    startJob: id,
    names: z.array(z.string()).min(1),
    /** Новые герои по ходу кампании: после первой победы на afterStage в отряд приходит Новичок с этим именем. */
    recruits: z.array(z.object({ afterStage: id, name: z.string() })).default([]),
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
