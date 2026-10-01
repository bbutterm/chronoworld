import { describe, expect, it } from 'vitest';
import { newGame, squadPower, type FullContext } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { groupDigits as formatNumber } from '../src/core/format';
import {
  BOARD_KINDS,
  boardSubLine,
  boardValueText,
  friendLine,
  friendStats,
  myPlaceText,
  parseBoard,
  parseFriends,
  SYNC_GAP_MS,
  syncDelay,
  syncPower,
  whereText,
} from '../src/game/online/logic';
import { mockCall } from '../src/game/online/mock';
import { progressValue } from '../supabase/functions/cw-api/boards';

const ctx: FullContext = loadFullContext();

describe('онлайн-клиент: друзья — глава и сила', () => {
  it('разбор: сила из ответа; строка «Глава N, этап M · Сила 12 345 · Башня: X»', () => {
    const [f] = parseFriends({ ok: true, friends: [{ id: 7, name: 'Вика', chapter: 4, stage: 12, power: 12345, towerBest: 37 }] }) ?? [];
    expect(f.power).toBe(12345);
    expect(friendLine(f)).toBe('Глава 4, этап 12 · Сила 12 345 · Башня: 37');
    expect(friendStats({ power: 0, towerBest: 3 })).toBe('Башня: 3');
    expect(whereText(0, 0)).toBe('Только начинает');
    expect(whereText(2, 0)).toBe('Глава 2, этап 1');
  });
});

describe('онлайн-клиент: доски рекордов', () => {
  it('четыре доски: сила, прогресс, Башня, MVP', () => {
    expect(BOARD_KINDS.map((k) => k.id)).toEqual(['power', 'progress', 'tower', 'mvp']);
  });

  it('разбор строки нового сервера: глава, этап, сила; моё место с ними же', () => {
    const b = parseBoard({
      ok: true,
      board: 'progress',
      week: '',
      top: [{ place: 1, name: 'Кира', value: 1012, me: false, chapter: 10, stage: 12, power: 3_400_000 }],
      mine: { place: 9, value: 307, chapter: 3, stage: 7, power: 18_420 },
    });
    expect(b?.top[0]).toEqual({ place: 1, name: 'Кира', value: 1012, me: false, chapter: 10, stage: 12, power: 3_400_000 });
    expect(b?.mine).toEqual({ place: 9, value: 307, chapter: 3, stage: 7, power: 18_420 });
  });

  it('значение и мелкая строка: не повторяют то, что уже в значении', () => {
    const r = { value: 412, chapter: 4, stage: 12, power: 45_678 };
    expect(boardValueText('power', { ...r, value: 45_678 })).toBe('45 678');
    expect(boardValueText('progress', r)).toBe('гл. 4-12');
    expect(boardValueText('progress', { value: progressValue(5, 3), chapter: 0, stage: 0 })).toBe('гл. 5-3'); // без полей — из value
    expect(boardValueText('tower', { ...r, value: 37 })).toBe('этаж 37');
    expect(boardValueText('mvp', { ...r, value: 1_640_000 })).toBe('1 640 000');
    expect(boardSubLine('power', r)).toBe('Глава 4, этап 12');
    expect(boardSubLine('progress', r)).toBe('Сила 45 678');
    expect(boardSubLine('tower', r)).toBe('Глава 4, этап 12 · Сила 45 678');
    expect(boardSubLine('tower', { chapter: 0, stage: 0, power: 0 })).toBe('');
  });

  it('«Ваше место» и подсказки, если меня нет на доске', () => {
    expect(myPlaceText('power', { place: 7, value: 12_345, chapter: 2, stage: 3, power: 12_345 })).toBe('Ваше место: 7 · 12 345');
    expect(myPlaceText('progress', null)).toMatch(/пройдите этап/);
    expect(myPlaceText('tower', null)).toMatch(/Башне/);
    expect(myPlaceText('mvp', null)).toMatch(/MVP/);
  });

  it('заглушка ?tgmock: каждая доска и охват разбираются, своя строка есть, место совпадает', async () => {
    for (const k of BOARD_KINDS)
      for (const scope of ['all', 'friends']) {
        const b = parseBoard(await mockCall('board', { board: k.id, scope }));
        expect(b, `${k.id}/${scope}`).not.toBeNull();
        const meRow = b!.top.find((r) => r.me);
        expect(meRow?.place).toBe(b!.mine?.place);
        expect(b!.top.every((r) => r.chapter > 0 && r.power > 0)).toBe(true);
      }
    const fr = parseFriends(await mockCall('friends', {}));
    expect(fr?.every((f) => f.power > 0)).toBe(true);
  });
});

describe('онлайн-клиент: sync силы отряда', () => {
  it('та же шкала, что «Мощь отряда» на экране героев', () => {
    const save = newGame(ctx, 0, '2026-10-01');
    const p = squadPower(save, ctx);
    expect(p).toBeGreaterThan(0);
    expect(formatNumber(syncPower(p))).toBe(formatNumber(p));
  });

  it('после улучшений — не чаще раза в минуту', () => {
    expect(syncDelay(10_000, 0, 2000)).toBe(2000); // sync ещё не было — через debounce
    expect(syncDelay(10_000, 9_000, 2000)).toBe(SYNC_GAP_MS - 1000); // был секунду назад — ждём минуту
    expect(syncDelay(200_000, 9_000, 2000)).toBe(2000);
  });
});
