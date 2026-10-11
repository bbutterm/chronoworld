import { describe, expect, it } from 'vitest';
import { COMBAT } from '../src/core';
import {
  bestFreeSlot,
  classifyGesture,
  dropHero,
  fieldSlots,
  hitSlot,
  removeAt,
  rosterOneEach,
  rosterOrder,
  swapSlots,
  tapHero,
} from '../src/game/prepLayout';

describe('подготовка к бою: куда встаёт герой', () => {
  it('танк и ближний бой — во фронт, стрелок и лекарь — в тыл; нет места в своей линии — в другую', () => {
    expect(bestFreeSlot([null, null, null, null, null], 0)).toBe(0);
    expect(bestFreeSlot(['a', null, null, null, null], 1)).toBe(1);
    expect(bestFreeSlot(['a', 'b', null, null, null], 1)).toBe(2);
    expect(bestFreeSlot([null, null, null, null, null], 2)).toBe(4);
    expect(bestFreeSlot([null, null, 'a', 'b', 'c'], 3)).toBe(1);
    expect(bestFreeSlot(['a', 'b', 'c', 'd', 'e'], 0)).toBe(-1);
  });

  it('нажатие на героя: не в отряде — встаёт в лучший или выбранный слот; в отряде — убирается', () => {
    expect(tapHero(['a', null, null, null, null], 'b', 2).squad).toEqual(['a', null, null, null, 'b']);
    expect(tapHero(['a', null, null, null, null], 'b', 2, 1).squad).toEqual(['a', 'b', null, null, null]);
    expect(tapHero(['a', 'b', null, null, null], 'b', 2).squad).toEqual(['a', null, null, null, null]);
    expect(tapHero(['a', 'b', 'c', 'd', 'e'], 'f', 0)).toEqual({ squad: null, reason: 'full' });
    // Полный отряд, но выбран слот — герой заменяет стоящего там.
    expect(tapHero(['a', 'b', 'c', 'd', 'e'], 'f', 0, 2).squad).toEqual(['a', 'b', 'f', 'd', 'e']);
  });

  it('последнего героя убрать нельзя', () => {
    expect(removeAt(['a', null, null, null, null], 0)).toEqual({ squad: null, reason: 'last' });
    expect(tapHero(['a', null, null, null, null], 'a', 0)).toEqual({ squad: null, reason: 'last' });
    expect(removeAt([null, 'a', 'b', null, null], 0).squad).toBeNull();
  });

  it('перетаскивание: из списка на занятый слот — замена, между слотами — обмен', () => {
    expect(dropHero(['a', 'b', null, null, null], 'c', 1).squad).toEqual(['a', 'c', null, null, null]);
    // Герой уже в отряде — меняется местами со стоящим в слоте.
    expect(dropHero(['a', 'b', null, null, null], 'a', 1).squad).toEqual(['b', 'a', null, null, null]);
    expect(dropHero(['a', 'b', null, null, null], 'a', 0).reason).toBe('same');
    expect(swapSlots(['a', 'b', null, null, null], 0, 4).squad).toEqual([null, 'b', null, null, 'a']);
    expect(swapSlots(['a', 'b', null, null, null], 0, 1).squad).toEqual(['b', 'a', null, null, null]);
    expect(swapSlots(['a', 'b', null, null, null], 1, 1).reason).toBe('same');
  });
});

describe('подготовка к бою: поле и жесты', () => {
  const slots = fieldSlots(COMBAT.field.slotsA, { top: 300, bottom: 1000 }, { front: 400, back: 150 }, 200);

  it('поле как в бою: фронт ближе к врагу (правее), слоты внутри полосы и не налезают друг на друга', () => {
    expect(slots).toHaveLength(5);
    for (const i of [0, 1]) expect(slots[i].x).toBe(400);
    for (const i of [2, 3, 4]) expect(slots[i].x).toBe(150);
    for (const s of slots) {
      expect(s.y - 100).toBeGreaterThanOrEqual(300 - 1e-6);
      expect(s.y + 100).toBeLessThanOrEqual(1000 + 1e-6);
    }
    // Колонки: в одной колонке центры дальше, чем высота слота.
    expect(slots[3].y - slots[2].y).toBeGreaterThanOrEqual(200);
    expect(slots[1].y - slots[0].y).toBeGreaterThanOrEqual(200);
  });

  it('палец попадает в слот с «прилипанием»; мимо — -1', () => {
    expect(hitSlot(slots, 200, 200, slots[3])).toBe(3);
    expect(hitSlot(slots, 200, 200, { x: slots[0].x + 120, y: slots[0].y }, 30)).toBe(0);
    expect(hitSlot(slots, 200, 200, { x: slots[0].x + 120, y: slots[0].y }, 0)).toBe(-1);
    expect(hitSlot(slots, 200, 200, { x: 900, y: 1500 }, 30)).toBe(-1);
  });

  it('список по мощи, при равной — по id', () => {
    const heroes = [{ id: 'b' }, { id: 'a' }, { id: 'c' }];
    const power: Record<string, number> = { a: 10, b: 10, c: 50 };
    expect(rosterOrder(heroes, (h) => power[h.id]).map((h) => h.id)).toEqual(['c', 'a', 'b']);
  });

  it('список для отряда — по одной плитке на героя: копия из отряда, иначе сильнейшая (скриншот владельца 11.10)', () => {
    const heroes = [
      { id: 'h1', templateId: 'alan' },
      { id: 'h2', templateId: 'alan' },
      { id: 'h3', templateId: 'bran' },
      { id: 'h4', templateId: 'bran' },
      { id: 'h5', templateId: 'vika' },
    ];
    const power: Record<string, number> = { h1: 10, h2: 30, h3: 50, h4: 20, h5: 5 };
    // Алан: в отряде слабая копия h1 — показываем её; Бран: в отряде никого — сильнейшая h3.
    expect(rosterOneEach(heroes, ['h1', null, null, null, null], (h) => power[h.id]).map((h) => h.id)).toEqual(['h1', 'h3', 'h5']);
    expect(rosterOneEach(heroes, [], (h) => power[h.id]).map((h) => h.id)).toEqual(['h2', 'h3', 'h5']);
  });

  it('жест: вбок или из списка — тянем героя, вертикально — листаем, удержание — тянем', () => {
    expect(classifyGesture({ dx: 3, dy: 2, heldMs: 50 }, { scrollable: true })).toBe('pending');
    expect(classifyGesture({ dx: 3, dy: 2, heldMs: 300 }, { scrollable: true })).toBe('drag');
    expect(classifyGesture({ dx: 40, dy: 10, heldMs: 50 }, { scrollable: true })).toBe('drag');
    expect(classifyGesture({ dx: 5, dy: -40, heldMs: 50 }, { scrollable: true })).toBe('scroll');
    expect(classifyGesture({ dx: 5, dy: -40, heldMs: 50 }, { scrollable: false })).toBe('drag');
    expect(classifyGesture({ dx: 5, dy: -40, heldMs: 50 }, { scrollable: true, leftList: true })).toBe('drag');
  });
});
