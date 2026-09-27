import Phaser from 'phaser';
import { GAME_H, GAME_W, HEADER_H } from './layout';
import { session, takeWarnings } from './session';
import { GAME } from './content';
import { lazyPortrait } from './sprites';
import { formatNumber, jobChangeReadyCount } from './flow';
import { button, ellipsize, icon, panel, text, toast } from './ui';
import { hasArt } from './assets';
import { C, FS, SP, TINT } from './theme';

export type NavTab = 'Campaign' | 'Heroes' | 'Home';

const TABS: { scene: NavTab; label: string }[] = [
  { scene: 'Campaign', label: 'Кампания' },
  { scene: 'Heroes', label: 'Герои' },
  { scene: 'Home', label: 'Главная' },
];

/** Имена иконок вкладок: ui_nav_<имя> и ui_nav_<имя>_active в assets/manifest.json. */
const NAV_ICON: Record<NavTab, string> = { Campaign: 'campaign', Heroes: 'heroes', Home: 'home' };

/** Высота нижней навигации; контент экрана — между шапкой и ней. */
export const NAV_H = 170;
export { HEADER_H };
export const CONTENT_TOP = HEADER_H + 20;
export const CONTENT_BOTTOM = GAME_H - NAV_H - 20;

/**
 * Общий каркас экрана: фон, шапка с названием и золотом, нижняя навигация (если active задан)
 * и накопившиеся предупреждения о сохранении.
 * back — кнопка «‹ Назад» в шапке: всегда ведёт на логического родителя экрана (карточка героя → список героев,
 * этап → его глава кампании и т. д.), а не «куда-то на главную».
 * opts.settings — шестерёнка в шапке слева от валюты (S: настройки и редкие действия главной).
 */
export function screen(
  scene: Phaser.Scene,
  title: string,
  active: NavTab | null,
  back?: { label?: string; to: string; data?: object },
  opts: { settings?: () => void } = {},
): void {
  scene.add.image(GAME_W / 2, GAME_H / 2, 'bg_arena').setDisplaySize(GAME_W, GAME_H).setAlpha(0.45);
  scene.add.rectangle(GAME_W / 2, HEADER_H / 2, GAME_W, HEADER_H, 0x1d140c, 0.92);
  scene.add.rectangle(GAME_W / 2, HEADER_H, GAME_W, 6, 0xc8a060);
  const t = text(scene, back ? GAME_W / 2 + 40 : 60, HEADER_H / 2, title, FS.h1, C.title, {
    fontStyle: 'bold',
    stroke: C.titleStroke,
    strokeThickness: 8,
  }).setOrigin(back ? 0.5 : 0, 0.5);
  if (back) button(scene, 110, HEADER_H / 2, 180, 100, 'k:buttonLong_beige', back.label ?? '‹ Назад', () => scene.scene.start(back.to, back.data), FS.h3);
  const currencyLeft = currencyLabels(scene);
  let titleRight = currencyLeft - SP.m;
  if (opts.settings) {
    const gx = currencyLeft - SP.m - GEAR_SIZE / 2;
    const gear = button(scene, gx, HEADER_H / 2, GEAR_SIZE, GEAR_SIZE, 'k:buttonSquare_beige', '', opts.settings);
    gear.container.add(gearIcon(scene, 0, -3, 56)).setName('settings');
    titleRight = gx - GEAR_SIZE / 2 - SP.m;
  }
  // Длинное название не должно наезжать на «Назад», шестерёнку и валюту справа.
  ellipsize(t, back ? Math.min(520, 2 * (titleRight - t.x)) : Math.min(680, titleRight - t.x));

  if (active) {
    scene.add.rectangle(GAME_W / 2, GAME_H - NAV_H / 2, GAME_W, NAV_H, 0x1d140c, 0.95);
    scene.add.rectangle(GAME_W / 2, GAME_H - NAV_H, GAME_W, 6, 0xc8a060);
    const w = GAME_W / TABS.length;
    TABS.forEach((t, i) => {
      const on = t.scene === active;
      const bx = w * (i + 0.5);
      const by = GAME_H - NAV_H / 2 + 4;
      const btn = button(scene, bx, by, w - 30, NAV_H - 40, on ? 'k:buttonLong_brown' : 'k:buttonLong_beige', t.label, () => {
        if (!on) scene.scene.start(t.scene);
      }, FS.h2);
      // Иконка вкладки (арт ui_nav_*; нет файла — только подпись).
      const iconId = `ui_nav_${NAV_ICON[t.scene]}${on ? '_active' : ''}`;
      if (hasArt(iconId)) {
        const size = NAV_H - 60;
        btn.container.add(scene.add.image(-(w - 30) / 2 + size / 2 + 12, 0, iconId).setDisplaySize(size, size));
        btn.label.setX(size / 2 + 4);
      }
      // R: значок «Герои», когда кто-то может сменить профессию.
      if (t.scene === 'Heroes') badge(scene, w * (i + 1) - 50, GAME_H - NAV_H + 30, jobChangeReadyCount(session.save, GAME));
    });
  }
  for (const w of takeWarnings()) toast(scene, w, C.error, 6000);
}

/** Размер кнопки-шестерёнки в шапке (цель нажатия — не меньше TOUCH). */
const GEAR_SIZE = 100;

/** Золото и гемы в правом углу шапки — друг под другом, чтобы не наезжать на заголовок. Возвращает левый край. */
function currencyLabels(scene: Phaser.Scene): number {
  const x = GAME_W - 50;
  const row = (y: number, value: number, color: string, tint: number, gem: boolean) => {
    const t = text(scene, x, y, formatNumber(value), FS.h2, color, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 }).setOrigin(1, 0.5);
    const ix = x - t.width - 30;
    const art = gem ? 'ui_icon_gem' : 'ui_icon_gold';
    if (hasArt(art)) scene.add.image(ix, y, art).setDisplaySize(52, 52);
    else if (gem) gemIcon(scene, ix, y, 38);
    else icon(scene, ix, y, 'iconCircle_beige', 40).setTint(tint);
    return ix - 20;
  };
  return Math.min(
    row(HEADER_H / 2 - 30, session.save.resources.gold, C.gold, 0xffc83a, false),
    row(HEADER_H / 2 + 32, session.save.currency.gems, C.gem, 0x6fd8ff, true),
  );
}

/** Шестерёнка (своей иконки в атласе нет): зубцы, диск и отверстие. size — внешний диаметр. */
export function gearIcon(scene: Phaser.Scene, x: number, y: number, size: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x, y });
  const r = size / 2;
  const ink = Phaser.Display.Color.HexStringToColor(C.ink).color;
  g.fillStyle(ink, 1);
  const teeth = 8;
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const pts = [
      [-r * 0.17, -r * 0.62],
      [r * 0.17, -r * 0.62],
      [r * 0.14, -r],
      [-r * 0.14, -r],
    ].map(([px, py]) => new Phaser.Math.Vector2(px * Math.cos(a) - py * Math.sin(a), px * Math.sin(a) + py * Math.cos(a)));
    g.fillPoints(pts, true);
  }
  g.fillCircle(0, 0, r * 0.72);
  g.fillStyle(0xe8d4a8, 1);
  g.fillCircle(0, 0, r * 0.3);
  return g;
}

/** Гем — ромб (своей иконки в атласе нет). */
export function gemIcon(scene: Phaser.Scene, x: number, y: number, size: number): Phaser.GameObjects.Polygon {
  const h = size / 2;
  return scene.add.polygon(x, y, [h * 0.8, 0, h * 1.6, h * 0.8, h * 0.8, h * 2, 0, h * 0.8], 0x6fd8ff).setStrokeStyle(3, 0x1d4a66);
}

/** Красный кружок с числом (непрочитанные награды). count ≤ 0 — ничего. */
export function badge(scene: Phaser.Scene, x: number, y: number, count: number): Phaser.GameObjects.Container | null {
  if (count <= 0) return null;
  const c = scene.add.circle(0, 0, 28, TINT.badge).setStrokeStyle(4, 0xffffff);
  const t = text(scene, 0, -1, String(count), FS.body, C.text, { fontStyle: 'bold' });
  return scene.add.container(x, y, [c, t]).setDepth(50);
}

/** Карточка-панель с рамкой из атласа. */
export function card(scene: Phaser.Scene, x: number, y: number, w: number, h: number, light = false): Phaser.GameObjects.NineSlice {
  return panel(scene, x, y, w, h, light ? 'ui_panel_light' : 'ui_panel');
}

const CONFIRM_NAME = 'confirmModal';

/** Открыто ли на сцене подтверждение confirm() — экран не должен перезапускаться у игрока «из-под пальца». */
export function confirmOpen(scene: Phaser.Scene): boolean {
  return !!scene.children.getByName(CONFIRM_NAME);
}

/** Модальное подтверждение: затемнение, вопрос, «Да» / «Отмена». */
export function confirm(scene: Phaser.Scene, question: string, yes: string, onYes: () => void): void {
  const layer = scene.add.container(0, 0).setDepth(9000).setName(CONFIRM_NAME);
  const shade = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.7).setInteractive();
  const box = panel(scene, GAME_W / 2, GAME_H / 2, 900, 520, 'ui_panel');
  const q = text(scene, GAME_W / 2, GAME_H / 2 - 90, question, FS.h2, C.text, { wordWrap: { width: 780 }, lineSpacing: 8 });
  const close = () => layer.destroy();
  const ok = button(scene, GAME_W / 2 - 210, GAME_H / 2 + 150, 380, 120, 'ui_btn_primary', yes, () => {
    close();
    onYes();
  });
  const cancel = button(scene, GAME_W / 2 + 210, GAME_H / 2 + 150, 380, 120, 'k:buttonLong_beige', 'Отмена', close);
  layer.add([shade, box, q, ok.container, cancel.container]);
}

/**
 * Портрет, вписанный в квадрат size (портреты бывают неквадратными). U: портрета ещё нет (лист не загружался) —
 * сначала нейтральный силуэт, настоящий подставится, когда будет вырезан из листа.
 */
export function portrait(scene: Phaser.Scene, x: number, y: number, key: string, size: number): Phaser.GameObjects.Image {
  const img = scene.add.image(x, y, key);
  const fit = () => img.setScale(size / Math.max(img.width, img.height, 1));
  lazyPortrait(scene, key, img, fit);
  return fit();
}
