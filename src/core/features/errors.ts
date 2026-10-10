/** Коды ошибок функций K1/K2/K5/K7 (отдельно от GameRuleError, чтобы не трогать progression/types.ts). */
export type FeatureErrorCode =
  | 'invalid_day'
  | 'invalid_config'
  | 'fast_rewards_limit'
  | 'not_enough_gems'
  | 'no_income'
  | 'unknown_quest'
  | 'quest_not_done'
  | 'quest_locked'
  | 'quest_already_claimed'
  | 'unknown_milestone'
  | 'not_enough_activity'
  | 'milestone_already_claimed'
  | 'stage_not_cleared';

/** Нарушение правил в K-функциях. message — русский текст для игрока. */
export class FeatureError extends Error {
  override name = 'FeatureError';
  constructor(
    public code: FeatureErrorCode,
    message: string,
  ) {
    super(message);
  }
}
