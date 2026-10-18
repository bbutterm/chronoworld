import { describe, expect, it } from 'vitest';
import { COMBAT } from '../src/core';
import { fieldSlots, minSlotGap, PREP, rosterCardW, slotBand } from '../src/game/prepLayout';

/**
 * Итерация 4 полировки (docs/design/ui-polish-research.md §5 «Этап», §7): редактор отряда — чистые слоты, компактная
 * сетка героев без плашек «в отряде», без постоянных инструкций и подписей «фронт/тыл»; меньше Text.
 */

const TOUCH = 96;

describe('редактор отряда: геометрия', () => {
  it('сетка героев: 5 плиток в ряд влезают в поле 1080 с полями 48, плитка не меньше цели нажатия', () => {
    const w = rosterCardW(1080);
    expect(w).toBeGreaterThanOrEqual(TOUCH * 1.5);
    expect(PREP.cols * w + (PREP.cols - 1) * PREP.gap).toBeLessThanOrEqual(1080 - 2 * PREP.margin);
    expect(PREP.cardH).toBeGreaterThanOrEqual(w);
  });

  // Поле экрана этапа (StageScene L.field) и экрана «Отряд» (SquadScene L.field): слоты одной колонки не налезают.
  for (const [name, field, xs] of [
    ['этап', { top: 298, bottom: 1010 }, { back: 150, front: 386 }],
    ['отряд', { top: 168, bottom: 870 }, { back: 330, front: 690 }],
  ] as const) {
    it(`поле «${name}»: слоты в своей полосе и не налезают друг на друга`, () => {
      const band = slotBand(field);
      const slots = fieldSlots(COMBAT.field.slotsA, band, xs, PREP.slotH);
      expect(minSlotGap(slots, PREP.slotH)).toBeGreaterThanOrEqual(0);
      for (const s of slots) {
        expect(s.y - PREP.slotH / 2).toBeGreaterThanOrEqual(field.top + PREP.headH - 1);
        expect(s.y + PREP.slotH / 2).toBeLessThanOrEqual(field.bottom);
      }
    });
  }

  it('minSlotGap: перекрытие — отрицательное, разные колонки не сравниваются', () => {
    expect(minSlotGap([{ x: 0, y: 0 }, { x: 0, y: 150 }], 200)).toBe(-50);
    expect(minSlotGap([{ x: 0, y: 0 }, { x: 300, y: 10 }], 200)).toBe(Infinity);
  });
});
