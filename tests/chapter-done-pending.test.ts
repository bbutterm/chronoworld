import { describe, expect, it } from 'vitest';
import {
  actPlayStage,
  clearChapterDone,
  deserialize,
  lastStageOfChapter,
  newGame,
  queueChapterDone,
  serialize,
  type SaveState,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { withReplay } from './helpers';

const ctx = loadFullContext();
const T0 = Date.UTC(2026, 8, 27, 10);
const D0 = '2026-09-27';
const stages = ctx.content.stages;
const ch1 = ctx.content.chapters[0]!.id;
const boss = lastStageOfChapter(ch1, ctx)!;

const withCleared = (n: number): SaveState => ({ ...newGame(ctx, T0, D0), campaign: { cleared: stages.slice(0, n).map((s) => s.id) } });

describe('«Глава пройдена» переживает перезагрузку (save.pendingChapterDone)', () => {
  it('ставится только при первой победе на последнем этапе главы', () => {
    const s = withCleared(boss.globalIndex);
    expect(queueChapterDone(s, boss.id, true, ctx).pendingChapterDone).toBe(ch1);
    expect(queueChapterDone(s, boss.id, false, ctx)).toBe(s);
    const notLast = stages.find((x) => x.chapter === ch1 && x.id !== boss.id)!;
    expect(queueChapterDone(s, notLast.id, true, ctx)).toBe(s);
  });

  it('победа над боссом главы записывает метку; после перезагрузки она на месте; уход с экрана снимает её', () => {
    let save: SaveState = withCleared(boss.globalIndex);
    save = { ...save, heroes: save.heroes.map((h) => ({ ...h, rarity: 'blue', level: 40 })) };
    let won: SaveState | null = null;
    for (let seed = 1; seed < 60 && !won; seed++) {
      const out = actPlayStage(save, D0, boss.id, seed, ctx, T0);
      if (out.result.winner === 'A') won = out.save;
    }
    expect(won).not.toBeNull();
    const reloaded = deserialize(serialize(won!));
    expect(reloaded.pendingChapterDone).toBe(ch1);
    // Повторная победа метку не ставит заново после того, как игрок ушёл с экрана.
    const left = clearChapterDone(reloaded);
    expect(left.pendingChapterDone).toBeUndefined();
    expect(deserialize(serialize(left)).pendingChapterDone).toBeUndefined();
    // Выпущенные данные повторы запрещают (stage_cleared); правило «повтор ничего не даёт» — при явном replay: true.
    expect(() => actPlayStage(left, D0, boss.id, 1, ctx, T0)).toThrow(expect.objectContaining({ code: 'stage_cleared' }));
    for (let seed = 1; seed < 20; seed++) {
      const again = actPlayStage(left, D0, boss.id, seed, withReplay(ctx), T0);
      expect(again.save.pendingChapterDone).toBeUndefined();
    }
  });

  it('старое сохранение без поля читается, метки нет; снятие без метки — тот же объект', () => {
    const s = newGame(ctx, T0, D0);
    const raw = JSON.parse(serialize(s));
    delete raw.pendingChapterDone;
    const loaded = deserialize(JSON.stringify(raw));
    expect(loaded.pendingChapterDone).toBeUndefined();
    expect(clearChapterDone(loaded)).toBe(loaded);
  });
});
