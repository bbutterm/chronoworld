/**
 * Telegram Mini App — «родное» поведение (docs/design/ui-polish-research.md §1.3, §3 правило 12):
 * - ready() — сразу при старте (Telegram убирает свой плейсхолдер, видна наша HTML-заставка), expand() — на всю высоту;
 * - disableVerticalSwipes() — вертикальный свайп (перетаскивание героев, прокрутка списков) не сворачивает игру;
 * - цвет шапки, фона и нижней полосы Telegram — цвет фона игры (без светлой/синей рамки вокруг);
 * - на телефоне (iOS/Android, Bot API 8.0+) — полный экран и портретная ориентация; кнопки Telegram «Закрыть» / «⋯»
 *   поверх игры не закрывают интерфейс: viewport.ts отступает на safeAreaInset + contentSafeAreaInset;
 * - BackButton Telegram (и аппаратная «назад» Android) = «‹ Назад» экрана: setTgBack(fn).
 * Вне Telegram (обычный браузер, тесты) всё — тихие no-op. Любой вызов SDK обёрнут: старый клиент без метода или
 * исключение «метод не поддерживается» игру не ломают.
 * Без Phaser и DOM — проверяется в tests/telegram.test.ts на поддельном WebApp.
 *
 * Не делаем: enableClosingConfirmation (раздражает), MainButton/BottomButton (свой CTA в canvas), themeParams
 * (у игры своя палитра). Вибрация Telegram — haptics.ts.
 */

type Insets = { top?: number; bottom?: number; left?: number; right?: number };

/** Часть Telegram.WebApp, которой пользуется игра. */
export interface TgWebAppLike {
  version?: string;
  platform?: string;
  isVersionAtLeast?: (v: string) => boolean;
  ready?: () => void;
  expand?: () => void;
  isExpanded?: boolean;
  requestFullscreen?: () => void;
  isFullscreen?: boolean;
  lockOrientation?: () => void;
  disableVerticalSwipes?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  safeAreaInset?: Insets;
  contentSafeAreaInset?: Insets;
  viewportHeight?: number;
  viewportStableHeight?: number;
  BackButton?: {
    show?: () => void;
    hide?: () => void;
    onClick?: (cb: () => void) => void;
    offClick?: (cb: () => void) => void;
  };
  onEvent?: (event: string, cb: (...a: never[]) => void) => void;
  offEvent?: (event: string, cb: (...a: never[]) => void) => void;
}

/** Подмена WebApp в тестах: undefined — брать настоящий из globalThis, null — «не Telegram». */
let override: TgWebAppLike | null | undefined;

export function setTgAppForTests(app: TgWebAppLike | null | undefined): void {
  override = app;
  backFn = null;
  backHandler = null;
  installedFor = null;
}

/**
 * WebApp, если игра открыта в Telegram, иначе undefined. SDK, загруженный вне Telegram, сообщает platform 'unknown' —
 * это тоже «не Telegram».
 */
export function tgApp(): TgWebAppLike | undefined {
  if (override !== undefined) return override ?? undefined;
  try {
    const app = (globalThis as unknown as { Telegram?: { WebApp?: TgWebAppLike } }).Telegram?.WebApp;
    return app && app.platform !== 'unknown' ? app : undefined;
  } catch {
    return undefined;
  }
}

/** Игра внутри Telegram. */
export const inTelegram = (): boolean => tgApp() !== undefined;

/** «8.0» ≥ «7.10»: сравнение версий Bot API по числам (не строкой). */
export function versionGte(have: string | undefined, need: string): boolean {
  if (!have) return false;
  const a = have.split('.').map((x) => parseInt(x, 10) || 0);
  const b = need.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

/** Клиент Telegram поддерживает версию Bot API need (isVersionAtLeast SDK, иначе по полю version). */
export function tgSupports(app: TgWebAppLike, need: string): boolean {
  try {
    if (typeof app.isVersionAtLeast === 'function') return app.isVersionAtLeast(need);
  } catch {
    /* ниже — по полю version */
  }
  return versionGte(app.version, need);
}

type Method = 'ready' | 'expand' | 'requestFullscreen' | 'lockOrientation' | 'disableVerticalSwipes' | 'setHeaderColor' | 'setBackgroundColor' | 'setBottomBarColor';

/** Вызов метода SDK: нет метода, старая версия или исключение — false, без ошибок. */
function call(app: TgWebAppLike, need: string, method: Method, ...args: string[]): boolean {
  const fn = app[method] as ((...a: string[]) => unknown) | undefined;
  if (typeof fn !== 'function' || !tgSupports(app, need)) return false;
  try {
    fn.apply(app, args);
    return true;
  } catch {
    return false;
  }
}

/** Телефон (полный экран и блокировка ориентации там уместны; на компьютере — нет). */
export const isMobilePlatform = (platform: string | undefined): boolean => platform === 'ios' || platform === 'android' || platform === 'android_x';

export interface TgInstallOptions {
  /** Цвет фона игры (#rrggbb) — для шапки, фона и нижней полосы Telegram. */
  color: string;
  /** Полный экран на телефоне (по умолчанию да; ?fullscreen=0 в адресе — нет). */
  fullscreen?: boolean;
}

/** Что сделала installTelegram (для тестов и отладки). */
export interface TgInstallResult {
  telegram: boolean;
  ready: boolean;
  expanded: boolean;
  swipesOff: boolean;
  colors: string[];
  fullscreen: boolean;
  orientationLocked: boolean;
}

let installedFor: TgWebAppLike | null = null;

/** Один раз при старте игры (viewport.ts initialView). Вне Telegram — ничего. Повторный вызов — ничего. */
export function installTelegram(opts: TgInstallOptions): TgInstallResult {
  const res: TgInstallResult = { telegram: false, ready: false, expanded: false, swipesOff: false, colors: [], fullscreen: false, orientationLocked: false };
  const app = tgApp();
  if (!app || installedFor === app) return res;
  installedFor = app;
  res.telegram = true;
  // Цвета — до ready(): Telegram сразу показывает игру в её цвете, без вспышки светлой темы чата.
  if (call(app, '6.1', 'setHeaderColor', opts.color)) res.colors.push('header');
  if (call(app, '6.1', 'setBackgroundColor', opts.color)) res.colors.push('background');
  if (call(app, '7.10', 'setBottomBarColor', opts.color)) res.colors.push('bottomBar');
  res.ready = call(app, '6.0', 'ready');
  res.expanded = call(app, '6.0', 'expand');
  res.swipesOff = call(app, '7.7', 'disableVerticalSwipes');
  if (isMobilePlatform(app.platform)) {
    // Полный экран не прячет интерфейс: viewport.ts отступает на safeAreaInset + contentSafeAreaInset
    // (строка «Закрыть» / «⋯» Telegram) и пересчитывается по fullscreenChanged / contentSafeAreaChanged.
    if (opts.fullscreen !== false && !app.isFullscreen) res.fullscreen = call(app, '8.0', 'requestFullscreen');
    res.orientationLocked = call(app, '8.0', 'lockOrientation');
  }
  return res;
}

/** Подписка на событие WebApp (viewportChanged, safeAreaChanged…). Возвращает отписку; вне Telegram — пустая. */
export function onTgEvent<T = unknown>(event: string, cb: (payload?: T) => void): () => void {
  const app = tgApp();
  if (!app?.onEvent) return () => {};
  const fn = cb as (...a: never[]) => void;
  try {
    app.onEvent(event, fn);
  } catch {
    return () => {};
  }
  return () => {
    try {
      app.offEvent?.(event, fn);
    } catch {
      /* ничего */
    }
  };
}

/** Отступы Telegram поверх игры (полный экран): safeAreaInset + contentSafeAreaInset, CSS px. Вне Telegram — нули. */
export function tgInsets(): { top: number; right: number; bottom: number; left: number } {
  const app = tgApp();
  const sum = (k: keyof Insets) => (app?.safeAreaInset?.[k] ?? 0) + (app?.contentSafeAreaInset?.[k] ?? 0);
  return { top: sum('top'), right: sum('right'), bottom: sum('bottom'), left: sum('left') };
}

// ---------- BackButton ----------

/** Текущий обработчик «назад» экрана и обёртка, подписанная на BackButton. */
let backFn: (() => void) | null = null;
let backHandler: (() => void) | null = null;

/**
 * Кнопка «назад» Telegram (стрелка в шапке, аппаратная «назад» Android) ведёт туда же, куда «‹ Назад» экрана.
 * fn — переход; null — скрыть кнопку (корневой экран: Город, Кампания, Герои, Приключения).
 * Возвращает отмену: скрывает кнопку, только если с тех пор её не занял другой экран (порядок shutdown старой сцены
 * и create новой не важен). Вне Telegram и до Bot API 6.1 — no-op.
 */
export function setTgBack(fn: (() => void) | null): () => void {
  const app = tgApp();
  const bb = app?.BackButton;
  if (!app || !bb || !tgSupports(app, '6.1')) {
    backFn = fn;
    const mine = fn;
    return () => {
      if (backFn === mine) backFn = null;
    };
  }
  try {
    if (backHandler) bb.offClick?.(backHandler);
  } catch {
    /* ничего */
  }
  backHandler = null;
  backFn = fn;
  if (!fn) {
    try {
      bb.hide?.();
    } catch {
      /* ничего */
    }
    return () => {};
  }
  const handler = () => {
    try {
      fn();
    } catch {
      /* переход упал — кнопку не ломаем */
    }
  };
  backHandler = handler;
  try {
    bb.onClick?.(handler);
    bb.show?.();
  } catch {
    /* ничего */
  }
  return () => {
    if (backFn === fn) setTgBack(null);
  };
}

/** Текущий обработчик «назад» (тесты, отладка). */
export const tgBack = (): (() => void) | null => backFn;
