/**
 * Вход в «Друзья и рекорды» со страницы «Город»: кнопка слева от ленты «Город» (справа — «Летопись»). Только в
 * Telegram (online/api.ts onlineAvailable); вне Telegram кнопки нет. Красный кружок — сколько колокольчиков ждёт.
 */
import Phaser from 'phaser';
import { badge } from '../screen';
import { SKIN_TINT } from '../skin';
import { FS } from '../theme';
import { button } from '../ui';
import { onlineAvailable } from './api';
import { normalizeAppLink } from './logic';
import { onlineState, onOnlineChange } from './online';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

/** Ссылка на Mini App для приглашений (VITE_TG_APP_LINK, https://t.me/<бот>/<app>) или null — «Позвать друга» скрыта. */
export const appLink = (): string | null => normalizeAppLink(env.VITE_TG_APP_LINK);

/** Колокольчик (своей иконки в скине нет). */
export function bellIcon(scene: Phaser.Scene, x: number, y: number, size: number, color: number = SKIN_TINT.gold): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x, y });
  const s = size / 2;
  g.fillStyle(color, 1);
  g.beginPath();
  g.moveTo(-s * 0.75, s * 0.45);
  g.lineTo(-s * 0.55, -s * 0.2);
  g.arc(0, -s * 0.2, s * 0.55, Math.PI, 0, false);
  g.lineTo(s * 0.75, s * 0.45);
  g.closePath();
  g.fillPath();
  g.fillRect(-s * 0.85, s * 0.42, s * 1.7, s * 0.16);
  g.fillCircle(0, s * 0.72, s * 0.17);
  g.fillCircle(0, -s * 0.82, s * 0.12);
  return g;
}

/** Кнопка «Друзья» (null — не Telegram). */
export function friendsButton(scene: Phaser.Scene, x: number, y: number, w = 260, h = 96): Phaser.GameObjects.Container | null {
  if (!onlineAvailable()) return null;
  const b = button(scene, x, y, w, h, 'k:buttonLong_beige', 'Друзья', () => scene.scene.start('Friends'), FS.body);
  b.label.setX(28);
  b.container.add(bellIcon(scene, 28 - b.label.width / 2 - 34, -4, 48));
  b.container.setName('friendsBtn');
  let dot: Phaser.GameObjects.Container | null = null;
  const draw = () => {
    if (!b.container.scene) return;
    dot?.destroy();
    dot = badge(scene, x + w / 2 - 16, y - h / 2 - 6, onlineState.giftsWaiting);
    dot?.setName('friendsBadge');
  };
  draw();
  const off = onOnlineChange(draw);
  b.container.once(Phaser.GameObjects.Events.DESTROY, off);
  return b.container;
}
