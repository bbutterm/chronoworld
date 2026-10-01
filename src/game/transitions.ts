import Phaser from 'phaser';
import { M } from './theme';

/**
 * Переходы между экранами: короткое затемнение старого экрана и проявление нового. Пока идёт затемнение,
 * ввод старого экрана выключен — второе нажатие (двойной тап по «В бой», «Собрать», «Назад») ничего не делает,
 * а повторный scene.start из того же экрана игнорируется.
 *
 * Ставится один раз (main.ts) обёрткой ScenePlugin.start — экранам ничего не нужно менять.
 * Без затемнения: переход из экрана, который ещё строится (перенаправление в create), с паузы и из Boot.
 *
 * Длительности — токены движения (§4.6): уход M.fast (ввод старого экрана закрыт только на это время), проявление
 * нового M.base (новый экран уже принимает нажатия). Один вид перехода на всю игру — затемнение в цвет фона;
 * при «Уменьшить анимацию» он тот же (затемнение не «движение», а смена кадра без вспышки).
 *
 * Для замеров (perf:ui, §7.3): performance.mark('scene:<ключ>:start') в момент scene.start и
 * 'scene:<ключ>:create' — когда новый экран построен.
 */
export const FADE_OUT_MS = M.fast;
export const FADE_IN_MS = M.base;
/** Запас на случай, если кадры не идут (фон, медленное устройство): переход не ждёт конца затемнения дольше. */
const FADE_GUARD_MS = FADE_OUT_MS + M.press / 2;

function mark(name: string): void {
  try {
    // Одна метка на имя (старую — прочь): за долгую сессию буфер меток не растёт.
    globalThis.performance?.clearMarks?.(name);
    globalThis.performance?.mark?.(name);
  } catch {
    // Замеры не должны ломать переходы.
  }
}

const leaving = new WeakSet<Phaser.Scene>();

/** Экран уже уходит (идёт затемнение перед переходом) — нажатия на нём игнорируются. */
export function isLeaving(scene: Phaser.Scene): boolean {
  return leaving.has(scene);
}

let installed = false;

export function installTransitions(): void {
  if (installed) return;
  installed = true;
  const proto = Phaser.Scenes.ScenePlugin.prototype;
  const start = proto.start;
  proto.start = function (this: Phaser.Scenes.ScenePlugin, key?: string | Phaser.Scene, data?: object) {
    const from = this.scene;
    const status = from?.sys.settings.status;
    const plain = !from || from.sys.settings.key === 'Boot' || status !== Phaser.Scenes.RUNNING || !from.cameras?.main;
    const targetKey = typeof key === 'string' ? key : key?.sys.settings.key;
    const fadeIn = () => {
      if (!targetKey) return;
      const to = this.get(targetKey);
      to?.sys.events.once(Phaser.Scenes.Events.CREATE, () => {
        mark(`scene:${targetKey}:create`);
        const cam = to.cameras.main;
        if (!cam) return;
        // Законченное проявление Phaser продолжает рисовать прозрачный прямоугольник на весь экран каждый кадр —
        // на слабом телефоне это заметная лишняя заливка. Сбрасываем эффект, как только он закончился.
        cam.once(Phaser.Cameras.Scene2D.Events.FADE_IN_COMPLETE, () => cam.fadeEffect.reset());
        cam.fadeIn(FADE_IN_MS, 0, 0, 0);
      });
    };
    if (plain) {
      if (targetKey) mark(`scene:${targetKey}:start`);
      if (from && from.sys.settings.key !== 'Boot') fadeIn();
      return start.call(this, key, data);
    }
    if (leaving.has(from)) return this;
    leaving.add(from);
    from.input.enabled = false;
    const cam = from.cameras.main;
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      leaving.delete(from);
      from.input.enabled = true;
      fadeIn();
      if (targetKey) mark(`scene:${targetKey}:start`);
      start.call(this, key, data);
    };
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, go);
    cam.fadeOut(FADE_OUT_MS, 0, 0, 0);
    // Затемнение идёт по кадрам игры: на медленном устройстве (или в фоне) кадров мало — переход не должен ждать их.
    window.setTimeout(go, FADE_GUARD_MS);
    return this;
  };
}
