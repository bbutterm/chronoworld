/** Коды ошибок экипировки (K6). */
export type EquipmentErrorCode =
  | 'invalid_config'
  | 'unknown_hero'
  | 'unknown_item'
  | 'unknown_item_def'
  | 'job_restricted'
  | 'item_equipped_by_other'
  /** Заточка: нет конфига (data/drops.json → refine). */
  | 'refine_unavailable'
  /** Заточка ещё не открыта (data/unlocks.json → refine). */
  | 'refine_locked'
  /** Предмет уже заточен до максимума. */
  | 'refine_max'
  | 'not_enough_gold';

/** Нарушение правил экипировки. message — русский текст для игрока. */
export class EquipmentError extends Error {
  override name = 'EquipmentError';
  constructor(
    public code: EquipmentErrorCode,
    message: string,
  ) {
    super(message);
  }
}
