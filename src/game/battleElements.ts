import Phaser from 'phaser';
import { ELEMENT_GLYPH, ELEMENT_NAMES, ELEMENT_TINT, type Element } from '../core/elements';
import { text } from './ui';

/**
 * Значок стихии (docs/design/battle-decisions.md §3): цветной кружок с буквой, рисуется кодом (арт не нужен).
 * Нейтраль значка не получает — меньше шума.
 */
export function elementBadge(scene: Phaser.Scene, x: number, y: number, el: Element, size = 30): Phaser.GameObjects.Container {
  const r = size / 2;
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.55).fillCircle(0, 2, r + 2);
  g.fillStyle(ELEMENT_TINT[el], 1).fillCircle(0, 0, r);
  g.lineStyle(2, 0x1a1008, 0.9).strokeCircle(0, 0, r);
  const glyph = ELEMENT_GLYPH[el];
  const t = text(scene, 0, 0, glyph, Math.round(size * (glyph.length > 1 ? 0.5 : 0.62)), el === 'holy' ? '#5a4410' : '#ffffff', {
    fontStyle: 'bold',
    stroke: el === 'holy' ? '#fff8d8' : '#000000',
    strokeThickness: 3,
  });
  return scene.add.container(x, y, [g, t]).setName(`element_${el}`);
}

/** «огонь» → «Огонь». */
export const elementTitle = (el: Element): string => ELEMENT_NAMES[el][0].toUpperCase() + ELEMENT_NAMES[el].slice(1);
