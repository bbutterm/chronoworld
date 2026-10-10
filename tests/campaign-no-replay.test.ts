import { describe, expect, it } from 'vitest';
import { actPlayStage, actSkipStage, GameRuleError, newGame, playStage, repeatStage, replayAllowance, replayAllowed, skipStage, type SaveState } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { withReplay } from './helpers';

// Решение владельца 10.10.2026 («один и тот же бой много раз» — нет): как в AFK Arena, пройденный этап больше
// не сражается — ни «Повторить», ни «Быстрый бой», ни тренировка. Бой — только на текущем открытом этапе.
const ctx = loadFullContext();
const D1 = '2026-10-10';
const [s0, s1] = ctx.content.stages;

function strong(): SaveState {
  const s = newGame(ctx, 0, D1);
  return { ...s, heroes: s.heroes.map((h) => ({ ...h, rarity: 'red', level: 100 })) };
}

function cleared(): SaveState {
  const out = actPlayStage(strong(), D1, s0.id, 1, ctx, 0);
  expect(out.result.winner).toBe('A');
  return out.save;
}

const stageCleared = expect.objectContaining({ code: 'stage_cleared', message: 'Этап уже пройден — бой идёт на следующем этапе' });

describe('Кампания без повторов (выпущенные данные)', () => {
  it('data/progression.json запрещает повторы; бюджета повторов нет', () => {
    expect(ctx.progression.campaign.replay).toBe(false);
    expect(replayAllowed(ctx)).toBe(false);
    expect(replayAllowance(cleared(), D1, ctx)).toEqual({ used: 0, limit: 0, remaining: 0 });
    // У Кухни нет источника «повтор этапа» — он бы никогда не сработал.
    expect(ctx.kitchen?.sources.replay).toBeUndefined();
  });

  it('пройденный этап: playStage, «Быстрый бой», повтор и обёртки бросают stage_cleared, save не меняется', () => {
    const save = cleared();
    const snapshot = JSON.stringify(save);
    const attempts = [
      () => playStage(save, s0.id, 2, ctx, undefined, D1),
      () => playStage(save, s0.id, 2, ctx),
      () => actPlayStage(save, D1, s0.id, 2, ctx),
      () => actSkipStage(save, D1, s0.id, 2, ctx),
      () => skipStage(save, s0.id, 2, ctx, D1),
      () => repeatStage(save, s0.id, 2, ctx, D1),
    ];
    for (const attempt of attempts) {
      expect(attempt).toThrow(GameRuleError);
      expect(attempt).toThrow(stageCleared);
    }
    expect(JSON.stringify(save)).toBe(snapshot);
  });

  it('текущий открытый этап по-прежнему играется, закрытый — stage_locked', () => {
    const save = cleared();
    const out = actPlayStage(save, D1, s1.id, 3, ctx, 0);
    expect(out.result.winner).toBe('A');
    expect(out.save.campaign.cleared).toContain(s1.id);
    expect(out.replay).toBeUndefined();
    expect(() => playStage(strong(), s1.id, 3, ctx)).toThrow(expect.objectContaining({ code: 'stage_locked' }));
  });

  it('поражение на открытом этапе можно повторять сколько угодно (это не повтор пройденного)', () => {
    const s = strong();
    const weak = { ...s, campaign: { cleared: ctx.content.stages.slice(0, -1).map((x) => x.id) }, heroes: s.heroes.map((h) => ({ ...h, rarity: 'green' as const, level: 1 })) };
    const last = ctx.content.stages.at(-1)!.id;
    const a = actPlayStage(weak, D1, last, 1, ctx);
    expect(a.result.winner).not.toBe('A');
    const b = actPlayStage(a.save, D1, last, 2, ctx);
    expect(b.result.winner).not.toBe('A');
    expect(b.save.battleSeq).toBe(weak.battleSeq + 2);
  });

  it('старый save с campaignFarm читается и не открывает повторы', () => {
    const save = { ...cleared(), campaignFarm: { day: D1, wins: 2 } };
    expect(() => playStage(save, s0.id, 2, ctx, undefined, D1)).toThrow(stageCleared);
  });

  it('явный replay: true в контексте возвращает прежние повторы (код повторов не удалён)', () => {
    const out = actPlayStage(cleared(), D1, s0.id, 2, withReplay(ctx));
    expect(out.replay?.limit).toBe(6);
  });
});
