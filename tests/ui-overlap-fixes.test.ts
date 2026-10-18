// Плашки и подписи не закрывают данные (first-30min-2026-10-10 P2/P3, скриншот владельца «Отряд полон» 11.10):
// заметка редактора отряда — под полем, подсказки «Героев» и «Кампании» — мимо подписей, длинные имена — целиком.
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {
  Scene: class {}, GameObjects: { Events: { DESTROY: 'destroy' }, Container: class {} },
  Scenes: { Events: { PRE_UPDATE: 'preupdate', POST_UPDATE: 'postupdate', SHUTDOWN: 'shutdown', CREATE: 'create' } },
  BlendModes: { ADD: 1 }, Math: { Clamp: (n: number, a: number, b: number) => Math.max(a, Math.min(b, n)) },
} }));
vi.mock('../src/game/audio', () => ({ sfx: vi.fn() }));
vi.mock('../src/game/haptics', () => ({ haptic: vi.fn() }));

const { formationBodyRows } = await import('../src/game/prepLayout');
const { HINT_GEOM, overlapArea, placeCallout } = await import('../src/game/hintLayout');
const { campaignLayout } = await import('../src/game/runtimeUiLayout');
const { FS, LEADING, S, T, leading } = await import('../src/game/theme');
const { balancedLines } = await import('../src/game/summonLootCard');

/** Высота плашки подсказки в одну строку (hintPointer: FS.body жирным + 22), как в снимках 390×844. */
const HINT_BOX_H = 64;
/** Кнопка «В бой» (ui.ts BTN.cta). */
const BTN_CTA = 144;

describe('редактор отряда: заметка «Отряд полон» — строкой под полем', () => {
  it('заметка в две строки T.body помещается в просвет между полем и угрозой / заголовком списка', () => {
    const noteH = 2 * Math.ceil(T.body * 1.2) + leading(T.body) + 2 * S.xs;
    for (const fieldBottom of [870, 990, 1010]) {
      const rows = formationBodyRows(fieldBottom, true);
      expect(rows.warningY - noteH / 2).toBeGreaterThanOrEqual(fieldBottom);
      expect(rows.warningY + noteH / 2).toBeLessThanOrEqual(rows.threat.titleY - T.caption * LEADING.caption / 2);
      const squad = formationBodyRows(fieldBottom);
      expect(squad.warningY + noteH / 2).toBeLessThanOrEqual(squad.rosterHeadY - 96 / 2);
    }
  });
});

describe('«Герои»: плашка «Наденьте трофеи» под нижним рядом не ложится на строку Таверны', () => {
  it('строка Таверны отступает на высоту стрелки и плашки, если подсказка на плитке нижнего ряда', () => {
    // Плитка 304×424 в одном ряду (F30-05: Алан, Бран, Вика), строка Таверны — не ближе HINT_BELOW к её низу.
    const HINT_BELOW = HINT_GEOM.arrowGap + HINT_GEOM.boxGap + 2 * FS.body + S.xs;
    const tile = { x: 540, y: 600, w: 304, h: 424 };
    const rowTop = tile.y + tile.h / 2 + HINT_BELOW;
    const tavernRow = { x: 48, y: rowTop, w: 984, h: 136 };
    const filters = { x: 48, y: tile.y - tile.h / 2 - 32 - 132, w: 984, h: 132 };
    const plan = placeCallout(tile, { w: 432, h: HINT_BOX_H }, { avoid: [tavernRow, filters], top: 160, bottom: 2000, width: 1080 });
    expect(plan.side).toBe('below');
    expect(plan.overlap).toBe(0);
  });
});

describe('«Кампания»: подсказки не закрывают подпись сундука', () => {
  it('новичок: подпись «Добыча за время отдыха» ниже плашки «Вперёд, в первый бой!» под «В бой»', () => {
    for (const bottom of [1500, 1700, 1980, 2200]) {
      const l = campaignLayout(bottom);
      const boxBottom = l.rowY + BTN_CTA / 2 + HINT_GEOM.arrowGap + HINT_GEOM.boxGap + HINT_BOX_H;
      const captionTop = l.cardY - 10 - (T.caption * LEADING.caption) / 2;
      expect(boxBottom).toBeLessThan(captionTop);
      // Подпись «Откроется после 1-1» — ниже подписи сундука и внутри карточки.
      expect(l.cardY + 50 - T.body * 0.7).toBeGreaterThan(l.cardY - 10 + (T.caption * LEADING.caption) / 2);
      expect(l.cardY + 50 + T.body * 0.7).toBeLessThan(l.cardY + l.cardH / 2);
    }
  });

  it('плашка на карточке (вкладки, «Собрать») — ряд накопленного поднимается на место подписи, подпись уходит', () => {
    // Плашка над вкладкой (2 строки) и ряд, поднятый на место подписи, не пересекаются.
    const l = campaignLayout(1700);
    const navTop = 1700 + 20;
    const box = { x: 240, y: navTop - 40 - 114, w: 506, h: 114 };
    const lifted = { x: l.fillX, y: l.cardY - 90 - 28, w: 300, h: 56 };
    expect(overlapArea(box, lifted)).toBe(0);
  });
});

describe('карта-награда Таверны: имя вещи целиком', () => {
  // Ширина «символа» — 1: строки сравниваются по длине.
  const measure = (s: string) => s.length;
  it('разрывы выбираются так, чтобы самая широкая строка была уже (не жадно)', () => {
    expect(balancedLines(['Составной', 'лук'], 1, measure)).toEqual(['Составной лук']);
    expect(balancedLines(['Составной', 'лук'], 2, measure)).toEqual(['Составной', 'лук']);
    expect(balancedLines(['Поножи', 'ночного', 'караула'], 2, measure)).toEqual(['Поножи ночного', 'караула']);
    expect(balancedLines(['Поножи', 'ночного', 'караула'], 3, measure)).toEqual(['Поножи', 'ночного', 'караула']);
    expect(balancedLines(['Кинжал', 'лунного', 'света'], 2, measure)).toEqual(['Кинжал', 'лунного света']);
    expect(balancedLines(['Лук'], 3, measure)).toEqual(['Лук']);
  });
});
