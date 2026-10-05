import { GAME_H, GAME_W } from './layout';
import type { BattlePresentationBounds } from './battlePresentation';

/** Scene geometry only; combat positions and time remain in the core's original coordinate system. */
export function battleScreenLayout(uiHeight: number, safeTop: number, safeBottom: number, touch: number, hasAuto: boolean) {
  const bottom = Math.max(uiHeight, safeBottom);
  const panelShift = Math.min(360, bottom - GAME_H);
  const hudY = Math.max(72, touch / 2 + 8) - Math.min(360, Math.max(0, -safeTop));
  const height = Math.max(96, touch);
  const widths = { sound: height, speed: Math.max(104, touch), auto: Math.max(132, touch), skip: Math.max(228, touch) };
  const skip = GAME_W - 40 - widths.skip / 2;
  const auto = skip - widths.skip / 2 - 12 - widths.auto / 2;
  const speed = (hasAuto ? auto - widths.auto / 2 : skip - widths.skip / 2) - 12 - widths.speed / 2;
  const sound = speed - widths.speed / 2 - 12 - widths.sound / 2;
  const arena: BattlePresentationBounds = { minX: 40, maxX: GAME_W - 40, minY: hudY + 320, maxY: bottom - 281 };
  const compact = uiHeight < GAME_H;
  const actorFactor = compact ? Math.max(0.78, Math.min(1, (arena.maxY - arena.minY) / 1200)) : 1;
  return { bottom, panelShift, hudY, bossBarY: hudY + 170, height, widths, controls: { skip, auto, speed, sound }, arena, compact, actorFactor };
}

/** The starting three back rows retain room on a short phone; the full-height renderer keeps its prior y mapping. */
export function presentedBattleY(y: number, arena: BattlePresentationBounds, compact: boolean, fullDy: number): number {
  if (!compact) return y - fullDy;
  const topFeet = arena.minY + Math.min(240, (arena.maxY - arena.minY) * 0.35);
  const bottomFeet = arena.maxY - 80;
  return topFeet + (y - 1090) / 640 * (bottomFeet - topFeet);
}

/** Endpoint bodies scroll; navigation stays reachable and never scales its labels or hit areas. */
export function battleResultLayout(uiHeight: number, safeBottom: number) {
  const bottom = Math.max(uiHeight, safeBottom);
  const compact = uiHeight < GAME_H;
  const bannerY = compact ? 180 : 300;
  const row2 = bottom - 132;
  const row1 = row2 - 176;
  return { bannerY, bodyTop: compact ? 330 : 470, bodyBottom: row1 - 110, row1, row2, bottom };
}

export function chapterDoneLayout(uiHeight: number, safeBottom: number) {
  const bottom = Math.max(uiHeight, safeBottom);
  const compact = uiHeight < GAME_H;
  const titleY = compact ? 170 : 330;
  const ctaY = bottom - 180;
  return { titleY, bodyTop: compact ? 330 : 510, bodyBottom: ctaY - 110, ctaY, bottom };
}
