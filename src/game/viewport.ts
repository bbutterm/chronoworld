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

type TgInsets = { top?: number; bottom?: number; left?: number; right?: number };
interface TgWebApp {
  safeAreaInset?: TgInsets;
  contentSafeAreaInset?: TgInsets;
  onEvent?: (event: string, cb: () => void) => void;
}
const telegram = (): TgWebApp | undefined => (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;

/**
 * Безопасные отступы экрана в CSS px: env(safe-area-inset-*) и, в Telegram Mini App на весь экран, поверх них —
 * отступы Telegram (safeAreaInset + contentSafeAreaInset: строка кнопок «Закрыть» / «⌄ …» сверху закрывала валюту).
 */
function readInsets(): Insets {
  const probe = document.getElementById('safe-probe');
  const st = probe ? getComputedStyle(probe) : undefined;
  const px = (v: string | undefined) => parseFloat(v ?? '') || 0;
  const css = { top: px(st?.paddingTop), right: px(st?.paddingRight), bottom: px(st?.paddingBottom), left: px(st?.paddingLeft) };
  const tg = telegram();
  if (!tg) return css;
  const sum = (k: keyof TgInsets) => (tg.safeAreaInset?.[k] ?? 0) + (tg.contentSafeAreaInset?.[k] ?? 0);
  return { top: Math.max(css.top, sum('top')), right: Math.max(css.right, sum('right')), bottom: Math.max(css.bottom, sum('bottom')), left: Math.max(css.left, sum('left')) };
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

/** Затемнение полей: вертикальный градиент от прозрачного к чёрному (одна маленькая общая текстура). */
const FADE_TEX = '__bleed_fade';
/** Насколько темнеет внешний край поля (у самой кромки экрана). */
const FADE_ALPHA = 0.55;

function fadeTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(FADE_TEX)) return FADE_TEX;
  const t = scene.textures.createCanvas(FADE_TEX, 4, 128);
  if (!t) return '__WHITE';
  const c = t.getContext();
  const g = c.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  c.fillStyle = g;
  c.fillRect(0, 0, 4, 128);
  t.refresh();
  return FADE_TEX;
}

/**
 * Продолжение полноэкранной картинки на поля вытянутых/широких экранов: зеркальное отражение краевой полосы
 * картинки (трава, камни, небо продолжаются без швов и без растянутых «полос»), углы — отражение углов, поверх —
 * мягкое затемнение к кромке экрана (тёмный тон темы). Кладётся сразу над картинкой в списке отображения — всё,
 * что нарисовано позже, остаётся сверху. Повторный вызов (картинке сменили текстуру) заменяет прежние полосы.
 */
export function bleedImage(scene: Phaser.Scene, img: Phaser.GameObjects.Image): void {
  const old = img.getData?.('bleed') as Phaser.GameObjects.Image[] | undefined;
  old?.forEach((o) => o.destroy());
  const f = img.frame;
  const tex = f.texture;
  const fw = f.cutWidth;
  const fh = f.cutHeight;
  // Сколько пикселей источника уходит на поле (картинка растянута на GAME_W×GAME_H).
  const sh = Math.min(fh, Math.max(1, Math.round((BLEED_Y * fh) / GAME_H)));
  const sw = Math.min(fw, Math.max(1, Math.round((BLEED_X * fw) / GAME_W)));
  const parts: Phaser.GameObjects.Image[] = [];
  const list = scene.children;
  // Картинка в контейнере (фон страницы сюжета поверх экрана) — полосы кладутся в тот же контейнер сразу за ней,
  // иначе они оказывались в корне сцены под всем слоем и на полях оставались чёрные полосы.
  const box = img.parentContainer;
  const put = (s: Phaser.GameObjects.Image, alpha: number) => {
    s.setAlpha(alpha).setDepth(img.depth).setScrollFactor(img.scrollFactorX, img.scrollFactorY);
    if (box) box.addAt(s, box.getIndex(img) + 1 + parts.length);
    else list.moveTo(s, list.getIndex(img) + 1 + parts.length);
    parts.push(s);
  };
  const mirror = (name: string, sx: number, sy: number, w: number, h: number, x: number, y: number, dw: number, dh: number, flipX: boolean, flipY: boolean) => {
    const key = `bleed:${f.name}:${name}:${w}x${h}`;
    if (!tex.has(key)) {
      // Новый кадр в текстуре с одним __BASE стал бы её кадром по умолчанию — возвращаем прежний.
      const first = tex.firstFrame;
      tex.add(key, f.sourceIndex, f.cutX + sx, f.cutY + sy, w, h);
      tex.firstFrame = first;
    }
    const s = scene.add.image(x, y, tex.key, key).setDisplaySize(dw + 1, dh + 1).setFlip(flipX, flipY);
    if (img.isTinted) s.setTint(img.tintTopLeft);
    put(s, img.alpha);
  };
  const L = -BLEED_X / 2;
  const R = GAME_W + BLEED_X / 2;
  const T = -BLEED_Y / 2;
  const B = GAME_H + BLEED_Y / 2;
  mirror('t', 0, 0, fw, sh, GAME_W / 2, T, GAME_W, BLEED_Y, false, true);
  mirror('b', 0, fh - sh, fw, sh, GAME_W / 2, B, GAME_W, BLEED_Y, false, true);
  mirror('l', 0, 0, sw, fh, L, GAME_H / 2, BLEED_X, GAME_H, true, false);
  mirror('r', fw - sw, 0, sw, fh, R, GAME_H / 2, BLEED_X, GAME_H, true, false);
  mirror('tl', 0, 0, sw, sh, L, T, BLEED_X, BLEED_Y, true, true);
  mirror('tr', fw - sw, 0, sw, sh, R, T, BLEED_X, BLEED_Y, true, true);
  mirror('bl', 0, fh - sh, sw, sh, L, B, BLEED_X, BLEED_Y, true, true);
  mirror('br', fw - sw, fh - sh, sw, sh, R, B, BLEED_X, BLEED_Y, true, true);
  // Затемнение к кромке: сверху и снизу — на всю ширину с углами, слева и справа — повёрнутый градиент.
  const fade = fadeTexture(scene);
  const W = GAME_W + 2 * BLEED_X;
  const a = img.alpha * FADE_ALPHA;
  put(scene.add.image(GAME_W / 2, T, fade).setDisplaySize(W, BLEED_Y + 1).setFlipY(true), a);
  put(scene.add.image(GAME_W / 2, B, fade).setDisplaySize(W, BLEED_Y + 1), a);
  put(scene.add.image(L, GAME_H / 2, fade).setAngle(90).setDisplaySize(GAME_H, BLEED_X + 1), a);
  put(scene.add.image(R, GAME_H / 2, fade).setAngle(-90).setDisplaySize(GAME_H, BLEED_X + 1), a);
  img.setData('bleed', parts);
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
    // MT-01: resize() выше пересчитал displayScale по СТАРОМУ css-размеру холста; после смены стиля — заново,
    // иначе координаты тапов остаются от прошлого размера окна (поворот, раскрытие Telegram) до перезагрузки.
    sm.refresh();
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
  // Telegram сообщает отступы асинхронно и меняет их при переходе в полноэкранный режим.
  for (const ev of ['safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged', 'viewportChanged']) telegram()?.onEvent?.(ev, schedule);

  apply();
}

/** Точка мира под указателем (указатель Phaser — в пикселях холста, а мир масштабирован камерой). */
export function worldPoint(scene: Phaser.Scene, p: Phaser.Input.Pointer): Phaser.Math.Vector2 {
  return scene.cameras.main.getWorldPoint(p.x, p.y);
}
