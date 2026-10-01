import Phaser from 'phaser';
import { ELEMENT_NAMES, ELEMENT_TINT, type Element } from '../core/elements';

/**
 * Значок стихии (docs/design/battle-decisions.md §3): цветной кружок с пиктограммой, рисуется кодом (арт не нужен).
 * BUG-189: буквы («З» читалась как 3, «О» — как 0, «В»/«Вт» путались) заменены пиктограммами: пламя, капля, лист,
 * вихрь, звезда, полумесяц, череп. Рисуется один раз в текстуру на (стихия, размер) — дальше это одна картинка.
 * Нейтраль значка не получает — меньше шума.
 */
export function elementBadge(scene: Phaser.Scene, x: number, y: number, el: Element, size = 30): Phaser.GameObjects.Container {
  const key = `elementBadge_${el}_${Math.round(size)}`;
  if (!scene.textures.exists(key)) drawBadge(scene, key, el, size);
  const img = scene.add.image(0, 1, key);
  return scene.add.container(x, y, [img]).setName(`element_${el}`).setSize(size, size);
}

function drawBadge(scene: Phaser.Scene, key: string, el: Element, size: number): void {
  const pad = 3;
  const r = size / 2;
  const c = r + pad;
  const W = Math.ceil(size + pad * 2);
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0x000000, 0.55).fillCircle(c, c + 2, r + 2);
  g.fillStyle(ELEMENT_TINT[el], 1).fillCircle(c, c, r);
  g.lineStyle(Math.max(1.5, size / 22), 0x1a1008, 0.9).strokeCircle(c, c, r);
  const k = size / 30;
  const P = (pts: number[][]) => pts.map(([px, py]) => new Phaser.Math.Vector2(c + px * k, c + py * k));
  const ink = el === 'holy' ? 0x5a4410 : 0xffffff;
  const edge = el === 'holy' ? 0xfff8d8 : 0x1a1008;
  g.fillStyle(ink, 1);
  g.lineStyle(Math.max(1, 1.4 * k), edge, 0.9);
  switch (el) {
    case 'fire': {
      // Пламя: язык вверх, с изгибом.
      const pts = P([[0, -10], [4, -4], [7, 1], [6, 6], [2, 9], [-3, 9], [-7, 5], [-7, 0], [-4, -3], [-3, 1], [-1, -2]]);
      g.fillPoints(pts, true);
      g.strokePoints(pts, true);
      break;
    }
    case 'water': {
      // Капля: острый верх, круглый низ.
      g.fillCircle(c, c + 3 * k, 6 * k);
      const pts = P([[0, -10], [5.6, 1], [-5.6, 1]]);
      g.fillPoints(pts, true);
      g.lineStyle(Math.max(1, 1.4 * k), edge, 0.9).beginPath();
      g.arc(c, c + 3 * k, 6 * k, Phaser.Math.DegToRad(-20), Phaser.Math.DegToRad(200), false);
      g.strokePath();
      break;
    }
    case 'earth': {
      // Лист с прожилкой.
      const pts = P([[-8, 8], [-8, 0], [-4, -6], [3, -9], [9, -9], [8, -2], [4, 4], [-2, 8]]);
      g.fillPoints(pts, true);
      g.strokePoints(pts, true);
      g.lineStyle(Math.max(1, 1.3 * k), ELEMENT_TINT[el], 1).lineBetween(c - 8 * k, c + 8 * k, c + 5 * k, c - 5 * k);
      break;
    }
    case 'wind': {
      // Вихрь: три завитка-линии.
      g.lineStyle(Math.max(1.6, 2.4 * k), ink, 1);
      for (const [yy, w] of [[-5, 14], [0, 18], [5, 11]] as const) {
        g.beginPath();
        g.moveTo(c - 9 * k, c + yy * k);
        g.lineTo(c + (w - 12) * k, c + yy * k);
        g.strokePath();
      }
      g.beginPath();
      g.arc(c + 6 * k, c - 7.5 * k, 2.5 * k, Phaser.Math.DegToRad(90), Phaser.Math.DegToRad(-120), true);
      g.strokePath();
      g.beginPath();
      g.arc(c + 3 * k, c + 2.5 * k, 2.5 * k, Phaser.Math.DegToRad(-90), Phaser.Math.DegToRad(120), false);
      g.strokePath();
      break;
    }
    case 'holy': {
      // Четырёхлучевая звезда.
      const pts = P([[0, -11], [2.5, -2.5], [11, 0], [2.5, 2.5], [0, 11], [-2.5, 2.5], [-11, 0], [-2.5, -2.5]]);
      g.fillPoints(pts, true);
      g.strokePoints(pts, true);
      break;
    }
    case 'dark': {
      // Полумесяц: круг, «выкушенный» кругом цвета значка.
      g.fillCircle(c - 1 * k, c, 8 * k);
      g.fillStyle(ELEMENT_TINT[el], 1).fillCircle(c + 3.5 * k, c - 2.5 * k, 7 * k);
      break;
    }
    case 'undead': {
      // Череп: голова, глазницы, челюсть.
      g.fillCircle(c, c - 2 * k, 7.5 * k);
      g.fillRect(c - 4.5 * k, c + 3 * k, 9 * k, 5 * k);
      g.fillStyle(ELEMENT_TINT[el], 1);
      g.fillCircle(c - 3 * k, c - 2 * k, 2.2 * k);
      g.fillCircle(c + 3 * k, c - 2 * k, 2.2 * k);
      g.fillRect(c - 0.7 * k, c + 4 * k, 1.4 * k, 4 * k);
      break;
    }
    default:
      g.fillCircle(c, c, 3 * k);
  }
  g.generateTexture(key, W, W);
  g.destroy();
}

/** «огонь» → «Огонь». */
export const elementTitle = (el: Element): string => ELEMENT_NAMES[el][0].toUpperCase() + ELEMENT_NAMES[el].slice(1);
