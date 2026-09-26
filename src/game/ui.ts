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

const DARK_TEXT = new Set(['ui_btn_speed', 'ui_btn_skip']);

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
): { container: Phaser.GameObjects.Container; setLabel: (s: string) => void } {
  const bg = panel(scene, 0, 0, w, h, textureId);
  const dark = DARK_TEXT.has(textureId);
  const t = text(scene, 0, -4, label, 44, dark ? '#4a3520' : '#ffffff', {
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
