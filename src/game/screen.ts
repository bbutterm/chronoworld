import Phaser from 'phaser';
import { GAME_H, GAME_W, HEADER_H } from './layout';
import { session, takeWarnings } from './session';
import { formatNumber } from './flow';
import { button, icon, panel, text, toast } from './ui';

export type NavTab = 'Campaign' | 'Heroes' | 'Home';

const TABS: { scene: NavTab; label: string }[] = [
  { scene: 'Campaign', label: 'Кампания' },
  { scene: 'Heroes', label: 'Герои' },
  { scene: 'Home', label: 'Главная' },
];

/** Высота нижней навигации; контент экрана — между шапкой и ней. */
export const NAV_H = 170;
export { HEADER_H };
export const CONTENT_TOP = HEADER_H + 20;
export const CONTENT_BOTTOM = GAME_H - NAV_H - 20;

/**
 * Общий каркас экрана: фон, шапка с названием и золотом, нижняя навигация (если active задан)
 * и накопившиеся предупреждения о сохранении.
 */
export function screen(scene: Phaser.Scene, title: string, active: NavTab | null, back?: { label?: string; to: string; data?: object }): void {
  scene.add.image(GAME_W / 2, GAME_H / 2, 'bg_arena').setDisplaySize(GAME_W, GAME_H).setAlpha(0.45);
  scene.add.rectangle(GAME_W / 2, HEADER_H / 2, GAME_W, HEADER_H, 0x1d140c, 0.92);
  scene.add.rectangle(GAME_W / 2, HEADER_H, GAME_W, 6, 0xc8a060);
  text(scene, back ? GAME_W / 2 + 40 : 60, HEADER_H / 2, title, 52, '#ffe9a8', {
    fontStyle: 'bold',
    stroke: '#3a2412',
    strokeThickness: 8,
  }).setOrigin(back ? 0.5 : 0, 0.5);
  if (back) button(scene, 110, HEADER_H / 2, 180, 100, 'k:buttonLong_beige', back.label ?? '‹ Назад', () => scene.scene.start(back.to, back.data), 34);
  currencyLabels(scene);

  if (active) {
    scene.add.rectangle(GAME_W / 2, GAME_H - NAV_H / 2, GAME_W, NAV_H, 0x1d140c, 0.95);
    scene.add.rectangle(GAME_W / 2, GAME_H - NAV_H, GAME_W, 6, 0xc8a060);
    const w = GAME_W / TABS.length;
    TABS.forEach((t, i) => {
      const on = t.scene === active;
      button(scene, w * (i + 0.5), GAME_H - NAV_H / 2 + 4, w - 30, NAV_H - 40, on ? 'k:buttonLong_brown' : 'k:buttonLong_beige', t.label, () => {
        if (!on) scene.scene.start(t.scene);
      }, 42);
    });
  }
  for (const w of takeWarnings()) toast(scene, w, '#ffb4a0', 6000);
}

/** Золото и гемы в правом углу шапки — друг под другом, чтобы не наезжать на заголовок. */
function currencyLabels(scene: Phaser.Scene): void {
  const x = GAME_W - 50;
  const row = (y: number, value: number, color: string, tint: number, gem: boolean) => {
    const t = text(scene, x, y, formatNumber(value), 40, color, { fontStyle: 'bold', stroke: '#000000', strokeThickness: 6 }).setOrigin(1, 0.5);
    const ix = x - t.width - 30;
    if (gem) gemIcon(scene, ix, y, 38);
    else icon(scene, ix, y, 'iconCircle_beige', 40).setTint(tint);
  };
  row(HEADER_H / 2 - 30, session.save.resources.gold, '#ffd84a', 0xffc83a, false);
  row(HEADER_H / 2 + 32, session.save.currency.gems, '#9fe8ff', 0x6fd8ff, true);
}

/** Гем — ромб (своей иконки в атласе нет). */
export function gemIcon(scene: Phaser.Scene, x: number, y: number, size: number): Phaser.GameObjects.Polygon {
  const h = size / 2;
  return scene.add.polygon(x, y, [h * 0.8, 0, h * 1.6, h * 0.8, h * 0.8, h * 2, 0, h * 0.8], 0x6fd8ff).setStrokeStyle(3, 0x1d4a66);
}

/** Красный кружок с числом (непрочитанные награды). count ≤ 0 — ничего. */
export function badge(scene: Phaser.Scene, x: number, y: number, count: number): Phaser.GameObjects.Container | null {
  if (count <= 0) return null;
  const c = scene.add.circle(0, 0, 28, 0xd63a2a).setStrokeStyle(4, 0xffffff);
  const t = text(scene, 0, -1, String(count), 32, '#ffffff', { fontStyle: 'bold' });
  return scene.add.container(x, y, [c, t]).setDepth(50);
}

/** Карточка-панель с рамкой из атласа. */
export function card(scene: Phaser.Scene, x: number, y: number, w: number, h: number, light = false): Phaser.GameObjects.NineSlice {
  return panel(scene, x, y, w, h, light ? 'ui_panel_light' : 'ui_panel');
}

/** Модальное подтверждение: затемнение, вопрос, «Да» / «Отмена». */
export function confirm(scene: Phaser.Scene, question: string, yes: string, onYes: () => void): void {
  const layer = scene.add.container(0, 0).setDepth(9000);
  const shade = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.7).setInteractive();
  const box = panel(scene, GAME_W / 2, GAME_H / 2, 900, 520, 'ui_panel');
  const q = text(scene, GAME_W / 2, GAME_H / 2 - 90, question, 40, '#ffffff', { wordWrap: { width: 780 }, lineSpacing: 8 });
  const close = () => layer.destroy();
  const ok = button(scene, GAME_W / 2 - 210, GAME_H / 2 + 150, 380, 120, 'ui_btn_primary', yes, () => {
    close();
    onYes();
  });
  const cancel = button(scene, GAME_W / 2 + 210, GAME_H / 2 + 150, 380, 120, 'k:buttonLong_beige', 'Отмена', close);
  layer.add([shade, box, q, ok.container, cancel.container]);
}

/** Портрет, вписанный в квадрат size (портреты бывают неквадратными). */
export function portrait(scene: Phaser.Scene, x: number, y: number, key: string, size: number): Phaser.GameObjects.Image {
  const img = scene.add.image(x, y, key);
  return img.setScale(size / Math.max(img.width, img.height, 1));
}
