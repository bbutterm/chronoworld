import Phaser from 'phaser';
import { GAME_H, GAME_W } from './layout';
import { session, takeWarnings } from './session';
import { button, icon, panel, text, toast } from './ui';

export type NavTab = 'Campaign' | 'Heroes' | 'Home';

const TABS: { scene: NavTab; label: string }[] = [
  { scene: 'Campaign', label: 'Кампания' },
  { scene: 'Heroes', label: 'Герои' },
  { scene: 'Home', label: 'Главная' },
];

/** Высота нижней навигации; контент экрана — между шапкой и ней. */
export const NAV_H = 170;
export const HEADER_H = 150;
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
  goldLabel(scene);

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

function goldLabel(scene: Phaser.Scene): void {
  const x = GAME_W - 60;
  const t = text(scene, x, HEADER_H / 2, String(session.save.resources.gold), 44, '#ffd84a', {
    fontStyle: 'bold',
    stroke: '#000000',
    strokeThickness: 6,
  }).setOrigin(1, 0.5);
  icon(scene, x - t.width - 36, HEADER_H / 2, 'iconCircle_beige', 44).setTint(0xffc83a);
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
