import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMBAT } from '../src/core';
import { fieldSlots, minSlotGap, PREP, rosterCardW, slotBand } from '../src/game/prepLayout';

/**
 * Итерация 4 полировки (docs/design/ui-polish-research.md §5 «Этап», §7): редактор отряда — чистые слоты, компактная
 * сетка героев без плашек «в отряде», без постоянных инструкций и подписей «фронт/тыл»; меньше Text.
 */

const SRC = (f: string) => readFileSync(join(import.meta.dirname, '..', 'src', 'game', f), 'utf8');
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

describe('редактор отряда: без шума (§3 правила 3, 4, 11)', () => {
  const editor = SRC('squadEditor.ts');
  it('нет плашки «в отряде», постоянной инструкции и подписей «фронт/тыл»', () => {
    expect(editor).not.toMatch(/'в отряде'/);
    expect(editor).not.toMatch(/'[^'\n]*(Нажмите на героя|Слот выбран)[^'\n]*'/);
    expect(editor).not.toMatch(/'(фронт|тыл)'/);
    // Мощь у каждого героя в слоте и на плитке больше не пишется — общая мощь в powerCompare.
    expect(editor).not.toMatch(/formatNumber\(heroPower/);
  });

  it('уровни — растровым шрифтом (BitmapText), а не Text на каждую плитку; пустой слот — пульс, опция hintEmpty', () => {
    expect(editor).toMatch(/bitmapText\(/);
    expect(editor).toMatch(/hintEmpty\?: boolean/);
    expect(editor).toMatch(/showPower\?: boolean/);
    expect(editor).toMatch(/chrome\?: boolean/);
    expect(editor).toMatch(/rosterHead\?:/);
  });

  it('«Отряд»: пресеты — листом снизу, одна главная кнопка', () => {
    const squad = SRC('scenes/SquadScene.ts');
    expect(squad).toMatch(/openPresetsSheet/);
    expect(squad).not.toMatch(/ui_btn_primary/);
    expect(squad.match(/\bcta\(/g)?.length).toBe(1);
    expect(squad).not.toMatch(/Пресетов пока нет/);
  });

  it('«Контракт героя»: без строки-инструкции и подписей роли под плитками', () => {
    const pick = SRC('scenes/HeroPickScene.ts');
    expect(pick).not.toMatch(/Выберите героя, затем ветку|Выберите героя — он придёт/);
    expect(pick).not.toMatch(/ROLE_NAMES\[t\.role\]/);
  });
});
