import Phaser from 'phaser';

/**
 * Переходы между экранами: короткое затемнение старого экрана и проявление нового. Пока идёт затемнение,
 * ввод старого экрана выключен — второе нажатие (двойной тап по «В бой», «Собрать», «Назад») ничего не делает,
 * а повторный scene.start из того же экрана игнорируется.
 *
 * Ставится один раз (main.ts) обёрткой ScenePlugin.start — экранам ничего не нужно менять.
 * Без затемнения: переход из экрана, который ещё строится (перенаправление в create), с паузы и из Boot.
 */
export const FADE_OUT_MS = 120;
export const FADE_IN_MS = 160;

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
      to?.sys.events.once(Phaser.Scenes.Events.CREATE, () => to.cameras.main?.fadeIn(FADE_IN_MS, 0, 0, 0));
    };
    if (plain) {
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
      start.call(this, key, data);
    };
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, go);
    cam.fadeOut(FADE_OUT_MS, 0, 0, 0);
    // Затемнение идёт по кадрам игры: на медленном устройстве (или в фоне) кадров мало — переход не должен ждать их.
    window.setTimeout(go, FADE_OUT_MS + 40);
    return this;
  };
}
