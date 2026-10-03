import { S, TOUCH_COMFORT } from './theme';

/** Flank the figure, leaving the information column and bottom card actions clear. */
export function heroBrowseLayout(infoLeft: number, top: number) {
  return {
    prevX: TOUCH_COMFORT / 2,
    nextX: infoLeft - S.xs - TOUCH_COMFORT / 2,
    y: top + 330,
    w: TOUCH_COMFORT,
    h: TOUCH_COMFORT,
  };
}
