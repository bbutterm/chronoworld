import { BLEED_X, BLEED_Y, GAME_H, GAME_W } from './layout';

/** P8. Раскладка холста на экране (без Phaser — проверяется в тестах). Использует viewport.ts. */

/** Предел плотности холста: на слабых телефонах больше ×2 — лишняя заливка GPU без заметной разницы. */
export const MAX_DPR = 2;

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface View {
  /** Холст в CSS-пикселях: положение и размер внутри окна. */
  cssLeft: number;
  cssTop: number;
  cssW: number;
  cssH: number;
  /** Размер холста в физических пикселях (backing store). */
  backW: number;
  backH: number;
  /** Физических пикселей холста на один CSS-пиксель. */
  density: number;
  /** Физических пикселей холста на единицу мира (зум камеры). */
  zoom: number;
  /** Видимая часть мира. */
  worldX: number;
  worldY: number;
  worldW: number;
  worldH: number;
}

/**
 * Раскладка холста для окна w×h CSS px с плотностью dpr и безопасными отступами insets.
 * Поле 1080×1920 целиком внутри безопасной области; вокруг — сколько поместится мира, но не больше полей.
 */
export function computeView(w: number, h: number, dpr: number, insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 }, maxDpr = MAX_DPR): View {
  const safeW = Math.max(1, w - insets.left - insets.right);
  const safeH = Math.max(1, h - insets.top - insets.bottom);
  /** CSS-пикселей на единицу мира. */
  const s = Math.min(safeW / GAME_W, safeH / GAME_H);
  // Центр поля — в центре безопасной области.
  const cx = insets.left + safeW / 2;
  const cy = insets.top + safeH / 2;
  const left = Math.max(-BLEED_X, GAME_W / 2 - cx / s);
  const right = Math.min(GAME_W + BLEED_X, GAME_W / 2 + (w - cx) / s);
  const top = Math.max(-BLEED_Y, GAME_H / 2 - cy / s);
  const bottom = Math.min(GAME_H + BLEED_Y, GAME_H / 2 + (h - cy) / s);
  const cssLeft = cx + (left - GAME_W / 2) * s;
  const cssTop = cy + (top - GAME_H / 2) * s;
  const cssW = (right - left) * s;
  const cssH = (bottom - top) * s;
  // Плотность: как у экрана (до maxDpr), но не ниже прежней «единица мира = пиксель холста» —
  // на DPR 3 картинка не становится хуже, чем была.
  const density = Math.max(Math.min(dpr, maxDpr), Math.min(dpr, 1 / s));
  const backW = Math.max(1, Math.round(cssW * density));
  const backH = Math.max(1, Math.round(cssH * density));
  return {
    cssLeft,
    cssTop,
    cssW,
    cssH,
    backW,
    backH,
    density,
    zoom: backW / (right - left),
    worldX: left,
    worldY: top,
    worldW: right - left,
    worldH: bottom - top,
  };
}

