/**
 * «Уже видел» для красных точек (docs/design/ui-polish-research.md §2.4): игрок открыл место, где горит повод, — точка
 * на вкладке за этот повод гаснет, пока не появится новый (другой уровень героя, другая редкость…). Состояние
 * интерфейса, не правило игры: живёт в localStorage браузера (как прочитанная Летопись), в сохранение не попадает.
 * «Начать заново» стирает ключ вместе с остальными ключами игры (session.ts startOver).
 *
 * Ключи — короткие строки поводов: `lvl:<id экземпляра>:<уровень>`, `asc:<id>:<редкость>` (flow.ts heroAlertKeys).
 */

export const BADGE_SEEN_KEY = (import.meta.env?.VITE_ADVANCE_LAB === '1' ? 'chronoworld.advanceLab.badges.seen' : 'chronoworld.badges.seen');
/** Сколько ключей хранить (старые вытесняются — лишь бы список не рос бесконечно). */
export const BADGE_SEEN_MAX = 300;

let cache: string[] | null = null;

function load(): string[] {
  if (cache) return cache;
  let list: unknown = [];
  try {
    list = JSON.parse(globalThis.localStorage?.getItem(BADGE_SEEN_KEY) ?? '[]');
  } catch {
    list = [];
  }
  cache = Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  return cache;
}

/** Видел ли игрок этот повод. */
export function badgeSeen(key: string): boolean {
  return load().includes(key);
}

/** Отметить поводы показанными (повторы не дублируются; хранилище недоступно — помним до перезагрузки). */
export function markBadgesSeen(keys: readonly string[]): void {
  const list = load();
  const fresh = keys.filter((k) => !list.includes(k));
  if (!fresh.length) return;
  cache = [...list, ...fresh].slice(-BADGE_SEEN_MAX);
  try {
    globalThis.localStorage?.setItem(BADGE_SEEN_KEY, JSON.stringify(cache));
  } catch {
    // Хранилище недоступно или переполнено — список живёт в памяти.
  }
}

/** Для тестов: забыть всё (и в памяти, и в хранилище). */
export function resetBadgesSeen(): void {
  cache = [];
  try {
    globalThis.localStorage?.removeItem(BADGE_SEEN_KEY);
  } catch {
    // нечего чистить
  }
}
