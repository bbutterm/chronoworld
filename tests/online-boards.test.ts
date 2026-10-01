import { describe, expect, it } from 'vitest';
import {
  BOARD_TOP,
  betterFilter,
  boardKind,
  boardMine,
  boardRows,
  boardScope,
  isWeekly,
  playerEntry,
  progressValue,
  rankBoard,
  rankEntries,
  rankTop,
  type PlayerRow,
} from '../supabase/functions/cw-api/boards';

const P = (tg_id: number, chapter: number, stage: number, power: number, first_name = `И${tg_id}`): PlayerRow => ({ tg_id, first_name, chapter, stage, power, tower_best: 0 });

describe('cw-api: доски — разбор запроса', () => {
  it('доска и охват: неизвестное — tower и all (старый клиент)', () => {
    expect(boardKind('mvp')).toBe('mvp');
    expect(boardKind('power')).toBe('power');
    expect(boardKind('progress')).toBe('progress');
    expect(boardKind(undefined)).toBe('tower');
    expect(boardKind('drop table')).toBe('tower');
    expect(boardScope('friends')).toBe('friends');
    expect(boardScope('x')).toBe('all');
    expect(isWeekly('tower') && isWeekly('mvp')).toBe(true);
    expect(isWeekly('power') || isWeekly('progress')).toBe(false);
  });
});

describe('cw-api: доски — порядок и места', () => {
  it('прогресс: глава важнее этапа, затем этап; при равенстве — одно место, выше тот, кто сильнее', () => {
    expect(progressValue(4, 12)).toBe(412);
    expect(progressValue(3, 18)).toBeLessThan(progressValue(4, 1));
    const players = [P(1, 3, 18, 900), P(2, 4, 1, 100), P(3, 4, 1, 500), P(4, 2, 5, 9999), P(5, 0, 0, 0)];
    const entries = players.map((p) => playerEntry('progress', p)).filter((e) => e !== null);
    expect(entries).toHaveLength(4); // без sync (глава 0) — не на доске
    const r = rankEntries(entries);
    expect(r.map((x) => x.id)).toEqual([3, 2, 1, 4]);
    expect(r.map((x) => x.place)).toEqual([1, 1, 3, 4]);
  });

  it('сила: по убыванию, одинаковая — одно место («1, 2, 2, 4»), без силы — не на доске', () => {
    const players = [P(1, 1, 1, 500), P(2, 1, 1, 800), P(3, 1, 1, 500), P(4, 1, 1, 100), P(5, 1, 1, 0)];
    const entries = players.map((p) => playerEntry('power', p)).filter((e) => e !== null);
    const r = rankEntries(entries);
    expect(r.map((x) => [x.id, x.place])).toEqual([[2, 1], [1, 2], [3, 2], [4, 4]]);
  });

  it('друзья: топ и моё место среди друзей', () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, value: 1000 - i }));
    const r = rankBoard(entries, 55);
    expect(r.top).toHaveLength(BOARD_TOP);
    expect(r.mine).toMatchObject({ id: 55, place: 55, value: 946 });
    expect(rankBoard(entries, 999).mine).toBeNull();
  });

  it('все: я в топе — место из топа; ниже — «лучше меня» + 1; нет на доске — null', () => {
    const top = [{ id: 1, value: 50 }, { id: 2, value: 40 }, { id: 3, value: 40 }];
    expect(rankTop(top, 3, { id: 3, value: 40 }, 1).mine).toMatchObject({ place: 2 });
    expect(rankTop(top, 9, { id: 9, value: 10 }, 120).mine).toMatchObject({ id: 9, place: 121, value: 10 });
    expect(rankTop(top, 9, null, null).mine).toBeNull();
  });

  it('фильтр «строго лучше меня» для подсчёта места', () => {
    expect(betterFilter('power', P(1, 2, 3, 12345))).toBe('power.gt.12345');
    expect(betterFilter('progress', P(1, 4, 12, 0))).toBe('chapter.gt.4,and(chapter.eq.4,stage.gt.12)');
  });
});

describe('cw-api: доски — строки ответа', () => {
  it('имя, значение, глава, этап, сила; нет игрока — «…»; моё место с главой и силой', () => {
    const ranked = rankEntries([{ id: 7, value: 30 }, { id: 8, value: 20 }]);
    const rows = boardRows(ranked, [P(7, 5, 3, 45678, 'Вика')], 8);
    expect(rows[0]).toEqual({ place: 1, name: 'Вика', value: 30, me: false, chapter: 5, stage: 3, power: 45678 });
    expect(rows[1]).toMatchObject({ place: 2, name: '…', me: true, chapter: 0, power: 0 });
    expect(boardMine({ id: 8, value: 20, place: 2 }, P(8, 2, 9, 3100))).toEqual({ place: 2, value: 20, chapter: 2, stage: 9, power: 3100 });
    expect(boardMine(null, P(8, 2, 9, 3100))).toBeNull();
  });
});
