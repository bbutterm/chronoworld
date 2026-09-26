/** Коды ошибок экипировки (K6). */
export type EquipmentErrorCode =
  | 'invalid_config'
  | 'unknown_hero'
  | 'unknown_item'
  | 'unknown_item_def'
  | 'job_restricted'
  | 'item_equipped_by_other';

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
