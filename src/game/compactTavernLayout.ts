import { GAME_H, GAME_W } from './layout';
import { cardSlots, type CardSlot } from './tavern';
import { S } from './theme';

/** Зал прокручивается между шапкой и закреплёнными кнопками; подарок остаётся отдельным входом. */
export function tavernLayout(uiHeight: number, safeBottom: number, welcomeGiven: boolean) {
  const pullY = safeBottom - 260;
  const feetY = uiHeight < 1700 ? (welcomeGiven ? 780 : 1000) : 1120;
  return { bodyTop: 170, bodyBottom: pullY - 184, feetY, pityY: feetY + 270, pullY, freeY: safeBottom - 130 };
}

/** Карты сохраняют читаемое имя: на адаптивном телефоне три колонки и отдельная полоса итоговых действий. */
export function tavernRevealLayout(count: number, safeBottom: number, adaptive: boolean) {
  const top = 320;
  const prepareY = safeBottom - (adaptive ? 350 : 490);
  let slots: CardSlot[];
  if (!adaptive) slots = cardSlots(count, 960).map((slot) => ({ ...slot, y: slot.y - top }));
  else {
    const cols = count === 1 ? 1 : 3;
    const w = count === 1 ? 360 : Math.floor((GAME_W - 2 * S.l - (cols - 1) * S.s) / cols);
    const h = Math.round(w * 1.36);
    const rowH = h + 112;
    slots = Array.from({ length: count }, (_, i) => ({
      x: count === 1 ? GAME_W / 2 : S.l + w / 2 + (i % cols) * (w + S.s),
      y: S.s + h / 2 + Math.floor(i / cols) * rowH, w, h,
    }));
  }
  const bodyHeight = Math.max(1, ...slots.map((slot) => slot.y + slot.h / 2 + 96));
  return { top, bottom: prepareY - 100, bodyHeight, slots, prepareY, doneY: safeBottom - (adaptive ? 140 : 280), deckY: safeBottom - 200 - top, shift: safeBottom - GAME_H };
}
