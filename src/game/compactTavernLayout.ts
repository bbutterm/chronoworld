import { GAME_H, GAME_W } from './layout';
import { cardSlots, type CardSlot } from './tavern';
import { S } from './theme';

/** Зал прокручивается между шапкой и закреплёнными кнопками; подарок остаётся отдельным входом. */
export function tavernLayout(uiHeight: number, safeBottom: number, welcomeGiven: boolean) {
  const pullY = safeBottom - 260;
  const feetY = uiHeight < 1700 ? (welcomeGiven ? 780 : 1000) : 1120;
  return { bodyTop: 170, bodyBottom: pullY - 184, feetY, pityY: feetY + 270, pullY, freeY: safeBottom - 130 };
}

/** Карта не уже этого, когда колонок больше трёх (имя героя на карте ещё читается на телефоне). */
const MIN_FIT_W = 220;

/** Карты сохраняют читаемое имя: на адаптивном телефоне три колонки и отдельная полоса итоговых действий. */
export function tavernRevealLayout(count: number, safeBottom: number, adaptive: boolean) {
  const top = 320;
  const prepareY = safeBottom - (adaptive ? 350 : 490);
  let slots: CardSlot[];
  if (!adaptive) slots = cardSlots(count, 960).map((slot) => ({ ...slot, y: slot.y - top }));
  else {
    // Колонок — сколько нужно, чтобы вся серия влезла без прокрутки (3 → 4), но карта не уже MIN_FIT_W: имя читается.
    // Не влезает и при 4 — три колонки и прокрутка (тесный телефон, имена важнее).
    const room = prepareY - 100 - top;
    const grid = (cols: number) => {
      const w = count === 1 ? 360 : Math.floor((GAME_W - 2 * S.l - (cols - 1) * S.s) / cols);
      const h = Math.round(w * 1.36);
      const rows = Math.ceil(count / cols);
      // Высота серии — как bodyHeight ниже: низ последней карты + место под метку «Новый».
      return { cols, w, h, rowH: h + 112, fits: S.s + (rows - 1) * (h + 112) + h + 96 <= room };
    };
    const g = count === 1 ? grid(1) : ([3, 4].map(grid).find((x) => x.fits && x.w >= MIN_FIT_W) ?? grid(3));
    const { cols, w, h, rowH } = g;
    slots = Array.from({ length: count }, (_, i) => {
      // Неполный последний ряд — по центру.
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, count - row * cols);
      const left = (GAME_W - (inRow * w + (inRow - 1) * S.s)) / 2;
      return { x: count === 1 ? GAME_W / 2 : left + w / 2 + (i % cols) * (w + S.s), y: S.s + h / 2 + row * rowH, w, h };
    });
  }
  const bodyHeight = Math.max(1, ...slots.map((slot) => slot.y + slot.h / 2 + 96));
  return { top, bottom: prepareY - 100, bodyHeight, slots, prepareY, doneY: safeBottom - (adaptive ? 140 : 280), deckY: safeBottom - 200 - top, shift: safeBottom - GAME_H };
}
