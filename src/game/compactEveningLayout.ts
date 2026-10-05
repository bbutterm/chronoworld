import { S, TOUCH_COMFORT } from './theme';

/** Имена приходят из public eveningSquadHeroes: [] остаётся явным отсутствием начисления. */
export function eveningCreditPreview(names: readonly string[], gain: number): string {
  return names.length ? `За главу +${gain} близости: ${names.join(', ')}` : 'Близость за главу не начисляется';
}

/** Подпись начисления переносится целиком под названием и действием, не вытесняя touch-цель. */
export function eveningPreviewRowHeight(subtitleHeight: number): number {
  return Math.max(288, 128 + subtitleHeight + S.s);
}

/** Целая цель «i» находится в полосе списка; первая строка вечера начинается ниже неё. */
export function eveningSectionLayout(top: number, touchSize: number) {
  return { headingY: top + touchSize / 2, nextTop: top + touchSize + S.xs };
}

/** Реплика и счётчик закреплены внизу; длинная реплика читается внутри собственной полосы. */
export function eveningDialogueLayout(safeBottom: number) {
  const panelHeight = 460;
  const panelY = safeBottom - 30 - panelHeight / 2;
  const top = panelY - panelHeight / 2;
  return { safeBottom, panelY, top, bodyTop: top + 132, bodyBottom: safeBottom - 116 };
}

/** Ответы сохраняют измеренную высоту и листаются, когда не помещаются над панелью реплики. */
export function eveningChoiceBounds(panelTop: number, contentHeight: number) {
  const bottom = panelTop - 80;
  const firstAnswerTop = Math.max(216, Math.min(280, bottom - TOUCH_COMFORT));
  return { top: Math.min(bottom - 1, Math.max(firstAnswerTop, bottom - contentHeight)), bottom };
}

/** Шапка результата и нижние действия отделены от длинного списка близости/задания. */
export function eveningModalLayout(uiHeight: number, contentHeight: number, headerHeight = 150) {
  const height = Math.min(Math.max(340, uiHeight - 240), headerHeight + contentHeight + 2 * S.l + TOUCH_COMFORT);
  const top = uiHeight / 2 - height / 2;
  const buttonY = top + height - S.l - TOUCH_COMFORT / 2;
  return { height, top, centerY: uiHeight / 2, buttonY, bodyTop: top + headerHeight, bodyBottom: buttonY - TOUCH_COMFORT / 2 - S.s };
}
