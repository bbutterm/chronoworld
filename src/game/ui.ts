import Phaser from 'phaser';
import { FONT } from './layout';

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
  const bg = scene.add.nineslice(0, 0, textureId, undefined, w, h, 16, 16, 16, 16);
  const t = text(scene, 0, 0, label, 44);
  const container = scene.add.container(x, y, [bg, t]);
  container.setSize(w, h).setInteractive({ useHandCursor: true });
  container.on('pointerdown', () => container.setScale(0.96));
  container.on('pointerout', () => container.setScale(1));
  container.on('pointerup', () => {
    container.setScale(1);
    onClick();
  });
  return { container, setLabel: (s) => t.setText(s) };
}
