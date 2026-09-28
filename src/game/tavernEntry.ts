import Phaser from 'phaser';
import { summonStatus } from '../core';
import { GAME } from './content';
import { pulse } from './juice';
import { card, cornerBadge } from './screen';
import { session, today } from './session';
import { SKIN_TINT, skinIcon } from './skin';
import { tavernBadge } from './tavern';
import { C, FS, TITLE_STYLE } from './theme';
import { pressable, text } from './ui';
import { lockedToast } from './unlockBanner';

/**
 * Вход в Таверну с главной (H5): одна плитка-медальон, её ставит HomeScene одной строкой (tavernTile).
 * Значок — бесплатный призыв и незабранный подарок; только что открылась и ещё не заходили — пульс, «Новое!»
 * и один раз тост «Открыта Таверна».
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
 * Плитка Таверны (центр x, y; размер w×h). Закрыта — тусклая с замком, нажатие — когда откроется;
 * открыта — переход в Таверну.
 */
export function tavernTile(scene: Phaser.Scene, x: number, y: number, w = 170, h = 170): void {
  const save = session.save;
  const st = summonStatus(save, today(), GAME);
  const bg = card(scene, x, y, w, h);
  const small = h < 200;
  const icon = mugIcon(scene, x, y - (small ? 22 : 30), small ? 64 : 80, st.unlocked ? SKIN_TINT.gold : SKIN_TINT.creamDim);
  const label = text(scene, x, y + (small ? 48 : 50), 'Таверна', small ? FS.caption : FS.h2, st.unlocked ? C.title : C.dim, TITLE_STYLE);
  if (!st.unlocked) {
    bg.setAlpha(0.75);
    icon.setAlpha(0.7);
    scene.add.image(x + w / 2 - 30, y - h / 2 + 30, skinIcon('lock')).setDisplaySize(38, 38).setTint(SKIN_TINT.creamDim);
    // «Таверна: откроется на этапе 1-5» (этап — data/unlocks.json).
    pressable(scene, bg, w, h, () => lockedToast(scene, 'tavern'));
    return;
  }
  pressable(scene, bg, w, h, () => scene.scene.start('Tavern'));
  bg.setName('tavernTile');
  const fresh = !flag(SEEN_KEY);
  if (fresh) {
    pulse(scene, bg, 1.04);
    pulse(scene, icon, 1.08);
    pulse(scene, label, 1.04);
    // Лента «Новое!» — по нижнему краю плитки (в правом верхнем углу — значок).
    const t = text(scene, 0, -1, 'Новое!', FS.caption, C.text, { fontStyle: 'bold' });
    const tag = scene.add.container(x, y + h / 2 + 4, [scene.add.rectangle(0, 0, t.width + 28, 40, 0xb83a2a).setStrokeStyle(3, 0xffd84a), t]);
    tag.setDepth(40);
  }
  cornerBadge(scene, x, y, w, h, tavernBadge(st, save.summon.welcomeGiven));
  // Об открытии Таверны теперь говорит баннер «Новая функция!» (unlockBanner.ts), отдельный тост не нужен.
}
