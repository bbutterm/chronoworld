import { slotPosition } from '../core';
import type { Side } from '../core';
import { FAMILY } from './theme';

export const GAME_W = 1080;
export const GAME_H = 1920;
/**
 * P8. Поля за краями поля 1080×1920, которые видны на вытянутых (19.5:9, 20:9) и широких (планшет 3:4) экранах:
 * фон, шапка, навигация и затемнения окон продолжаются туда (viewport.ts). Интерактив в поля не ставить —
 * на экране 9:16 их не видно.
 */
export const BLEED_X = 240;
export const BLEED_Y = 360;
/** Высота шапки экрана (название, золото, гемы). */
export const HEADER_H = 150;

/** Арена — нижние 2/3 экрана. Координаты поля в ядре совпадают с экранными (ширина 1080). */
export const ARENA_TOP = 700;

/** Точка ног юнита в слоте. */
export function slotPos(side: Side, slot: number, dy = 0): { x: number; y: number } {
  const p = slotPosition(side, slot);
  return { x: p.x, y: p.y + dy };
}

/** Текстовая гарнитура (Rubik) — для текста вне text() из ui.ts (бой, экран загрузки). Заголовочная — FAMILY.heading (theme.ts). */
export const FONT = FAMILY.body;
