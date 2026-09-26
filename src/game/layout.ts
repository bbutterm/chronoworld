import { COMBAT } from '../core';
import type { Side } from '../core';

export const GAME_W = 1080;
export const GAME_H = 1920;

/** Арена — нижние 2/3 экрана. Игрок слева, враг справа, фронт ближе к центру. */
export const ARENA_TOP = 700;
const LANE_Y0 = 850;
const LANE_STEP = 205;
const COLUMN_X = { A: { front: 390, back: 150 }, B: { front: 690, back: 930 } };

export function slotPos(side: Side, slot: number, dy = 0): { x: number; y: number } {
  const row = COMBAT.slots.front.includes(slot) ? 'front' : 'back';
  return { x: COLUMN_X[side][row], y: LANE_Y0 + dy + COMBAT.slots.lane[slot] * LANE_STEP };
}

export const FONT = 'Arial, "Helvetica Neue", sans-serif';
