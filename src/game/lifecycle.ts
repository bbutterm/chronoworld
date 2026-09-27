/**
 * U. Жизненный цикл приложения в Telegram Mini App / браузере: игра не крутит кадры, когда её не видно
 * (вкладка скрыта, окно без фокуса, Mini App свёрнут), и умеет ограничивать FPS.
 * Логика — без Phaser (LoopLike — нужная часть Phaser.Core.TimeStep), чтобы проверять в тестах.
 */

/** Часть Phaser.Core.TimeStep, которой мы управляем. */
export interface LoopLike {
  running: boolean;
  fpsLimit: number;
  hasFpsLimit: boolean;
  _limitRate: number;
  sleep(): void;
  wake(seamless?: boolean): void;
  resetDelta(): void;
}

/**
 * Интервал ограничителя кадров. Чуть меньше 1000/fps: rAF дрожит, и при ровно 33.3 мс на экране 60 Гц
 * ограничитель иногда пропускал бы ещё один кадр (20 FPS вместо 30).
 */
export const limitRate = (fps: number) => 1000 / fps - 3;

/** Самый большой шаг времени боя за кадр, мс: после паузы или подвисания бой не «прыгает» вперёд. */
export const MAX_FRAME_MS = 250;
export const clampDelta = (delta: number, max = MAX_FRAME_MS) => (delta > max ? max : delta < 0 ? 0 : delta);

export class AppLifecycle {
  /** Почему игра сейчас на паузе (скрыта, без фокуса, свёрнута в Telegram). Пусто — идёт. */
  private readonly reasons = new Set<string>();

  constructor(private readonly loop: LoopLike) {}

  get paused(): boolean {
    return this.reasons.size > 0;
  }

  pause(reason: string): void {
    const was = this.paused;
    this.reasons.add(reason);
    if (!was) this.loop.sleep();
  }

  resume(reason: string): void {
    if (!this.reasons.delete(reason) || this.paused) return;
    // Сначала обнулить отсчёт: иначе первый кадр после паузы получил бы всё время, что игра спала.
    this.loop.resetDelta();
    this.loop.wake();
  }

  /** 60 и больше — без ограничителя (частота экрана), иначе — ограничитель Phaser (fps.limit). */
  setFpsCap(fps: number): void {
    const limit = fps >= 60 ? 0 : fps;
    const running = this.loop.running;
    // Функция шага выбирается при запуске цикла (step или stepLimitFPS) — перезапускаем его.
    if (running) this.loop.sleep();
    this.loop.fpsLimit = limit;
    this.loop.hasFpsLimit = limit > 0;
    this.loop._limitRate = limit > 0 ? limitRate(limit) : 0;
    if (running) {
      this.loop.resetDelta();
      this.loop.wake();
    }
  }
}

interface TelegramWebApp {
  onEvent?: (event: string, cb: () => void) => void;
}

let current: AppLifecycle | null = null;

/** Жизненный цикл игры (null — ещё не установлен, например в тестах). */
export const lifecycle = () => current;

/** Подписаться на события страницы и Telegram WebApp (если есть). Один раз при старте игры. */
export function installLifecycle(loop: LoopLike, fpsCap: number): AppLifecycle {
  const app = new AppLifecycle(loop);
  current = app;
  app.setFpsCap(fpsCap);
  if (typeof document === 'undefined') return app;
  document.addEventListener('visibilitychange', () => (document.hidden ? app.pause('hidden') : app.resume('hidden')));
  window.addEventListener('blur', () => app.pause('blur'));
  window.addEventListener('focus', () => app.resume('blur'));
  // Telegram Mini App: свёрнут / развёрнут (Bot API 8.0). Страница при этом может оставаться «видимой».
  const tg = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
  tg?.onEvent?.('deactivated', () => app.pause('telegram'));
  tg?.onEvent?.('activated', () => app.resume('telegram'));
  if (document.hidden) app.pause('hidden');
  return app;
}
