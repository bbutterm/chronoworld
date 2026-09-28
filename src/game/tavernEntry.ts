import Phaser from 'phaser';
import { summonStatus } from '../core';
import { GAME } from './content';
import { pulse } from './juice';
import { card, cornerBadge } from './screen';
import { session, today } from './session';
import { SKIN_TINT, skinIcon } from './skin';
import { tavernBadge } from './tavern';
import { C, FS, OUTLINE, TITLE_STYLE } from './theme';
import { pressable, text } from './ui';
import { lockedToast, lockLabel } from './unlockBanner';

/**
 * Вход в Таверну с главной (H5): плитка-«здание» в ряду Таверна / Лавка / Охота (buildingTile — общий вид этих трёх
 * плиток), её ставит HomeScene одной строкой (tavernTile). Значок — бесплатный призыв и незабранный подарок; только что
 * открылась и ещё не заходили — пульс и «Новое!».
 */

const SEEN_KEY = 'chronoworld.tavernSeen';
const NOTICE_KEY = 'chronoworld.tavernNotice';

function flag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function setFlag(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Хранилище недоступно — «Новое!» просто покажется ещё раз.
  }
}

/** Игрок заходил в Таверну (гасит «Новое!» на главной). */
export function markTavernSeen(): void {
  setFlag(SEEN_KEY);
  setFlag(NOTICE_KEY);
}

/** Кружка — значок Таверны (своей иконки в скине нет). size — высота. */
export function mugIcon(scene: Phaser.Scene, x: number, y: number, size: number, color: number = SKIN_TINT.gold): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x, y });
  const s = size / 64;
  g.lineStyle(5 * s, color, 1);
  // Кружка.
  g.strokeRoundedRect(-22 * s, -14 * s, 34 * s, 40 * s, 5 * s);
  // Ручка.
  g.beginPath();
  g.arc(12 * s, 6 * s, 11 * s, -Math.PI / 2, Math.PI / 2, false);
  g.strokePath();
  // Пена.
  g.fillStyle(color, 1);
  for (const [fx, fy, r] of [
    [-16, -18, 7],
    [-5, -21, 8],
    [7, -18, 7],
  ]) g.fillCircle(fx * s, fy * s, r * s);
  // Обручи.
  g.lineStyle(3 * s, color, 0.8);
  g.lineBetween(-22 * s, 2 * s, 12 * s, 2 * s);
  return g;
}

/**
 * «Здание» на главной — общий вид плиток Таверна / Лавка / Охота (одинаковый размер, ряд под плитками 2×2):
 * медальон с иконкой, название, строка состояния; в правом верхнем углу — красный значок-число или зелёная точка.
 * Закрыто (data/unlocks.json) — тусклая плитка, замок в углу, вместо состояния «Откроется на этапе …» в две строки,
 * касание — тост. Возвращает фон (имя — для e2e), медальон и подпись (для пульса «Новое!»).
 */
export interface BuildingTile {
  bg: Phaser.GameObjects.NineSlice;
  art: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  /** Центр строки состояния. */
  statusY: number;
}

export function buildingTile(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  o: {
    name: string;
    title: string;
    /** Иконка поверх диска медальона (центр 0, 0), size — диаметр диска. */
    art: (size: number, tint: number) => Phaser.GameObjects.GameObject;
    open: boolean;
    /** Строка состояния открытой плитки. */
    status?: { text: string; color: string };
    lockId: Parameters<typeof lockedToast>[1];
    onOpen: () => void;
    /** Красный значок-число (0 — нет). */
    badge?: number;
    /** Зелёная точка «можно что-то сделать» (когда нет числа). */
    dot?: boolean;
  },
): BuildingTile {
  const bg = card(scene, x, y, w, h);
  bg.setName(o.name);
  const tint = o.open ? SKIN_TINT.gold : SKIN_TINT.creamDim;
  // Открыта — медальон, название и строка состояния; закрыта — медальон меньше, под названием «Откроется на этапе …» в две строки.
  const size = o.open ? 84 : 56;
  const top = y - h / 2;
  const artY = top + (o.open ? 12 : 10) + size / 2;
  const art = scene.add.container(x, artY, [scene.add.image(0, 0, 'skin_medallion').setDisplaySize(size, size), o.art(size, tint)]);
  const labelY = artY + size / 2 + (o.open ? 26 : 22);
  const label = text(scene, x, labelY, o.title, FS.body, o.open ? C.title : C.dim, TITLE_STYLE);
  const statusY = labelY + 38;
  if (!o.open) {
    bg.setAlpha(0.75);
    art.setAlpha(0.7);
    text(scene, x, labelY + 20, lockLabel(o.lockId), FS.caption, C.dim, { ...OUTLINE, wordWrap: { width: w - 40 }, lineSpacing: -4 }).setOrigin(0.5, 0);
    scene.add.image(x + w / 2 - 30, top + 30, skinIcon('lock')).setDisplaySize(36, 36).setTint(SKIN_TINT.creamDim);
    pressable(scene, bg, w, h, () => lockedToast(scene, o.lockId));
    return { bg, art, label, statusY };
  }
  if (o.status) text(scene, x, statusY, o.status.text, FS.caption, o.status.color, OUTLINE);
  pressable(scene, bg, w, h, o.onOpen);
  if (o.badge) cornerBadge(scene, x, y, w, h, o.badge);
  else if (o.dot) scene.add.circle(x + w / 2 - 22, top + 18, 13, 0x3fbf5a).setStrokeStyle(3, 0x0f2a12);
  return { bg, art, label, statusY };
}

/**
 * Плитка Таверны (центр x, y; размер w×h) — «здание» главной (buildingTile). Закрыта — тусклая с замком, нажатие — когда
 * откроется; открыта — переход в Таверну. Значок — бесплатный призыв и незабранный подарок; только что открылась и ещё
 * не заходили — пульс и лента «Новое!».
 */
export function tavernTile(scene: Phaser.Scene, x: number, y: number, w: number, h: number): void {
  const save = session.save;
  const st = summonStatus(save, today(), GAME);
  const n = st.unlocked ? tavernBadge(st, save.summon.welcomeGiven) : 0;
  const fresh = st.unlocked && !flag(SEEN_KEY);
  const t = buildingTile(scene, x, y, w, h, {
    name: 'tavernTile',
    title: 'Таверна',
    art: (size, tint) => mugIcon(scene, 2, 4, size * 0.62, tint),
    open: st.unlocked,
    // Только что открылась и ещё не заходили — вместо состояния лента «Новое!».
    status: fresh ? undefined : { text: 'Призыв героев', color: n > 0 ? C.success : C.muted },
    lockId: 'tavern',
    onOpen: () => scene.scene.start('Tavern'),
    badge: n,
  });
  if (!fresh) return;
  pulse(scene, t.bg, 1.04);
  pulse(scene, t.art, 1.08);
  pulse(scene, t.label, 1.04);
  const label = text(scene, 0, -1, 'Новое!', FS.caption, C.text, { fontStyle: 'bold' });
  scene.add.container(x, t.statusY, [scene.add.rectangle(0, 0, label.width + 24, 40, 0xb83a2a).setStrokeStyle(3, 0xffd84a), label]).setDepth(40);
  // Об открытии Таверны говорит баннер «Новая функция!» (unlockBanner.ts), отдельный тост не нужен.
}
