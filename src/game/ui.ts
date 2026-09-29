import Phaser from 'phaser';
import { skinKey, sliceOf, tex } from './assets';
import { SKIN, SKIN_DARK_LABEL } from './skin';
import { FONT, GAME_H, GAME_W, HEADER_H } from './layout';
import { worldPoint } from './viewport';
import { C, FS, TINT, TOUCH } from './theme';
import { arrowRect, HINT_GEOM, overlapArea, placeCallout, type CalloutPlan, type HintSide, type Rect } from './hintLayout';
import { HINT_TEXT, markHint, type HintId } from './hints';
import { barFrom, juiceOn } from './juice';
import { sfx } from './audio';
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

/** На сколько опускается подпись нажатой кнопки. */
const PRESS_DY = 6;

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
}

/** Текстура недоступной кнопки (skin.ts); нет скина — серый tint. */
export const DISABLED_BTN = 'skin_btn_disabled';
const DISABLED_TINT = 0x8a8a8a;

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
  /**
   * repeat — переключатель по кругу (скорость, FPS): быстрые повторные нажатия не глушим.
   * sound — звук нажатия (по умолчанию «тап»; null — без звука, например кнопка сама открывает окно со звуком).
   */
  opts: { repeat?: boolean; sound?: SfxId | null } = {},
): ButtonView {
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
  // Скин: подпись тиснёная — на золоте светлый отблеск снизу, на тёмных плитках — тень.
  if (skin) t.setShadow(0, dark ? 2 : 3, dark ? 'rgba(255,244,210,0.55)' : 'rgba(0,0,0,0.85)', dark ? 0 : 3, false, true);
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
  // Подпись «проседает» на PRESS_DY относительно своего места, а не ставится в абсолютный y: вызывающий
  // мог сдвинуть её (подпись вкладки навигации под иконкой, T1-04) — после нажатия она должна вернуться туда же.
  let sunk = false;
  const ready = debounce();
  let enabled = true;
  const setPressed = (p: boolean) => {
    armed = p;
    if (!bg.scene) return;
    if (enabled) {
      const f = tex(scene, textureId, p);
      bg.setTexture(f.key, f.frame);
    }
    if (p !== sunk) {
      t.y += p ? PRESS_DY : -PRESS_DY;
      sunk = p;
    }
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
    if (!opts.repeat && !ready()) return;
    const sound = opts.sound === undefined ? 'ui_tap' : opts.sound;
    if (sound) sfx(sound);
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
    setLabel: (s) => t.setText(s),
    label: t,
    setEnabled: (on) => {
      if (on === enabled || !bg.scene) return view;
      enabled = on;
      const grey = scene.textures.exists(DISABLED_BTN) && skin !== null;
      if (on) {
        const f = tex(scene, textureId, false);
        bg.setTexture(f.key, f.frame);
        bg.clearTint();
      } else if (grey) bg.setTexture(DISABLED_BTN);
      else bg.setTint(DISABLED_TINT);
      t.setColor(on ? labelColor : C.disabled);
      if (skin) t.setShadow(0, on && dark ? 2 : 3, on && dark ? 'rgba(255,244,210,0.55)' : 'rgba(0,0,0,0.85)', on && dark ? 0 : 3, false, true);
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

/** Опасное действие (сброс и т. п.): обычная тёмная плитка с красной подписью — не выделяется как активная и не спутать с основной (T3-23). */
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
  const b = button(scene, x, y, w, h, 'k:buttonLong_beige', label, onClick, fontSize);
  b.label.setColor('#ff8a7a').setStroke('#2a0804', 6);
  // MT-19: выключенная — серая, без красной подписи («Удалить прочитанные» при пустой почте выглядела активной).
  const setEnabled = b.setEnabled;
  b.setEnabled = (on) => {
    setEnabled(on);
    if (b.label.scene) b.label.setColor(on ? '#ff8a7a' : C.disabled).setStroke(on ? '#2a0804' : '#000000', on ? 6 : 0);
    return b;
  };
  return b;
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
  ) {
    this.content = scene.add.container(0, top);
    const w = GAME_W;
    const g = scene.make.graphics({}, false);
    g.fillStyle(0xffffff).fillRect(0, top, w, bottom - top);
    this.content.setMask(g.createGeometryMask());
    // Видимая полоса списка (для e2e-проверки «кнопку ничто не перекрывает»: вне полосы содержимое скрыто маской).
    this.content.setData('clip', [top, bottom]);
    this.thumb = scene.add.rectangle(w - 6, top, 8, 40, TINT.frame, 0.8).setOrigin(0.5, 0).setDepth(20).setVisible(false);
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
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.PRE_UPDATE, guard));
    // Список в модальном окне закрывается раньше сцены — снять обработчики вместе с содержимым.
    this.content.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.input.off('pointerdown', down);
      scene.input.off('pointermove', move);
      scene.input.off('pointerup', up);
      scene.input.off('wheel', wheel);
      scene.events.off(Phaser.Scenes.Events.PRE_UPDATE, guard);
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
    const y = this.wy(p);
    return y >= this.top && y <= this.bottom;
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

/**
 * R/S. Указатель подсказки на цель (x, y): пульсирующее кольцо, прыгающая стрелка и плашка с одной строкой.
 * side — предпочтительная сторона плашки ('auto' — без предпочтения). Сторону и сдвиг вбок выбирает placeCallout
 * (hintLayout.ts), чтобы плашка не закрывала другие элементы управления сцены: все интерактивные объекты,
 * кроме самой цели, плюс opts.avoid и видимые подписи, начинающиеся с opts.avoidText. target — размер цели.
 * Рамка и стрелка ничего не перехватывают: нажатия проходят к кнопке под ними. opts.skip — плашку можно коснуться
 * (в углу «✕»): подсказка скрывается и больше не показывается (обучение пропускаемое).
 *
 * Правила (отчёты тестировщиков NB-03/04, MT-07, LT-10, NB-13):
 * - одна подсказка на экране: новая убирает прежнюю;
 * - раскладка считается на следующем кадре, когда сцена достроена (вкладки и кнопки, созданные после вызова, тоже
 *   обходятся), и ждёт, пока закроются сюжетный диалог и баннер «Новая функция!» — под ними подсказку не видно;
 * - плашка никогда не закрывает кнопки: не влезает в строку — переносится уже; нигде нет места — остаются рамка
 *   (и стрелка, если она ничего не закрывает), а текст показывается всплывающим сообщением.
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
  if (juiceOn()) scene.tweens.add({ targets: ring, scaleX: 1 + grow / (target.w + pad), scaleY: 1 + grow / (target.h + pad), alpha: grow > 0 ? 0.15 : 0.35, yoyo: grow <= 0, duration: 800, repeat: -1 });
  c.add(ring);
  const t = text(scene, 0, 0, message, FS.body, C.title, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4, wordWrap: { width: w - 200 } });
  const closeW = opts.skip ? 44 : 0;
  const avoid = [...controlRects(scene, x, y), ...textRects(scene, opts.avoidText ?? []), ...(opts.avoid ?? [])];
  const tgt = { x, y, ...target };
  // Плашка в одну строку не везде помещается между кнопками (итоги: «Дальше» у правого края, слева — «Авто»):
  // тогда та же строка переносится уже — узкая плашка встаёт рядом с целью, ничего не закрывая.
  let best: CalloutPlan | null = null;
  let wrap = w - 200;
  for (const ww of [w - 200, 640, 520, 420, 340]) {
    t.setWordWrapWidth(ww);
    const p = placeCallout(tgt, { w: Math.min(w - 60, t.width + 60 + closeW), h: t.height + 22 }, {
      prefer: side === 'auto' ? undefined : side,
      avoid,
      top: HEADER_H + 8,
      bottom: h,
      width: w,
    });
    if (!best || p.overlap < best.overlap) {
      best = p;
      wrap = ww;
    }
    if (p.overlap === 0) break;
  }
  t.setWordWrapWidth(wrap);
  const plan = best!;
  const g = HINT_GEOM;
  const arrowAt = (sd: HintSide) => {
    const ay = arrowRect(tgt, sd).y + g.arrowH / 2;
    const dir = sd === 'above' ? -1 : 1;
    // Стрелка остриём к цели: над целью — вниз, под целью — вверх.
    const arrow =
      sd === 'above'
        ? scene.add.triangle(x, ay, 0, 0, g.arrowW, 0, g.arrowW / 2, g.arrowH, TINT.gold)
        : scene.add.triangle(x, ay, 0, g.arrowH, g.arrowW, g.arrowH, g.arrowW / 2, 0, TINT.gold);
    arrow.setStrokeStyle(4, TINT.header);
    if (juiceOn()) scene.tweens.add({ targets: arrow, y: ay - dir * 10, yoyo: true, repeat: -1, duration: 450, ease: 'Sine.easeInOut' });
    c.add(arrow);
  };
  if (plan.overlap > 0) {
    // Места для плашки нет — рамка, стрелка (где она ничего не закрывает) и текст всплывающим сообщением.
    t.destroy();
    const free = (['above', 'below'] as HintSide[]).find((sd) => {
      const a = arrowRect(tgt, sd);
      return a.y >= HEADER_H && a.y + a.h <= h && avoid.every((r) => overlapArea(a, r) === 0);
    });
    if (free) arrowAt(free);
    toast(scene, message, C.title, 4500, 'middle');
    c.setData('hintBox', { x, y, w: 0, h: 0 }).setData('hintOverlap', 0).setData('hintSide', free ?? 'none').setData('hintMode', 'ring');
    return;
  }
  arrowAt(plan.side);
  const b = plan.box;
  const bg = scene.add.rectangle(b.x + b.w / 2, b.y + b.h / 2, b.w, b.h, 0x000000, 0.85).setStrokeStyle(4, TINT.gold);
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
  // Для e2e и отладки: где оказалась плашка и что она закрыла.
  c.setData('hintBox', b).setData('hintOverlap', plan.overlap).setData('hintSide', plan.side).setData('hintMode', 'box');
}

/**
 * Подсказка обучения id (hints.ts): текст HINT_TEXT[id] (или opts.text), касание плашки — пропустить (markHint).
 */
export function tutorialHint(
  scene: Phaser.Scene,
  id: HintId,
  x: number,
  y: number,
  side: HintSide | 'auto',
  target: { w: number; h: number },
  opts: { avoid?: Rect[]; avoidText?: string[]; text?: string } = {},
): Phaser.GameObjects.Container {
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

/**
 * Прямоугольники всех интерактивных объектов сцены (кнопки, карточки, вкладки), кроме того, что под точкой
 * (x, y) — это сама цель подсказки, — и полноэкранных затемнений модальных окон.
 */
function controlRects(scene: Phaser.Scene, x: number, y: number): Rect[] {
  const sw = GAME_W;
  const sh = GAME_H;
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

/** Одновременно видно не больше стольких тостов в одной стопке; более старые уходят раньше срока. */
const TOAST_MAX = 3;
const TOAST_GAP = 14;

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
const toastStacks = new WeakMap<Phaser.Scene, Record<'top' | 'middle', ToastEntry[]>>();

/**
 * Всплывающее сообщение под шапкой экрана (не закрывает название и валюту), исчезает само.
 * T4-13: несколько тостов подряд встают стопкой друг под другом; такое же сообщение, пока оно на экране,
 * не дублируется — у него появляется «×N» и продлевается показ.
 * at: 'middle' — посреди экрана: сверху и снизу у экрана главные кнопки, их тост не закрывает.
 */
export function toast(scene: Phaser.Scene, message: string, color: string = C.title, ms = 3500, at: 'top' | 'middle' = 'top'): void {
  let stacks = toastStacks.get(scene);
  if (!stacks) {
    stacks = { top: [], middle: [] };
    toastStacks.set(scene, stacks);
  }
  const stack = (stacks[at] = stacks[at].filter((e) => !e.gone && e.c.scene));
  const dismiss = (e: ToastEntry) => {
    if (e.gone) return;
    e.gone = true;
    e.hide.remove();
    const i = stack.indexOf(e);
    if (i >= 0) stack.splice(i, 1);
    if (e.c.scene) scene.tweens.add({ targets: e.c, alpha: 0, duration: 300, onComplete: () => e.c.destroy() });
    layout();
  };
  const top = at === 'middle' ? GAME_H * 0.46 : HEADER_H + 24;
  const layout = () => {
    // Сверху — от шапки вниз; посреди экрана — стопка по центру вокруг 46 % высоты.
    const total = stack.reduce((n, e) => n + e.h, 0) + TOAST_GAP * Math.max(0, stack.length - 1);
    let y = at === 'middle' ? top - total / 2 : top;
    for (const e of stack) {
      const cy = y + e.h / 2;
      if (e.c.scene) scene.tweens.add({ targets: e.c, y: cy, duration: 180, ease: 'Sine.easeOut' });
      y += e.h + TOAST_GAP;
    }
  };
  // Ошибка — «нельзя», успех — мягкий колокольчик (награды звенят своими звуками, juice.ts).
  if (color === C.error) sfx('ui_error');
  else if (color === C.success) sfx('ui_notify');
  const same = stack.find((e) => e.message === message);
  if (same) {
    same.count++;
    same.label.setText(`${message} ×${same.count}`);
    same.hide.reset({ delay: ms, callback: () => dismiss(same) });
    return;
  }
  const w = GAME_W;
  const t = text(scene, 0, 0, message, FS.h3, color, { wordWrap: { width: w - 160 }, lineSpacing: 6 });
  const bgH = t.height + 50;
  // MT-17: плашка по ширине текста, а не во весь экран — меньше закрывает кнопки шапки и строку под ней
  // (касания она не ловит: кнопка под тостом нажимается).
  const bg = scene.add.rectangle(0, 0, Math.min(w - 100, Math.max(420, t.width + 80)), bgH, 0x000000, 0.88).setStrokeStyle(3, 0xc8a060);
  const prevBottom = stack.reduce((n, e) => n + e.h + TOAST_GAP, 0);
  const c = scene.add.container(w / 2, (at === 'middle' ? top : top + prevBottom) + bgH / 2, [bg, t]).setDepth(10000).setAlpha(0);
  scene.tweens.add({ targets: c, alpha: 1, duration: 200 });
  const entry: ToastEntry = { c, h: bgH, message, count: 1, label: t, gone: false, hide: undefined as unknown as Phaser.Time.TimerEvent };
  entry.hide = scene.time.delayedCall(ms, () => dismiss(entry));
  stack.push(entry);
  while (stack.length > TOAST_MAX) dismiss(stack[0]);
  layout();
}
