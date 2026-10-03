import Phaser from 'phaser';
import { skinKey, sliceOf, tex } from './assets';
import { SKIN_DARK_LABEL } from './skin';
import { GAME_H, GAME_W, HEADER_H } from './layout';
import { worldPoint } from './viewport';
import { C, COLOR, COLOR_N, E, FAMILY, familyFor, FS, leading, M, R, S, T, TINT, TOUCH, TOUCH_COMFORT } from './theme';
import { BADGE } from './frame';
import { arrowRect, HINT_GEOM, overlapArea, placeCallout, sceneObstacles, type CalloutPlan, type HintSide, type Rect, type SceneNode } from './hintLayout';
import { HINT_TEXT, hintNagged, markHint, noteHintVisit, type HintId } from './hints';
import { barFrom, heartbeat, juiceOn } from './juice';
import { roIconImage } from './itemIcons';
import { sfx } from './audio';
import { haptic } from './haptics';
import type { SfxId } from './audioCatalog';

/**
 * Событие «отменить нажатие» (на scene.input — его слушатели снимаются при остановке сцены):
 * ScrollArea шлёт его, когда палец начал тянуть список, — нажатая кнопка/карточка отпускается.
 */
const CANCEL_PRESS = 'ui-cancel-press';

/** Повторное срабатывание одной и той же кнопки/карточки раньше этого срока — случайный двойной тап, игнорируем. */
const REPEAT_MS = 300;

/** Защита от двойного тапа: true — можно срабатывать (и запоминаем время). */
function debounce(): () => boolean {
  let last = -Infinity;
  return () => {
    const t = performance.now();
    if (t - last < REPEAT_MS) return false;
    last = t;
    return true;
  };
}

/** Сколько после закрытия окна не принимать касания (MT-02: второй быстрый тап «проваливался» в кнопку под окном). */
export const SHIELD_MS = 400;
let shieldTimer = 0;

/**
 * «Щит» от проваливающегося тапа: на ms весь ввод игры (все сцены) выключен. Зовётся, когда закрывается модальное
 * окно (popIn) — касание, закрывшее окно, уже обработано, а следующее быстрое не попадёт ни в элемент под окном,
 * ни в новый экран, если окно запустило переход.
 */
export function shieldTaps(game: Phaser.Game | undefined, ms = SHIELD_MS): void {
  const mgr = game?.input;
  if (!mgr) return;
  mgr.enabled = false;
  window.clearTimeout(shieldTimer);
  shieldTimer = window.setTimeout(() => {
    mgr.enabled = true;
  }, ms);
}

/** Kenney UI нарисован мелко: 9-slice строим в меньшем размере и увеличиваем, чтобы рамки были заметны. */
const UI_SCALE = 2.5;

/** Мягкая тень текста поверх арта (вместо обводки): 0/2 ед., размытие 4, 55 % — §4.1 исследования. */
export const TEXT_SHADOW = { x: 0, y: 2, color: 'rgba(0,0,0,0.55)', blur: 4 } as const;

/**
 * Текст по центру (x, y). Правила токенов (docs/design/ui-polish-research.md, §4.1):
 * - многострочный (wordWrap) без явного lineSpacing получает межстрочный по шкале T (leading());
 * - тонкая обводка C.stroke / C.titleStroke (OUTLINE, TITLE_STYLE, до 4 ед.) превращается в мягкую тень: на тёмной
 *   поверхности её не видно, на арте она отделяет буквы от фона, а буквы не «толстеют». Толстая явная обводка
 *   (5+ ед., «наклейки» на арте) остаётся как есть. Явный shadow в стиле главнее.
 */
export function text(
  scene: Phaser.Scene,
  x: number,
  y: number,
  value: string,
  size: number = FS.h2,
  color: string = C.text,
  style: Phaser.Types.GameObjects.Text.TextStyle = {},
): Phaser.GameObjects.Text {
  const s: Phaser.Types.GameObjects.Text.TextStyle = { fontFamily: familyFor(size, style), fontSize: `${size}px`, color, align: 'center', ...style };
  if (style.wordWrap && style.lineSpacing === undefined) s.lineSpacing = leading(size);
  const soft = (style.stroke === C.stroke || style.stroke === C.titleStroke) && (style.strokeThickness ?? 0) <= 4;
  if (soft) {
    delete s.stroke;
    s.strokeThickness = 0;
  }
  const t = scene.add.text(x, y, value, s).setOrigin(0.5);
  if (soft && !style.shadow) t.setShadow(TEXT_SHADOW.x, TEXT_SHADOW.y, TEXT_SHADOW.color, TEXT_SHADOW.blur, false, true);
  return t;
}

/** Поверхность сохраняет API текстуры, прозрачности и tint в обоих рендерах. */
export type Panel = Phaser.GameObjects.NineSlice | Phaser.GameObjects.Image;

interface CanvasPanelTexture { key: string; refs: number }
const canvasPanels = new WeakMap<Phaser.Textures.TextureManager, Map<string, CanvasPanelTexture>>();
let canvasPanelId = 0;

/**
 * NineSlice у Phaser рисуется только в WebGL. В Canvas собираем те же девять участков в обычную Image.
 * Кэш делится между одинаковыми панелями, освобождается после последнего владельца и при смене состояния.
 * Исходные координаты учитывают кадр атласа; углы не растягиваются вместе с серединой.
 */
export function slicedPanel(
  scene: Phaser.Scene, x: number, y: number, key: string, frame: string | number | undefined,
  w: number, h: number, left: number, right: number, top: number, bottom: number,
): Panel {
  if (!scene.sys?.game?.renderer || scene.sys.game.renderer.type !== Phaser.CANVAS) {
    return scene.add.nineslice(x, y, key, frame, w, h, left, right, top, bottom);
  }
  const textures = scene.textures;
  let cache = canvasPanels.get(textures);
  if (!cache) canvasPanels.set(textures, cache = new Map());
  const entries = cache;
  let logicalW = w, logicalH = h;
  let width = Math.max(1, Math.ceil(w));
  let height = Math.max(1, Math.ceil(h));
  let sourceKey = key, sourceFrame = frame;
  let current: { id: string; value: CanvasPanelTexture } | undefined;
  const release = () => {
    if (!current) return;
    if (--current.value.refs === 0) {
      textures.remove(current.value.key);
      entries.delete(current.id);
    }
    current = undefined;
  };
  const acquire = (sourceKey: string, sourceFrame?: string | number) => {
    const id = JSON.stringify([sourceKey, sourceFrame, width, height, left, right, top, bottom]);
    if (current?.id === id) return current.value.key;
    let value = entries.get(id);
    if (!value) {
      const source = textures.getFrame(sourceKey, sourceFrame);
      const bakedKey = `__canvas_panel_${++canvasPanelId}`;
      const canvas = textures.createCanvas(bakedKey, width, height);
      if (!canvas) throw new Error('Не удалось создать поверхность интерфейса');
      const ctx = canvas.getContext();
      // Слишком узкая панель: симметрично уменьшаем углы, без отрицательного размера центра.
      const sx = Math.min(1, source.cutWidth / Math.max(1, left + right));
      const sy = Math.min(1, source.cutHeight / Math.max(1, top + bottom));
      const dx = Math.min(1, width / Math.max(1, left + right));
      const dy = Math.min(1, height / Math.max(1, top + bottom));
      const xs = [0, left * sx, source.cutWidth - right * sx, source.cutWidth];
      const ys = [0, top * sy, source.cutHeight - bottom * sy, source.cutHeight];
      const xd = [0, left * dx, width - right * dx, width];
      const yd = [0, top * dy, height - bottom * dy, height];
      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
        const sw = xs[col + 1] - xs[col], sh = ys[row + 1] - ys[row];
        const dw = xd[col + 1] - xd[col], dh = yd[row + 1] - yd[row];
        if (sw > 0 && sh > 0 && dw > 0 && dh > 0) {
          ctx.drawImage(source.source.image as CanvasImageSource,
            source.cutX + xs[col], source.cutY + ys[row], sw, sh, xd[col], yd[row], dw, dh);
        }
      }
      canvas.refresh();
      value = { key: bakedKey, refs: 0 };
      entries.set(id, value);
    }
    value.refs++;
    release();
    current = { id, value };
    return value.key;
  };
  const img = scene.add.image(x, y, acquire(key, frame)).setDisplaySize(w, h);
  const setTexture = img.setTexture.bind(img);
  img.setTexture = (nextKey: string | Phaser.Textures.Texture, nextFrame?: string | number) => {
    sourceKey = typeof nextKey === 'string' ? nextKey : nextKey.key;
    sourceFrame = nextFrame;
    setTexture(acquire(sourceKey, sourceFrame));
    return img;
  };
  // Image.setSize обычно меняет лишь hitbox. Панель должна, как NineSlice, перерисоваться (счётчик сундука).
  img.setSize = (nextWidth: number, nextHeight: number) => {
    if (logicalW === nextWidth && logicalH === nextHeight) return img;
    const sx = img.scaleX * width / logicalW, sy = img.scaleY * height / logicalH;
    logicalW = Math.max(1, nextWidth);
    logicalH = Math.max(1, nextHeight);
    width = Math.ceil(logicalW);
    height = Math.ceil(logicalH);
    setTexture(acquire(sourceKey, sourceFrame));
    img.setScale(sx * logicalW / width, sy * logicalH / height);
    return img;
  };
  img.once(Phaser.GameObjects.Events.DESTROY, release);
  return img;
}

/** 9-slice панель из манифеста (кадр атласа или картинка). */
export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, id: string, scale = UI_SCALE): Panel {
  const t = tex(scene, id);
  const [l, r, tp, b] = sliceOf(id);
  // Текстуры скина нарисованы в игровых единицах — без увеличения; углы не больше половины размера.
  if (skinKey(scene, id)) {
    const k = Math.min(l, w / 2 - 1, h / 2 - 1);
    return slicedPanel(scene, x, y, t.key, t.frame, w, h, k, k, k, k);
  }
  return slicedPanel(scene, x, y, t.key, t.frame, w / scale, h / scale, l, r, tp, b).setScale(scale);
}

// ———————————————————————————————————————— Кнопки ————————————————————————————————————————

/**
 * Высоты и поля кнопок (TODO(theme.ts): перенести в токены). l — обычная кнопка экрана/модалки (цель ≥ 122 ед. по §1.2
 * исследования — 120 + отступ), m — кнопка в строке списка и иконка, cta — главная кнопка экрана. padX — поле подписи.
 */
export const BTN = { cta: 144, l: 120, m: 96, padX: S.l, icon: 96 } as const;

/**
 * Вид кнопки (§4.7): primary — золото, одна на экран; secondary — тёмная плитка с рамкой; ghost — подпись цветом
 * акцента без плитки (третичное действие); icon — квадратная тёмная плитка с глифом/иконкой; danger — тёмная плитка
 * с красной подписью (сброс, удаление: не выделяется как главная, T3-23).
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'icon' | 'danger';

/** Текстура скина по виду (явный variant главнее textureId). */
const VARIANT_TEXTURE: Record<Exclude<ButtonVariant, 'ghost'>, string> = {
  primary: 'ui_btn_primary',
  secondary: 'ui_btn_secondary',
  icon: 'ui_btn_secondary',
  danger: 'ui_btn_secondary',
};

/** Вид кнопки по текстуре (старые вызовы без variant): золото — primary, остальное — secondary. */
export function variantOf(textureId: string): ButtonVariant {
  return textureId === 'ui_btn_primary' ? 'primary' : 'secondary';
}

/** Насколько сжимается нажатая кнопка (§4.6): 1 → 0.96 за M.press, обратно с «пружиной» E.pop за M.release. */
export const PRESS_SCALE = 0.96;

/**
 * Отклик нажатия: масштаб объекта к PRESS_SCALE и обратно. Свои твины масштаба объекта (пульс «можно забрать»)
 * на время нажатия ставятся на паузу и продолжаются после отпускания — без рывка и без двойного эффекта.
 * Без анимации (juiceOn() = false) — масштаб сразу.
 */
export function pressFeedback(scene: Phaser.Scene, obj: Phaser.GameObjects.Container | Phaser.GameObjects.Image, down: boolean): void {
  if (!obj.scene) return;
  const prev = obj.getData('pressTween') as Phaser.Tweens.Tween | undefined;
  if (prev) prev.stop();
  let base = obj.getData('pressBase') as number | undefined;
  if (down) {
    if (base === undefined) {
      base = obj.scaleX;
      obj.setData('pressBase', base);
    }
    const paused = (obj.getData('pressPaused') as Phaser.Tweens.Tween[] | undefined) ?? [];
    for (const tw of scene.tweens.getTweensOf(obj)) {
      if (tw !== prev && tw.isPlaying()) {
        tw.pause();
        paused.push(tw);
      }
    }
    obj.setData('pressPaused', paused);
  }
  if (base === undefined) return;
  const to = down ? base * PRESS_SCALE : base;
  const done = () => {
    if (down || !obj.scene) return;
    obj.setData('pressBase', undefined).setData('pressTween', undefined);
    const paused = (obj.getData('pressPaused') as Phaser.Tweens.Tween[] | undefined) ?? [];
    obj.setData('pressPaused', undefined);
    for (const tw of paused) if (!tw.isDestroyed()) tw.resume();
  };
  if (!juiceOn()) {
    obj.setScale(to);
    done();
    return;
  }
  obj.setData(
    'pressTween',
    scene.tweens.add({ targets: obj, scale: to, duration: down ? M.press : M.release, ease: down ? E.out : E.pop, onComplete: done }),
  );
}

/** Подписи на плитках: тиснение. На золоте — светлый отблеск снизу, на тёмных — мягкая тень. */
function labelShadow(t: Phaser.GameObjects.Text, onGold: boolean): void {
  if (onGold) t.setShadow(0, 2, 'rgba(255,244,210,0.55)', 0, false, true);
  else t.setShadow(0, 2, 'rgba(0,0,0,0.75)', 3, false, true);
}

/** Подпись недоступной кнопки на сером «камне»: приглушённая, но читаемая (≈ 4.5:1). TODO(theme.ts): токен. */
export const DISABLED_LABEL = '#aea89b';

const DARK_TEXT = new Set(['ui_btn_speed', 'ui_btn_skip', 'k:buttonLong_beige', 'k:buttonLong_grey', 'k:buttonSquare_beige', 'k:buttonSquare_grey']);

/** Кнопка: контейнер, подпись и недоступное состояние. */
export interface ButtonView {
  container: Phaser.GameObjects.Container;
  setLabel: (s: string) => void;
  label: Phaser.GameObjects.Text;
  /**
   * Недоступна (false): серая «каменная» кнопка с приглушённой подписью и иконками, без свечения и блика —
   * вместо полупрозрачности (сквозь неё просвечивал фон). Нажатие по-прежнему приходит в onClick
   * (экран объясняет тостом, почему нельзя); кому нажатие не нужно — disableInteractive() сам.
   */
  setEnabled: (on: boolean) => ButtonView;
  /** Вид кнопки (явный или по текстуре). */
  variant: ButtonVariant;
}

/** Длинная подпись остаётся внутри кнопки; размер не опускается ниже caption. */
export function fitButtonLabel(label: Phaser.GameObjects.Text, width: number, preferred: number, variant: ButtonVariant = 'secondary'): void {
  // У ghost нет рамки; компактной плитке достаточно 8 ед. с каждой стороны.
  // Широкое поле 32 ед. оставляем большим CTA, иначе «Пропустить» не влезает даже при caption.
  const padding = variant === 'ghost' ? 0 : Math.min(width <= 320 ? S.xxs : S.m, width * 0.12);
  const maxWidth = Math.max(1, width - 2 * padding);
  const minimum = Math.min(preferred, T.caption);
  label.setFontSize(preferred);
  for (let size = preferred - 2; label.width > maxWidth && size >= minimum; size -= 2) label.setFontSize(size);
  if (label.width > maxWidth) {
    label.setFontSize(minimum);
    ellipsize(label, maxWidth);
  }
}

/** Текстура недоступной кнопки (skin.ts); нет скина — серый tint. */
export const DISABLED_BTN = 'skin_btn_disabled';
const DISABLED_TINT = 0x8a8a8a;

/** Параметры кнопки. */
export interface ButtonOpts {
  /** Переключатель по кругу (скорость, FPS): быстрые повторные нажатия не глушим. */
  repeat?: boolean;
  /** Звук нажатия (по умолчанию «тап»; null — без звука, например кнопка сама открывает окно со звуком). */
  sound?: SfxId | null;
  /** Вид (§4.7). Не задан — по textureId: золото → primary, остальное → secondary. Задан — главнее textureId. */
  variant?: ButtonVariant;
}

/**
 * Кнопка из 9-slice текстуры (или плейсхолдера) с подписью. Новый код задаёт opts.variant (textureId тогда не важен,
 * можно передать ''), высоту — из BTN. Нажатие: масштаб 0.96 (pressFeedback) и «вдавленная» текстура скина; подпись
 * отдельно не сдвигается.
 */
export function button(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  textureId: string,
  label: string,
  onClick: () => void,
  fontSize: number = FS.h2,
  opts: ButtonOpts = {},
): ButtonView {
  const variant = opts.variant ?? variantOf(textureId);
  const texId = opts.variant && opts.variant !== 'ghost' ? VARIANT_TEXTURE[opts.variant] : textureId || 'ui_btn_secondary';
  const ghost = variant === 'ghost';
  const bg = panel(scene, 0, 0, w, h, texId);
  if (ghost) bg.setAlpha(0);
  const skin = skinKey(scene, texId);
  // Скин: на золотой кнопке тёмная подпись, на тёмных плитках — светлая (активная — золотая), danger — красная, ghost — акцент.
  const dark = !ghost && (skin ? SKIN_DARK_LABEL.has(skin) : DARK_TEXT.has(texId));
  let color: string;
  if (ghost) color = COLOR.accent;
  else if (variant === 'danger') color = COLOR.negative;
  else if (skin) color = dark ? COLOR.onAccent : skin === 'skin_btn_active' ? COLOR.title : COLOR.textPrimary;
  else color = dark ? C.ink : C.text;
  const plain = dark || skin !== null || ghost;
  const t = text(scene, 0, ghost ? 0 : -3, label, fontSize, color, {
    fontStyle: 'bold',
    stroke: plain ? C.none : C.titleStroke,
    strokeThickness: plain ? 0 : 5,
  });
  if (skin || ghost) labelShadow(t, dark);
  const fitLabel = () => fitButtonLabel(t, w, fontSize, variant);
  fitLabel();
  const container = scene.add.container(x, y, [bg, t]);
  // Цель нажатия не ниже TOUCH, даже если кнопка нарисована ниже.
  const hitH = Math.max(h, h >= BTN.l ? TOUCH_COMFORT : TOUCH);
  container.setSize(w, hitH).setInteractive({
    useHandCursor: true,
    hitArea: new Phaser.Geom.Rectangle(0, 0, w, hitH),
    hitAreaCallback: Phaser.Geom.Rectangle.Contains,
  });
  // armed: палец опустился именно на эту кнопку; отпускание без него (или после протяжки списка) — не клик.
  let armed = false;
  const ready = debounce();
  let enabled = true;
  const setPressed = (p: boolean) => {
    armed = p;
    if (!bg.scene) return;
    if (enabled && !ghost) {
      const f = tex(scene, texId, p);
      bg.setTexture(f.key, f.frame);
    }
    if (ghost && enabled) t.setAlpha(p ? 0.7 : 1);
    pressFeedback(scene, container, p);
  };
  const release = () => {
    if (armed) setPressed(false);
  };
  container.on('pointerdown', () => setPressed(true));
  container.on('pointerout', release);
  container.on('pointerup', () => {
    if (!armed) return;
    setPressed(false);
    if (!opts.repeat && !ready()) return;
    const sound = opts.sound === undefined ? 'ui_tap' : opts.sound;
    if (sound) sfx(sound);
    haptic(sound === 'ui_tab' ? 'tab' : 'tap');
    onClick();
  });
  // Отпустили вне кнопки или список начали тянуть — кнопка не должна остаться нажатой.
  scene.input.on('pointerup', release);
  scene.input.on(CANCEL_PRESS, release);
  container.once(Phaser.GameObjects.Events.DESTROY, () => {
    scene.input.off('pointerup', release);
    scene.input.off(CANCEL_PRESS, release);
  });
  const labelColor = color;
  const view: ButtonView = {
    container,
    variant,
    setLabel: (s) => { t.setText(s); fitLabel(); },
    label: t,
    setEnabled: (on) => {
      if (on === enabled || !bg.scene) return view;
      enabled = on;
      if (ghost) t.setAlpha(on ? 1 : 0.45);
      else {
        const grey = scene.textures.exists(DISABLED_BTN) && skin !== null;
        if (on) {
          const f = tex(scene, texId, false);
          bg.setTexture(f.key, f.frame);
          bg.clearTint();
        } else if (grey) bg.setTexture(DISABLED_BTN);
        else bg.setTint(DISABLED_TINT);
        t.setColor(on ? labelColor : DISABLED_LABEL);
        if (skin) labelShadow(t, on && dark);
      }
      // Иконки и украшения внутри кнопки: иконки приглушены, свечение и блик (ADD) спрятаны.
      for (const o of container.list) {
        if (o === bg || o === t) continue;
        const g = o as Phaser.GameObjects.Image;
        if (g.blendMode === Phaser.BlendModes.ADD) g.setVisible(on);
        else if (typeof g.setAlpha === 'function') {
          if (!on) g.setData('enabledAlpha', g.alpha);
          g.setAlpha(on ? ((g.getData('enabledAlpha') as number | undefined) ?? 1) : 0.4);
        }
      }
      return view;
    },
  };
  return view;
}

/** Опасное действие (сброс, удаление): button() вида danger — тёмная плитка с красной подписью (T3-23, MT-19). */
export function dangerButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  onClick: () => void,
  fontSize: number = FS.h3,
): ButtonView {
  return button(scene, x, y, w, h, '', label, onClick, fontSize, { variant: 'danger' });
}

/** Проверки попадания, уже обёрнутые ScrollArea (полоса списка). */
const CLIPPED_HITS = new WeakSet<Phaser.Types.Input.HitAreaCallback>();

/**
 * Вертикальная прокрутка списка: контейнер с маской в полосе [top, bottom], тянется пальцем и колёсиком.
 * Кнопки внутри оборачивают обработчик в `tap(fn)` — он не сработает после протяжки и вне видимой полосы; вне полосы
 * объекты списка и не ловят нажатия (guardInput), так что скрытая маской карточка не закрывает навигацию под списком
 * (маска Phaser не отсекает ввод). Карточки — через `pressable(..., area.tap(fn))`.
 * Когда содержимое выше полосы, справа видна полоса прокрутки.
 */
export class ScrollArea {
  readonly content: Phaser.GameObjects.Container;
  private height = 0;
  private dragFrom: { y: number; scroll: number } | null = null;
  private dragged = false;
  private readonly thumb: Phaser.GameObjects.Rectangle;
  /** Открыто модальное окно поверх списка — прокрутка и нажатия в списке выключены. */
  locked = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly top: number,
    private readonly bottom: number,
    /** Границы модальной полосы в координатах мира; обычные списки сохраняют прежнюю полную ширину. */
    private readonly horizontal?: { left: number; right: number },
  ) {
    this.content = scene.add.container(0, top);
    const { left, right } = horizontal ?? { left: 0, right: GAME_W };
    const g = scene.make.graphics({}, false);
    g.fillStyle(0xffffff).fillRect(left, top, right - left, bottom - top);
    this.content.setMask(g.createGeometryMask());
    // Видимая полоса списка (для e2e-проверки «кнопку ничто не перекрывает»: вне полосы содержимое скрыто маской).
    this.content.setData('clip', [top, bottom]);
    this.thumb = scene.add.rectangle(right - 6, top, 8, 40, TINT.frame, 0.8).setOrigin(0.5, 0).setDepth(20).setVisible(false);
    const down = (p: Phaser.Input.Pointer) => {
      this.dragged = false;
      this.dragFrom = this.inside(p) && !this.locked ? { y: this.wy(p), scroll: this.content.y } : null;
    };
    const move = (p: Phaser.Input.Pointer) => {
      if (!this.dragFrom || !p.isDown) return;
      if (!this.dragged && Math.abs(this.wy(p) - this.dragFrom.y) > 14 && this.scrollable) {
        this.dragged = true;
        // Палец тянет список — нажатая кнопка/карточка под ним отпускается (иначе остаётся «вдавленной»).
        scene.input.emit(CANCEL_PRESS);
      }
      if (this.dragged) this.scrollTo(this.dragFrom.scroll + (this.wy(p) - this.dragFrom.y));
    };
    const up = () => {
      this.dragFrom = null;
    };
    const wheel = (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (!this.locked && this.inside(p)) this.scrollTo(this.content.y - dy);
    };
    scene.input.on('pointerdown', down);
    scene.input.on('pointermove', move);
    scene.input.on('pointerup', up);
    scene.input.on('wheel', wheel);
    // Маска Phaser не отсекает ввод: карточка под нижним краем полосы (скрыта маской) ловила нажатия поверх
    // нижней навигации, и «КАМПАНИЯ»/«ГЛАВНАЯ» не срабатывали. Каждый кадр новые интерактивные объекты
    // списка получают проверку попадания «указатель внутри полосы» — вне полосы их для ввода как будто нет.
    const guard = () => this.guardInput(this.content);
    scene.events.on(Phaser.Scenes.Events.PRE_UPDATE, guard);
    const shutdown = () => scene.events.off(Phaser.Scenes.Events.PRE_UPDATE, guard);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, shutdown);
    // Список в модальном окне закрывается раньше сцены — снять обработчики вместе с содержимым.
    this.content.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.input.off('pointerdown', down);
      scene.input.off('pointermove', move);
      scene.input.off('pointerup', up);
      scene.input.off('wheel', wheel);
      scene.events.off(Phaser.Scenes.Events.PRE_UPDATE, guard);
      scene.events.off(Phaser.Scenes.Events.SHUTDOWN, shutdown);
      if (this.thumb.scene) this.thumb.destroy();
    });
  }

  /** Содержимое и полоса прокрутки — положить в слой модального окна (над его фоном). */
  get parts(): Phaser.GameObjects.GameObject[] {
    return [this.content, this.thumb];
  }

  /** Обернуть проверку попадания у интерактивных потомков контейнера (один раз на объект). */
  private guardInput(c: Phaser.GameObjects.Container): void {
    for (const o of c.list) {
      const input = o.input;
      if (input && !CLIPPED_HITS.has(input.hitAreaCallback)) {
        const hit = input.hitAreaCallback;
        // Указатель, по которому идёт проверка, — активный (InputManager ставит его перед hitTest).
        const clipped = ((area: unknown, x: number, y: number, go: Phaser.GameObjects.GameObject): boolean =>
          this.inside(this.scene.input.activePointer) && hit(area, x, y, go)) as Phaser.Types.Input.HitAreaCallback;
        CLIPPED_HITS.add(clipped);
        input.hitAreaCallback = clipped;
      }
      if (o instanceof Phaser.GameObjects.Container) this.guardInput(o);
    }
  }

  /** Содержимое выше видимой полосы — есть что прокручивать. */
  get scrollable(): boolean {
    return this.height > this.bottom - this.top;
  }

  /** Высота содержимого (для границ прокрутки). */
  setContentHeight(h: number): void {
    this.height = h;
    this.scrollTo(this.content.y);
  }

  /** Убрать всё содержимое и вернуться наверх (перерисовка списка без перезапуска сцены). */
  clear(): void {
    this.content.removeAll(true);
    this.height = 0;
    this.scrollTo(this.top);
  }

  /** Сдвиг содержимого: 0 — в самом верху. */
  get offset(): number {
    return this.top - this.content.y;
  }

  set offset(v: number) {
    this.scrollTo(this.top - v);
  }

  private scrollTo(y: number): void {
    const view = this.bottom - this.top;
    const min = this.top - Math.max(0, this.height - view);
    this.content.y = Phaser.Math.Clamp(y, min, this.top);
    this.thumb.setVisible(this.scrollable);
    if (!this.scrollable) return;
    const th = Math.max(60, (view * view) / this.height);
    const pct = this.offset / (this.height - view);
    this.thumb.setSize(8, th).setY(this.top + (view - th) * pct);
  }

  /** Указатель — в пикселях холста; список живёт в координатах мира (камера масштабирует). */
  private wy(p: Phaser.Input.Pointer): number {
    return worldPoint(this.scene, p).y;
  }

  private inside(p: Phaser.Input.Pointer): boolean {
    const { x, y } = worldPoint(this.scene, p);
    return y >= this.top && y <= this.bottom
      && (!this.horizontal || (x >= this.horizontal.left && x <= this.horizontal.right));
  }

  /** Обработчик нажатия для объекта в списке: игнорирует протяжку и нажатия вне видимой полосы. */
  tap(fn: () => void): () => void {
    return () => {
      const p = this.scene.input.activePointer;
      if (this.locked || this.dragged || !this.inside(p)) return;
      fn();
    };
  }

  add<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.content.add(o);
    return o;
  }
}

type Tappable = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform;

/**
 * Карточка/слот как цель нажатия: интерактивность, затемнение при нажатии (как у кнопок),
 * клик — только если палец опустился на эту же карточку и список не тянули.
 * Вызывать после того, как карточка добавлена в свой контейнер (слой, ScrollArea): затемнение кладётся туда же.
 */
export function pressable<T extends Tappable>(scene: Phaser.Scene, target: T, w: number, h: number, onTap: () => void): T {
  const shade = scene.add.rectangle(target.x, target.y, w, h, TINT.pressed, 0.25).setVisible(false);
  const parent = target.parentContainer;
  if (parent) parent.add(shade);
  let armed = false;
  const ready = debounce();
  const set = (p: boolean) => {
    armed = p;
    if (!shade.scene) return;
    shade.setVisible(p);
    if (!p) return;
    if (shade.parentContainer) shade.parentContainer.bringToTop(shade);
    else scene.children.bringToTop(shade);
  };
  const release = () => {
    if (armed) set(false);
  };
  target.setInteractive({ useHandCursor: true });
  target.on('pointerdown', () => set(true));
  target.on('pointerout', release);
  target.on('pointerup', () => {
    if (!armed) return;
    set(false);
    if (!ready()) return;
    sfx('ui_tap');
    haptic('tap');
    onTap();
  });
  scene.input.on('pointerup', release);
  scene.input.on(CANCEL_PRESS, release);
  target.once(Phaser.GameObjects.Events.DESTROY, () => {
    scene.input.off('pointerup', release);
    scene.input.off(CANCEL_PRESS, release);
    if (shade.scene) shade.destroy();
  });
  return target;
}

/** Обрезать однострочный текст многоточием, чтобы он влез в maxWidth. */
/**
 * Текст с переносом — не больше lines строк: лишние слова срезаются, в конце «…» (описания в карточках фиксированной
 * высоты не наезжают на строки ниже).
 */
export function clampLines(t: Phaser.GameObjects.Text, lines: number): Phaser.GameObjects.Text {
  const full = t.text;
  const count = () => t.getWrappedText(t.text).length;
  if (count() <= lines) return t;
  const words = full.split(' ');
  let n = words.length;
  while (n > 1) {
    n--;
    t.setText(words.slice(0, n).join(' ').replace(/[,.;:—–-]+$/, '') + '…');
    if (count() <= lines) break;
  }
  return t;
}

export function ellipsize(t: Phaser.GameObjects.Text, maxWidth: number): Phaser.GameObjects.Text {
  const full = t.text;
  if (t.width <= maxWidth) return t;
  let lo = 0;
  let hi = full.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    t.setText(full.slice(0, mid).trimEnd() + '…');
    if (t.width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return t.setText(full.slice(0, lo).trimEnd() + '…');
}

/** Пустое состояние списка: приглушённая подсказка по центру (что сделать, чтобы здесь что-то появилось). */
export function emptyState(scene: Phaser.Scene, x: number, y: number, message: string, width = 900): Phaser.GameObjects.Text {
  return text(scene, x, y, message, FS.body, C.muted, { wordWrap: { width }, lineSpacing: 10, stroke: C.stroke, strokeThickness: 3 });
}

/** Кадр атласа Kenney как картинка (иконки, галочки); `name` — имя кадра без .png. */
export function icon(scene: Phaser.Scene, x: number, y: number, name: string, size: number): Phaser.GameObjects.Image {
  const t = tex(scene, `k:${name}`);
  const img = scene.add.image(x, y, t.key, t.frame);
  return img.setScale(size / Math.max(img.width, img.height));
}

/** Полоса прогресса (подложка + заливка) — прямоугольники, без перерисовки каждый кадр. */
export function progressBar(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  pct: number,
  color = 0x6fd06f,
  /** key — полоса анимируется до нового значения (juice.ts barFrom); delay — задержка, мс. */
  opts: { key?: string; delay?: number } = {},
): Phaser.GameObjects.Container {
  const p = Phaser.Math.Clamp(pct, 0, 1);
  const back = scene.add.rectangle(0, 0, w, h, 0x120d08).setOrigin(0, 0.5).setStrokeStyle(3, 0x4a3b25, 1);
  const fill = scene.add.rectangle(2, 0, Math.max(0, (w - 4) * p), h - 6, color).setOrigin(0, 0.5);
  // «Стекло» трубки: светлая полоса по верхней трети — полоса читается объёмной, а не плоской плашкой.
  // Индекс 1 — по-прежнему заливка (Поручения и авто-прохождение двигают её ширину сами).
  const glass = scene.add.rectangle(2, -(h - 6) / 4, w - 4, Math.max(2, (h - 6) / 3), 0xffffff, 0.16).setOrigin(0, 0.5);
  // Полоса с ключом доезжает до нового значения от прошлого показанного (при первом показе за сессию — от нуля).
  const from = opts.key ? barFrom(opts.key, p) : null;
  if (from !== null) {
    const full = Math.max(0, w - 4);
    fill.width = full * Phaser.Math.Clamp(from, 0, 1);
    scene.tweens.add({ targets: fill, width: full * p, delay: opts.delay ?? 120, duration: 450, ease: 'Cubic.easeOut' });
  }
  return scene.add.container(x, y, [back, fill, glass]);
}

// ———————————————————————————————————————— Плашки и мелкие компоненты (§4.7) ————————————————————————————————————————

/**
 * Тон компонента (чип, тег, тост, дельта стата) → цвет роли COLOR. neutral — вторичный текст, без акцента.
 * rarity-цвета — у рамок героев/предметов (RARITY), не здесь.
 */
export type Tone = 'neutral' | 'accent' | 'positive' | 'negative' | 'warning' | 'info' | 'gold' | 'gem';
export const TONE_COLOR: Readonly<Record<Tone, string>> = {
  neutral: COLOR.textSecondary,
  accent: COLOR.accent,
  positive: COLOR.positive,
  negative: COLOR.negative,
  warning: COLOR.warning,
  info: COLOR.info,
  gold: COLOR.gold,
  gem: COLOR.gem,
};

/** Смесь двух цветов #rrggbb (t = 0 — a, 1 — b): тонированные подложки без полупрозрачности (не просвечивает арт). */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1, 7), 16);
  const pb = parseInt(b.slice(1, 7), 16);
  const ch = (sh: number) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** Плоская скруглённая плашка: заливка, необязательная рамка и блик по верхней кромке. */
export interface PlateSpec {
  fill: string;
  /** Прозрачность заливки (поверхность «без рамки» — 0.85). */
  alpha?: number;
  border?: string;
  borderW?: number;
  /** Радиус (R.*); больше половины высоты не бывает — так получается «таблетка». */
  r: number;
  /** Светлая линия по верхней кромке (0…1) — «поднятая» поверхность. */
  hl?: number;
}

/** Радиус плашки w×h: не больше половины меньшей стороны (с запасом под 9-slice). */
export function plateRadius(w: number, h: number, r: number): number {
  return Math.max(2, Math.min(r, Math.floor(Math.min(w, h) / 2) - 2));
}

/** Ключ кэша текстуры плашки (одна canvas-текстура на сочетание — для всех сцен). */
export function plateKey(spec: PlateSpec): string {
  return `ui_plate_${spec.fill}_${spec.alpha ?? 1}_${spec.border ?? '-'}_${spec.border ? (spec.borderW ?? 3) : 0}_${spec.r}_${spec.hl ?? 0}`;
}

function plateTexture(scene: Phaser.Scene, spec: PlateSpec): { key: string; k: number } {
  const key = plateKey(spec);
  const k = spec.r + 2;
  if (scene.textures.exists(key)) return { key, k };
  const size = 2 * k + 2;
  const ct = scene.textures.createCanvas(key, size, size);
  if (!ct) return { key, k };
  const ctx = ct.getContext();
  const path = (inset: number, r: number) => {
    const x = 1 + inset;
    const s = size - 2 - inset * 2;
    ctx.beginPath();
    ctx.moveTo(x + r, x);
    ctx.arcTo(x + s, x, x + s, x + s, r);
    ctx.arcTo(x + s, x + s, x, x + s, r);
    ctx.arcTo(x, x + s, x, x, r);
    ctx.arcTo(x, x, x + s, x, r);
    ctx.closePath();
  };
  ctx.globalAlpha = spec.alpha ?? 1;
  path(0, spec.r);
  ctx.fillStyle = spec.fill;
  ctx.fill();
  ctx.globalAlpha = 1;
  const bw = spec.border ? (spec.borderW ?? 3) : 0;
  if (bw) {
    path(bw / 2, Math.max(1, spec.r - bw / 2));
    ctx.lineWidth = bw;
    ctx.strokeStyle = spec.border as string;
    ctx.stroke();
  }
  if (spec.hl) {
    ctx.strokeStyle = `rgba(255,240,210,${spec.hl})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(1 + spec.r, 1 + bw + 1);
    ctx.lineTo(size - 1 - spec.r, 1 + bw + 1);
    ctx.stroke();
  }
  ct.refresh();
  return { key, k };
}

/** Плашка w×h с центром (x, y) — 9-slice из кэшированной canvas-текстуры (один объект, батчится). */
export function plate(scene: Phaser.Scene, x: number, y: number, w: number, h: number, spec: PlateSpec): Panel {
  const r = plateRadius(w, h, spec.r);
  const { key, k } = plateTexture(scene, { ...spec, r });
  return slicedPanel(scene, x, y, key, undefined, w, h, k, k, k, k);
}

/**
 * Поверхности (§3 п. 5): surface — без рамки (заливка 85 %), raised — поднятая карточка (рамка бронзой, блик),
 * sunken — поле/пустой слот. TODO(skin.ts, агент C): заменить текстурами скина трёх поверхностей, когда появятся.
 */
export const SURFACE: Readonly<Record<'surface' | 'raised' | 'sunken', Omit<PlateSpec, 'r'>>> = {
  surface: { fill: COLOR.surface, alpha: 0.88 },
  raised: { fill: COLOR.surfaceRaised, alpha: 0.96, border: COLOR.border, borderW: 3, hl: 0.12 },
  sunken: { fill: COLOR.surfaceSunken, alpha: 0.92, border: '#2e2a24', borderW: 2 },
};

/** Иконка компонента: id иконки RO ('gold', 'gems', 'scrolls', предмет), имя контурной иконки скина ('star'), ключ текстуры, 'k:<кадр Kenney>' или своя фабрика. */
export type IconSpec = string | ((scene: Phaser.Scene, x: number, y: number, size: number) => Phaser.GameObjects.GameObject) | null | undefined;

type Placed = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform;

/** Иконка по IconSpec размером ≈ size (контурные иконки скина красятся tint). null — нечего показать. */
export function iconOf(scene: Phaser.Scene, x: number, y: number, spec: IconSpec, size: number, tint?: string): Placed | null {
  if (!spec) return null;
  if (typeof spec === 'function') return spec(scene, x, y, size) as Placed;
  const ro = roIconImage(scene, x, y, spec, size);
  if (ro) return ro;
  const skin = `skin_ico_${spec}`;
  if (scene.textures.exists(skin)) {
    const img = scene.add.image(x, y, skin).setDisplaySize(size, size);
    return tint ? img.setTint(parseInt(tint.slice(1, 7), 16)) : img;
  }
  if (spec.startsWith('k:')) return icon(scene, x, y, spec.slice(2), size);
  if (scene.textures.exists(spec)) {
    const img = scene.add.image(x, y, spec);
    return img.setScale(size / Math.max(img.width, img.height));
  }
  return null;
}

/** Число с пробелами по разрядам (неразрывными): 34617 → «34 617». */
export function groupNum(n: number): string {
  const s = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return n < 0 ? `−${s}` : s;
}

/** Подпись разницы: +12 зелёным, −5 красным; 0 и пустая строка — null (разницы не показываем). */
export function formatDelta(d: number | string | undefined | null): { text: string; tone: Tone } | null {
  if (d === undefined || d === null || d === '' || d === 0) return null;
  if (typeof d === 'number') return { text: d > 0 ? `+${groupNum(d)}` : groupNum(d), tone: d > 0 ? 'positive' : 'negative' };
  const neg = /^[-−]/.test(d);
  return { text: neg ? d.replace(/^-/, '−') : d.startsWith('+') ? d : `+${d}`, tone: neg ? 'negative' : 'positive' };
}

/** Размеры чипа: m — награды, цены; s — плотные строки. */
const CHIP = { m: { h: 72, icon: 48, font: T.body, pad: 20 }, s: { h: 56, icon: 40, font: T.caption, pad: 16 } } as const;

/** Описание чипа (для rewardRow). */
export interface ChipSpec {
  icon?: IconSpec;
  value: string | number;
  tone?: Tone;
}

/**
 * Чип «иконка + число» (награда, цена, мощь): тёмная «таблетка», число жирным цветом тона (neutral — основной текст).
 * Контейнер с центром (x, y); ширина — container.width. opts.bg = false — без подложки (внутри своей плашки);
 * opts.align — x — левый/правый край вместо центра.
 */
export function chip(
  scene: Phaser.Scene,
  x: number,
  y: number,
  iconSpec: IconSpec,
  value: string | number,
  tone: Tone = 'neutral',
  opts: { size?: 's' | 'm'; bg?: boolean; align?: 'center' | 'left' | 'right' } = {},
): Phaser.GameObjects.Container {
  const m = CHIP[opts.size ?? 'm'];
  const color = tone === 'neutral' ? COLOR.textPrimary : TONE_COLOR[tone];
  const label = text(scene, 0, 0, typeof value === 'number' ? groupNum(value) : value, m.font, color, { fontStyle: 'bold' }).setOrigin(0, 0.5);
  const ic = iconOf(scene, 0, 0, iconSpec, m.icon, color);
  const bg = opts.bg !== false;
  const pad = bg ? m.pad : 0;
  const iconW = ic ? m.icon + S.xxs : 0;
  const w = Math.round(pad + iconW + label.width + pad + (ic && bg ? -4 : 0));
  const left = -w / 2 + pad;
  if (ic) ic.setPosition(left + m.icon / 2 - (bg ? 4 : 0), 0);
  label.setX(left + iconW - (ic && bg ? 4 : 0));
  const parts: Phaser.GameObjects.GameObject[] = [];
  if (bg) parts.push(plate(scene, 0, 0, w, m.h, { ...SURFACE.sunken, border: mixHex(COLOR.surfaceSunken, tone === 'neutral' ? COLOR.border : TONE_COLOR[tone], 0.45), r: R.pill }));
  if (ic) parts.push(ic);
  parts.push(label);
  const cx = opts.align === 'left' ? x + w / 2 : opts.align === 'right' ? x - w / 2 : x;
  return scene.add.container(cx, y, parts).setSize(w, m.h);
}

/**
 * Ряд наград-чипов по центру x (§3 п. 4: иконка + число вместо фразы). Не влезает в maxW — чипы мельче (s), потом
 * перенос на следующую строку. Контейнер; размер — container.width/height, y — центр первой строки.
 * opts.align = 'left' — x — левый край, каждая строка (и перенесённая) начинается от него (§3 п. 6).
 */
export function rewardRow(
  scene: Phaser.Scene,
  x: number,
  y: number,
  items: ChipSpec[],
  opts: { maxW?: number; size?: 's' | 'm'; gap?: number; bg?: boolean; align?: 'center' | 'left' } = {},
): Phaser.GameObjects.Container {
  const left = opts.align === 'left';
  const maxW = opts.maxW ?? 1080 - 2 * S.l;
  const gap = opts.gap ?? S.xs;
  const row = scene.add.container(x, y);
  const build = (size: 's' | 'm') => {
    row.removeAll(true);
    return items.map((it) => chip(scene, 0, 0, it.icon, it.value, it.tone ?? 'neutral', { size, bg: opts.bg }));
  };
  let size: 's' | 'm' = opts.size ?? 'm';
  let chips = build(size);
  const total = (cs: Phaser.GameObjects.Container[]) => cs.reduce((n, c) => n + c.width, 0) + gap * Math.max(0, cs.length - 1);
  if (total(chips) > maxW && size === 'm' && !opts.size) {
    chips.forEach((c) => c.destroy());
    size = 's';
    chips = build(size);
  }
  // Раскладка по строкам (жадно), каждая строка — по центру (или от левого края).
  const lines: Phaser.GameObjects.Container[][] = [[]];
  let lw = 0;
  for (const c of chips) {
    const add = (lines[lines.length - 1].length ? gap : 0) + c.width;
    if (lw + add > maxW && lines[lines.length - 1].length) {
      lines.push([]);
      lw = 0;
    }
    lines[lines.length - 1].push(c);
    lw += (lines[lines.length - 1].length > 1 ? gap : 0) + c.width;
  }
  const h = CHIP[size].h;
  let width = 0;
  lines.forEach((line, i) => {
    const lwid = total(line);
    width = Math.max(width, lwid);
    let cx = left ? 0 : -lwid / 2;
    for (const c of line) {
      c.setPosition(cx + c.width / 2, i * (h + S.xs));
      cx += c.width + gap;
    }
    row.add(line);
  });
  return row.setSize(width, lines.length * h + (lines.length - 1) * S.xs);
}

/**
 * Тег — маленькая плашка-статус («БОСС», «Новый», «×2»): T.caption жирным цветом тона на тонированной подложке.
 * opts.solid — заливка цветом тона и тёмная подпись (самое заметное: «БОСС»). Центр (x, y); ширина — container.width.
 */
export function tag(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  tone: Tone = 'neutral',
  opts: { solid?: boolean; align?: 'center' | 'left' | 'right' } = {},
): Phaser.GameObjects.Container {
  const c = TONE_COLOR[tone];
  const t = text(scene, 0, 0, label, T.caption, opts.solid ? COLOR.onAccent : c, { fontStyle: 'bold' });
  const h = 52;
  const w = Math.max(h, Math.round(t.width + 2 * S.xs));
  const bg = opts.solid
    ? plate(scene, 0, 0, w, h, { fill: c, r: R.s, hl: 0.25 })
    : plate(scene, 0, 0, w, h, { fill: mixHex(COLOR.surfaceSunken, c, 0.18), alpha: 0.95, border: mixHex(COLOR.surfaceSunken, c, 0.55), borderW: 2, r: R.s });
  const cx = opts.align === 'left' ? x + w / 2 : opts.align === 'right' ? x - w / 2 : x;
  return scene.add.container(cx, y, [bg, t]).setSize(w, h);
}

/**
 * Стат: подпись (T.caption, вторичный) и значение (жирное) с необязательной разницей (+12 зелёным, −5 красным).
 * С opts.w — строка шириной w: подпись слева, значение справа (центр строки — x). Без w — столбик: значение
 * (T.heading) над подписью; opts.align — по центру x или от левого края x.
 */
export function stat(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  value: string | number,
  opts: { delta?: number | string | null; w?: number; align?: 'center' | 'left'; tone?: Tone } = {},
): Phaser.GameObjects.Container {
  const val = typeof value === 'number' ? groupNum(value) : value;
  const vColor = opts.tone && opts.tone !== 'neutral' ? TONE_COLOR[opts.tone] : COLOR.textPrimary;
  const d = formatDelta(opts.delta);
  const c = scene.add.container(x, y);
  if (opts.w) {
    const w = opts.w;
    const l = text(scene, -w / 2, 0, label, T.caption, COLOR.textSecondary).setOrigin(0, 0.5);
    let right = w / 2;
    const parts: Phaser.GameObjects.GameObject[] = [l];
    if (d) {
      const dt = text(scene, right, 0, d.text, T.caption, TONE_COLOR[d.tone], { fontStyle: 'bold' }).setOrigin(1, 0.5);
      right -= dt.width + S.xxs;
      parts.push(dt);
    }
    const v = text(scene, right, 0, val, T.body, vColor, { fontStyle: 'bold' }).setOrigin(1, 0.5);
    parts.push(v);
    ellipsize(l, Math.max(40, right - v.width - S.xs + w / 2));
    return c.add(parts).setSize(w, T.body * 1.3);
  }
  const left = opts.align === 'left';
  const v = text(scene, 0, -T.caption * 0.55, val, T.heading, vColor, { fontStyle: 'bold' }).setOrigin(left ? 0 : 0.5, 0.5);
  const l = text(scene, 0, T.heading * 0.6, label, T.caption, COLOR.textSecondary).setOrigin(left ? 0 : 0.5, 0.5);
  c.add([v, l]);
  if (d) {
    const dt = text(scene, 0, v.y, d.text, T.caption, TONE_COLOR[d.tone], { fontStyle: 'bold' }).setOrigin(0, 0.5);
    if (left) dt.setX(v.width + S.xxs);
    else {
      // Пара «значение разница» по центру x.
      const both = v.width + S.xxs + dt.width;
      v.setX(-both / 2 + v.width / 2);
      dt.setX(-both / 2 + v.width + S.xxs);
    }
    c.add(dt);
  }
  return c.setSize(Math.max(v.width, l.width), T.heading + T.caption + S.xxs);
}

/** Описание строки списка. */
export interface ListRowSpec {
  /** Иконка слева в утопленном квадрате (IconSpec или готовый объект). */
  icon?: IconSpec | Placed;
  title: string;
  /** Вторая строка (вторичный текст, одна строка, многоточие). */
  subtitle?: string;
  /** Полноширинный переносимый текст под заголовком/иконкой/действием (для сравнений снаряжения). */
  subtitleFullWidth?: boolean;
  /** Справа: строка (жирная, цвет trailingTone) или объект (кнопка, чип, тег — по его width). */
  trailing?: string | Placed;
  trailingTone?: Tone;
  /** Высота строки; по умолчанию 112 (без подзаголовка) / 136. */
  h?: number;
  /** Поднятая карточка (рамка) вместо плоской поверхности. По умолчанию — поверхность без рамки (§3 п. 5). */
  raised?: boolean;
  /** Нажатие по строке (в ScrollArea — обернуть в area.tap(fn)). */
  onTap?: () => void;
  /** Приглушить (получено, закрыто): иконка и заголовок бледнее. */
  dim?: boolean;
}

/**
 * Строка списка (Почта, Задания, Достижения, Инвентарь): иконка, заголовок и подзаголовок по левому краю, справа —
 * действие или значение. Контейнер с центром (x, y) шириной w; высота — container.height.
 * Нажатие — pressable() по подложке (затемнение), если задан onTap.
 */
export function listRow(scene: Phaser.Scene, x: number, y: number, w: number, spec: ListRowSpec): Phaser.GameObjects.Container {
  const h = spec.h ?? (spec.subtitleFullWidth ? 256 : spec.subtitle ? 136 : 112);
  const c = scene.add.container(x, y).setSize(w, h);
  const bg = plate(scene, 0, 0, w, h, { ...(spec.raised ? SURFACE.raised : SURFACE.surface), r: R.m });
  c.add(bg);
  const headerY = spec.subtitleFullWidth ? -h / 2 + 64 : 0;
  let left = -w / 2 + S.s;
  const box = Math.min(h - 2 * S.xs, 104);
  if (spec.icon) {
    const ix = left + box / 2;
    c.add(plate(scene, ix, headerY, box, box, { ...SURFACE.sunken, r: R.s }));
    const ic =
      typeof spec.icon === 'object' && spec.icon !== null
        ? (spec.icon as Placed).setPosition(ix, headerY)
        : iconOf(scene, ix, headerY, spec.icon as IconSpec, Math.round(box * 0.7), COLOR.textSecondary);
    if (ic) {
      if (spec.dim && 'setAlpha' in ic) (ic as unknown as Phaser.GameObjects.Image).setAlpha(0.5);
      c.add(ic);
    }
    left += box + S.s;
  }
  let right = w / 2 - S.m;
  if (spec.trailing !== undefined) {
    if (typeof spec.trailing === 'string') {
      const tone = spec.trailingTone ?? 'neutral';
      const tt = text(scene, right, headerY, spec.trailing, T.body, tone === 'neutral' ? COLOR.textPrimary : TONE_COLOR[tone], { fontStyle: 'bold' }).setOrigin(1, 0.5);
      c.add(tt);
      right -= tt.width + S.s;
    } else {
      const o = spec.trailing;
      const ow = ((o as unknown as { width?: number }).width ?? 0) * Math.abs(o.scaleX || 1);
      o.setPosition(right - ow / 2, headerY);
      c.add(o);
      right -= ow + S.s;
    }
  }
  const maxW = Math.max(60, right - left);
  const title = text(scene, left, spec.subtitleFullWidth ? headerY : spec.subtitle ? -T.caption * 0.62 : 0, spec.title, T.body, spec.dim ? COLOR.textTertiary : COLOR.textPrimary, { fontStyle: 'bold' }).setOrigin(0, 0.5);
  ellipsize(title, maxW);
  c.add(title);
  if (spec.subtitle) {
    const sub = spec.subtitleFullWidth
      ? text(scene, -w / 2 + S.s, headerY + 64, spec.subtitle, T.caption, spec.dim ? COLOR.textTertiary : COLOR.textSecondary, { align: 'left', wordWrap: { width: w - 2 * S.s }, lineSpacing: 0 }).setOrigin(0, 0)
      : text(scene, left, T.body * 0.62, spec.subtitle, T.caption, spec.dim ? COLOR.textTertiary : COLOR.textSecondary).setOrigin(0, 0.5);
    if (!spec.subtitleFullWidth) ellipsize(sub, maxW);
    c.add(sub);
  }
  if (spec.onTap) pressable(scene, bg, w, h, spec.onTap);
  return c;
}

/** Переключатель вкладок внутри экрана. */
export interface SegmentedView {
  container: Phaser.GameObjects.Container;
  /** Выбранная вкладка. */
  readonly index: number;
  /** Выбрать вкладку (emit — вызвать onChange, как при нажатии). */
  select: (i: number, emit?: boolean) => void;
}

/** Вкладка segmented: подпись, значок слева от неё, точка «есть что забрать», замок «ещё закрыто». */
export interface SegmentSpec {
  label: string;
  /** Значок слева от подписи (IconSpec: контурные иконки скина красятся цветом подписи). */
  icon?: IconSpec;
  /** Красная точка в правом верхнем углу вкладки (§2.4: точка, не число). */
  dot?: boolean;
  /** Замок в правом верхнем углу и приглушённая подпись (вкладку всё равно можно открыть — посмотреть, что там). */
  lock?: boolean;
}

/** Размер значка в подписи вкладки и замка в углу. */
const SEG_ICON = 40;
const SEG_LOCK = 26;

/**
 * Вкладки внутри экрана одного вида (§4.7, вместо четырёх разных): утопленная дорожка, выбранная вкладка —
 * поднятая плашка с золотой подписью, которая переезжает за M.base. Центр (x, y), ширина w. Цель нажатия ≥ TOUCH.
 * Вкладка — строка или SegmentSpec (значок, точка, замок). onChange — только при смене вкладки (повторное нажатие на
 * выбранную ничего не делает). Точка выбранной вкладки гаснет (её содержимое уже на экране).
 */
export function segmented(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  options: (string | SegmentSpec)[],
  selected: number,
  onChange: (i: number) => void,
  opts: { h?: number } = {},
): SegmentedView {
  const h = opts.h ?? 88;
  const inset = 6;
  const specs: SegmentSpec[] = options.map((o) => (typeof o === 'string' ? { label: o } : o));
  const n = Math.max(1, specs.length);
  const segW = (w - 2 * inset) / n;
  const c = scene.add.container(x, y).setSize(w, Math.max(h, TOUCH));
  c.add(plate(scene, 0, 0, w, h, { ...SURFACE.sunken, r: R.m }));
  const xs = specs.map((_, i) => -w / 2 + inset + segW * (i + 0.5));
  let index = Phaser.Math.Clamp(selected, 0, n - 1);
  const ind = plate(scene, xs[index], 0, segW, h - 2 * inset, { fill: COLOR.surfaceRaised, border: mixHex(COLOR.border, COLOR.accent, 0.45), borderW: 2, r: R.m - 4, hl: 0.14 });
  c.add(ind);
  const colorOf = (i: number) => (i === index ? COLOR.title : specs[i].lock ? COLOR.textTertiary : COLOR.textSecondary);
  const icons: (Placed | null)[] = [];
  const labels = specs.map((sp, i) => {
    const t = text(scene, xs[i], 0, sp.label, T.caption, colorOf(i), { fontStyle: 'bold' });
    const ic = sp.icon ? iconOf(scene, 0, 0, sp.icon, SEG_ICON, colorOf(i)) : null;
    icons.push(ic);
    ellipsize(t, segW - S.xs - (ic ? SEG_ICON + S.xxs : 0));
    if (ic) {
      // Значок и подпись — одной группой по центру вкладки.
      const gw = SEG_ICON + S.xxs + t.width;
      ic.setPosition(xs[i] - gw / 2 + SEG_ICON / 2, 0);
      t.setX(xs[i] + (SEG_ICON + S.xxs) / 2);
      c.add(ic);
    }
    c.add(t);
    if (sp.lock) {
      const lk = iconOf(scene, xs[i] + segW / 2 - S.xs - SEG_LOCK / 2 + 4, -h / 2 + inset + SEG_LOCK / 2 + 4, 'lock', SEG_LOCK, COLOR.textTertiary);
      if (lk) c.add(lk.setName('segLock'));
    }
    return t;
  });
  const dots = specs.map((sp, i) => {
    if (!sp.dot) return null;
    const r = BADGE.dot / 2;
    const d = scene.add
      .circle(xs[i] + segW / 2 - S.xs - r + 4, -h / 2 + inset + r - 2, r, COLOR_N.badge)
      .setStrokeStyle(3, COLOR_N.bg, 0.9)
      .setName('segDot')
      .setVisible(i !== index);
    c.add(d);
    heartbeat(scene, d);
    return d;
  });
  const recolor = () =>
    labels.forEach((t, k) => {
      t.setColor(colorOf(k));
      const ic = icons[k] as (Placed & { setTint?: (c: number) => unknown }) | null;
      if (ic?.setTint && typeof specs[k].icon === 'string' && scene.textures.exists(`skin_ico_${specs[k].icon}`)) ic.setTint(parseInt(colorOf(k).slice(1, 7), 16));
    });
  const view: SegmentedView = {
    container: c,
    get index() {
      return index;
    },
    select: (i, emit = false) => {
      if (i === index || i < 0 || i >= n || !c.scene) return;
      index = i;
      recolor();
      dots[i]?.setVisible(false);
      scene.tweens.killTweensOf(ind);
      if (juiceOn()) scene.tweens.add({ targets: ind, x: xs[i], duration: M.base, ease: E.out });
      else ind.setX(xs[i]);
      if (emit) onChange(i);
    },
  };
  const ready = debounce();
  specs.forEach((_, i) => {
    const zone = scene.add.zone(xs[i], 0, segW, Math.max(h, TOUCH)).setInteractive({ useHandCursor: true });
    let armed = false;
    const release = () => (armed = false);
    zone.on('pointerdown', () => (armed = true));
    zone.on('pointerout', release);
    zone.on('pointerup', () => {
      if (!armed) return;
      armed = false;
      if (i === index || !ready()) return;
      sfx('ui_tab');
      haptic('tab');
      view.select(i, true);
    });
    scene.input.on(CANCEL_PRESS, release);
    zone.once(Phaser.GameObjects.Events.DESTROY, () => scene.input.off(CANCEL_PRESS, release));
    c.add(zone);
  });
  return view;
}

/**
 * Кнопка «i» (§4.7): правила и подробности — за ней, а не постоянным текстом на экране. Кружок size (64) с
 * бронзовой рамкой, цель нажатия TOUCH. Контейнер с центром (x, y).
 */
export function infoButton(scene: Phaser.Scene, x: number, y: number, onTap: () => void, opts: { size?: number } = {}): Phaser.GameObjects.Container {
  const size = opts.size ?? 64;
  const bg = plate(scene, 0, 0, size, size, { fill: COLOR.surfaceRaised, border: mixHex(COLOR.border, COLOR.accent, 0.35), borderW: 3, r: R.pill, hl: 0.12 });
  const t = text(scene, 0, 1, 'i', Math.round(size * 0.66), COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' });
  const c = scene.add.container(x, y, [bg, t]).setSize(TOUCH, TOUCH).setName('infoButton');
  c.setInteractive({ useHandCursor: true, hitArea: new Phaser.Geom.Rectangle(0, 0, TOUCH, TOUCH), hitAreaCallback: Phaser.Geom.Rectangle.Contains });
  let armed = false;
  const ready = debounce();
  const set = (p: boolean) => {
    armed = p;
    pressFeedback(scene, c, p);
  };
  const release = () => {
    if (armed) set(false);
  };
  c.on('pointerdown', () => set(true));
  c.on('pointerout', release);
  c.on('pointerup', () => {
    if (!armed) return;
    set(false);
    if (!ready()) return;
    sfx('ui_tap');
    haptic('tap');
    onTap();
  });
  scene.input.on('pointerup', release);
  scene.input.on(CANCEL_PRESS, release);
  c.once(Phaser.GameObjects.Events.DESTROY, () => {
    scene.input.off('pointerup', release);
    scene.input.off(CANCEL_PRESS, release);
  });
  return c;
}

/**
 * R/S. Указатель подсказки на цель (x, y): рамка (один пульс), стрелка (один кивок) и плашка с одной строкой.
 * side — предпочтительная сторона плашки ('auto' — без предпочтения). Сторону и сдвиг вбок выбирает placeCallout
 * (hintLayout.ts), чтобы плашка не закрывала ни элементы управления сцены (все интерактивные объекты, кроме самой цели,
 * плюс opts.avoid и подписи, начинающиеся с opts.avoidText), ни данные — видимые подписи и числа (sceneObstacles).
 * target — размер цели. Рамка и стрелка ничего не перехватывают: нажатия проходят к кнопке под ними. opts.skip —
 * плашку можно коснуться (в углу «✕»): подсказка скрывается и больше не показывается (обучение пропускаемое).
 *
 * Правила (отчёты тестировщиков NB-03/04, MT-07, LT-10, NB-13; ui-polish-research §3 п. 3 — «пульс цели один раз»):
 * - одна подсказка на экране: новая убирает прежнюю;
 * - раскладка считается на следующем кадре, когда сцена достроена (вкладки и кнопки, созданные после вызова, тоже
 *   обходятся), и ждёт, пока закроются сюжетный диалог и баннер «Новая функция!» — под ними подсказку не видно;
 * - плашка никогда не закрывает кнопки: не влезает в строку — переносится уже; нет места и с данными — может лечь на
 *   подписи (но не на кнопки); нигде нет места — остаются рамка и стрелка (если она ничего не закрывает), без текста.
 */
export function hintPointer(
  scene: Phaser.Scene,
  x: number,
  y: number,
  message: string,
  side: HintSide | 'auto',
  target: { w: number; h: number },
  opts: { avoid?: Rect[]; avoidText?: string[]; skip?: () => void } = {},
): Phaser.GameObjects.Container {
  // Одна подсказка за раз: прежняя (другой шаг или та же после перерисовки) уходит.
  for (const o of [...scene.children.list]) if (o.name === 'hint') o.destroy();
  const c = scene.add.container(0, 0).setDepth(8000).setName('hint');
  const build = () => {
    if (!c.scene || !c.active) return;
    // Сюжетный диалог или баннер открытия поверх — подождать, пока их закроют (NB-13).
    if (scene.children.getByName('dialogue') || scene.children.getByName('unlockBanner')) {
      scene.events.once(Phaser.Scenes.Events.POST_UPDATE, build);
      return;
    }
    drawHint(scene, c, x, y, message, side, target, opts);
  };
  scene.events.once(Phaser.Scenes.Events.POST_UPDATE, build);
  return c;
}

function drawHint(
  scene: Phaser.Scene,
  c: Phaser.GameObjects.Container,
  x: number,
  y: number,
  message: string,
  side: HintSide | 'auto',
  target: { w: number; h: number },
  opts: { avoid?: Rect[]; avoidText?: string[]; skip?: () => void },
): void {
  const w = GAME_W;
  const h = GAME_H;
  // T3-13: рамка (и её пульс) не выходит за поле и не уходит под нижний край: у края цель обводится плотнее.
  const room = Math.max(0, Math.min(x - target.w / 2, w - x - target.w / 2, y - target.h / 2 - HEADER_H, h - y - target.h / 2));
  const pad = Math.min(24, Math.max(8, room * 2 - 6));
  const grow = Math.max(0, Math.min(40, room * 2 - pad - 8));
  const ring = scene.add.rectangle(x, y, target.w + pad, target.h + pad).setStrokeStyle(8, TINT.gold, 1);
  // Один пульс (§3 п. 3): рамка вздыхает и остаётся на месте; у края, где расти некуда, — мигает.
  if (juiceOn()) {
    scene.tweens.add(
      grow > 0
        ? { targets: ring, scaleX: 1 + grow / (target.w + pad), scaleY: 1 + grow / (target.h + pad), yoyo: true, duration: M.emphasis, ease: E.inOut }
        : { targets: ring, alpha: 0.35, yoyo: true, duration: M.emphasis, ease: E.inOut },
    );
  }
  c.add(ring);
  const t = text(scene, 0, 0, message, FS.body, C.title, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4, wordWrap: { width: w - 200 } });
  const closeW = opts.skip ? 44 : 0;
  const tgt = { x, y, ...target };
  const obstacles = sceneObstacles(scene.children.list as unknown as SceneNode[], tgt, { w, h });
  const controls = [...obstacles.controls, ...textRects(scene, opts.avoidText ?? []), ...(opts.avoid ?? [])];
  // Плашка в одну строку не везде помещается между кнопками (итоги: «Дальше» у правого края, слева — «Авто»):
  // тогда та же строка переносится уже — узкая плашка встаёт рядом с целью, ничего не закрывая. Сначала — не закрывая
  // и данные (подписи, числа); не вышло — хотя бы не кнопки.
  let plan: CalloutPlan | null = null;
  let wrap = w - 200;
  for (const avoid of [[...controls, ...obstacles.texts], controls]) {
    for (const ww of [w - 200, 640, 520, 420, 340]) {
      t.setWordWrapWidth(ww);
      const p = placeCallout(tgt, { w: Math.min(w - 60, t.width + 60 + closeW), h: t.height + 22 }, {
        prefer: side === 'auto' ? undefined : side,
        avoid,
        top: HEADER_H + 8,
        bottom: h,
        width: w,
      });
      if (p.overlap === 0) {
        plan = p;
        wrap = ww;
        break;
      }
    }
    if (plan) break;
  }
  t.setWordWrapWidth(wrap);
  const g = HINT_GEOM;
  const arrowAt = (sd: HintSide) => {
    const ay = arrowRect(tgt, sd).y + g.arrowH / 2;
    const dir = sd === 'above' ? -1 : 1;
    // Стрелка остриём к цели: над целью — вниз, под целью — вверх; один кивок к цели.
    const arrow =
      sd === 'above'
        ? scene.add.triangle(x, ay, 0, 0, g.arrowW, 0, g.arrowW / 2, g.arrowH, TINT.gold)
        : scene.add.triangle(x, ay, 0, g.arrowH, g.arrowW, g.arrowH, g.arrowW / 2, 0, TINT.gold);
    arrow.setStrokeStyle(4, TINT.header);
    if (juiceOn()) scene.tweens.add({ targets: arrow, y: ay - dir * 10, yoyo: true, duration: M.slow, ease: E.inOut });
    c.add(arrow);
  };
  if (!plan) {
    // Места для плашки нет — только рамка и стрелка (где она ничего не закрывает); без всплывающего текста.
    t.destroy();
    const free = (['above', 'below'] as HintSide[]).find((sd) => {
      const a = arrowRect(tgt, sd);
      return a.y >= HEADER_H && a.y + a.h <= h && controls.every((r) => overlapArea(a, r) === 0);
    });
    if (free) arrowAt(free);
    c.setData('hintBox', { x, y, w: 0, h: 0 }).setData('hintOverlap', 0).setData('hintSide', free ?? 'none').setData('hintMode', 'ring');
    return;
  }
  arrowAt(plan.side);
  const b = plan.box;
  const bg = plate(scene, b.x + b.w / 2, b.y + b.h / 2, b.w, b.h, { fill: '#14120f', alpha: 0.94, border: COLOR.accent, borderW: 4, r: R.l });
  t.setPosition(b.x + b.w / 2 - closeW / 2, b.y + b.h / 2);
  c.add([bg, t]);
  if (opts.skip) {
    const skip = opts.skip;
    c.add(text(scene, b.x + b.w - 30, b.y + b.h / 2, '✕', FS.body, C.muted, { fontStyle: 'bold' }).setName('hintSkip'));
    bg.setInteractive({ useHandCursor: true }).on('pointerup', () => {
      skip();
      c.destroy();
    });
  }
  // Для e2e и отладки: где оказалась плашка и что она закрыла (кнопки — всегда 0; данные — hintOverText).
  const overText = obstacles.texts.reduce((n, r) => n + overlapArea(b, r), 0);
  c.setData('hintBox', b).setData('hintOverlap', plan.overlap).setData('hintOverText', overText).setData('hintSide', plan.side).setData('hintMode', 'box');
}

/** Подсказки, уже показанные в этом визите экрана (от create до shutdown): одна подсказка за визит. */
const visitHints = new WeakMap<Phaser.Scene, Set<HintId>>();

function visitOf(scene: Phaser.Scene): Set<HintId> {
  let set = visitHints.get(scene);
  if (!set) {
    const fresh = new Set<HintId>();
    set = fresh;
    visitHints.set(scene, fresh);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (visitHints.get(scene) === fresh) visitHints.delete(scene);
    });
  }
  return set;
}

/**
 * Подсказка обучения id (hints.ts): текст HINT_TEXT[id] (или opts.text), касание плашки — пропустить (markHint).
 * Одна подсказка за визит экрана; повторяющиеся (NAG_HINTS) — не больше NAG_LIMIT визитов подряд. Заглушённая —
 * null: вызывающий отмечает показ только для действительно видимой подсказки.
 */
export function tutorialHint(
  scene: Phaser.Scene,
  id: HintId,
  x: number,
  y: number,
  side: HintSide | 'auto',
  target: { w: number; h: number },
  opts: { avoid?: Rect[]; avoidText?: string[]; text?: string } = {},
): Phaser.GameObjects.Container | null {
  const visit = visitOf(scene);
  const where = scene.scene.key;
  // Одна подсказка за визит: шаг выполнен или пропущен — следующий шаг цепочки ждёт следующего захода на экран.
  // Повторная подсказка, висящая главами (вкладка «Герои»: опыт, трофеи), — не больше NAG_LIMIT заходов (hints.ts).
  if ((visit.size && !visit.has(id)) || (!visit.has(id) && hintNagged(id, where))) {
    return null;
  }
  if (!visit.has(id)) {
    visit.add(id);
    noteHintVisit(id, where);
  }
  return hintPointer(scene, x, y, opts.text ?? HINT_TEXT[id], side, target, { avoid: opts.avoid, avoidText: opts.avoidText, skip: () => markHint(id) }).setData('hintId', id);
}

/** Прямоугольники видимых подписей сцены, текст которых начинается с одной из строк (что плашка не должна закрывать). */
function textRects(scene: Phaser.Scene, prefixes: string[]): Rect[] {
  if (!prefixes.length) return [];
  const out: Rect[] = [];
  const walk = (list: Phaser.GameObjects.GameObject[], visible: boolean) => {
    for (const o of list) {
      const vis = visible && (o as unknown as { visible?: boolean }).visible !== false;
      if (o instanceof Phaser.GameObjects.Container) walk(o.list, vis);
      else if (vis && o instanceof Phaser.GameObjects.Text && prefixes.some((p) => o.text.startsWith(p))) {
        const r = o.getBounds();
        out.push({ x: r.x, y: r.y, w: r.width, h: r.height });
      }
    }
  };
  walk(scene.children.list, true);
  return out;
}

// ———————————————————————————————————————— Тосты ————————————————————————————————————————

/** Одновременно видно не больше стольких тостов в одной стопке; более старые уходят раньше срока. */
const TOAST_MAX = 3;
const TOAST_GAP = S.xs;
/**
 * Время показа тоста по умолчанию (§4.6; TODO(theme.ts): токены): обычный — 2000 мс + 30 мс на символ (длинное
 * сообщение успевают прочитать), ошибка — от 3000; не дольше max. Явный ms вызывающего главнее.
 */
export const TOAST_MS = { show: 2000, error: 3000, perChar: 30, max: 4500 } as const;
/** Тост выше всего, включая плашку онлайна (9500, online.ts) — поэтому выше Z.toast. */
const TOAST_DEPTH = 10000;

interface ToastEntry {
  c: Phaser.GameObjects.Container;
  h: number;
  message: string;
  count: number;
  label: Phaser.GameObjects.Text;
  hide: Phaser.Time.TimerEvent;
  gone: boolean;
}

/** Стопки тостов сцены (сверху и посреди экрана). Сцена перезапустилась — стопки новые (объекты уничтожены). */
const toastStacks = new WeakMap<Phaser.Scene, Record<ToastAt, ToastEntry[]>>();
/** Где стопка тостов: под шапкой, посреди экрана или в бою — под плашками ульт (их низ ≈ 844), над полем (BUG-191). */
export type ToastAt = 'top' | 'middle' | 'battle';
const BATTLE_TOAST_Y = 862;

/** Тон тоста по цвету, который передал вызывающий (старый API: цвет текста). */
export function toastTone(color: string): Tone {
  if (color === C.error || color === COLOR.negative) return 'negative';
  if (color === C.success || color === COLOR.positive) return 'positive';
  if (color === C.warning) return 'warning';
  if (color === C.info || color === C.gem) return 'info';
  return 'accent';
}

/** Сколько показывать тост без явного ms. */
export function toastDuration(message: string, error: boolean): number {
  return Math.min(TOAST_MS.max, (error ? TOAST_MS.error : TOAST_MS.show) + TOAST_MS.perChar * Math.max(0, message.length - 30));
}

/**
 * Всплывающее сообщение — «таблетка» под шапкой (не закрывает название и валюту), исчезает само.
 * Политика (§2, §3 п. 10): тост — только ошибка («нельзя: не хватает…») или результат, которого не видно на экране
 * (письмо ушло, награда попала в запас). Успех, видимый на месте (купили, надели, улучшили), — анимацией там же, без тоста.
 * Вид: тёмная плашка с цветной точкой и рамкой тона (ошибка — красная, успех — зелёная, остальное — золото), текст
 * основным цветом; вход M.fast сверху, выход M.base.
 * T4-13: несколько тостов подряд встают стопкой друг под другом; такое же сообщение, пока оно на экране,
 * не дублируется — у него появляется «×N» и продлевается показ.
 * at: 'middle' — посреди экрана: сверху и снизу у экрана главные кнопки, их тост не закрывает.
 */
export function toast(scene: Phaser.Scene, message: string, color: string = C.title, ms?: number, at: ToastAt = 'top'): void {
  let stacks = toastStacks.get(scene);
  if (!stacks) {
    stacks = { top: [], middle: [], battle: [] };
    toastStacks.set(scene, stacks);
  }
  const stack = (stacks[at] = stacks[at].filter((e) => !e.gone && e.c.scene));
  const tone = toastTone(color);
  const showMs = ms ?? toastDuration(message, tone === 'negative');
  const dismiss = (e: ToastEntry) => {
    if (e.gone) return;
    e.gone = true;
    e.hide.remove();
    const i = stack.indexOf(e);
    if (i >= 0) stack.splice(i, 1);
    if (e.c.scene) scene.tweens.add({ targets: e.c, alpha: 0, y: e.c.y - S.xs, duration: M.base, ease: E.in, onComplete: () => e.c.destroy() });
    layout();
  };
  const top = at === 'middle' ? GAME_H * 0.46 : at === 'battle' ? BATTLE_TOAST_Y : HEADER_H + S.xs;
  const layout = () => {
    // Сверху — от шапки вниз; посреди экрана — стопка по центру вокруг 46 % высоты.
    const total = stack.reduce((n, e) => n + e.h, 0) + TOAST_GAP * Math.max(0, stack.length - 1);
    let y = at === 'middle' ? top - total / 2 : top;
    for (const e of stack) {
      const cy = y + e.h / 2;
      if (e.c.scene) scene.tweens.add({ targets: e.c, y: cy, duration: M.base, ease: E.out });
      y += e.h + TOAST_GAP;
    }
  };
  // Ошибка — «нельзя», успех — мягкий колокольчик (награды звенят своими звуками, juice.ts).
  if (tone === 'negative') {
    sfx('ui_error');
    haptic('error');
  } else if (tone === 'positive') sfx('ui_notify');
  const same = stack.find((e) => e.message === message);
  if (same) {
    same.count++;
    same.label.setText(`${message} ×${same.count}`);
    same.hide.reset({ delay: showMs, callback: () => dismiss(same) });
    if (juiceOn() && same.c.scene) scene.tweens.add({ targets: same.c, scale: 1.04, duration: M.press, yoyo: true, ease: E.out });
    return;
  }
  const w = GAME_W;
  const toneColor = TONE_COLOR[tone];
  const dot = 16;
  const t = text(scene, 0, 0, message, T.body, COLOR.textPrimary, { wordWrap: { width: w - 2 * S.xxl - 2 * S.m - dot - S.xs } }).setOrigin(0, 0.5);
  const bgH = Math.round(t.height + 2 * S.xs + 4);
  // MT-17: плашка по ширине текста, а не во весь экран — меньше закрывает кнопки шапки и строку под ней
  // (касания она не ловит: кнопка под тостом нажимается).
  const bgW = Math.round(Math.min(w - 2 * S.xxl, t.width + 2 * S.m + dot + S.xs));
  const oneLine = t.height < T.body * 1.6;
  const bg = plate(scene, 0, 0, bgW, bgH, { fill: '#14120f', alpha: 0.95, border: mixHex('#14120f', toneColor, 0.6), borderW: 2, r: oneLine ? R.pill : R.l });
  const left = -bgW / 2 + S.m;
  const mark = scene.add.circle(left + dot / 2, oneLine ? 0 : -t.height / 2 + T.body * 0.65, dot / 2, parseInt(toneColor.slice(1, 7), 16));
  t.setX(left + dot + S.xs);
  const prevBottom = stack.reduce((n, e) => n + e.h + TOAST_GAP, 0);
  const y0 = (at === 'middle' ? top : top + prevBottom) + bgH / 2;
  const c = scene.add.container(w / 2, y0 - S.xs, [bg, mark, t]).setDepth(TOAST_DEPTH).setAlpha(0).setName('toast');
  scene.tweens.add({ targets: c, alpha: 1, y: y0, duration: M.fast, ease: E.out });
  const entry: ToastEntry = { c, h: bgH, message, count: 1, label: t, gone: false, hide: undefined as unknown as Phaser.Time.TimerEvent };
  entry.hide = scene.time.delayedCall(showMs, () => dismiss(entry));
  stack.push(entry);
  while (stack.length > TOAST_MAX) dismiss(stack[0]);
  layout();
}
