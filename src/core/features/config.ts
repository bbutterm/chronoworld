import { z } from 'zod';
import type { GameContext, ProgressEvent } from '../progression/types';
import { FeatureError } from './errors';
import { QuestsConfigSchema, type QuestsConfig } from './quests';
import { CardRaritySchema } from '../heroes/schema';

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
  /**
   * Уровни врагов и «Рекомендуем: герои ур. N (синие)» (features/levels.ts, docs/content/balance.md, раздел 4а). Только
   * отображение — на бой не влияет. Нет — уровни не показываются (функции считают по зелёным героям, отряд 5, масштаб 1).
   */
  levels: z
    .object({
      /**
       * Враг уровня L — юнит, у которого hp·atk = enemyScale × hp·atk медианного героя уровня L (той же редкости, что в полосе
       * этапа). > 1: враги в среднем крепче одного героя (у героев — навыки, лечение, синергия отряда). Подбор — модель игрока
       * (npm run balance -- --levels): средний уровень врагов этапа ≈ средний уровень отряда модели при первой победе.
       */
      enemyScale: z.number().positive(),
      /**
       * Босс (kind boss) рассчитан на весь отряд: его hp·atk делится ещё на bossScale. Нет — 1. Подбор — тот же замер
       * (уровень босса ≈ уровню, с которым эталонный отряд проходит его этап).
       */
      bossScale: z.number().positive().optional(),
      /**
       * QA LT-03: враг «ур. 5» делал этап непроходимым — hp·atk не видит лечения и щитов. Множитель hp·atk по роли юнита
       * (healer — лечит отряд) и supportScale — у юнитов с навыками лечения/щита/усиления союзников (Изида, Песчаник).
       */
      roleScale: z.record(z.string(), z.number().positive()).optional(),
      supportScale: z.number().positive().optional(),
      /**
       * Нижняя граница уровня врага этапа кампании: доля рекомендуемого уровня героев этапа (0.75 — не ниже ¾). Босс — не ниже
       * рекомендуемого уровня (без поправки на экипировку), свита — не выше босса. Нет — без границы.
       */
      stageFloor: z.number().min(0).max(1).optional(),
      /**
       * Типичный отряд с этапа fromStage (до следующей полосы): редкость героев и их число — медиана модели игрока при первой
       * победе. По ним считается рекомендуемый уровень (squad героев редкости rarity с мощью ≥ рекомендуемой) и уровни врагов.
       * Порядок — по этапам кампании; первая полоса — с первого этапа.
       */
      bands: z
        .array(
          z.object({
            fromStage: z.string(),
            rarity: CardRaritySchema,
            squad: z.number().int().min(1).max(5),
            /**
             * Доля мощи отряда от экипировки (модель игрока при первой победе: 5–15%). Рекомендуемый уровень считается по
             * мощи × (1 − gear): «герои ур. N» — без вещей, как у медианного героя. Нет — 0.
             */
            gear: z.number().min(0).max(0.9).optional(),
            /** enemyScale для врагов этапов этой полосы (поздние главы: враги крепче героев той же hp·atk). Нет — общий. */
            enemyScale: z.number().positive().optional(),
          }),
        )
        .min(1),
    })
    .optional(),
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
