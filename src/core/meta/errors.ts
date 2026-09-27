/** Коды ошибок K8/K9/K10 (свой класс, чтобы не трогать FeatureError/GameRuleError). */
export type MetaErrorCode =
  | 'invalid_config'
  | 'invalid_day'
  // K8 пресеты
  | 'unknown_preset'
  | 'preset_limit'
  | 'invalid_preset_name'
  | 'invalid_squad'
  | 'duplicate_card'
  | 'unknown_hero'
  // K9 поручения
  | 'unknown_bounty'
  | 'refresh_limit'
  | 'wrong_hero_count'
  | 'duplicate_hero'
  | 'hero_busy'
  | 'role_required'
  | 'bounty_not_finished'
  // K10 достижения
  | 'unknown_achievement'
  | 'invalid_counter'
  | 'achievement_not_done'
  | 'achievement_already_claimed';

/** Нарушение правил в K8/K9/K10. message — русский текст для игрока. */
export class MetaError extends Error {
  override name = 'MetaError';
  constructor(
    public code: MetaErrorCode,
    message: string,
  ) {
    super(message);
  }
}
