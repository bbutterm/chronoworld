import Phaser from 'phaser';
import { BLEED_X, BLEED_Y, GAME_H, GAME_W, HEADER_H } from './layout';
import { session, takeWarnings } from './session';
import { GAME } from './content';
import { anim, lazyPortrait, portraitKey, spriteView, whenSprites } from './sprites';
import { formatNumber, heroesBadgeCount } from './flow';
import { button, ellipsize, emptyState, icon, panel, text, toast } from './ui';
import { hasArt } from './assets';
import { C, FS, SP, TINT } from './theme';
import { SKIN, SKIN_TINT, skinIcon, type SkinIcon } from './skin';
import { animateCurrency, heartbeat, type CurrencyPill } from './juice';

export type NavTab = 'Campaign' | 'Heroes' | 'Home';

const TABS: { scene: NavTab; label: string }[] = [
  { scene: 'Campaign', label: 'Кампания' },
  { scene: 'Heroes', label: 'Герои' },
  { scene: 'Home', label: 'Главная' },
];

/** Имена иконок вкладок: ui_nav_<имя> и ui_nav_<имя>_active в assets/manifest.json. */
const NAV_ICON: Record<NavTab, SkinIcon> = { Campaign: 'map', Heroes: 'helmet', Home: 'home' };

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
  // Фон 1080×1920 сам продолжается на поля вытянутых экранов (viewport.ts); шапка и навигация — тоже до краёв.
  scene.add.image(GAME_W / 2, GAME_H / 2, 'skin_bg_forest').setDisplaySize(GAME_W, GAME_H);
  const fullW = GAME_W + 2 * BLEED_X;
  scene.add.rectangle(GAME_W / 2, (HEADER_H - BLEED_Y) / 2, fullW, HEADER_H + BLEED_Y, SKIN.bg, 0.96);
  scene.add.rectangle(GAME_W / 2, HEADER_H, fullW, 2, SKIN_TINT.bronze);
  if (back) button(scene, 110, HEADER_H / 2, 180, 100, 'k:buttonLong_beige', back.label ?? '‹ Назад', () => scene.scene.start(back.to, back.data), FS.h3);
  const currencyLeft = currencyLabels(scene);
  let titleRight = currencyLeft - SP.m;
  if (opts.settings) {
    const gx = currencyLeft - SP.m - GEAR_SIZE / 2;
    const gear = button(scene, gx, HEADER_H / 2, GEAR_SIZE, GEAR_SIZE, 'k:buttonSquare_beige', '', opts.settings);
    gear.container.add(scene.add.image(0, 0, skinIcon('gear')).setDisplaySize(56, 56).setTint(SKIN_TINT.gold)).setName('settings');
    titleRight = gx - GEAR_SIZE / 2 - SP.m;
  }
  // T3-08: название — между «‹ Назад» и валютой; длинное сначала мельчает, потом переносится на две строки.
  const titleLeft = back ? 200 + SP.m : 50;
  const t = text(scene, back ? (titleLeft + titleRight) / 2 : titleLeft, HEADER_H / 2, title, FS.h1, SKIN.cream, { fontStyle: 'bold' }).setOrigin(back ? 0.5 : 0, 0.5);
  fitTitle(t, titleRight - titleLeft);

  if (active) {
    scene.add.rectangle(GAME_W / 2, GAME_H - (NAV_H - BLEED_Y) / 2, GAME_W + 2 * BLEED_X, NAV_H + BLEED_Y, SKIN.bg, 0.9);
    const w = GAME_W / TABS.length;
    TABS.forEach((t, i) => {
      const on = t.scene === active;
      const bx = w * (i + 0.5);
      const by = GAME_H - NAV_H / 2;
      // Плитка вкладки как в референсе: контурная иконка и подпись капсом под ней; активная — золотая рамка.
      const btn = button(scene, bx, by, w - 36, NAV_H - 30, on ? 'k:buttonLong_brown' : 'k:buttonLong_beige', t.label.toUpperCase(), () => {
        // T1-04: на подэкранах вкладки (карточка героя, инвентарь) вкладка ведёт к её корневому экрану.
        if (!on || scene.scene.key !== t.scene) scene.scene.start(t.scene);
      }, FS.caption);
      btn.label.setY(34).setColor(on ? SKIN.goldLight : SKIN.creamDim);
      btn.container.add(scene.add.image(0, -18, skinIcon(NAV_ICON[t.scene])).setDisplaySize(60, 60).setTint(on ? SKIN_TINT.gold : SKIN_TINT.creamDim));
      // R: значок «Герои», когда кто-то может сменить профессию; P10 (T1-08) — или надеть вещь получше.
      if (t.scene === 'Heroes') cornerBadge(scene, bx, by, w - 36, NAV_H - 30, heroesBadgeCount(session.save, GAME));
    });
  }
  for (const w of takeWarnings()) toast(scene, w, C.error, 6000);
}

/** Название экрана в ширину maxW: крупно, если влезает; иначе мельче (до FS.h3), потом две строки, потом «…». */
function fitTitle(t: Phaser.GameObjects.Text, maxW: number): void {
  for (const size of [FS.h1, FS.h2, FS.h3]) {
    t.setFontSize(size);
    if (t.width <= maxW) return;
  }
  const full = t.text;
  t.setWordWrapWidth(maxW).setLineSpacing(-4);
  if (t.height <= HEADER_H - 16 && t.width <= maxW) return;
  t.setWordWrapWidth(null);
  t.setText(full);
  ellipsize(t, maxW);
}

/** Размер кнопки-шестерёнки в шапке (цель нажатия — не меньше TOUCH). */
const GEAR_SIZE = 100;

/**
 * Золото и гемы в правом углу шапки — друг под другом, чтобы не наезжать на заголовок. Возвращает левый край.
 * Каждая «таблетка» — контейнер с центром в её середине: подпрыгивает целиком, когда валюта меняется (juice.ts).
 */
function currencyLabels(scene: Phaser.Scene): number {
  const x = GAME_W - 50;
  const pills: CurrencyPill[] = [];
  // Валюта — «таблетка» из скина: иконка и число, как монеты в референсе.
  const row = (y: number, kind: CurrencyPill['kind'], value: number, color: string, tint: number) => {
    const gem = kind === 'gems';
    const t = text(scene, 0, 0, formatNumber(value), FS.h3, color, { fontStyle: 'bold' }).setOrigin(1, 0.5);
    const ix = x - 18 - t.width - 34;
    const pillW = x - ix + 34 + 6;
    const cx = x - pillW / 2 + 6;
    const art = gem ? 'ui_icon_gem' : 'ui_icon_gold';
    const ico = hasArt(art) ? scene.add.image(ix - cx, 0, art).setDisplaySize(46, 46) : gem ? gemIcon(scene, ix - cx, 0, 34) : icon(scene, ix - cx, 0, 'iconCircle_beige', 36).setTint(tint);
    t.setPosition(x - 18 - cx, 0);
    const box = scene.add.container(cx, y, [panel(scene, 0, 0, pillW, 64, 'k:buttonLong_beige'), ico, t]).setName(`pill_${kind}`);
    pills.push({ kind, value, text: t, box, icon: { x: ix, y } });
    return x - pillW + 6 - 10;
  };
  const left = Math.min(
    row(HEADER_H / 2 - 30, 'gold', session.save.resources.gold, C.gold, 0xffc83a),
    row(HEADER_H / 2 + 32, 'gems', session.save.currency.gems, C.gem, 0x6fd8ff),
  );
  animateCurrency(scene, pills);
  return left;
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

/**
 * Красный кружок с числом (готово к получению, есть что сделать). count ≤ 0 — ничего. Больше 99 — «99+».
 * Один вид везде (навигация, плитки, кнопки): радиус 28, белая обводка, мягкое «сердцебиение» (juice.ts).
 * Место — через cornerBadge (правый верхний угол цели), чтобы значки стояли одинаково.
 */
export function badge(scene: Phaser.Scene, x: number, y: number, count: number): Phaser.GameObjects.Container | null {
  if (count <= 0) return null;
  const label = count > 99 ? '99+' : String(count);
  const c = scene.add.circle(0, 0, 28, TINT.badge).setStrokeStyle(4, 0xffffff);
  const t = text(scene, 0, -1, label, label.length > 2 ? FS.caption - 6 : FS.body, C.text, { fontStyle: 'bold' });
  const box = scene.add.container(x, y, [c, t]).setDepth(50).setName('badge');
  heartbeat(scene, box);
  return box;
}

/** Значок в правом верхнем углу прямоугольника (центр cx, cy; размер w×h): на 22 внутрь от правого края, на 16 — от верхнего. */
export function cornerBadge(scene: Phaser.Scene, cx: number, cy: number, w: number, h: number, count: number): Phaser.GameObjects.Container | null {
  return badge(scene, cx + w / 2 - 22, cy - h / 2 + 16, count);
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

/**
 * Модальное подтверждение: затемнение, вопрос, «Да» / «Отмена».
 * opts.danger — разрушительное действие (сброс, удаление): оно красное и справа, а золотая основная кнопка —
 * безопасная «Отмена» (T3-23: не сбросить прогресс «на автомате»).
 */
export function confirm(scene: Phaser.Scene, question: string, yes: string, onYes: () => void, opts: { danger?: boolean } = {}): void {
  const layer = scene.add.container(0, 0).setDepth(9000).setName(CONFIRM_NAME);
  const shade = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.7).setInteractive();
  const q = text(scene, GAME_W / 2, 0, question, FS.h2, C.text, { wordWrap: { width: 780 }, lineSpacing: 8 });
  // Высота окна — по тексту вопроса: без пустого провала между вопросом и кнопками.
  const boxH = Math.max(400, q.height + 330);
  const top = GAME_H / 2 - boxH / 2;
  const box = panel(scene, GAME_W / 2, GAME_H / 2, 900, boxH, 'ui_panel');
  q.setY(top + 90 + q.height / 2);
  const btnY = top + boxH - 110;
  const close = () => layer.destroy();
  const doIt = () => {
    close();
    onYes();
  };
  const danger = !!opts.danger;
  const ok = button(scene, GAME_W / 2 + (danger ? 210 : -210), btnY, 380, 120, danger ? DANGER_BTN : 'ui_btn_primary', yes, doIt);
  const cancel = button(scene, GAME_W / 2 + (danger ? -210 : 210), btnY, 380, 120, danger ? 'ui_btn_primary' : 'k:buttonLong_beige', 'Отмена', close);
  // Касание мимо окна — «Отмена» (окно само касания ловит, чтобы не закрываться от нажатия по нему).
  box.setInteractive();
  shade.on('pointerup', close);
  layer.add([shade, box, q, ok.container, cancel.container]);
  popIn(scene, layer, shade);
}

/** Красная кнопка опасного действия (текстура скина, buildSkin). */
export const DANGER_BTN = 'skin_btn_danger';

/** Появление модального окна: затемнение проявляется, окно чуть «вырастает» из центра экрана. */
export function popIn(scene: Phaser.Scene, layer: Phaser.GameObjects.Container, shade?: Phaser.GameObjects.GameObject): void {
  const rest = layer.list.filter((o) => o !== shade) as unknown as (Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.Alpha)[];
  if (shade) scene.tweens.add({ targets: shade, alpha: { from: 0, to: 1 }, duration: 140 });
  // Масштаб контейнера — от центра экрана: сдвигаем начало координат в центр.
  const inner = scene.add.container(GAME_W / 2, GAME_H / 2);
  for (const o of rest) {
    layer.remove(o as unknown as Phaser.GameObjects.GameObject);
    o.setPosition(o.x - GAME_W / 2, o.y - GAME_H / 2);
    inner.add(o as unknown as Phaser.GameObjects.GameObject);
  }
  layer.add(inner);
  inner.setScale(0.92).setAlpha(0);
  scene.tweens.add({ targets: inner, scale: 1, alpha: 1, duration: 160, ease: 'Back.easeOut' });
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

/** Цвет перекраски юнита (visual.tint) для setTint; нет — белый (без перекраски). */
export function unitTint(visual: { tint?: string } | undefined): number {
  return visual?.tint ? Phaser.Display.Color.HexStringToColor(visual.tint).color : 0xffffff;
}

/**
 * Фигура героя/юнита в стойке (анимация idle), ноги в (x, feetY), высота фигуры не больше height.
 * Лист грузится по требованию; пока его нет (или арта нет вовсе) — портрет. onReady получает готовый объект.
 */
export function unitFigure(
  scene: Phaser.Scene,
  id: string,
  x: number,
  feetY: number,
  height: number,
  opts: { maxScale?: number; onReady?: (o: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image) => void } = {},
): void {
  const onReady = opts.onReady;
  whenSprites(scene, [id], () => {
    if (!scene.sys.displayList) return;
    const view = spriteView(scene, id);
    if (!view.art) {
      onReady?.(portrait(scene, x, feetY - height / 2, portraitKey(id), height));
      return;
    }
    const spr = scene.add.sprite(x, feetY, view.key, 0).setOrigin(view.originX, view.originY);
    // Пиксель-арт: по умолчанию не растягиваем (как в бою), крупный показ — до maxScale.
    spr.setScale(Math.min(opts.maxScale ?? 1, height / Math.max(1, view.height)) * (view.size / spr.frame.height));
    const idle = anim(view, id, 'idle');
    if (idle) spr.play({ key: idle, repeat: -1 });
    onReady?.(spr);
  });
}

/**
 * Пустой список: карточка с иконкой, подсказкой «что сделать» и (если есть) кнопкой этого действия —
 * у игрока всегда есть очевидный следующий шаг, а не голый текст поверх фона.
 */
export function emptyCard(
  scene: Phaser.Scene,
  y: number,
  message: string,
  iconName: SkinIcon,
  cta?: { label: string; onClick: () => void },
): void {
  const msg = emptyState(scene, GAME_W / 2, 0, message, 880);
  const h = 120 + msg.height + 60 + (cta ? 150 : 0);
  const top = y - h / 2;
  card(scene, GAME_W / 2, y, 1000, h);
  scene.children.bringToTop(msg);
  scene.add.image(GAME_W / 2, top + 80, skinIcon(iconName)).setDisplaySize(80, 80).setTint(SKIN_TINT.gold).setAlpha(0.9);
  msg.setY(top + 140 + msg.height / 2);
  if (cta) button(scene, GAME_W / 2, top + h - 95, 560, 120, 'ui_btn_primary', cta.label, cta.onClick, FS.h2);
}
