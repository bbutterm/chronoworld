import { DayStringSchema, emptyDaily, type SaveState } from '../save/schema';
import { FeatureError } from './errors';

/** Проверить строку дня 'YYYY-MM-DD'; иначе FeatureError('invalid_day'). */
export function assertDay(day: string): void {
  if (!DayStringSchema.safeParse(day).success) throw new FeatureError('invalid_day', `Неверный день: ${JSON.stringify(day)} (нужно YYYY-MM-DD)`);
}

/**
 * Переключить суточные счётчики на день day. Общая точка сброса для быстрых наград и заданий.
 * - day новее save.daily.day → счётчики обнуляются (быстрые награды, задания, полученные награды);
 * - тот же день → save без изменений (тот же объект);
 * - day раньше сохранённого (часы переведены назад) → без изменений: сброс только вперёд,
 *   чтобы переводом часов туда-обратно нельзя было получить лишние попытки.
 * Строки YYYY-MM-DD сравниваются лексикографически. Чистая функция.
 */
export function rollDay(save: SaveState, day: string): SaveState {
  assertDay(day);
  if (day <= save.daily.day) return save;
  return { ...save, daily: emptyDaily(day) };
}
