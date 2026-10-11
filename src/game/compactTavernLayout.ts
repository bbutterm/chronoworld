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
const MIN_FIT_W = 200;

/**
 * Карты сохраняют читаемое имя: на адаптивном телефоне три-четыре колонки и отдельная полоса итоговых действий.
 * safeTop — верх видимой области (view().safeTop, ≤ 0 на высоком экране): серия начинается под «Пропустить» от
 * верха экрана, а не с фиксированной отметки — иначе в Telegram на высоком телефоне сверху пустая полоса, а ×10
 * не влезает (скриншот владельца 11.10).
 */
export function tavernRevealLayout(count: number, safeBottom: number, adaptive: boolean, safeTop = 0) {
  const top = adaptive ? Math.round(safeTop) + 200 : 320;
  /** «Пропустить» — над серией. */
  const skipY = adaptive ? top - 84 : 236;
  const prepareY = safeBottom - (adaptive ? 350 : 490);
  let slots: CardSlot[];
  if (!adaptive) slots = cardSlots(count, 960).map((slot) => ({ ...slot, y: slot.y - top }));
  else {
    // Колонок — сколько нужно, чтобы вся серия влезла без прокрутки (3 или 4, карта при нужде чуть уже), но не уже
    // MIN_FIT_W: имя читается. Не влезает и так — три колонки и прокрутка (тесный телефон, имена важнее).
    const room = prepareY - 100 - top;
    // Ряд: карта + метка «+1 копия» / «В сумке» под ней (центр метки — на 34 ниже карты, высота ~60) + зазор.
    const GAP = 96;
    const need = (rows: number, h: number) => S.s + (rows - 1) * (h + GAP) + h + 96;
    const grid = (cols: number) => {
      const full = count === 1 ? 360 : Math.floor((GAME_W - 2 * S.l - (cols - 1) * S.s) / cols);
      const rows = Math.ceil(count / cols);
      // Не влезает — карта чуть уже (не уже MIN_FIT_W): лучше вся серия на экране, чем прокрутка.
      const fitH = (room - S.s - 96 - (rows - 1) * GAP) / rows;
      const w = count === 1 ? full : Math.min(full, Math.floor(fitH / 1.36));
      const h = Math.round(w * 1.36);
      return { cols, w, h, rowH: h + GAP, fits: need(rows, h) <= room };
    };
    const fallback = () => {
      const w = Math.floor((GAME_W - 2 * S.l - 2 * S.s) / 3);
      const h = Math.round(w * 1.36);
      return { cols: 3, w, h, rowH: h + GAP, fits: false };
    };
    // Из влезающих раскладок — с самой крупной картой.
    const g = count === 1 ? grid(1) : ([3, 4].map(grid).filter((x) => x.fits && x.w >= MIN_FIT_W).sort((x, y) => y.w - x.w)[0] ?? fallback());
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
  return { top, skipY, bottom: prepareY - 100, bodyHeight, slots, prepareY, doneY: safeBottom - (adaptive ? 140 : 280), deckY: safeBottom - 200 - top, shift: safeBottom - GAME_H };
}
