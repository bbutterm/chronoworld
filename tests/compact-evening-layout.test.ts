import { describe, expect, it } from 'vitest';
import { eveningChoiceBounds, eveningCreditPreview, eveningDialogueLayout, eveningModalLayout, eveningPreviewRowHeight, eveningSectionLayout } from '../src/game/compactEveningLayout';
import { scrollLayout } from '../src/game/scroll';
import { S, TOUCH_COMFORT } from '../src/game/theme';

describe('Вечера: длинный текст, ответ и результат остаются доступны', () => {
  it('превью показывает участников главы из public контракта, в том числе одного героя legacy и явное отсутствие начисления', () => {
    expect(eveningCreditPreview(['Алан', 'Бран', 'Вика', 'Дорн', 'Кай'], 1)).toBe('За главу +1 близости: Алан, Бран, Вика, Дорн, Кай');
    expect(eveningCreditPreview(['Лира'], 1)).toBe('За главу +1 близости: Лира');
    expect(eveningCreditPreview([], 1)).toBe('Близость за главу не начисляется');
  });

  it.each([72, 144, 216])('измеренная подпись начисления%s не перекрывает следующий вечер и оставляет целую кнопку', (height) => {
    const row = eveningPreviewRowHeight(height);
    expect(row).toBeGreaterThanOrEqual(128 + height + S.s);
    const section = eveningSectionLayout(0, TOUCH_COMFORT);
    const listenTop = section.nextTop + 64 - TOUCH_COMFORT / 2;
    expect(listenTop).toBeGreaterThan(section.headingY + TOUCH_COMFORT / 2);
    const nextActionTop = row + S.xs + 136 / 2 - TOUCH_COMFORT / 2;
    expect(nextActionTop).toBeGreaterThan(64 + TOUCH_COMFORT / 2);
  });

  it.each([96, 132])('первое «i» сохраняет полную цель%s внутри маски и не пересекает «Слушать»', (touch) => {
    const section = eveningSectionLayout(0, touch);
    expect(section.headingY - touch / 2).toBeGreaterThanOrEqual(0);
    const firstActionTop = section.nextTop + 136 / 2 - touch / 2;
    expect(firstActionTop).toBeGreaterThanOrEqual(section.headingY + touch / 2 + S.xs);
  });

  it.each([1410, 1770, 1920])('реплика и счётчик сохраняют нижний край при высоте%s', (bottom) => {
    const line = eveningDialogueLayout(bottom);
    expect(line.panelY + 230).toBe(bottom - 30);
    expect(line.bodyTop).toBe(line.top + 132);
    expect(line.bodyBottom).toBeLessThan(bottom - 30 - S.l - 18);
    const long = scrollLayout(1400, line.bodyTop, line.bodyBottom, 9999);
    expect(long.y + 1400).toBe(line.bodyBottom);
    expect(long.height).toBeGreaterThan(4 * 42);
  });

  it('три обычных ответа не перекрывают Skip и панель реплики', () => {
    const line = eveningDialogueLayout(1410);
    const height = 3 * 132 + 2 * S.xs;
    const choices = eveningChoiceBounds(line.top, height);
    expect(choices.top).toBeGreaterThan(130 + 132 / 2);
    expect(choices.bottom).toBeLessThan(line.top);
    expect(choices.bottom - choices.top).toBe(height);
    expect(132 / 3).toBe(44);
  });

  it('длинные измеренные ответы листаются до последнего, не заходя в верхний Skip', () => {
    const choices = eveningChoiceBounds(eveningDialogueLayout(1410).top, 3 * 340 + 2 * S.xs);
    expect(choices.top).toBe(280);
    const end = scrollLayout(1052, choices.top, choices.bottom, 9999);
    expect(end.y + 1052).toBe(choices.bottom);
    expect(end.maxOffset).toBeGreaterThan(0);
  });

  it('в уменьшенном окне один ответ сохраняет полную touch-цель и не касается Skip', () => {
    const choices = eveningChoiceBounds(eveningDialogueLayout(970).top, 3 * TOUCH_COMFORT + 2 * S.xs);
    expect(choices.bottom - choices.top).toBeGreaterThanOrEqual(TOUCH_COMFORT);
    expect(choices.top).toBeGreaterThan(130 + TOUCH_COMFORT / 2);
    const end = scrollLayout(428, choices.top, choices.bottom, 9999);
    expect(end.y + 428).toBe(choices.bottom);
  });

  it.each([1410, 1770, 1920])('итог на 12 строк сохраняет sticky действия и отдельную прокрутку, высота%s', (height) => {
    const content = 12 * (256 + S.xs) - S.xs;
    const modal = eveningModalLayout(height, content);
    expect(modal.top).toBeGreaterThanOrEqual(120);
    expect(modal.bodyTop).toBe(modal.top + 150);
    expect(modal.bodyBottom).toBeLessThan(modal.buttonY - TOUCH_COMFORT / 2);
    expect(modal.buttonY + TOUCH_COMFORT / 2).toBeLessThan(modal.top + modal.height);
    const end = scrollLayout(content, modal.bodyTop, modal.bodyBottom, 99999);
    expect(end.y + content).toBe(modal.bodyBottom);
    expect(end.maxOffset).toBeGreaterThan(0);
  });

  it('полная инструкция задания входит в отдельную body-полосу без внешней шапки', () => {
    const modal = eveningModalLayout(1410, 2200, 0);
    expect(modal.bodyTop).toBe(modal.top);
    const end = scrollLayout(2200, modal.bodyTop, modal.bodyBottom, 99999);
    expect(end.y + 2200).toBe(modal.bodyBottom);
    expect(modal.buttonY + TOUCH_COMFORT / 2).toBeLessThan(1410);
  });
});
