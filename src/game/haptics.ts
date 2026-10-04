/**
 * Вибрация (тактильный отклик): Telegram.WebApp.HapticFeedback внутри Telegram (Bot API 6.1+), вне Telegram на Android —
 * navigator.vibrate короткими импульсами, на iOS вне Telegram и на компьютере — ничего.
 *
 * - Вызов: `haptic('victory')` из любого места; безопасно всегда (нет Telegram, выключено, слишком часто — ничего).
 * - Какой момент как вибрирует — таблица HAPTICS ниже (как SFX в audioCatalog.ts): правится в одном месте.
 * - Ограничения: общий зазор между импульсами (GLOBAL_GAP_MS) и свой зазор у каждого момента (gap) — в бою
 *   один импульс на класс событий за окно, а не на каждый удар.
 * - Настройка «Вибрация» (вкл по умолчанию) — свой ключ localStorage, как звук и FPS.
 * - Игра на паузе (вкладка скрыта, Telegram свёрнут — lifecycle.ts) — тишина.
 *
 * Без Phaser: ядро (HapticEngine) проверяется в тестах (tests/haptics.test.ts).
 */
import { lifecycle } from './lifecycle';

export type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
export type NotifyType = 'success' | 'warning' | 'error';

/** Один импульс: удар заданной силы, уведомление или «щелчок выбора». */
export type HapticStep = { impact: ImpactStyle } | { notify: NotifyType } | { select: true };

export interface HapticDef {
  /** Импульсы по порядку (второй — через STEP_MS после первого: «успех + тяжёлый удар» у босса). */
  steps: HapticStep[];
  /** Этот момент — не чаще одного раза за столько мс. */
  gap: number;
  /** Пропустить, если любой импульс был меньше столько мс назад (тост-ошибка сразу после поломки при заточке). */
  quiet?: number;
  desc: string;
}

const imp = (style: ImpactStyle, desc: string, gap = 120): HapticDef => ({ steps: [{ impact: style }], gap, desc });
const note = (type: NotifyType, desc: string, gap = 400): HapticDef => ({ steps: [{ notify: type }], gap, desc });
const sel = (desc: string, gap = 60): HapticDef => ({ steps: [{ select: true }], gap, desc });

/** Все моменты с вибрацией. */
export const HAPTICS = {
  // ---------- интерфейс ----------
  tap: sel('нажатие кнопки (не касание поля)'),
  tab: sel('переключение вкладки'),
  error: { ...note('warning', 'действие недоступно: не хватает золота, ошибка (тост-ошибка)', 300), quiet: 600 },
  soft: imp('soft', 'открыта находка / история героя / сюжетная страница', 300),
  // ---------- награды и прогресс ----------
  reward: imp('light', 'забрать награду, открыть сундук', 250),
  levelUp: note('success', 'повышение уровня, вознесение, смена профессии', 250),
  unlock: note('success', 'открылась новая функция или глава', 600),
  refineOk: note('success', 'заточка удалась', 250),
  refineFail: { steps: [{ notify: 'error' }, { impact: 'heavy' }], gap: 300, desc: 'заточка: вещь сломалась' },
  // ---------- таверна ----------
  cardFlip: imp('light', 'таверна: переворот карты', 70),
  cardRare: imp('heavy', 'таверна: фиолетовая / золотая / красная карта', 250),
  // ---------- Башня ----------
  blessPick: imp('light', 'Башня: выбрана карта-благословение', 250),
  // ---------- бой ----------
  ultReady: imp('light', 'ульта героя готова (ручной режим; раз на готовность героя)', 600),
  ultCast: imp('heavy', 'касание портрета: ульта запущена', 300),
  ultHit: imp('medium', 'удар ульты своего героя (один на ульту)', 450),
  chargeBreak: note('success', '«Сбито!» — заряд босса сорван', 800),
  heroHurt: imp('heavy', 'по герою прошёл сильный удар (≥ 30 % здоровья) — редко', 2500),
  heroDown: imp('heavy', 'герой пал', 1200),
  bossDown: { steps: [{ notify: 'success' }, { impact: 'heavy' }], gap: 1500, desc: 'босс / MVP побеждён' },
  // ---------- моменты (juice.ts → moment(); §3 п. 10: дорого в моменты, тихо в рутине) ----------
  moment: { steps: [{ notify: 'success' }, { impact: 'heavy' }], gap: 1500, desc: 'момент: вознесение, новая глава, первая победа на этапе' },
  // ---------- итоги ----------
  victory: { steps: [{ notify: 'success' }, { impact: 'heavy' }], gap: 800, desc: 'победа (момент juice.ts: «успех» + тяжёлый удар под «ПОБЕДА»)' },
  defeat: note('error', 'поражение', 800),
} as const satisfies Record<string, HapticDef>;

export type HapticId = keyof typeof HAPTICS;

/** Любые два импульса — не чаще, мс (кроме шагов одного момента). */
export const GLOBAL_GAP_MS = 70;
/** Пауза между шагами одного момента, мс. */
export const STEP_MS = 120;

/** Длительность импульса navigator.vibrate (Android вне Telegram), мс; массив — «вибрация, пауза, вибрация». */
export const VIBRATE_MS: Record<ImpactStyle | NotifyType | 'select', number | number[]> = {
  select: 8,
  soft: 10,
  light: 12,
  rigid: 16,
  medium: 22,
  heavy: 38,
  success: [16, 60, 26],
  warning: [26, 50, 26],
  error: [36, 40, 36, 40, 36],
};

// ---------- выход: Telegram или navigator.vibrate ----------

/** Часть Telegram.WebApp.HapticFeedback. */
export interface TgHaptic {
  impactOccurred(style: ImpactStyle): unknown;
  notificationOccurred(type: NotifyType): unknown;
  selectionChanged(): unknown;
}

export interface HapticOut {
  tg: TgHaptic | null;
  /** navigator.vibrate (только Android вне Telegram), иначе null. */
  vibrate: ((pattern: number | number[]) => unknown) | null;
}

interface TgWebAppLike {
  HapticFeedback?: TgHaptic;
  isVersionAtLeast?: (v: string) => boolean;
  platform?: string;
}

/** Найти выход вибрации в этом окружении. Нет ничего — оба null (вызовы молча ничего не делают). */
export function detectHapticOut(g: unknown = globalThis): HapticOut {
  const w = g as { Telegram?: { WebApp?: TgWebAppLike }; navigator?: Navigator };
  let tg: TgHaptic | null = null;
  try {
    const app = w.Telegram?.WebApp;
    // До 6.1 HapticFeedback нет: вызов пишет предупреждение в консоль. platform 'unknown' — страница открыта не в Telegram.
    if (app?.HapticFeedback && app.platform !== 'unknown' && app.isVersionAtLeast?.('6.1')) tg = app.HapticFeedback;
  } catch {
    tg = null;
  }
  let vibrate: HapticOut['vibrate'] = null;
  try {
    const nav = w.navigator;
    if (!tg && nav && typeof nav.vibrate === 'function' && /Android/i.test(nav.userAgent ?? '')) {
      vibrate = (p) => {
        // Без касания страницы Chrome блокирует vibrate и пишет предупреждение в консоль — не зовём.
        const act = (nav as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
        if (act && !act.hasBeenActive) return false;
        return nav.vibrate(p);
      };
    }
  } catch {
    vibrate = null;
  }
  return { tg, vibrate };
}

function runStep(out: HapticOut, s: HapticStep): void {
  if (out.tg) {
    if ('impact' in s) out.tg.impactOccurred(s.impact);
    else if ('notify' in s) out.tg.notificationOccurred(s.notify);
    else out.tg.selectionChanged();
    return;
  }
  if (out.vibrate) out.vibrate(VIBRATE_MS['impact' in s ? s.impact : 'notify' in s ? s.notify : 'select']);
}

// ---------- ядро (проверяется в тестах) ----------

export interface HapticDeps {
  out: () => HapticOut;
  now: () => number;
  /** Настройка «Вибрация». */
  enabled: () => boolean;
  /** Игра на паузе / скрыта. */
  paused: () => boolean;
  /** Отложить второй шаг момента (setTimeout). */
  later: (fn: () => void, ms: number) => void;
}

export class HapticEngine {
  private last = -Infinity;
  private readonly lastById = new Map<string, number>();

  constructor(private readonly deps: HapticDeps) {}

  /** Вибрировать момент id. true — импульс отправлен. */
  fire(id: HapticId): boolean {
    const def: HapticDef = HAPTICS[id];
    if (!def || !this.deps.enabled() || this.deps.paused()) return false;
    const out = this.deps.out();
    if (!out.tg && !out.vibrate) return false;
    const t = this.deps.now();
    if (t - this.last < Math.max(GLOBAL_GAP_MS, def.quiet ?? 0)) return false;
    if (t - (this.lastById.get(id) ?? -Infinity) < def.gap) return false;
    this.last = t;
    this.lastById.set(id, t);
    def.steps.forEach((s, i) => {
      const go = () => {
        if (i > 0 && (!this.deps.enabled() || this.deps.paused())) return;
        try {
          runStep(out, s);
        } catch {
          // Вибрация не должна ломать игру.
        }
      };
      if (i === 0) go();
      else this.deps.later(go, STEP_MS * i);
    });
    return true;
  }
}

// ---------- настройка ----------

/** Настройка, не прогресс — свой ключ localStorage. */
export const HAPTICS_KEY = (import.meta.env?.VITE_ADVANCE_LAB === '1' ? 'chronoworld.advanceLab.haptics' : 'chronoworld.haptics');

interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const store = (): KV | null => {
  try {
    return (globalThis.localStorage as KV | undefined) ?? null;
  } catch {
    return null;
  }
};

/** Прочитать настройку «Вибрация» (по умолчанию — вкл). */
export function loadHapticsOn(s: KV | null = store()): boolean {
  try {
    return s?.getItem(HAPTICS_KEY) !== '0';
  } catch {
    return true;
  }
}

export const hapticSettings = { on: loadHapticsOn() };

/** Включить / выключить вибрацию (запоминается). Включили — короткий отклик, чтобы было понятно, что работает. */
export function setHapticsOn(on: boolean): void {
  hapticSettings.on = on;
  try {
    store()?.setItem(HAPTICS_KEY, on ? '1' : '0');
  } catch {
    // Не запомнили — не страшно.
  }
  if (on) haptic('tap');
}

/** Есть ли на этом устройстве вибрация (Telegram или Android). */
export const hapticsAvailable = (): boolean => {
  const o = detectHapticOut();
  return !!(o.tg || o.vibrate);
};

// ---------- публичный API ----------

let cachedOut: HapticOut | null = null;
const engine = new HapticEngine({
  // Выход ищем при вызове и запоминаем найденный (пустой не запоминаем: вдруг SDK Telegram догрузится позже).
  out: () => {
    if (cachedOut) return cachedOut;
    const o = detectHapticOut();
    if (o.tg || o.vibrate) cachedOut = o;
    return o;
  },
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  enabled: () => hapticSettings.on,
  paused: () => !!lifecycle()?.paused || (typeof document !== 'undefined' && document.hidden),
  later: (fn, ms) => void setTimeout(fn, ms),
});

/** Вибрировать момент (таблица HAPTICS). delayMs — позже (совпасть с кадром удара в бою). */
export function haptic(id: HapticId, delayMs = 0): void {
  try {
    if (delayMs > 0) setTimeout(() => engine.fire(id), delayMs);
    else engine.fire(id);
  } catch {
    // Вибрация не должна ломать игру.
  }
}
