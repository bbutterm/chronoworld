/** Раскладка Летописи: вкладки, счётчик и прокрутка используют одну безопасную полосу. */
export function chronicleLayout(contentTop: number, contentBottom: number, minTouch: number, minFont: number) {
  const tabH = Math.max(132, minTouch);
  const summaryH = Math.max(36, minFont);
  const tabTop = contentTop + 24;
  const summaryTop = tabTop + tabH + 16;
  return {
    tabH,
    tabY: tabTop + tabH / 2,
    summaryY: summaryTop + summaryH / 2,
    listTop: summaryTop + summaryH + 24,
    listBottom: contentBottom,
    rowH: Math.max(144, minTouch),
    pageButtonH: Math.max(132, minTouch),
  };
}
