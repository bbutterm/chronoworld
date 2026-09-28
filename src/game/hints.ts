/**
 * R. Подсказки первой сессии: пульсирующий указатель и одна строка на следующем полезном действии.
 * Это не часть прогресса — список показанных подсказок живёт в localStorage отдельно от сохранения игры
 * (как скорость боя). Каждая подсказка показывается, пока игрок один раз не сделал действие или не коснулся плашки
 * (пропустить). Выбор подсказки — чистые функции (их проверяет tests/game-hints.test.ts), рисование — hintPointer() в ui.ts.
 *
 * Ведущее обучение главы 1 (как в AFK, первые 10–15 минут; порядок — TUTORIAL_CHAIN):
 * «В бой» на карте → «В бой» на расстановке (с Таверны — «Авто») → бой (с этапа 3 — скорость ×2) → итоги «Дальше»
 * (потом «К кампании») → сундук «Собрать» → «Герои» → «Улучшить» → Таверна ×10 → вознесение копиями → быстрые награды →
 * задания дня. Башня и трофеи — позже, по событию.
 */

export type HintId =
  | 'home_campaign'
  | 'stage_fight'
  | 'prep_auto'
  | 'battle_speed'
  | 'result_next'
  | 'result_home'
  | 'chest_claim'
  | 'level_up'
  | 'tavern_summon'
  | 'ascend'
  | 'fast_rewards'
  | 'quests_open'
  | 'tower_open'
  | 'equip_gear';

/** Цепочка обучения главы 1 по порядку (для документации и теста: каждая подсказка — одна, с текстом). */
export const TUTORIAL_CHAIN: readonly HintId[] = [
  'home_campaign',
  'stage_fight',
  'battle_speed',
  'result_next',
  'result_home',
  'chest_claim',
  'level_up',
  'tavern_summon',
  'prep_auto',
  'ascend',
  'fast_rewards',
  'quests_open',
];

export const HINT_KEY = 'chronoworld.hints';

/** Тексты подсказок — одна строка. */
export const HINT_TEXT: Record<HintId, string> = {
  home_campaign: 'Первый этап ждёт — жмите «В бой»',
  stage_fight: 'Отряд готов — жмите «В бой»',
  prep_auto: 'Новые герои! «Авто» поставит сильнейших',
  battle_speed: 'Скорость ×2 — бой вдвое быстрее',
  result_next: 'Победа! Следующий этап — «Дальше»',
  result_home: 'Сундук копится — загляните в кампанию',
  chest_claim: 'Заберите награду из сундука',
  level_up: 'Опыта хватает на новый уровень — «Герои» → «Улучшить»',
  tavern_summon: 'Таверна открыта — наймите героев в «Городе»',
  ascend: 'Три копии героя — вознесите его в «Героях»',
  fast_rewards: 'Быстрые награды: 2 часа сундука сразу, раз в день бесплатно',
  quests_open: 'Задания дня открыты — гемы за простые дела',
  tower_open: 'Башня испытаний открыта!',
  /** P10 (T1-08): в инвентаре лежат вещи лучше надетых. */
  equip_gear: 'Наденьте трофеи — загляните в «Герои»',
};

/** Подпись под текстом плашки: касание плашки пропускает подсказку. */
export const HINT_SKIP = 'коснитесь, чтобы скрыть';

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
  /** Хоть одного героя отряда можно «Улучшить» (хватает опыта пула и золота). */
  levelUpReady: boolean;
  towerUnlocked: boolean;
  /** P10 (T1-08): у кого-то из героев в инвентаре есть вещь лучше надетой. */
  gearUpgrade?: boolean;
  /** Таверна открыта, а первого ×10 ещё не было. */
  tavernReady?: boolean;
  /** Кого-то можно вознести копиями (хватает копий и золота). */
  ascendReady?: boolean;
  /** Быстрые награды открыты и сегодня бесплатны. */
  fastRewardsFree?: boolean;
  /** Задания дня открыты. */
  questsUnlocked?: boolean;
}

/**
 * Какую подсказку показать на странице «Кампания» (одну, самую нужную) или null (имя — историческое: раньше это была
 * главная). Порядок — цепочка обучения: новичок → «В бой»; сундук, «Улучшить» (вкладка «Герои»), Таверна (вкладка
 * «Город»), вознесение («Герои»), быстрые награды, задания («Город»); по событию — трофеи и Башня («Приключения»).
 */
export function pickHomeHint(s: HomeHintInput, isDone: (id: HintId) => boolean = hintDone): HintId | null {
  if (s.cleared === 0 && !isDone('home_campaign')) return 'home_campaign';
  if (s.chestHasIncome && !isDone('chest_claim')) return 'chest_claim';
  if (s.levelUpReady && !isDone('level_up')) return 'level_up';
  if (s.tavernReady && !isDone('tavern_summon')) return 'tavern_summon';
  if (s.ascendReady && !isDone('ascend')) return 'ascend';
  if (s.fastRewardsFree && !isDone('fast_rewards')) return 'fast_rewards';
  if (s.questsUnlocked && !isDone('quests_open')) return 'quests_open';
  if (s.gearUpgrade && !isDone('equip_gear')) return 'equip_gear';
  if (s.towerUnlocked && !isDone('tower_open')) return 'tower_open';
  return null;
}

/** Экран итогов (первая победа на этапе): «Дальше» — один раз; потом, когда копится сундук, — «К кампании». */
export function pickResultHint(s: { chestOrLevel: boolean; hasNext: boolean }, isDone: (id: HintId) => boolean = hintDone): HintId | null {
  if (s.hasNext && !isDone('result_next')) return 'result_next';
  if (s.chestOrLevel && !isDone('chest_claim') && !isDone('result_home')) return 'result_home';
  return null;
}

/**
 * Экран расстановки: новые герои вне отряда после первого ×10 в Таверне (summoned) — «Авто», иначе на первом бою — «В бой».
 * До Таверны сильнее бывает только случайная карта героя из боя: одноразовый шаг «Авто» на неё не тратим — его место в
 * цепочке сразу после призыва (TUTORIAL_CHAIN).
 */
export function pickPrepHint(s: { first: boolean; benchStronger: boolean; summoned: boolean }, isDone: (id: HintId) => boolean = hintDone): HintId | null {
  if (s.benchStronger && s.summoned && !isDone('prep_auto')) return 'prep_auto';
  if (s.first && !isDone('stage_fight')) return 'stage_fight';
  return null;
}
