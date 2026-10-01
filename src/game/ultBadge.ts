import Phaser from 'phaser';
import { breaksCharge } from '../core';
import { CONTENT } from './content';

/**
 * Значок «молния»: ульта героя оглушает или срывает каст — ею сбивают заряд босса (docs/design/battle-decisions.md §4).
 * Признак — из данных навыка (`breaksCharge`: статус stun / interrupt в эффектах), руками ничего не размечается.
 * Рисуется графикой (не символом шрифта): одинаково в Telegram, на iOS и в headless-браузере.
 */

/** Ульта skillId сбивает заряд босса. */
export function ultBreaksCharge(skillId: string | undefined | null): boolean {
  const sk = skillId ? CONTENT.skills[skillId] : undefined;
  return !!sk && breaksCharge(sk);
}

/** Подпись к значку (карточка героя, окно навыка). */
export const BREAK_LABEL = 'сбивает заряд';

/**
 * Круглый значок с жёлтой молнией (центр x, y; диаметр size). size 44 на экране 1080 ≈ 16 CSS px на 390 px — читается.
 */
export function chargeBreakBadge(scene: Phaser.Scene, x: number, y: number, size = 44): Phaser.GameObjects.Container {
  const r = size / 2;
  const g = scene.add.graphics();
  g.fillStyle(0x1a0f04, 0.95);
  g.fillCircle(0, 0, r);
  g.lineStyle(Math.max(2, size * 0.07), 0xffd84a, 1);
  g.strokeCircle(0, 0, r - size * 0.035);
  // Молния: зигзаг сверху справа вниз влево.
  const k = size / 44;
  const bolt = [
    [3, -15],
    [-9, 2],
    [-1, 2],
    [-5, 15],
    [9, -3],
    [1, -3],
    [5, -15],
  ].map(([px, py]) => new Phaser.Math.Vector2(px * k, py * k));
  g.fillStyle(0xffe070, 1);
  g.fillPoints(bolt, true);
  g.lineStyle(Math.max(1, 1.5 * k), 0x6a3a00, 1);
  g.strokePoints(bolt, true);
  return scene.add.container(x, y, [g]).setName('chargeBreakBadge');
}
