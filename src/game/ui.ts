import Phaser from 'phaser';
import { sliceOf, tex } from './assets';
import { FONT, HEADER_H } from './layout';

/** Kenney UI нарисован мелко: 9-slice строим в меньшем размере и увеличиваем, чтобы рамки были заметны. */
const UI_SCALE = 2.5;

export function text(
  scene: Phaser.Scene,
  x: number,
  y: number,
  value: string,
  size = 40,
  color = '#ffffff',
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
  fontSize = 44,
): { container: Phaser.GameObjects.Container; setLabel: (s: string) => void; label: Phaser.GameObjects.Text } {
  const bg = panel(scene, 0, 0, w, h, textureId);
  const dark = DARK_TEXT.has(textureId);
  const t = text(scene, 0, -4, label, fontSize, dark ? '#4a3520' : '#ffffff', {
    fontStyle: 'bold',
    stroke: dark ? '#00000000' : '#3a2412',
    strokeThickness: dark ? 0 : 5,
  });
  const container = scene.add.container(x, y, [bg, t]);
  container.setSize(w, h).setInteractive({ useHandCursor: true });
  const setPressed = (p: boolean) => {
    const f = tex(scene, textureId, p);
    bg.setTexture(f.key, f.frame);
    t.setY(p ? 2 : -4);
  };
  container.on('pointerdown', () => setPressed(true));
  container.on('pointerout', () => setPressed(false));
  container.on('pointerup', () => {
    setPressed(false);
    onClick();
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
  fontSize = 36,
): ReturnType<typeof button> {
  const b = button(scene, x, y, w, h, 'k:buttonLong_brown', label, onClick, fontSize);
  b.label.setColor('#ff8a7a').setStroke('#2a0804', 6);
  return b;
}

/**
 * Вертикальная прокрутка списка: контейнер с маской в полосе [top, bottom], тянется пальцем и колёсиком.
 * Кнопки внутри оборачивают обработчик в `tap(fn)` — он не сработает после протяжки и вне видимой полосы
 * (маска Phaser не отсекает ввод).
 */
export class ScrollArea {
  readonly content: Phaser.GameObjects.Container;
  private height = 0;
  private dragFrom: { y: number; scroll: number } | null = null;
  private dragged = false;
  /** Открыто модальное окно поверх списка — прокрутка и нажатия в списке выключены. */
  locked = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly top: number,
    private readonly bottom: number,
  ) {
    this.content = scene.add.container(0, top);
    const g = scene.make.graphics({}, false);
    g.fillStyle(0xffffff).fillRect(0, top, scene.scale.gameSize.width, bottom - top);
    this.content.setMask(g.createGeometryMask());
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.dragged = false;
      this.dragFrom = this.inside(p) && !this.locked ? { y: p.y, scroll: this.content.y } : null;
    });
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.dragFrom || !p.isDown) return;
      if (Math.abs(p.y - this.dragFrom.y) > 14) this.dragged = true;
      if (this.dragged) this.scrollTo(this.dragFrom.scroll + (p.y - this.dragFrom.y));
    });
    scene.input.on('pointerup', () => {
      this.dragFrom = null;
    });
    scene.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (!this.locked) this.scrollTo(this.content.y - dy);
    });
  }

  /** Высота содержимого (для границ прокрутки). */
  setContentHeight(h: number): void {
    this.height = h;
    this.scrollTo(this.content.y);
  }

  /** Сдвиг содержимого: 0 — в самом верху. */
  get offset(): number {
    return this.top - this.content.y;
  }

  set offset(v: number) {
    this.scrollTo(this.top - v);
  }

  private scrollTo(y: number): void {
    const min = this.top - Math.max(0, this.height - (this.bottom - this.top));
    this.content.y = Phaser.Math.Clamp(y, min, this.top);
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

/** Всплывающее сообщение под шапкой экрана (не закрывает название и валюту), исчезает само. */
export function toast(scene: Phaser.Scene, message: string, color = '#ffe9a8', ms = 3500): void {
  const w = scene.scale.gameSize.width;
  const t = text(scene, 0, 0, message, 34, color, { wordWrap: { width: w - 160 }, lineSpacing: 6 });
  const bgH = t.height + 50;
  const bg = scene.add.rectangle(0, 0, w - 100, bgH, 0x000000, 0.88).setStrokeStyle(3, 0xc8a060);
  const c = scene.add.container(w / 2, HEADER_H + 24 + bgH / 2, [bg, t]).setDepth(10000).setAlpha(0);
  scene.tweens.add({ targets: c, alpha: 1, duration: 200 });
  scene.tweens.add({ targets: c, alpha: 0, delay: ms, duration: 400, onComplete: () => c.destroy() });
}
