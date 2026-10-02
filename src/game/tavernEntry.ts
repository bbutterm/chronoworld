import Phaser from 'phaser';
import { summonStatus } from '../core';
import { GAME } from './content';
import { artCardTexture, artEntry, type EntryView } from './homeBuildings';
import { decorTween, pulse } from './juice';
import { ensureTavernTextures, TAVERN_BG, TAVERN_BG_FILE } from './tavernArt';
import { card, cornerBadge } from './screen';
import { session, today } from './session';
import { SKIN_TINT, skinIcon } from './skin';
import { C, E, FS, M, OUTLINE, TITLE_STYLE } from './theme';
import { pressable, text } from './ui';
import { lockedToast, lockLabel } from './unlockBanner';

/**
 * Вход в Таверну со страницы «Город» (H5): витрина-картинка (artEntry, homeBuildings.ts), её ставит HomeScene одной
 * строкой (tavernTile). Здесь же — buildingTile, общий вид плиток страницы «Приключения».
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
 * «Здание» — общий вид плиток страниц «Город» (Таверна, Лавка, Задания, Достижения) и «Приключения» (Башня,
 * Экспедиции, Охота): медальон с иконкой, название, строка состояния и (у крупной плитки) строка-пояснение; в правом
 * верхнем углу — красный значок-число или зелёная точка. Размер медальона и шрифты — по размеру плитки: крупная
 * (высота ≥ 300) — медальон до 230, название FS.h1; содержимое — по центру плитки по высоте.
 * Закрыто (data/unlocks.json) — тусклая плитка, замок в углу, вместо состояния «Откроется на этапе …»,
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
    /** Пояснение под состоянием (только крупная плитка): что здесь делают. */
    note?: string;
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
  const big = h >= 300;
  const tint = o.open ? SKIN_TINT.gold : SKIN_TINT.creamDim;
  // Открыта — медальон, название и строка состояния; закрыта — медальон меньше, под названием «Откроется на этапе …».
  const size = Math.round(Math.min(big ? 230 : 84, Math.min(w, h) * (o.open ? 0.44 : 0.3)));
  const labelGap = big ? 50 : o.open ? 26 : 22;
  const statusGap = big ? 60 : 38;
  const note = big && o.open && o.note ? o.note : '';
  const top = y - h / 2;
  // Высота содержимого (медальон, название, состояние или замок, пояснение) — чтобы поставить его по центру плитки.
  const block = size + labelGap + (o.open ? statusGap + 20 : 80) + (note ? 70 : 0);
  const artY = top + Math.max(o.open ? 12 : 10, (h - block) / 2) + size / 2;
  if (big) scene.add.image(x, artY, 'skin_glow').setDisplaySize(size * 1.9, size * 1.9).setTint(o.open ? 0xffd27a : 0x6a6050).setAlpha(o.open ? 0.28 : 0.15);
  const art = scene.add.container(x, artY, [scene.add.image(0, 0, 'skin_medallion').setDisplaySize(size, size), o.art(size, tint)]);
  const labelY = artY + size / 2 + labelGap;
  const label = text(scene, x, labelY, o.title, big ? FS.h1 : FS.body, o.open ? C.title : C.dim, TITLE_STYLE);
  const statusY = labelY + statusGap;
  if (!o.open) {
    bg.setAlpha(0.75);
    art.setAlpha(0.7);
    text(scene, x, labelY + (big ? 40 : 20), lockLabel(o.lockId), big ? FS.body : FS.caption, C.dim, { ...OUTLINE, wordWrap: { width: w - 40 }, lineSpacing: -4 }).setOrigin(0.5, 0);
    scene.add.image(x + w / 2 - (big ? 44 : 30), top + (big ? 44 : 30), skinIcon('lock')).setDisplaySize(big ? 52 : 36, big ? 52 : 36).setTint(SKIN_TINT.creamDim);
    pressable(scene, bg, w, h, () => lockedToast(scene, o.lockId));
    return { bg, art, label, statusY };
  }
  if (o.status) text(scene, x, statusY, o.status.text, big ? FS.h3 : FS.caption, o.status.color, OUTLINE);
  if (note) text(scene, x, statusY + 36, note, FS.small, C.muted, { ...OUTLINE, wordWrap: { width: w - 60 }, align: 'center', lineSpacing: -2 }).setOrigin(0.5, 0);
  pressable(scene, bg, w, h, o.onOpen);
  if (o.badge) cornerBadge(scene, x, y, w, h, o.badge);
  else if (o.dot) scene.add.circle(x + w / 2 - 22, top + 18, 13, 0x3fbf5a).setStrokeStyle(3, 0x0f2a12);
  return { bg, art, label, statusY };
}

/**
 * Картинка витрины Таверны: камин зала «Два колокола» (нарисованный фон tavernArt.ts или файл владельца bg_tavern),
 * вырезанный под размер карточки. Возвращает ключ текстуры и где на карточке огонь (доля ширины/высоты).
 */
function tavernArt(scene: Phaser.Scene, w: number, h: number): { key: string; fire: { x: number; y: number } } {
  ensureTavernTextures(scene);
  const srcKey = scene.textures.exists(TAVERN_BG_FILE) ? TAVERN_BG_FILE : TAVERN_BG;
  const src = scene.textures.get(srcKey).getSourceImage() as CanvasImageSource & { width: number; height: number };
  // Координаты канваса 720×1280: камин — (360, 470), полки с бутылками и фонари вокруг. Файл владельца — тот же кадр.
  const k = src.width / 720;
  const ch = Math.min(src.height, 600 * k);
  const cw = Math.min(src.width, (ch * w) / h);
  const cx0 = (src.width - cw) / 2;
  const cy0 = Math.max(0, 470 * k - ch * 0.5);
  const fire = { x: (360 * k - cx0) / cw, y: (490 * k - cy0) / ch };
  const key = artCardTexture(scene, `tavern_${srcKey}`, w, h, (c, W, H) => c.drawImage(src, cx0, cy0, cw, ch, 0, 0, W, H));
  return { key, fire };
}

/**
 * Витрина Таверны на странице «Город» (центр x, y; размер w×h): камин зала, «Таверна» крупно. Состояние — тег сверху:
 * «Подарок» (подарок открытия не забран), «Бесплатный призыв», только что открылась и ещё не заходили — «Новое» и
 * пульс. Закрыта — приглушённая с замком и «Откроется на этапе …», касание — тост.
 */
export function tavernTile(scene: Phaser.Scene, x: number, y: number, w: number, h: number): EntryView {
  const save = session.save;
  const st = summonStatus(save, today(), GAME);
  const fresh = st.unlocked && !flag(SEEN_KEY);
  const gift = st.unlocked && !save.summon.welcomeGiven;
  const art = tavernArt(scene, w, h);
  const state = fresh ? { label: 'Новое', tone: 'accent' as const } : gift ? { label: 'Подарок', tone: 'accent' as const } : st.freeLeft > 0 ? { label: 'Бесплатный призыв', tone: 'accent' as const } : undefined;
  const t = artEntry(scene, x, y, w, h, art.key, {
    name: 'tavernTile',
    title: 'Таверна',
    open: st.unlocked,
    lockId: 'tavern',
    onOpen: () => scene.scene.start('Tavern'),
    state: st.unlocked ? state : undefined,
    // Огонь в камине дышит (украшение: без «Уменьшить анимацию», в общем лимите твинов).
    extra: (root) => {
      if (!st.unlocked) return;
      const fx = (art.fire.x - 0.5) * w;
      const fy = (art.fire.y - 0.5) * h;
      const glow = scene.add.image(fx, fy, 'skin_glow').setDisplaySize(w * 0.62, w * 0.62).setTint(0xff9a40).setAlpha(0.32).setBlendMode(Phaser.BlendModes.ADD);
      root.add(glow);
      decorTween(scene, { targets: glow, alpha: { from: 0.22, to: 0.42 }, duration: M.emphasis * 1.5, yoyo: true, repeat: -1, ease: E.inOut });
    },
  });
  // Только что открылась — карточка один раз «вздыхает» (об открытии говорит баннер «Новая функция!»).
  if (fresh) pulse(scene, t.root, 1.03);
  return t;
}
