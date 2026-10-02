import Phaser from 'phaser';
import { sfx } from './audio';
import { haptic } from './haptics';
import { cornerBadge } from './screen';
import { SKIN_TINT, skinIcon, type SkinIcon } from './skin';
import { COLOR, COLOR_N, FAMILY, R, S, T } from './theme';
import { ellipsize, plate, pressable, pressFeedback, SURFACE, tag, text, TONE_COLOR, type Tone } from './ui';
import { lockedToast, lockLabel } from './unlockBanner';

/**
 * «Здания» страницы «Город» (HomeScene): у каждого входа свой вид и размер по важности, без строк-пояснений.
 * - artEntry — крупная арт-витрина (Таверна, Лавка): картинка во всю карточку (своя canvas-текстура со скруглением,
 *   рамкой и затемнением снизу), название заголовочной гарнитурой в левом нижнем углу, сверху слева — тег состояния
 *   («Бесплатный призыв»), в углу — красное число (можно забрать) или золотая точка (есть что посмотреть).
 * - compactEntry — небольшой вход (Задания, Достижения): медальон с иконкой, название и одно короткое состояние
 *   (полоска или «15 / 16»).
 * Закрыто (data/unlocks.json) — приглушено, замок (в углу витрины или в медальоне входа), под названием этап открытия, касание — тост.
 */

type FeatureId = Parameters<typeof lockedToast>[1];

export interface EntryOpts {
  /** Имя контейнера карточки (для e2e: tavernTile, shopTile, questsTile, achievementsTile). */
  name: string;
  title: string;
  open: boolean;
  lockId: FeatureId;
  onOpen: () => void;
  /** Красное число «можно забрать» (0 — нет). */
  badge?: number;
  /** Золотая точка «есть что посмотреть» (когда нет числа). */
  goldDot?: boolean;
}

export interface EntryView {
  root: Phaser.GameObjects.Container;
  /** Название (для указателя подсказки и пульса «новое»). */
  label: Phaser.GameObjects.Text;
}

type Paint = (c: CanvasRenderingContext2D, w: number, h: number) => void;

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/**
 * Карточка-картинка w×h (одна canvas-текстура на размер): скругление R.l, картинка paint, мягкая виньетка, затемнение
 * нижней трети под название, рамка бронзой и блик по верхней кромке. Ключ — base + размер.
 */
export function artCardTexture(scene: Phaser.Scene, base: string, w: number, h: number, paint: Paint): string {
  const key = `home_${base}_${Math.round(w)}x${Math.round(h)}`;
  if (scene.textures.exists(key)) return key;
  const W = Math.round(w);
  const H = Math.round(h);
  const ct = scene.textures.createCanvas(key, W, H);
  if (!ct) return '__WHITE';
  const c = ct.getContext();
  const r = R.l;
  c.save();
  roundRect(c, 1, 1, W - 2, H - 2, r);
  c.clip();
  c.fillStyle = COLOR.surfaceSunken;
  c.fillRect(0, 0, W, H);
  paint(c, W, H);
  // Виньетка: края темнее — взгляд к центру картинки.
  const v = c.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.25, W / 2, H * 0.5, Math.max(W, H) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  c.fillStyle = v;
  c.fillRect(0, 0, W, H);
  // Низ под название.
  const g = c.createLinearGradient(0, H * 0.5, 0, H);
  g.addColorStop(0, 'rgba(10,8,6,0)');
  g.addColorStop(0.6, 'rgba(10,8,6,0.62)');
  g.addColorStop(1, 'rgba(10,8,6,0.92)');
  c.fillStyle = g;
  c.fillRect(0, H * 0.5, W, H * 0.5);
  c.restore();
  // Рамка и блик.
  c.lineWidth = 3;
  c.strokeStyle = COLOR.border;
  roundRect(c, 2.5, 2.5, W - 5, H - 5, r - 1.5);
  c.stroke();
  c.strokeStyle = 'rgba(255,230,180,0.18)';
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(r + 4, 6);
  c.lineTo(W - r - 4, 6);
  c.stroke();
  ct.refresh();
  return key;
}

/** «Откроется на этапе 2-1» → «Этап 2-1» (небольшие входы и узкие витрины: подпись в одну строку рядом с замком). */
export function shortLockLabel(id: FeatureId): string {
  return lockLabel(id).replace(/^Откроется на этапе/, 'Этап');
}

/** Замок в правом верхнем углу карточки (x, y — центр карточки). */
function lockMark(scene: Phaser.Scene, x: number, y: number, w: number, h: number, size = 44): Phaser.GameObjects.Image {
  return scene.add
    .image(x + w / 2 - S.s - size / 2, y - h / 2 + S.s + size / 2, skinIcon('lock'))
    .setDisplaySize(size, size)
    .setTint(SKIN_TINT.creamDim);
}

/** Золотая точка «есть что посмотреть» (не красная: красное — только «можно забрать»). */
export function goldDot(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.Arc {
  return scene.add.circle(x, y, 13, COLOR_N.accent).setStrokeStyle(3, COLOR_N.onAccent).setDepth(50).setName('goldDot');
}

/** Значки в углу карточки: число — красное, иначе золотая точка. */
function marks(scene: Phaser.Scene, x: number, y: number, w: number, h: number, o: EntryOpts): void {
  if (!o.open) return;
  if (o.badge) cornerBadge(scene, x, y, w, h, o.badge);
  else if (o.goldDot) goldDot(scene, x + w / 2 - 18, y - h / 2 + 16);
}

/**
 * Крупная арт-витрина (центр x, y; w×h): texKey — картинка карточки (artCardTexture), extra — что поставить поверх
 * картинки и под названием (огонь, фигура), state — тег сверху слева.
 */
export function artEntry(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  texKey: string,
  o: EntryOpts & {
    extra?: (root: Phaser.GameObjects.Container) => void;
    state?: { label: string; tone: Tone };
  },
): EntryView {
  const root = scene.add.container(x, y).setName(o.name).setSize(w, h);
  const img = scene.add.image(0, 0, texKey).setDisplaySize(w, h);
  root.add(img);
  if (!o.open) img.setTint(0x6c665e);
  o.extra?.(root);
  const left = -w / 2 + S.m;
  const bottom = h / 2 - S.m;
  // Название — заголовочной гарнитурой в левом нижнем углу; закрыто — под ним «Откроется на этапе …».
  const titleY = o.open ? bottom - T.title * 0.5 : bottom - T.caption - S.xs - T.title * 0.5;
  const label = text(scene, left, titleY, o.title, T.title, o.open ? COLOR.title : COLOR.textSecondary, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0.5);
  label.setShadow(0, 3, 'rgba(0,0,0,0.85)', 6, false, true);
  root.add(label);
  if (!o.open) {
    const lock = text(scene, left, bottom - T.caption / 2, lockLabel(o.lockId), T.caption, COLOR.textSecondary).setOrigin(0, 0.5);
    // Узкая витрина — коротко («Этап 2-1»).
    if (lock.width > w - 2 * S.m) lock.setText(shortLockLabel(o.lockId));
    root.add([lock, lockMark(scene, 0, 0, w, h)]);
  } else if (o.state) {
    root.add(tag(scene, left, -h / 2 + S.m + 26, o.state.label, o.state.tone, { solid: true, align: 'left' }).setName(`${o.name}State`));
  }
  pressable(scene, img, w, h, o.open ? o.onOpen : () => lockedToast(scene, o.lockId));
  marks(scene, x, y, w, h, o);
  return { root, label };
}

/**
 * Небольшой вход (центр x, y; w×h): медальон с иконкой слева, название, под ним одно короткое состояние —
 * полоска (bar 0…1) или подпись (status).
 */
export function compactEntry(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  o: EntryOpts & { icon: SkinIcon; bar?: number; status?: { text: string; tone?: Tone } },
): EntryView {
  const root = scene.add.container(x, y).setName(o.name).setSize(w, h);
  const bg = plate(scene, 0, 0, w, h, { ...SURFACE.raised, r: R.l });
  root.add(bg);
  const m = Math.min(h - 2 * S.s, 112);
  const mx = -w / 2 + S.s + m / 2;
  const tint = o.open ? SKIN_TINT.gold : SKIN_TINT.creamDim;
  const med = scene.add.image(mx, 0, 'skin_medallion').setDisplaySize(m, m);
  // Закрыто — в медальоне замок вместо иконки (название не теснится значками справа).
  const ico = scene.add.image(mx, 0, skinIcon(o.open ? o.icon : 'lock')).setDisplaySize(m * 0.48, m * 0.48).setTint(tint);
  root.add([med, ico]);
  const left = mx + m / 2 + S.s;
  const maxW = w / 2 - S.m - left;
  const hasSub = !o.open || o.bar !== undefined || !!o.status;
  const label = text(scene, left, hasSub ? -T.caption * 0.62 : 0, o.title, T.heading, o.open ? COLOR.title : COLOR.textSecondary, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0.5);
  ellipsize(label, maxW);
  root.add(label);
  const subY = T.heading * 0.62;
  if (!o.open) {
    bg.setAlpha(0.8);
    med.setAlpha(0.6);
    ico.setAlpha(0.7);
    root.add(text(scene, left, subY, shortLockLabel(o.lockId), T.caption, COLOR.textSecondary).setOrigin(0, 0.5));
  } else if (o.bar !== undefined) {
    const bw = Math.min(maxW, 260);
    const bh = 14;
    const f = Phaser.Math.Clamp(o.bar, 0, 1);
    root.add(plate(scene, left + bw / 2, subY, bw, bh + 6, { ...SURFACE.sunken, r: R.pill }));
    if (f > 0) root.add(scene.add.rectangle(left + 3, subY, (bw - 6) * f, bh - 4, f >= 1 ? COLOR_N.positive : COLOR_N.accent).setOrigin(0, 0.5));
  } else if (o.status) {
    const tone = o.status.tone ?? 'neutral';
    root.add(text(scene, left, subY, o.status.text, T.caption, TONE_COLOR[tone], { fontStyle: 'bold' }).setOrigin(0, 0.5));
  }
  pressable(scene, bg, w, h, o.open ? o.onOpen : () => lockedToast(scene, o.lockId));
  marks(scene, x, y, w, h, o);
  return { root, label };
}

/** Круглая иконка-кнопка шапки и страницы «Город» — как шестерёнка настроек (screen.ts): размер круга и цель нажатия. */
export const ROUND_ICON = { size: 84, hit: 104 } as const;

/**
 * Круглая иконка-кнопка без подписи (События, Почта, Контракт, Летопись): тёмный круг с бронзовой кромкой, глиф
 * золотом (glyph рисует его с центром 0, 0 и размером size). Нажатие — кромка золотом и сжатие (pressFeedback).
 */
export function roundIcon(
  scene: Phaser.Scene,
  x: number,
  y: number,
  name: string,
  glyph: (size: number) => Phaser.GameObjects.GameObject,
  onTap: () => void,
  size: number = ROUND_ICON.size,
): Phaser.GameObjects.Container {
  const g = scene.add.graphics();
  const draw = (pressed: boolean) => {
    g.clear();
    g.fillStyle(pressed ? COLOR_N.surfaceSunken : COLOR_N.surface, 0.92).fillCircle(0, 0, size / 2);
    g.lineStyle(3, pressed ? COLOR_N.title : COLOR_N.border, 1).strokeCircle(0, 0, size / 2 - 1.5);
  };
  draw(false);
  const box = scene.add.container(x, y, [g, glyph(size * 0.62)]).setName(name);
  // Своя цель нажатия (без прямоугольного затемнения pressable — у круга отклик кромкой и сжатием).
  const hit = scene.add.zone(x, y, ROUND_ICON.hit, ROUND_ICON.hit).setInteractive({ useHandCursor: true });
  let armed = false;
  let last = -Infinity;
  const set = (p: boolean) => {
    if (armed === p || !box.scene) return;
    armed = p;
    draw(p);
    pressFeedback(scene, box, p);
  };
  hit.on('pointerdown', () => set(true));
  hit.on('pointerout', () => set(false));
  hit.on('pointerup', () => {
    if (!armed) return;
    set(false);
    const t = performance.now();
    if (t - last < 250) return;
    last = t;
    sfx('ui_tap');
    haptic('tap');
    onTap();
  });
  box.once(Phaser.GameObjects.Events.DESTROY, () => hit.scene && hit.destroy());
  return box;
}
