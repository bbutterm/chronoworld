import { loadOrNew, newGame, persist, type SaveState } from '../core';
import { GAME } from './content';
import { localDay } from './flow';
import { LocalStorageAdapter } from './storage';

/**
 * Текущая игра: одно сохранение на всё приложение. Экраны читают `session.save`
 * и после каждого изменения зовут `commit(next)` — оно сразу пишется в localStorage.
 */
const storage = new LocalStorageAdapter();
/** Предупреждения для игрока, которые покажет ближайший экран (тостом). */
const warnings: string[] = [];

export const now = () => Date.now();
/** День игрока по локальному времени — его получают все ежедневные механики (act*-обёртки, задания). */
export const today = () => localDay(new Date());

function boot(): SaveState {
  const r = loadOrNew(storage, GAME, now(), today());
  if (r.source === 'reset') warnings.push(`Сохранение не удалось прочитать, начата новая игра. ${r.error?.message ?? ''}`.trim());
  if (!storage.available) warnings.push('Хранилище браузера недоступно — прогресс сохранится только до перезагрузки страницы.');
  // Новая игра записывается сразу, чтобы время сундука шло с первого запуска. Битое сохранение
  // не затираем до первого действия игрока (вдруг это сейв более новой версии игры).
  if (r.source === 'new') persist(storage, r.save);
  return r.save;
}

export const session = {
  save: boot(),
};

/** Сохранить новое состояние игры. */
export function commit(save: SaveState): void {
  const wasAvailable = storage.available;
  session.save = save;
  persist(storage, save);
  if (wasAvailable && !storage.available) warnings.push('Не удалось записать сохранение (хранилище переполнено или заблокировано). Прогресс живёт до перезагрузки.');
}

/** Начать заново: новая игра сразу записывается поверх старой. */
export function resetProgress(): void {
  commit(newGame(GAME, now(), today()));
}

/** Забрать накопившиеся предупреждения (каждое показывается один раз). */
export function takeWarnings(): string[] {
  return warnings.splice(0);
}
