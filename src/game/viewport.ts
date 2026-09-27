import Phaser from 'phaser';
import { BLEED_X, BLEED_Y, GAME_H, GAME_W } from './layout';
import { computeView, MAX_DPR, type Insets, type View } from './viewLayout';

export { computeView, MAX_DPR, type View };

/**
 * P8. Вывод игры на экран телефона.
 *
 * Раскладка экранов по-прежнему в поле 1080×1920 (GAME_W×GAME_H), но:
 * - поле вписывается в безопасную область экрана (без выреза/«чёлки»), а видимая часть мира
 *   расширяется за его края до BLEED_X/BLEED_Y — на вытянутых телефонах (19.5:9, 20:9) вместо пустых
 *   полос сверху и снизу продолжаются фон, шапка и навигация; позиции кнопок не меняются;
 * - холст рисуется с учётом devicePixelRatio (не больше MAX_DPR, но и не мельче прежнего
 *   «холст 1080 по ширине»), а мир масштабируется камерой каждой сцены: текст и рамки чёткие;
 * - полноэкранные прямоугольники (затемнения окон, заливки) и фоны 1080×1920 сами растягиваются на поля
 *   (installBleed), так что экраны про поля ничего знать не обязаны.
 *
 * Альбомная ориентация на телефоне — заглушка «Поверните телефон» (index.html, CSS).
 */

/** Телефон в альбомной ориентации — показываем «Поверните телефон» (то же условие, что в CSS index.html). */
export const LANDSCAPE_PHONE = '(orientation: landscape) and (max-height: 540px)';

/** Безопасные отступы экрана (env(safe-area-inset-*)) в CSS px. */
function readInsets(): Insets {
  const probe = document.getElementById('safe-probe');
  if (!probe) return { top: 0, right: 0, bottom: 0, left: 0 };
  const st = getComputedStyle(probe);
  const px = (v: string) => parseFloat(v) || 0;
  return { top: px(st.paddingTop), right: px(st.paddingRight), bottom: px(st.paddingBottom), left: px(st.paddingLeft) };
}

/** Предел плотности: ?dpr=N в адресе (для замеров), иначе MAX_DPR. */
function maxDprSetting(): number {
  const q = Number(new URLSearchParams(location.search).get('dpr'));
  return q > 0 && q <= 4 ? q : MAX_DPR;
}

let current: View = computeView(GAME_W, GAME_H, 1);

/** Текущая раскладка (для отладки и e2e: window.__view). */
export function view(): View {
  return current;
}

/** Начальный размер холста для конфига игры. */
export function initialView(): View {
  current = computeView(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, readInsets(), maxDprSetting());
  return current;
}

/** Камера сцены показывает видимую часть мира. */
function fitCamera(scene: Phaser.Scene): void {
  const cam = scene.cameras?.main;
  if (!cam) return;
  const v = current;
  cam.setSize(v.backW, v.backH);
  cam.setZoom(v.zoom);
  cam.centerOn(v.worldX + v.worldW / 2, v.worldY + v.worldH / 2);
  fitted.set(cam, v);
}

/** С какой раскладкой подогнана камера (новая раскладка после поворота — подогнать заново). */
const fitted = new WeakMap<Phaser.Cameras.Scene2D.Camera, View>();

/** Разрешение текста: при зуме камеры больше 1 буквы растеризуются крупнее, иначе расплывутся. */
function textResolution(): number {
  return current.zoom > 1.02 ? Math.min(2, Math.ceil(current.zoom * 4) / 4) : 1;
}

/** Фон на всё поле 1080×1920 — продолжить его краевыми полосами на видимые поля. */
function isFullScreen(o: { x: number; y: number; displayWidth: number; displayHeight: number }): boolean {
  return Math.abs(o.x - GAME_W / 2) < 1 && Math.abs(o.y - GAME_H / 2) < 1 && Math.abs(o.displayWidth - GAME_W) < 1 && Math.abs(o.displayHeight - GAME_H) < 1;
}

/**
 * Полосы по краям полноэкранной картинки: крайняя строка/столбец текстуры, растянутые на поле.
 * Кладутся сразу над картинкой в списке отображения — всё, что нарисовано позже, остаётся сверху.
 */
export function bleedImage(scene: Phaser.Scene, img: Phaser.GameObjects.Image): void {
  const f = img.frame;
  const tex = f.texture;
  const edge = 2;
  const strip = (name: string, sx: number, sy: number, sw: number, sh: number, x: number, y: number, w: number, h: number) => {
    const key = `bleed:${f.name}:${name}`;
    if (!tex.has(key)) {
      // Новый кадр в текстуре с одним __BASE стал бы её кадром по умолчанию — возвращаем прежний.
      const first = tex.firstFrame;
      tex.add(key, f.sourceIndex, f.cutX + sx, f.cutY + sy, sw, sh);
      tex.firstFrame = first;
    }
    const s = scene.add
      .image(x, y, tex.key, key)
      .setDisplaySize(w, h)
      .setAlpha(img.alpha)
      .setDepth(img.depth)
      .setScrollFactor(img.scrollFactorX, img.scrollFactorY);
    if (img.isTinted) s.setTint(img.tintTopLeft);
    const list = scene.children;
    list.moveTo(s, list.getIndex(img) + 1);
  };
  const fw = f.cutWidth;
  const fh = f.cutHeight;
  const W = GAME_W + 2 * BLEED_X;
  strip('t', 0, 0, fw, edge, GAME_W / 2, -BLEED_Y / 2, W, BLEED_Y + 1);
  strip('b', 0, fh - edge, fw, edge, GAME_W / 2, GAME_H + BLEED_Y / 2, W, BLEED_Y + 1);
  strip('l', 0, 0, edge, fh, -BLEED_X / 2, GAME_H / 2, BLEED_X + 1, GAME_H);
  strip('r', fw - edge, 0, edge, fh, GAME_W + BLEED_X / 2, GAME_H / 2, BLEED_X + 1, GAME_H);
}

let installed = false;

/**
 * Один раз при старте (main.ts): камеры сцен, растяжение полноэкранных объектов на поля,
 * разрешение текста и пересчёт при повороте/изменении окна.
 */
export function installViewport(game: Phaser.Game): void {
  if (installed) return;
  installed = true;

  // Полноэкранные прямоугольники (затемнения модальных окон, вспышки) — сразу на весь видимый мир с полями.
  const factory = Phaser.GameObjects.GameObjectFactory.prototype as unknown as Record<string, unknown>;
  type Fn = (this: unknown, ...a: unknown[]) => unknown;
  const rect = factory.rectangle as Fn;
  factory.rectangle = function (this: unknown, x: number, y: number, w: number, h: number, ...rest: unknown[]) {
    if (x === GAME_W / 2 && y === GAME_H / 2 && w === GAME_W && h === GAME_H) {
      w += 2 * BLEED_X;
      h += 2 * BLEED_Y;
    }
    return rect.call(this, x, y, w, h, ...rest);
  };
  const addText = factory.text as Fn;
  factory.text = function (this: unknown, x: number, y: number, t: unknown, style?: Phaser.Types.GameObjects.Text.TextStyle) {
    return addText.call(this, x, y, t, { resolution: textResolution(), ...style });
  };

  const bleed = (scene: Phaser.Scene) => {
    for (const o of [...scene.children.list]) {
      if (o instanceof Phaser.GameObjects.Image && isFullScreen(o)) bleedImage(scene, o);
    }
  };
  // Сцены подхватываем перед каждым кадром: камера подгоняется, как только появилась или поменялась раскладка,
  // фоны растягиваются после create. Порядок загрузки сцен и плагинов Phaser тут не важен.
  const hooked = new WeakSet<Phaser.Scene>();
  game.events.on(Phaser.Core.Events.PRE_RENDER, () => {
    for (const scene of game.scene.scenes as Phaser.Scene[]) {
      if (!hooked.has(scene)) {
        hooked.add(scene);
        scene.sys.events.on(Phaser.Scenes.Events.CREATE, () => bleed(scene));
        if (scene.sys.settings.status === Phaser.Scenes.RUNNING) bleed(scene);
      }
      const cam = scene.cameras?.main;
      if (cam && fitted.get(cam) !== current) fitCamera(scene);
    }
  });

  const apply = () => {
    const v = (current = computeView(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, readInsets(), maxDprSetting()));
    const sm = game.scale;
    sm.zoom = 1 / v.density;
    if (sm.width !== v.backW || sm.height !== v.backH) sm.resize(v.backW, v.backH);
    const st = game.canvas.style;
    st.position = 'absolute';
    st.left = `${v.cssLeft}px`;
    st.top = `${v.cssTop}px`;
    st.width = `${v.cssW}px`;
    st.height = `${v.cssH}px`;
    sm.updateBounds();
  };
  let pending = 0;
  const schedule = () => {
    cancelAnimationFrame(pending);
    // Размер окна после поворота телефона приходит не сразу — пересчитываем в следующем кадре и ещё раз чуть позже.
    pending = requestAnimationFrame(apply);
    window.setTimeout(apply, 300);
  };
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.visualViewport?.addEventListener('resize', schedule);

  apply();
}

/** Точка мира под указателем (указатель Phaser — в пикселях холста, а мир масштабирован камерой). */
export function worldPoint(scene: Phaser.Scene, p: Phaser.Input.Pointer): Phaser.Math.Vector2 {
  return scene.cameras.main.getWorldPoint(p.x, p.y);
}
