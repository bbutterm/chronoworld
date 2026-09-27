import { slotPosition } from '../core';
import type { Side } from '../core';

export const GAME_W = 1080;
export const GAME_H = 1920;
/** Высота шапки экрана (название, золото, гемы). */
export const HEADER_H = 150;

/** Арена — нижние 2/3 экрана. Координаты поля в ядре совпадают с экранными (ширина 1080). */
export const ARENA_TOP = 700;

/** Точка ног юнита в слоте. */
export function slotPos(side: Side, slot: number, dy = 0): { x: number; y: number } {
  const p = slotPosition(side, slot);
  return { x: p.x, y: p.y + dy };
}

export const FONT = 'Arial, "Helvetica Neue", sans-serif';
