import { S } from './theme';

/** A readable scrollable body, with the main action above the navigation on every viewport. */
export function adventureModeLayout(bottom: number, top = 170, actionH = 144) {
  const footerY = bottom - S.xs - actionH / 2;
  const footerTop = footerY - actionH / 2 - S.xs;
  return { bodyTop: top, bodyBottom: Math.max(top + 1, footerTop - S.xs), footerTop, footerY, bottom };
}
