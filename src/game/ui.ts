import Phaser from 'phaser';
import { skinKey, sliceOf, tex } from './assets';
import { SKIN, SKIN_DARK_LABEL } from './skin';
import { FONT, HEADER_H } from './layout';
import { C, FS, TINT, TOUCH } from './theme';
import { HINT_GEOM, placeCallout, type HintSide, type Rect } from './hintLayout';

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

/** Kenney UI нарисован мелко: 9-slice строим в меньшем размере и увеличиваем, чтобы рамки были заметны. */
const UI_SCALE = 2.5;

export function text(
  scene: Phaser.Scene,
  x: number,
  y: number,
  value: string,
  size: number = FS.h2,
  color: string = C.text,
  style: Phaser.Types.GameObjects.Text.TextStyle = {},
): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, value, { fontFamily: FONT, fontSize: `${size}px`, color, align: 'center', ...style })
    .setOrigin(0.5);
}

/** 9-slice панель из манифеста (кадр атласа или картинка). */
export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, id: string, scale = UI_SCALE): Phaser.GameObjects.NineSlice {
  const t = tex(scene, id);
  const [l, r, tp, b] = sliceOf(id);
  // Текстуры скина нарисованы в игровых единицах — без увеличения; углы не больше половины размера.
  if (skinKey(scene, id)) {
    const k = Math.min(l, w / 2 - 1, h / 2 - 1);
    return scene.add.nineslice(x, y, t.key, t.frame, w, h, k, k, k, k);
  }
  return scene.add.nineslice(x, y, t.key, t.frame, w / scale, h / scale, l, r, tp, b).setScale(scale);
}

const DARK_TEXT = new Set(['ui_btn_speed', 'ui_btn_skip', 'k:buttonLong_beige', 'k:buttonLong_grey', 'k:buttonSquare_beige', 'k:buttonSquare_grey']);

/** Кнопка из 9-slice текстуры (или плейсхолдера) с подписью. */
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
  /** repeat — переключатель по кругу (скорость, FPS): быстрые повторные нажатия не глушим. */
  opts: { repeat?: boolean } = {},
): { container: Phaser.GameObjects.Container; setLabel: (s: string) => void; label: Phaser.GameObjects.Text } {
  const bg = panel(scene, 0, 0, w, h, textureId);
  const skin = skinKey(scene, textureId);
  // Скин: на золотой кнопке тёмная подпись, на тёмных плитках — кремовая (активная — золотая).
  const dark = skin ? SKIN_DARK_LABEL.has(skin) : DARK_TEXT.has(textureId);
  const color = skin ? (dark ? '#2a1c08' : skin === 'skin_btn_active' ? SKIN.goldLight : SKIN.cream) : dark ? C.ink : C.text;
  const t = text(scene, 0, -4, label, fontSize, color, {
    fontStyle: 'bold',
    stroke: dark || skin ? C.none : C.titleStroke,
    strokeThickness: dark || skin ? 0 : 5,
  });
  const container = scene.add.container(x, y, [bg, t]);
  // Цель нажатия не ниже TOUCH, даже если кнопка нарисована ниже.
  const hitH = Math.max(h, TOUCH);
  container.setSize(w, hitH).setInteractive({
    useHandCursor: true,
    hitArea: new Phaser.Geom.Rectangle(0, 0, w, hitH),
    hitAreaCallback: Phaser.Geom.Rectangle.Contains,
  });
  // armed: палец опустился именно на эту кнопку; отпускание без него (или после протяжки списка) — не клик.
  let armed = false;
  const ready = debounce();
  const setPressed = (p: boolean) => {
    armed = p;
    if (!bg.scene) return;
    const f = tex(scene, textureId, p);
    bg.setTexture(f.key, f.frame);
    t.setY(p ? 2 : -4);
    // Нажатая кнопка чуть «проседает» — видно, что касание принято.
    container.setScale(p ? 0.97 : 1);
  };
  const release = () => {
    if (armed) setPressed(false);
  };
  container.on('pointerdown', () => setPressed(true));
  container.on('pointerout', release);
  container.on('pointerup', () => {
    if (!armed) return;
    setPressed(false);
    if (opts.repeat || ready()) onClick();
  });
  // Отпустили вне кнопки или список начали тянуть — кнопка не должна остаться нажатой.
  scene.input.on('pointerup', release);
  scene.input.on(CANCEL_PRESS, release);
  container.once(Phaser.GameObjects.Events.DESTROY, () => {
    scene.input.off('pointerup', release);
    scene.input.off(CANCEL_PRESS, release);
  });
  return { container, setLabel: (s) => t.setText(s), label: t };
}

/** Опасное действие (сброс и т. п.): коричневая кнопка с красной подписью — заметна, но не спутать с основной. */
export function dangerButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  onClick: () => void,
  fontSize: number = FS.h3,
): ReturnType<typeof button> {
  const b = button(scene, x, y, w, h, 'k:buttonLong_brown', label, onClick, fontSize);
  b.label.setColor('#ff8a7a').setStroke('#2a0804', 6);
  return b;
}

/**
 * Вертикальная прокрутка списка: контейнер с маской в полосе [top, bottom], тянется пальцем и колёсиком.
 * Кнопки внутри оборачивают обработчик в `tap(fn)` — он не сработает после протяжки и вне видимой полосы
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
  ) {
    this.content = scene.add.container(0, top);
    const w = scene.scale.gameSize.width;
    const g = scene.make.graphics({}, false);
    g.fillStyle(0xffffff).fillRect(0, top, w, bottom - top);
    this.content.setMask(g.createGeometryMask());
    // Видимая полоса списка (для e2e-проверки «кнопку ничто не перекрывает»: вне полосы содержимое скрыто маской).
    this.content.setData('clip', [top, bottom]);
    this.thumb = scene.add.rectangle(w - 6, top, 8, 40, TINT.frame, 0.8).setOrigin(0.5, 0).setDepth(20).setVisible(false);
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.dragged = false;
      this.dragFrom = this.inside(p) && !this.locked ? { y: p.y, scroll: this.content.y } : null;
    });
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.dragFrom || !p.isDown) return;
      if (!this.dragged && Math.abs(p.y - this.dragFrom.y) > 14 && this.scrollable) {
        this.dragged = true;
        // Палец тянет список — нажатая кнопка/карточка под ним отпускается (иначе остаётся «вдавленной»).
        scene.input.emit(CANCEL_PRESS);
      }
      if (this.dragged) this.scrollTo(this.dragFrom.scroll + (p.y - this.dragFrom.y));
    });
    scene.input.on('pointerup', () => {
      this.dragFrom = null;
    });
    scene.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (!this.locked && this.inside(p)) this.scrollTo(this.content.y - dy);
    });
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

  private inside(p: Phaser.Input.Pointer): boolean {
    return p.y >= this.top && p.y <= this.bottom;
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
    if (ready()) onTap();
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
): Phaser.GameObjects.Container {
  const p = Phaser.Math.Clamp(pct, 0, 1);
  const back = scene.add.rectangle(0, 0, w, h, 0x1a120a).setOrigin(0, 0.5).setStrokeStyle(3, 0x000000, 0.6);
  const fill = scene.add.rectangle(2, 0, Math.max(0, (w - 4) * p), h - 6, color).setOrigin(0, 0.5);
  return scene.add.container(x, y, [back, fill]);
}

/**
 * R/S. Указатель подсказки на цель (x, y): пульсирующее кольцо, прыгающая стрелка и плашка с одной строкой.
 * side — предпочтительная сторона плашки ('auto' — без предпочтения). Сторону и сдвиг вбок выбирает placeCallout
 * (hintLayout.ts), чтобы плашка не закрывала другие элементы управления сцены: все интерактивные объекты,
 * кроме самой цели, плюс opts.avoid. target — размер цели (рамка пульсирует вокруг неё).
 * Ничего не перехватывает: нажатия проходят к кнопке под ним.
 */
export function hintPointer(
  scene: Phaser.Scene,
  x: number,
  y: number,
  message: string,
  side: HintSide | 'auto',
  target: { w: number; h: number },
  opts: { avoid?: Rect[] } = {},
): Phaser.GameObjects.Container {
  const w = scene.scale.gameSize.width;
  const h = scene.scale.gameSize.height;
  const ring = scene.add.rectangle(x, y, target.w + 24, target.h + 24).setStrokeStyle(8, TINT.gold, 1);
  scene.tweens.add({ targets: ring, scaleX: 1 + 40 / target.w, scaleY: 1 + 40 / target.h, alpha: 0.15, duration: 800, repeat: -1 });
  const t = text(scene, 0, 0, message, FS.body, C.title, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4, wordWrap: { width: w - 200 } });
  const box = { w: Math.min(w - 60, t.width + 60), h: t.height + 22 };
  const plan = placeCallout({ x, y, ...target }, box, {
    prefer: side === 'auto' ? undefined : side,
    avoid: [...controlRects(scene, x, y), ...(opts.avoid ?? [])],
    top: HEADER_H + 8,
    bottom: h,
    width: w,
  });
  const dir = plan.side === 'above' ? -1 : 1;
  const ay = plan.arrowY;
  // Стрелка остриём к цели: над целью — вниз, под целью — вверх.
  const g = HINT_GEOM;
  const arrow =
    plan.side === 'above'
      ? scene.add.triangle(x, ay, 0, 0, g.arrowW, 0, g.arrowW / 2, g.arrowH, TINT.gold)
      : scene.add.triangle(x, ay, 0, g.arrowH, g.arrowW, g.arrowH, g.arrowW / 2, 0, TINT.gold);
  arrow.setStrokeStyle(4, TINT.header);
  scene.tweens.add({ targets: arrow, y: ay - dir * 10, yoyo: true, repeat: -1, duration: 450, ease: 'Sine.easeInOut' });
  const b = plan.box;
  const bg = scene.add.rectangle(b.x + b.w / 2, b.y + b.h / 2, b.w, b.h, 0x000000, 0.85).setStrokeStyle(4, TINT.gold);
  t.setPosition(b.x + b.w / 2, b.y + b.h / 2);
  const c = scene.add.container(0, 0, [ring, arrow, bg, t]).setDepth(8000).setName('hint');
  // Для e2e и отладки: где оказалась плашка и что она закрыла.
  c.setData('hintBox', b).setData('hintOverlap', plan.overlap).setData('hintSide', plan.side);
  return c;
}

/**
 * Прямоугольники всех интерактивных объектов сцены (кнопки, карточки, вкладки), кроме того, что под точкой
 * (x, y) — это сама цель подсказки, — и полноэкранных затемнений модальных окон.
 */
function controlRects(scene: Phaser.Scene, x: number, y: number): Rect[] {
  const sw = scene.scale.gameSize.width;
  const sh = scene.scale.gameSize.height;
  const out: Rect[] = [];
  const walk = (list: Phaser.GameObjects.GameObject[]) => {
    for (const o of list) {
      if (o instanceof Phaser.GameObjects.Container) walk(o.list);
      if (!o.input?.enabled) continue;
      const any = o as unknown as { getBounds?: () => Phaser.Geom.Rectangle; visible?: boolean };
      if (!any.getBounds || any.visible === false) continue;
      const r = any.getBounds();
      if (r.width >= sw * 0.9 && r.height >= sh * 0.9) continue;
      if (r.contains(x, y)) continue;
      out.push({ x: r.x, y: r.y, w: r.width, h: r.height });
    }
  };
  walk(scene.children.list);
  return out;
}

/** Всплывающее сообщение под шапкой экрана (не закрывает название и валюту), исчезает само. */
export function toast(scene: Phaser.Scene, message: string, color: string = C.title, ms = 3500, at: 'top' | 'middle' = 'top'): void {
  const w = scene.scale.gameSize.width;
  const t = text(scene, 0, 0, message, FS.h3, color, { wordWrap: { width: w - 160 }, lineSpacing: 6 });
  const bgH = t.height + 50;
  const bg = scene.add.rectangle(0, 0, w - 100, bgH, 0x000000, 0.88).setStrokeStyle(3, 0xc8a060);
  // middle — посреди экрана: сверху и снизу у экрана главные кнопки, их тост не закрывает.
  const y = at === 'middle' ? scene.scale.gameSize.height * 0.46 : HEADER_H + 24 + bgH / 2;
  const c = scene.add.container(w / 2, y, [bg, t]).setDepth(10000).setAlpha(0);
  scene.tweens.add({ targets: c, alpha: 1, duration: 200 });
  scene.tweens.add({ targets: c, alpha: 0, delay: ms, duration: 400, onComplete: () => c.destroy() });
}
