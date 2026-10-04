import Phaser from 'phaser';
import { BLEED_X, BLEED_Y, GAME_H, GAME_W } from './layout';
import { inTelegram, installTelegram, onTgEvent, tgInsets } from './telegram';
import { computeView, MAX_DPR, supportsAdaptiveLayout, type Insets, type View } from './viewLayout';

export { computeView, MAX_DPR, type View };
/** Сцены меняют раскладку, сохраняя выбранного героя, модальное окно и положение списка. */
export const VIEW_CHANGED = 'ui-view-changed';

/** Подписка живёт столько же, сколько запуск сцены; повторный вход не копит обработчики. */
export function onViewChange(scene: Phaser.Scene, fn: (next: View, previous: View) => void): () => void {
  const off = () => {
    scene.events.off(VIEW_CHANGED, fn);
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, off);
  };
  scene.events.on(VIEW_CHANGED, fn);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
  return off;
}

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

/**
 * Безопасные отступы экрана в CSS px: env(safe-area-inset-*) и, в Telegram Mini App на весь экран, поверх них —
 * отступы Telegram (safeAreaInset + contentSafeAreaInset: строка кнопок «Закрыть» / «⌄ …» сверху закрывала валюту).
 */
function readInsets(): Insets {
  const probe = document.getElementById('safe-probe');
  const st = probe ? getComputedStyle(probe) : undefined;
  const px = (v: string | undefined) => parseFloat(v ?? '') || 0;
  const css = { top: px(st?.paddingTop), right: px(st?.paddingRight), bottom: px(st?.paddingBottom), left: px(st?.paddingLeft) };
  if (!inTelegram()) return css;
  const tg = tgInsets();
  return { top: Math.max(css.top, tg.top), right: Math.max(css.right, tg.right), bottom: Math.max(css.bottom, tg.bottom), left: Math.max(css.left, tg.left) };
}

/** Предел плотности: ?dpr=N в адресе (для замеров), иначе MAX_DPR. */
function maxDprSetting(): number {
  const q = Number(new URLSearchParams(location.search).get('dpr'));
  return q > 0 && q <= 4 ? q : MAX_DPR;
}

/** Production включает только проверенные сцены. В dev можно проверить новую раскладку до её регистрации. */
function adaptiveSetting(scene = ''): boolean {
  return supportsAdaptiveLayout(scene) || (import.meta.env.DEV && new URLSearchParams(location.search).get('compact') === '1');
}

let current: View = computeView(GAME_W, GAME_H, 1);

/** Текущая раскладка (для отладки и e2e: window.__view). */
export function view(): View {
  return current;
}

/** Размеры в мире для читаемого текста и цели44CSSpx в адаптивной раскладке. */
export function minimumFontSize(): number {
  return current.adaptive ? Math.max(36, Math.ceil(12 * current.worldW / current.cssW)) : 0;
}

export function minimumTouchSize(): number {
  return current.adaptive ? Math.max(132, Math.ceil(44 * current.worldW / current.cssW)) : 96;
}

/** Цвет фона игры (index.html, конфиг Phaser в main.ts) — им же красим шапку, фон и нижнюю полосу Telegram. */
export const APP_BG = '#0a0907';

/**
 * Начальный размер холста для конфига игры. Заодно (один раз, до создания игры) — настройка Telegram Mini App
 * (telegram.ts): ready, expand, без сворачивания свайпом, цвета, полный экран на телефоне (?fullscreen=0 — без него).
 */
export function initialView(): View {
  let fullscreen = true;
  try {
    fullscreen = new URLSearchParams(location.search).get('fullscreen') !== '0';
  } catch {
    /* по умолчанию — полный экран */
  }
  installTelegram({ color: APP_BG, fullscreen });
  current = computeView(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, readInsets(), maxDprSetting(), adaptiveSetting());
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

/** Ширина/высота «полосы-заливки» поля (маленькая canvas-текстура, растягивается с линейной фильтрацией). */
const FILL_N = 64;
const FILL_DEPTH = 16;
/** Какая доля картинки у кромки берётся как образец цвета (1,5 %: небо/земля без крыш и башен). */
const EDGE_FRAC = 0.015;
/**
 * Заливка по ключу текстуры фона: источник (слабая ссылка — вытесненный фон не держим в памяти) и номер поколения.
 * Фон перерисовали под тем же ключом — новое поколение с новым ключом заливки (старую не удаляем: её могут ещё
 * показывать полосы живой сцены; она крошечная, 64×16).
 */
const fills = new Map<string, { src: WeakRef<object> | null; gen: number }>();

type Side = 't' | 'b' | 'l' | 'r';

/**
 * RN-01. Заливка поля одной стороны: образец кромки картинки (EDGE_FRAC), у шва — в полную ширину (64 точки, цвета
 * неба/земли по месту), к краю экрана — всё мягче (размытие до 6 точек). Никаких отражений: раньше поле было
 * зеркалом верхних строк, и над каждым боем висели перевёрнутые крыши, пирамиды и вторая луна.
 * null — источник не читается (текстура без картинки) — тогда поле просто затемняется.
 */
function edgeFill(scene: Phaser.Scene, f: Phaser.Textures.Frame, side: Side): string | null {
  const tex = f.texture;
  const src = tex.getSourceImage(f.sourceIndex) as CanvasImageSource | undefined;
  if (!src || !(src instanceof HTMLImageElement || src instanceof HTMLCanvasElement || (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap))) return null;
  const base = `__bleedfill:${tex.key}:${f.name}:${side}`;
  const known = fills.get(base);
  const same = !!known && known.src?.deref() === src;
  const gen = known ? (same ? known.gen : known.gen + 1) : 0;
  const key = `${base}:${gen}`;
  if (scene.textures.exists(key)) return key;
  const horiz = side === 't' || side === 'b';
  const fw = f.cutWidth;
  const fh = f.cutHeight;
  const sh = Math.max(1, Math.round(fh * EDGE_FRAC));
  const sw = Math.max(1, Math.round(fw * EDGE_FRAC));
  // Образец кромки в координатах источника.
  const sx = f.cutX + (side === 'r' ? fw - sw : 0);
  const sy = f.cutY + (side === 'b' ? fh - sh : 0);
  const w = horiz ? fw : sw;
  const h = horiz ? sh : fh;
  const tw = horiz ? FILL_N : FILL_DEPTH;
  const th = horiz ? FILL_DEPTH : FILL_N;
  const t = scene.textures.createCanvas(key, tw, th);
  if (!t) return null;
  try {
    const ctx = t.getContext();
    ctx.imageSmoothingEnabled = true;
    const line = (n: number) => {
      const c = document.createElement('canvas');
      c.width = horiz ? n : 1;
      c.height = horiz ? 1 : n;
      const g = c.getContext('2d')!;
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, sx, sy, w, h, 0, 0, c.width, c.height);
      return c;
    };
    // У шва — 12 образцов по кромке (цвет неба/земли по месту, без полос), к краю экрана — 3 (почти ровный тон).
    const sharp = line(12);
    const soft = line(3);
    for (let i = 0; i < FILL_DEPTH; i++) {
      // k: 0 — у кромки экрана (мягко), 1 — у шва с картинкой (образец как есть).
      const k = i / (FILL_DEPTH - 1);
      const near = side === 't' || side === 'l' ? k : 1 - k;
      const [dx, dy, dw, dh] = horiz ? [0, i, tw, 1] : [i, 0, 1, th];
      ctx.globalAlpha = 1;
      ctx.drawImage(soft, 0, 0, soft.width, soft.height, dx, dy, dw, dh);
      ctx.globalAlpha = near;
      ctx.drawImage(sharp, 0, 0, sharp.width, sharp.height, dx, dy, dw, dh);
    }
    ctx.globalAlpha = 1;
    t.refresh();
    // Кадры (новый кадр не должен стать кадром по умолчанию): c0/c1 — крайние столбцы для углов, n — ряд у шва
    // (растушёвка шва внутрь картинки).
    const first = t.firstFrame;
    if (horiz) {
      t.add('c0', 0, 0, 0, 1, FILL_DEPTH);
      t.add('c1', 0, FILL_N - 1, 0, 1, FILL_DEPTH);
      t.add('n', 0, 0, side === 't' ? FILL_DEPTH - 1 : 0, FILL_N, 1);
    } else t.add('n', 0, side === 'l' ? FILL_DEPTH - 1 : 0, 0, 1, FILL_N);
    t.firstFrame = first;
  } catch {
    // Картинка с другого источника (taint) или ещё не декодирована — без заливки.
    scene.textures.remove(key);
    return null;
  }
  fills.set(base, { src: typeof WeakRef === 'function' ? new WeakRef(src as object) : null, gen });
  return key;
}

/**
 * Продолжение полноэкранной картинки на поля вытянутых/широких экранов (RN-01): образец цвета у кромки картинки,
 * растянутый на поле и размытый к краю экрана (edgeFill), углы — средний цвет соседних полос, поверх — затемнение
 * к кромке экрана. Отражений нет. Кладётся сразу над картинкой в списке отображения — всё, что нарисовано позже,
 * остаётся сверху. Повторный вызов (картинке сменили текстуру) заменяет прежние полосы.
 */
export function bleedImage(scene: Phaser.Scene, img: Phaser.GameObjects.Image): void {
  const old = img.getData?.('bleed') as Phaser.GameObjects.GameObject[] | undefined;
  old?.forEach((o) => o.destroy());
  const f = img.frame;
  const parts: Phaser.GameObjects.GameObject[] = [];
  const list = scene.children;
  // Картинка в контейнере (фон страницы сюжета поверх экрана) — полосы кладутся в тот же контейнер сразу за ней,
  // иначе они оказывались в корне сцены под всем слоем и на полях оставались чёрные полосы.
  const box = img.parentContainer;
  const put = <T extends Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle>(s: T, alpha: number): T => {
    s.setAlpha(alpha).setDepth(img.depth).setScrollFactor(img.scrollFactorX, img.scrollFactorY);
    if (box) box.addAt(s, box.getIndex(img) + 1 + parts.length);
    else list.moveTo(s, list.getIndex(img) + 1 + parts.length);
    parts.push(s);
    return s;
  };
  const L = -BLEED_X / 2;
  const R = GAME_W + BLEED_X / 2;
  const T = -BLEED_Y / 2;
  const B = GAME_H + BLEED_Y / 2;
  const tint = (s: Phaser.GameObjects.Image) => (img.isTinted ? s.setTint(img.tintTopLeft) : s);
  /** Растушёвка шва: ряд заливки у шва заходит на картинку на FEATHER, прозрачнея внутрь. */
  const FEATHER = 90;
  const band = (side: Side, x: number, y: number, dw: number, dh: number) => {
    const key = edgeFill(scene, f, side);
    if (!key) {
      put(scene.add.rectangle(x, y, dw + 2, dh + 2, 0x07060a), img.alpha);
      return key;
    }
    put(tint(scene.add.image(x, y, key).setDisplaySize(dw + 2, dh + 2)), img.alpha);
    const a = img.alpha;
    // Растушёвка — только когда поле этой стороны видно (на ровных 9:16 края картинки не трогаем).
    const shown = side === 't' || side === 'b' ? current.worldY < -8 : current.worldX < -8;
    if (!shown) return key;
    if (side === 't') put(tint(scene.add.image(GAME_W / 2, FEATHER / 2, key, 'n').setDisplaySize(GAME_W, FEATHER)), 1).setAlpha(a, a, 0, 0);
    if (side === 'b') put(tint(scene.add.image(GAME_W / 2, GAME_H - FEATHER / 2, key, 'n').setDisplaySize(GAME_W, FEATHER)), 1).setAlpha(0, 0, a, a);
    if (side === 'l') put(tint(scene.add.image(FEATHER / 2, GAME_H / 2, key, 'n').setDisplaySize(FEATHER, GAME_H)), 1).setAlpha(a, 0, a, 0);
    if (side === 'r') put(tint(scene.add.image(GAME_W - FEATHER / 2, GAME_H / 2, key, 'n').setDisplaySize(FEATHER, GAME_H)), 1).setAlpha(0, a, 0, a);
    return key;
  };
  const top = band('t', GAME_W / 2, T, GAME_W, BLEED_Y);
  const bottom = band('b', GAME_W / 2, B, GAME_W, BLEED_Y);
  band('l', L, GAME_H / 2, BLEED_X, GAME_H);
  band('r', R, GAME_H / 2, BLEED_X, GAME_H);
  // Углы: крайний столбец полосы сверху/снизу (кадры c0/c1 заливки), растянутый на угол.
  const corner = (key: string | null, x: number, y: number, fromLeft: boolean) => {
    if (!key) return put(scene.add.rectangle(x, y, BLEED_X + 2, BLEED_Y + 2, 0x07060a), img.alpha);
    return put(tint(scene.add.image(x, y, key, fromLeft ? 'c0' : 'c1').setDisplaySize(BLEED_X + 2, BLEED_Y + 2)), img.alpha);
  };
  corner(top, L, T, true);
  corner(top, R, T, false);
  corner(bottom, L, B, true);
  corner(bottom, R, B, false);
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
    const options = { resolution: textResolution(), ...style };
    if (current.adaptive) {
      const size = parseFloat(String(options.fontSize ?? 16));
      options.fontSize = Math.max(size, minimumFontSize());
    }
    return addText.call(this, x, y, t, options);
  };

  const bleed = (scene: Phaser.Scene) => {
    for (const o of [...scene.children.list]) {
      if (o instanceof Phaser.GameObjects.Image && isFullScreen(o)) bleedImage(scene, o);
    }
  };
  let activeSceneKey = game.scene.getScenes(true).at(-1)?.scene.key ?? '';
  const apply = () => {
    const previous = current;
    const v = (current = computeView(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, readInsets(), maxDprSetting(), adaptiveSetting(activeSceneKey)));
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
    if (previous.safeTop !== v.safeTop || previous.safeBottom !== v.safeBottom || previous.uiHeight !== v.uiHeight) {
      for (const scene of game.scene.getScenes(true)) scene.events.emit(VIEW_CHANGED, v, previous);
    }
  };
  // START приходит до create: размеры доступны экрану при его первом построении, включая production.
  const hooked = new WeakSet<Phaser.Scene>();
  const hook = (scene: Phaser.Scene) => {
    if (hooked.has(scene)) return;
    hooked.add(scene);
    scene.sys.events.on(Phaser.Scenes.Events.START, () => {
      activeSceneKey = scene.scene.key;
      apply();
      fitCamera(scene);
    });
    scene.sys.events.on(Phaser.Scenes.Events.CREATE, () => bleed(scene));
    if (scene.sys.settings.status === Phaser.Scenes.RUNNING) bleed(scene);
  };
  const hookAll = () => {
    for (const scene of game.scene.scenes as Phaser.Scene[]) hook(scene);
  };
  game.events.once(Phaser.Core.Events.READY, hookAll);
  hookAll();
  game.events.on(Phaser.Core.Events.PRE_RENDER, () => {
    hookAll();
    for (const scene of game.scene.scenes as Phaser.Scene[]) {
      const cam = scene.cameras?.main;
      if (cam && fitted.get(cam) !== current) fitCamera(scene);
    }
  });
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
  for (const ev of ['safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged']) onTgEvent(ev, schedule);
  // Высота окна Telegram: пока шторка ещё едет (isStateStable: false), холст не пересобираем на каждое событие —
  // пересчёт по устойчивой высоте, когда движение закончилось.
  onTgEvent<{ isStateStable?: boolean }>('viewportChanged', (e) => {
    if (e && e.isStateStable === false) return;
    schedule();
  });

  apply();
}

/** Точка мира под указателем (указатель Phaser — в пикселях холста, а мир масштабирован камерой). */
export function worldPoint(scene: Phaser.Scene, p: Phaser.Input.Pointer): Phaser.Math.Vector2 {
  return scene.cameras.main.getWorldPoint(p.x, p.y);
}
