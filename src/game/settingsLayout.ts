import { S, TOUCH_COMFORT } from './theme';

/** Fixed chrome; only settings rows scroll. All coordinates are 1080×1920 world units. */
export const SETTINGS_LAYOUT = {
  panelW: 880,
  panelH: 1680,
  titleY: 210,
  bodyTop: 300,
  bodyBottom: 1516,
  hintY: 1552,
  versionY: 1612,
  closeY: 1710,
  contentW: 720,
  valueW: 220,
  hitH: TOUCH_COMFORT,
  rowGap: S.s,
} as const;

/** Хром остаётся в безопасной области; содержимое настроек листается, а кнопка закрытия закреплена. */
export function settingsLayout(uiHeight = 1920) {
  const shift = uiHeight - 1920;
  return {
    ...SETTINGS_LAYOUT,
    panelH: SETTINGS_LAYOUT.panelH + shift,
    bodyBottom: SETTINGS_LAYOUT.bodyBottom + shift,
    hintY: SETTINGS_LAYOUT.hintY + shift,
    versionY: SETTINGS_LAYOUT.versionY + shift,
    closeY: SETTINGS_LAYOUT.closeY + shift,
  };
}

/** Measured wrapped labels and explanations grow downwards, never into the next control. */
export function settingsRowLayout(labelHeight: number, explanationHeight = 0) {
  const rowH = Math.max(SETTINGS_LAYOUT.hitH, labelHeight);
  const explanationY = rowH + S.xs;
  return {
    rowH,
    centerY: rowH / 2,
    explanationY,
    height: (explanationHeight > 0 ? explanationY + explanationHeight : rowH) + SETTINGS_LAYOUT.rowGap,
  };
}
