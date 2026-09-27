import { DAILY_DAYS_KEEP, DayStringSchema, emptyDaily, type SaveState } from '../save/schema';
import { FeatureError } from './errors';

/** Проверить строку дня 'YYYY-MM-DD'; иначе FeatureError('invalid_day'). */
export function assertDay(day: string): void {
  if (!DayStringSchema.safeParse(day).success) throw new FeatureError('invalid_day', `Неверный день: ${JSON.stringify(day)} (нужно YYYY-MM-DD)`);
}

/**
 * Переключить суточные счётчики на день day. Общая точка сброса для быстрых наград и заданий.
 * - тот же день → save без изменений (тот же объект);
 * - day новее save.daily.day и его набор ещё не выдавался (нет в daily.usedDays) → счётчики обнуляются
 *   (быстрые награды, задания, полученные награды), day добавляется в usedDays;
 * - day новее, но уже был (часы ходили туда-обратно) → день меняется, счётчики остаются: второй раз тот же
 *   день не получить (P11, T4-07);
 * - day раньше сохранённого (часы переведены назад) → день меняется, счётчики остаются (новых попыток нет),
 *   а сброс произойдёт в ближайшую невыданную полночь — после возврата часов из будущего ежедневные механики
 *   не замирают на весь «забег» вперёд (T4-07).
 * Строки YYYY-MM-DD сравниваются лексикографически. Чистая функция.
 */
export function rollDay(save: SaveState, day: string): SaveState {
  assertDay(day);
  const d = save.daily;
  if (day === d.day) return save;
  const used = d.usedDays ?? [d.day];
  if (day > d.day && !used.includes(day)) {
    const usedDays = [...used, day].sort().slice(-DAILY_DAYS_KEEP);
    return { ...save, daily: { ...emptyDaily(day), usedDays } };
  }
  return { ...save, daily: { ...d, day, usedDays: used } };
}
