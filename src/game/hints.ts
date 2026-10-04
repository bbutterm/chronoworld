/**
 * R. Подсказки первой сессии: пульсирующий указатель и одна строка на следующем полезном действии.
 * Это не часть прогресса — список показанных подсказок живёт в localStorage отдельно от сохранения игры
 * (как скорость боя). Каждая подсказка показывается, пока игрок один раз не сделал действие или не коснулся плашки
 * (пропустить). Выбор подсказки — чистые функции (их проверяет tests/game-hints.test.ts), рисование — hintPointer() в ui.ts.
 *
 * Ведущее обучение главы 1 (как в AFK, первые 10–15 минут; порядок — TUTORIAL_CHAIN):
 * «В бой» на карте → «В бой» на расстановке (с Таверны — «Авто») → бой (с этапа 3 — скорость ×2) → итоги «Дальше»
 * (потом «К кампании») → сундук «Собрать» → «Герои» → «Улучшить» → Таверна ×10 → «Авто» → быстрые награды → задания дня →
 * вознесение копиями (когда три копии выпали). Башня и трофеи — позже, по событию. На экране — одна подсказка, плашка
 * не закрывает кнопки (hintPointer в ui.ts); шаги, ненужные по прогрессу сохранения, не показываются (tutorial.ts).
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
  | 'equip_gear'
  | 'branch_pick'
  /** Подсказки первого входа (firstTips.ts): реплика персонажа один раз. */
  | 'tip_tower'
  | 'tip_hunt'
  | 'tip_evening'
  | 'tip_expedition'
  | 'tip_boss_charge';

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
  'fast_rewards',
  'quests_open',
  // Вознесение — по удаче Таверны (три копии бывают не у всех): не держит шаги, которые открываются этапами.
  'ascend',
];

export const HINT_KEY = (import.meta.env?.VITE_ADVANCE_LAB === '1' ? 'chronoworld.advanceLab.hints' : 'chronoworld.hints');

/**
 * Тексты подсказок: одна строка ≤ HINT_MAX символов голосом игры — что делать и зачем, без «нажмите…, чтобы…»
 * (ui-polish-research §3 п. 3/4). Куда жать, показывает сам указатель: рамка и стрелка на цели.
 */
export const HINT_MAX = 40;
export const HINT_TEXT: Record<HintId, string> = {
  home_campaign: 'Вперёд, в первый бой!',
  stage_fight: 'Отряд готов. В бой!',
  prep_auto: 'Новые герои! «Авто» поможет с отрядом',
  battle_speed: 'Быстрее? Включите ×2',
  result_next: 'Победа! Дальше — следующий этап',
  result_home: 'Сундук копится — загляните в кампанию',
  chest_claim: 'В сундуке добыча — заберите',
  level_up: 'Опыта хватает — улучшите героя',
  tavern_summon: 'Таверна открыта — наймите героев',
  ascend: 'Три копии — пора вознести героя',
  fast_rewards: 'Быстрые награды: сегодня даром',
  quests_open: 'Задания дня — гемы за простые дела',
  /** CampaignScene дописывает « Загляните в «Приключения»» — вместе тоже ≤ 40. */
  tower_open: 'Башня открыта!',
  /** P10 (T1-08): в инвентаре лежат вещи лучше надетых. */
  equip_gear: 'Есть трофеи получше — наденьте',
  /** RN-21: в отряде фиолетовый без ветки. */
  branch_pick: 'Выберите ветку — вторая профессия',
  // Подсказки первого входа: полный текст — tipTexts.ts (TIPS), здесь — коротко, для отладки и тестов.
  tip_tower: 'Башня: выбирайте путь, берегите отряд',
  tip_hunt: 'MVP: берите героев слабой стихии',
  tip_evening: 'Вечер: ответ по душе сближает',
  tip_expedition: 'Событие: выбор решает добычу',
  tip_boss_charge: 'Ульта с молнией сбивает заряд босса',
};

/**
 * RN-15. Подсказки «открылась функция» — показываются на карте один раз (не висят главами до действия и не глушат
 * другие шаги): показ сам помечает их (markHintShown). Указатель на самой странице функции живёт до действия.
 */
export const ONE_SHOT_HINTS: ReadonlySet<HintId> = new Set<HintId>(['tower_open']);
export const HINT_SHOWN_KEY = (import.meta.env?.VITE_ADVANCE_LAB === '1' ? 'chronoworld.advanceLab.hintsShown' : 'chronoworld.hintsShown');

let shown: Set<HintId> | null = null;
function shownSet(): Set<HintId> {
  if (shown) return shown;
  try {
    const raw = globalThis.localStorage?.getItem(HINT_SHOWN_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    shown = new Set(Array.isArray(arr) ? (arr.filter((x) => typeof x === 'string') as HintId[]) : []);
  } catch {
    shown = new Set();
  }
  return shown;
}

/** Одноразовая подсказка уже показывалась на карте. */
export function hintShown(id: HintId): boolean {
  return ONE_SHOT_HINTS.has(id) && shownSet().has(id);
}

/** Запомнить реальный показ; подавленная модальным окном подсказка остаётся доступной. */
export function markHintShown(id: HintId, displayed = true): void {
  if (!displayed || !ONE_SHOT_HINTS.has(id)) return;
  const set = shownSet();
  if (set.has(id)) return;
  set.add(id);
  try {
    globalThis.localStorage?.setItem(HINT_SHOWN_KEY, JSON.stringify([...set]));
  } catch {
    // Не запомнили — покажется ещё раз, не страшно.
  }
}

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

/**
 * Шаги, потерявшие смысл по прогрессу сохранения (LT-12, MT-07): список показанных подсказок живёт в localStorage
 * устройства, и игрок середины игры на новом телефоне иначе прошёл бы обучение заново. Проверку по сохранению
 * регистрирует tutorial.ts (setHintObsolete); без неё (тесты) — ничего не устарело.
 */
let obsolete: (id: HintId) => boolean = () => false;
export function setHintObsolete(fn: (id: HintId) => boolean): void {
  obsolete = fn;
}

/** Подсказка выполнена (или пропущена) на этом устройстве либо уже не нужна по прогрессу. */
export function hintDone(id: HintId): boolean {
  if (doneSet().has(id)) return true;
  try {
    return obsolete(id);
  } catch {
    return false;
  }
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
  shown = new Set();
  nags.clear();
  try {
    globalThis.localStorage?.removeItem(HINT_KEY);
    globalThis.localStorage?.removeItem(HINT_SHOWN_KEY);
  } catch {
    // ничего
  }
}

/** Перечитать хранилище (для тестов и после внешней очистки localStorage). */
export function reloadHints(): void {
  done = null;
  shown = null;
}

/**
 * Подсказки, которые висят, пока держится состояние (опыт на уровень, трофеи лучше надетых, копии на вознесение,
 * ветка не выбрана), — указатель на вкладку «Герои» со страницы «Кампания». Без лимита он стоял на каждом заходе
 * (e2e-chapter1: equip_gear ×174). Показываем не больше NAG_LIMIT заходов на экран, потом молчим, пока состояние не
 * сменится (флаг входа pickHomeHint стал false — счёт с нуля). Счёт — в памяти сессии: после перезапуска игры
 * напомнит ещё раз.
 */
export const NAG_LIMIT = 3;
export const NAG_HINTS: ReadonlySet<HintId> = new Set<HintId>(['level_up', 'equip_gear', 'ascend', 'branch_pick']);
/** «экран:id» → сколько заходов подсказка уже была на экране. */
const nags = new Map<string, number>();

/** Повторяющаяся подсказка id исчерпала заходы на экране where (ключ сцены). */
export function hintNagged(id: HintId, where: string): boolean {
  return NAG_HINTS.has(id) && (nags.get(`${where}:${id}`) ?? 0) >= NAG_LIMIT;
}

/** Подсказка id показана в новом заходе на экран where (tutorialHint в ui.ts зовёт раз за визит). */
export function noteHintVisit(id: HintId, where: string): void {
  if (!NAG_HINTS.has(id)) return;
  const k = `${where}:${id}`;
  nags.set(k, (nags.get(k) ?? 0) + 1);
}

/** Состояние подсказки сменилось (опыта на уровень больше нет и т. п.) — снова NAG_LIMIT заходов на всех экранах. */
export function resetHintNag(id: HintId): void {
  for (const k of [...nags.keys()]) if (k.endsWith(`:${id}`)) nags.delete(k);
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
  /** RN-21: в отряде фиолетовый (и выше) без ветки. */
  branchPending?: boolean;
}

/**
 * Какую подсказку показать на странице «Кампания» (одну, самую нужную) или null (имя — историческое: раньше это была
 * главная). Порядок — цепочка обучения: новичок → «В бой»; сундук, «Улучшить» (вкладка «Герои»), Таверна (вкладка
 * «Город»), быстрые награды, задания («Город»), вознесение («Герои»); по событию — трофеи и Башня («Приключения»).
 */
export function pickHomeHint(s: HomeHintInput, doneFn: (id: HintId) => boolean = hintDone, where = 'Campaign'): HintId | null {
  // Повторяющиеся: состояние ушло — счёт заходов с нуля; исчерпали заходы — шаг пропускается (цепочка идёт дальше).
  const held: [HintId, boolean | undefined][] = [
    ['level_up', s.levelUpReady],
    ['equip_gear', s.gearUpgrade],
    ['ascend', s.ascendReady],
    ['branch_pick', s.branchPending],
  ];
  for (const [id, on] of held) if (!on) resetHintNag(id);
  const isDone = (id: HintId) => doneFn(id) || hintNagged(id, where);
  if (s.cleared === 0 && !isDone('home_campaign')) return 'home_campaign';
  if (s.chestHasIncome && !isDone('chest_claim')) return 'chest_claim';
  if (s.levelUpReady && !isDone('level_up')) return 'level_up';
  if (s.tavernReady && !isDone('tavern_summon')) return 'tavern_summon';
  if (s.fastRewardsFree && !isDone('fast_rewards')) return 'fast_rewards';
  if (s.questsUnlocked && !isDone('quests_open')) return 'quests_open';
  if (s.ascendReady && !isDone('ascend')) return 'ascend';
  if (s.branchPending && !isDone('branch_pick')) return 'branch_pick';
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
