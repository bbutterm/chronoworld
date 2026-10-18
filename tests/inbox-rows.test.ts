import { describe, expect, it } from 'vitest';
import { claimState, groupRows, letterState, ratio, trackPos } from '../src/game/inboxOrder';

// Задания дня, Достижения, Почта (полировка UI, итерация 8C): одна строка listRow, готовое сверху, полученное внизу.

describe('порядок строк входящих', () => {
  it('состояние задания/достижения: выполнено и не забрано — ready, забрано — done', () => {
    expect(claimState({ done: true, claimed: false })).toBe('ready');
    expect(claimState({ done: false, claimed: false })).toBe('active');
    expect(claimState({ done: true, claimed: true })).toBe('done');
  });

  it('состояние письма: вложение ждёт — ready, не прочитано — active, остальное — done', () => {
    expect(letterState({ read: true, claimed: false }, true)).toBe('ready');
    expect(letterState({ read: false, claimed: false }, false)).toBe('active');
    expect(letterState({ read: true, claimed: true }, false)).toBe('done');
  });

  it('готовые сверху, в процессе — ближе к цели выше, полученные внизу; внутри группы порядок исходный', () => {
    const items = [
      { id: 'a', done: true, claimed: true, p: 1 },
      { id: 'b', done: false, claimed: false, p: 0.2 },
      { id: 'c', done: true, claimed: false, p: 1 },
      { id: 'd', done: false, claimed: false, p: 0.8 },
      { id: 'e', done: false, claimed: false, p: 0.2 },
      { id: 'f', done: true, claimed: false, p: 1 },
    ];
    const g = groupRows(items, claimState, (x) => x.p);
    expect(g.ready.map((x) => x.id)).toEqual(['c', 'f']);
    expect(g.active.map((x) => x.id)).toEqual(['d', 'b', 'e']);
    expect(g.done.map((x) => x.id)).toEqual(['a']);
    // Без progress — порядок как есть (почта: новые первыми).
    expect(groupRows(items, claimState).active.map((x) => x.id)).toEqual(['b', 'd', 'e']);
  });

  it('доля прогресса и место порога на дорожке — в пределах 0…1', () => {
    expect(ratio(3, 5)).toBeCloseTo(0.6);
    expect(ratio(9, 5)).toBe(1);
    expect(ratio(0, 0)).toBe(1);
    expect(trackPos(100, 110)).toBeCloseTo(100 / 110);
    expect(trackPos(200, 110)).toBe(1);
    expect(trackPos(10, 0)).toBe(0);
  });
});
