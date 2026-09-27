import { z } from 'zod';
import type { GameContext, ProgressEvent } from '../progression/types';
import { FeatureError } from './errors';
import { QuestsConfigSchema, type QuestsConfig } from './quests';

/** data/progression.json → fastRewards (K1). */
export const FastRewardsConfigSchema = z.object({
  /** Сколько часов офлайн-дохода даёт одно использование. */
  hours: z.number().positive(),
  /** Бесплатных использований в день. */
  freePerDay: z.number().int().nonnegative(),
  /** Цена в гемах платных использований по порядку; их число = лимит платных в день. */
  gemCosts: z.array(z.number().int().nonnegative()),
});

/**
 * data/progression.json → power (K2). Мощь юнита =
 * round(hp·hp + atk·atk + def·def + spd·spd + perActive·активных + perPassive·пассивных).
 */
export const PowerConfigSchema = z.object({
  hp: z.number().nonnegative(),
  atk: z.number().nonnegative(),
  def: z.number().nonnegative(),
  spd: z.number().nonnegative(),
  perActive: z.number().nonnegative(),
  perPassive: z.number().nonnegative(),
  /**
   * «Рекомендуемая мощь этапа» (recommendedPower) = мощь врагов × коэффициент: recommendedStages[id] (этапы, чей состав
   * труднее или легче своей мощи), иначе recommendedBoss (босс-этап) или recommended; не задано — 1. Округляется до
   * «красивого» числа. Коэффициенты подбирает модель игрока (npm run balance -- --fit-recommended, docs/content/balance.md):
   * с мощью ≥ рекомендуемой этап проходится с 1–2 попыток, 85–95% — «чуть-чуть не хватает».
   */
  recommended: z.number().positive().optional(),
  recommendedBoss: z.number().positive().optional(),
  recommendedStages: z.record(z.string(), z.number().positive()).optional(),
});

/**
 * Новые ключи data/progression.json (K1, K2). Читаются отдельно от ProgressionConfigSchema,
 * которая лишние ключи просто отбрасывает.
 */
export const FeaturesProgressionSchema = z.object({
  fastRewards: FastRewardsConfigSchema,
  power: PowerConfigSchema,
});

export type FastRewardsConfig = z.infer<typeof FastRewardsConfigSchema>;
export type PowerConfig = z.infer<typeof PowerConfigSchema>;

export interface FeaturesConfig {
  fastRewards: FastRewardsConfig;
  power: PowerConfig;
  quests: QuestsConfig;
}

/** GameContext + конфиги K-функций. */
export interface FeatureContext extends GameContext {
  features: FeaturesConfig;
}

/** События K-функций для UI: события прогрессии + свои. */
export type FeatureEvent =
  | ProgressEvent
  | { type: 'gems'; amount: number }
  | { type: 'fastRewardsUsed'; gemCost: number; hours: number }
  | { type: 'questClaimed'; questId: string; points: number; activity: number }
  | { type: 'activityClaimed'; milestone: number };

function describe(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.length ? i.path.map(String).join('.') : '(корень)'}: ${i.message}`)
    .join('; ');
}

/**
 * Разобрать конфиги K-функций из сырого JSON (ядро файлы не читает):
 * progressionJson — содержимое data/progression.json, questsJson — data/quests.json.
 * Ошибка → FeatureError('invalid_config') с путём до поля.
 */
export function parseFeaturesConfig(progressionJson: unknown, questsJson: unknown): FeaturesConfig {
  const p = FeaturesProgressionSchema.safeParse(progressionJson);
  if (!p.success) throw new FeatureError('invalid_config', `data/progression.json: ${describe(p.error)}`);
  const q = QuestsConfigSchema.safeParse(questsJson);
  if (!q.success) throw new FeatureError('invalid_config', `data/quests.json: ${describe(q.error)}`);
  return { ...p.data, quests: q.data };
}

/** GameContext → FeatureContext (UI: `withFeatures(gameCtx, progressionJson, questsJson)`). */
export function withFeatures(ctx: GameContext, progressionJson: unknown, questsJson: unknown): FeatureContext {
  return { ...ctx, features: parseFeaturesConfig(progressionJson, questsJson) };
}
