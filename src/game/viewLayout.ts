import { BLEED_X, BLEED_Y, GAME_H, GAME_W } from './layout';

/** P8. Раскладка холста на экране (без Phaser — проверяется в тестах). Использует viewport.ts. */

/** Предел плотности холста: на слабых телефонах больше ×2 — лишняя заливка GPU без заметной разницы. */
export const MAX_DPR = 2;

/** Проверенные экраны с переменной высотой. Остальные сохраняют полное поле, пока их раскладка не адаптирована. */
export function supportsAdaptiveLayout(scene: string): boolean {
  return scene === 'Campaign' || scene === 'Adventure' || scene === 'Hero' || scene === 'Ascend' || scene === 'Heroes' || scene === 'HeroPick' || scene === 'Stage' || scene === 'Squad';
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface View {
  /** Высота раскладки интерфейса; ширина остаётся 1080, шрифты и кнопки не сжимаются по вертикали. */
  uiHeight: number;
  /** Проверенная адаптивная раскладка на телефоне, включая полную высоту1920 без вырезов. */
  adaptive: boolean;
  compact: boolean;
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
  /** Верх безопасной области (под вырезом) в координатах мира: ≤ 0; на 9:16 без выреза — 0. */
  safeTop: number;
  /** Низ безопасной области (над «домашней полоской») в координатах мира: ≥ uiHeight. */
  safeBottom: number;
}

/**
 * Раскладка холста для окна w×h CSS px с плотностью dpr и безопасными отступами insets.
 * Обычно поле1080×1920 целиком внутри безопасной области. Адаптивный телефон сохраняет ширину1080,
 * высота интерфейса равна доступной безопасной высоте; размеры кнопок и букв по вертикали остаются прежними.
 */
export function computeView(w: number, h: number, dpr: number, insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 }, maxDpr = MAX_DPR, adaptive = false): View {
  const safeW = Math.max(1, w - insets.left - insets.right);
  const safeH = Math.max(1, h - insets.top - insets.bottom);
  /** CSS-пикселей на единицу мира. */
  const portraitLayout = adaptive && w <= 600 && h > w;
  const compact = portraitLayout && safeH / GAME_H < safeW / GAME_W;
  const s = compact ? safeW / GAME_W : Math.min(safeW / GAME_W, safeH / GAME_H);
  const uiHeight = compact ? safeH / s : GAME_H;
  // Центр поля — в центре безопасной области.
  const cx = insets.left + safeW / 2;
  const cy = insets.top + safeH / 2;
  const left = Math.max(-BLEED_X, GAME_W / 2 - cx / s);
  const right = Math.min(GAME_W + BLEED_X, GAME_W / 2 + (w - cx) / s);
  const top = Math.max(-BLEED_Y, uiHeight / 2 - cy / s);
  const bottom = Math.min(uiHeight + BLEED_Y, uiHeight / 2 + (h - cy) / s);
  const cssLeft = cx + (left - GAME_W / 2) * s;
  const cssTop = cy + (top - uiHeight / 2) * s;
  const cssW = (right - left) * s;
  const cssH = (bottom - top) * s;
  // Плотность: как у экрана (до maxDpr), но не ниже прежней «единица мира = пиксель холста» —
  // на DPR 3 картинка не становится хуже, чем была.
  const density = Math.max(Math.min(dpr, maxDpr), Math.min(dpr, 1 / s));
  const backW = Math.max(1, Math.round(cssW * density));
  const backH = Math.max(1, Math.round(cssH * density));
  return {
    uiHeight,
    adaptive: portraitLayout,
    compact,
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
    safeTop: Math.min(0, Math.max(top, uiHeight / 2 - (cy - insets.top) / s)),
    safeBottom: Math.max(uiHeight, Math.min(bottom, uiHeight / 2 + (h - insets.bottom - cy) / s)),
  };
}
