import Phaser from 'phaser';
import type { Slot } from '../core';
import { TINT } from './theme';

/**
 * T3-27. Иконки предметов без нового арта: силуэт по слоту (оружие — клинок, лук, посох или топор; доспех, шлем, сапоги), нарисованный на холсте
 * оттенками серого — setTint цветом редкости даёт цветную иконку с объёмом. Текстуры строятся лениво, один раз.
 */
type Ctx = CanvasRenderingContext2D;

const S = 96;

type Shape = Slot | 'bow' | 'staff' | 'axe';

const DRAW: Record<Shape, (c: Ctx) => void> = {
  weapon: (c) => {
    // Клинок по диагонали, гарда, рукоять, навершие.
    c.save();
    c.translate(S / 2, S / 2);
    c.rotate(-Math.PI / 4);
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(0, -44);
    c.lineTo(8, -32);
    c.lineTo(8, 14);
    c.lineTo(-8, 14);
    c.lineTo(-8, -32);
    c.closePath();
    c.fill();
    c.fillStyle = '#b8b8b8';
    c.fillRect(-2, -34, 4, 46);
    c.fillStyle = '#d8d8d8';
    c.fillRect(-22, 14, 44, 8);
    c.fillStyle = '#8a8a8a';
    c.fillRect(-5, 22, 10, 18);
    c.fillStyle = '#e8e8e8';
    c.beginPath();
    c.arc(0, 44, 7, 0, Math.PI * 2);
    c.fill();
    c.restore();
  },
  armor: (c) => {
    c.fillStyle = '#e8e8e8';
    c.beginPath();
    c.moveTo(28, 14);
    c.lineTo(40, 20);
    c.quadraticCurveTo(48, 26, 56, 20);
    c.lineTo(68, 14);
    c.lineTo(84, 26);
    c.lineTo(76, 44);
    c.lineTo(70, 40);
    c.lineTo(70, 82);
    c.quadraticCurveTo(48, 90, 26, 82);
    c.lineTo(26, 40);
    c.lineTo(20, 44);
    c.lineTo(12, 26);
    c.closePath();
    c.fill();
    c.fillStyle = '#a8a8a8';
    c.fillRect(46, 30, 4, 50);
    c.fillStyle = '#c8c8c8';
    c.fillRect(30, 56, 36, 5);
  },
  helmet: (c) => {
    c.fillStyle = '#e8e8e8';
    c.beginPath();
    c.moveTo(18, 66);
    c.bezierCurveTo(16, 30, 30, 14, 48, 14);
    c.bezierCurveTo(66, 14, 80, 30, 78, 66);
    c.lineTo(84, 78);
    c.lineTo(12, 78);
    c.closePath();
    c.fill();
    c.fillStyle = '#6a6a6a';
    c.fillRect(28, 46, 40, 8);
    c.fillStyle = '#b0b0b0';
    c.fillRect(45, 16, 6, 30);
  },
  bow: (c) => {
    // Дуга лука, тетива и стрела.
    c.strokeStyle = '#e8e8e8';
    c.lineWidth = 9;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(24, 12);
    c.quadraticCurveTo(92, 48, 24, 84);
    c.stroke();
    c.strokeStyle = '#a0a0a0';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(24, 12);
    c.lineTo(24, 84);
    c.stroke();
    c.strokeStyle = '#d0d0d0';
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(16, 48);
    c.lineTo(80, 48);
    c.stroke();
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(88, 48);
    c.lineTo(74, 40);
    c.lineTo(74, 56);
    c.closePath();
    c.fill();
  },
  staff: (c) => {
    // Древко по диагонали и навершие-кристалл.
    c.strokeStyle = '#a8a8a8';
    c.lineWidth = 9;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(20, 84);
    c.lineTo(62, 34);
    c.stroke();
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(72, 8);
    c.lineTo(86, 24);
    c.lineTo(72, 44);
    c.lineTo(58, 24);
    c.closePath();
    c.fill();
    c.fillStyle = '#c8c8c8';
    c.beginPath();
    c.moveTo(72, 8);
    c.lineTo(86, 24);
    c.lineTo(72, 24);
    c.closePath();
    c.fill();
  },
  axe: (c) => {
    c.strokeStyle = '#9a9a9a';
    c.lineWidth = 9;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(26, 86);
    c.lineTo(64, 16);
    c.stroke();
    c.fillStyle = '#e8e8e8';
    c.beginPath();
    c.moveTo(56, 22);
    c.quadraticCurveTo(92, 14, 88, 48);
    c.quadraticCurveTo(70, 40, 50, 36);
    c.closePath();
    c.fill();
  },
  boots: (c) => {
    c.fillStyle = '#e8e8e8';
    c.beginPath();
    c.moveTo(30, 12);
    c.lineTo(58, 12);
    c.lineTo(58, 56);
    c.quadraticCurveTo(84, 60, 86, 76);
    c.lineTo(86, 84);
    c.lineTo(28, 84);
    c.closePath();
    c.fill();
    c.fillStyle = '#9a9a9a';
    c.fillRect(28, 76, 58, 8);
    c.fillStyle = '#c0c0c0';
    c.fillRect(30, 12, 28, 8);
  },
};

/** Форма иконки: слот, а у оружия — вид по id предмета (лук, посох, топор; остальное — клинок). */
function shapeOf(slot: Slot, itemId = ''): Shape {
  if (slot !== 'weapon') return slot;
  if (/bow|arbalest/.test(itemId)) return 'bow';
  if (/staff|rod|mace/.test(itemId)) return 'staff';
  if (/axe/.test(itemId)) return 'axe';
  return 'weapon';
}

/** Ключ текстуры иконки (строится при первом обращении). */
export function itemIconKey(scene: Phaser.Scene, slot: Slot, itemId?: string): string {
  const shape = shapeOf(slot, itemId);
  const key = `item_ico_${shape}`;
  if (!scene.textures.exists(key)) {
    const t = scene.textures.createCanvas(key, S, S);
    if (t) {
      const c = t.getContext();
      c.lineJoin = 'round';
      DRAW[shape](c);
      t.refresh();
    }
  }
  return key;
}

/**
 * Квадрат-ячейка с иконкой предмета: тёмная подложка, рамка и иконка цветом редкости (как ячейки в AFK Arena).
 * Возвращает объекты (подложка, иконка) — вызывающий кладёт их в свой контейнер/список.
 */
export function itemCell(scene: Phaser.Scene, x: number, y: number, size: number, slot: Slot | null, color: number, itemId?: string): Phaser.GameObjects.GameObject[] {
  const bg = scene.add.rectangle(x, y, size, size, TINT.checkOff, 0.95).setStrokeStyle(4, color, 1);
  if (!slot) return [bg];
  const ico = scene.add.image(x, y, itemIconKey(scene, slot, itemId)).setDisplaySize(size * 0.78, size * 0.78).setTint(color);
  return [bg, ico];
}
