/**
 * Порядок строк «входящих» (Задания дня, Достижения, Почта) — без Phaser, для тестов.
 * Состояние строки: ready — можно забрать (сверху, золотой акцент), active — в процессе, done — получено/прочитано
 * (внизу: свёрнуто или приглушено).
 */

export type RowState = 'ready' | 'active' | 'done';

export interface Grouped<T> {
  ready: T[];
  active: T[];
  done: T[];
}

/** Задание или достижение: выполнено и не забрано — ready; забрано — done. */
export function claimState(x: { done: boolean; claimed: boolean }): RowState {
  return x.claimed ? 'done' : x.done ? 'ready' : 'active';
}

/** Письмо: вложение не забрано — ready; не прочитано — active; остальное — done. */
export function letterState(l: { read: boolean; claimed: boolean }, claimable: boolean): RowState {
  return claimable ? 'ready' : !l.read ? 'active' : 'done';
}

/**
 * Разложить по группам, сохраняя исходный порядок внутри группы. progress — для active: ближе к цели — выше
 * (без него — как есть).
 */
export function groupRows<T>(items: readonly T[], stateOf: (x: T) => RowState, progress?: (x: T) => number): Grouped<T> {
  const g: Grouped<T> = { ready: [], active: [], done: [] };
  for (const x of items) g[stateOf(x)].push(x);
  if (progress) {
    const at = new Map(g.active.map((x, i) => [x, i]));
    g.active.sort((a, b) => progress(b) - progress(a) || (at.get(a) ?? 0) - (at.get(b) ?? 0));
  }
  return g;
}

/** Доля прогресса 0…1 (цель 0 — 1). */
export function ratio(progress: number, target: number): number {
  return target > 0 ? Math.max(0, Math.min(1, progress / target)) : 1;
}

/** Позиция порога на дорожке активности: 0…1 от начала (последний порог — у правого края, если max = его очки). */
export function trackPos(points: number, max: number): number {
  return max > 0 ? Math.max(0, Math.min(1, points / max)) : 0;
}
