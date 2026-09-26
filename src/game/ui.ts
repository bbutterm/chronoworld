import Phaser from 'phaser';
import { sliceOf, tex } from './assets';
import { FONT } from './layout';

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
): { container: Phaser.GameObjects.Container; setLabel: (s: string) => void } {
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
  return { container, setLabel: (s) => t.setText(s) };
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

/** Всплывающее сообщение сверху экрана, исчезает само. */
export function toast(scene: Phaser.Scene, message: string, color = '#ffe9a8', ms = 3500): void {
  const w = scene.scale.gameSize.width;
  const t = text(scene, 0, 0, message, 34, color, { wordWrap: { width: w - 160 }, lineSpacing: 6 });
  const bg = scene.add.rectangle(0, 0, w - 100, t.height + 50, 0x000000, 0.82).setStrokeStyle(3, 0xc8a060);
  const c = scene.add.container(w / 2, 200 + t.height / 2, [bg, t]).setDepth(10000).setAlpha(0);
  scene.tweens.add({ targets: c, alpha: 1, duration: 200 });
  scene.tweens.add({ targets: c, alpha: 0, delay: ms, duration: 400, onComplete: () => c.destroy() });
}
