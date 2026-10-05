import Phaser from 'phaser';
import { BLEED_X, GAME_H, GAME_W } from './layout';
import { registerModal } from './screen';
import { COLOR, COLOR_N, FAMILY, R, S, T, Z } from './theme';
import { button, ellipsize, ScrollArea, shieldTaps, text } from './ui';
import { onViewChange, view } from './viewport';

/** Mode-local modal: its scroll mask stays in world coordinates; header and confirmation never scroll away. */
export function adventureModePanel(
  scene: Phaser.Scene, name: string, title: string,
  opts: { footerH?: number; onClose?: () => void } = {},
) {
  const width = GAME_W - 2 * S.l;
  const footerH = opts.footerH ?? 0;
  const headH = 136;
  const layer = scene.add.container(0, 0).setDepth(Z.modal + 50).setName(name);
  const shade = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H * 3, COLOR_N.bg, 0.82).setInteractive();
  const frame = scene.add.graphics();
  const header = text(scene, S.l + S.m, 0, title, T.heading, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0.5);
  ellipsize(header, width - 132 - S.m * 2);
  const footer = scene.add.container(S.l, 0).setName(`${name}Footer`);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    area.locked = true;
    layer.destroy();
    opts.onClose?.();
  };
  const exit = button(scene, GAME_W - S.l - 66, 0, 132, 132, '', '×', close, T.heading, { variant: 'ghost' }).container.setName(`${name}Close`);
  layer.add([shade, frame, header, exit]);
  const area = new ScrollArea(scene, headH, headH + 1, { left: S.l, right: GAME_W - S.l });
  area.content.setName(`${name}Body`);
  const content = scene.add.container(S.l, 0);
  area.add(content);
  layer.add([...area.parts, footer]);
  const layout = () => {
    const v = view(), top = Math.max(v.safeTop + S.s, Math.round(v.uiHeight * 0.04)), bottom = v.safeBottom - S.s;
    frame.clear().fillStyle(COLOR_N.surfaceRaised, 0.99).fillRoundedRect(S.l, top, width, bottom - top, R.xl);
    frame.lineStyle(3, COLOR_N.border).strokeRoundedRect(S.l, top, width, bottom - top, R.xl);
    frame.setInteractive(new Phaser.Geom.Rectangle(S.l, top, width, bottom - top), Phaser.Geom.Rectangle.Contains);
    header.setY(top + headH / 2); exit.setY(top + headH / 2);
    footer.setY(bottom - footerH);
    area.setBounds(top + headH, Math.max(top + headH + 1, bottom - footerH - S.s));
  };
  layout();
  registerModal(layer, close);
  shade.on('pointerup', close);
  const off = onViewChange(scene, () => { if (!closed) layout(); });
  layer.once(Phaser.GameObjects.Events.DESTROY, () => { off(); shieldTaps(scene.sys.game); });
  return { layer, area, content, footer, width, close, setTitle: (title: string) => { header.setText(title); ellipsize(header, width - 132 - S.m * 2); }, setHeight: (h: number) => area.setContentHeight(h + S.m) };
}
