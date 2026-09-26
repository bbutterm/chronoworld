import { describe, expect, it } from 'vitest';
import { newGame, playStage, type ProgressEvent } from '../src/core';
import { assignSlot, currentStage, describeEvents, localDay, lockedJobSkills, nextOpenStage, stageSeed } from '../src/game/flow';
import { loadGameContext } from '../scripts/lib/content-node';

const ctx = loadGameContext();

describe('помощники экранов', () => {
  it('localDay — локальная дата YYYY-MM-DD', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localDay(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('stageSeed детерминирован и меняется с battleSeq', () => {
    const save = newGame(ctx, 1_700_000_000_000);
    expect(stageSeed(save)).toBe(stageSeed({ ...save }));
    expect(stageSeed({ ...save, battleSeq: 1 })).not.toBe(stageSeed(save));
    expect(stageSeed(save)).toBeGreaterThanOrEqual(0);
  });

  it('assignSlot: герой уникален — меняется местами; null убирает', () => {
    const squad = ['h1', 'h2', null, 'h4', 'h5'];
    expect(assignSlot(squad, 2, 'h1')).toEqual([null, 'h2', 'h1', 'h4', 'h5']);
    expect(assignSlot(squad, 0, 'h2')).toEqual(['h2', 'h1', null, 'h4', 'h5']);
    expect(assignSlot(squad, 1, null)).toEqual(['h1', null, null, 'h4', 'h5']);
    expect(squad).toEqual(['h1', 'h2', null, 'h4', 'h5']);
  });

  it('новая игра ведёт на первый этап; после победы открывается следующий', () => {
    const save = newGame(ctx, 0);
    const first = ctx.content.stages[0];
    expect(currentStage(save, ctx)?.id).toBe(first.id);
    expect(nextOpenStage(save, first.id, ctx)).toBeNull();
    const cleared = { ...save, campaign: { cleared: [first.id] } };
    expect(nextOpenStage(cleared, first.id, ctx)?.id).toBe(ctx.content.stages[1].id);
    expect(currentStage(cleared, ctx)?.id).toBe(ctx.content.stages[1].id);
  });

  it('describeEvents склеивает level-up и сообщает о смене профессии', () => {
    const save = newGame(ctx, 0);
    const events: ProgressEvent[] = [
      { type: 'levelUp', heroId: 'h1', jobLevel: 2 },
      { type: 'levelUp', heroId: 'h1', jobLevel: 3 },
      { type: 'jobChangeAvailable', heroId: 'h1', jobs: ['swordman'] },
    ];
    const lines = describeEvents(events, save, ctx);
    expect(lines.filter((l) => l.includes('джоб'))).toEqual([`${save.heroes[0].name}: джоб 3`]);
    expect(lines.some((l) => l.startsWith('Смена профессии доступна!'))).toBe(true);
  });

  it('lockedJobSkills — навыки выше текущего уровня по порядку', () => {
    const locked = lockedJobSkills('novice', 1, ctx);
    expect(locked.every((s) => s.jobLevel > 1)).toBe(true);
    expect(lockedJobSkills('novice', 10, ctx)).toEqual([]);
  });

  it('бой этапа из сохранения воспроизводим: тот же save → тот же исход', () => {
    const save = newGame(ctx, 12345);
    const stage = ctx.content.stages[0].id;
    const a = playStage(save, stage, stageSeed(save), ctx);
    const b = playStage(save, stage, stageSeed(save), ctx);
    expect(a.result.winner).toBe(b.result.winner);
    expect(a.result.duration).toBe(b.result.duration);
  });
});
