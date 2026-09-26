/**
 * R. Подсказки первой сессии: пульсирующий указатель и одна строка на следующем полезном действии.
 * Это не часть прогресса — список показанных подсказок живёт в localStorage отдельно от сохранения игры
 * (как скорость боя). Каждая подсказка показывается, пока игрок один раз не сделал действие.
 * Выбор подсказки — чистые функции (их проверяет tests/game-hints.test.ts), рисование — hintPointer() в ui.ts.
 */

export type HintId = 'home_campaign' | 'stage_fight' | 'chest_claim' | 'job_change' | 'tower_open';

export const HINT_KEY = 'chronoworld.hints';

/** Тексты подсказок — одна строка. */
export const HINT_TEXT: Record<HintId, string> = {
  home_campaign: 'Начните с кампании: первый этап ждёт',
  stage_fight: 'Отряд готов — жмите «В бой»',
  chest_claim: 'Заберите награду из сундука',
  job_change: 'Смена профессии доступна — загляните в «Герои»',
  tower_open: 'Башня испытаний открыта!',
};

function load(): Set<HintId> {
  try {
    const raw = globalThis.localStorage?.getItem(HINT_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? (arr.filter((x) => typeof x === 'string') as HintId[]) : []);
  } catch {
    // Хранилище недоступно или испорчено — показываем подсказки заново, это не страшно.
    return new Set();
  }
}

function store(done: Set<HintId>): void {
  try {
    globalThis.localStorage?.setItem(HINT_KEY, JSON.stringify([...done]));
  } catch {
    // Не запомнили — подсказка покажется ещё раз.
  }
}

/** Выполненные подсказки (кеш в памяти; хранилище — только для переживания перезагрузки). */
let done: Set<HintId> | null = null;
const doneSet = () => (done ??= load());

export function hintDone(id: HintId): boolean {
  return doneSet().has(id);
}

/** Игрок сделал действие — подсказка больше не показывается. */
export function markHint(id: HintId): void {
  const d = doneSet();
  if (d.has(id)) return;
  d.add(id);
  store(d);
}

/** «Сбросить подсказки» (и новая игра): все подсказки покажутся снова. */
export function resetHints(): void {
  done = new Set();
  try {
    globalThis.localStorage?.removeItem(HINT_KEY);
  } catch {
    // ничего
  }
}

/** Перечитать хранилище (для тестов и после внешней очистки localStorage). */
export function reloadHints(): void {
  done = null;
}

export interface HomeHintInput {
  /** Пройдено этапов кампании. */
  cleared: number;
  /** В сундуке есть что забрать. */
  chestHasIncome: boolean;
  /** Хоть один герой может сменить профессию. */
  jobChangeReady: boolean;
  towerUnlocked: boolean;
}

/**
 * Какую подсказку показать на главной (одну, самую нужную) или null.
 * Порядок: новичок → кампания; затем сундук, смена профессии, башня.
 */
export function pickHomeHint(s: HomeHintInput, isDone: (id: HintId) => boolean = hintDone): HintId | null {
  if (s.cleared === 0 && !isDone('home_campaign')) return 'home_campaign';
  if (s.chestHasIncome && !isDone('chest_claim')) return 'chest_claim';
  if (s.jobChangeReady && !isDone('job_change')) return 'job_change';
  if (s.towerUnlocked && !isDone('tower_open')) return 'tower_open';
  return null;
}
