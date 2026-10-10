import { describe, expect, it } from 'vitest';
import { actPlayStage, actSkipStage, deserialize, newGame, playStage, repeatStage, replayAllowance, serialize, skipStage, type SaveState } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { withReplay } from './helpers';

// Выпущенные данные повторы запрещают (campaign.replay: false; tests/campaign-no-replay.test.ts). Код дневного бюджета
// повторов остаётся для контекстов с replay ≠ false — проверяем его на явно разрешённых повторах (как было до 10.10).
const base = withReplay(loadFullContext());
const ctx = {
  ...base,
  cards: { ...base.cards, heroCards: { ...base.cards.heroCards, replay: { blue: 1, purple: 1 } } },
  equipment: { ...base.equipment, drops: { ...base.equipment.drops, rules: base.equipment.drops.rules.map((r) => ({ ...r, chance: 1 })) } },
};
const D1 = '2026-10-04';
const D2 = '2026-10-05';
const stageId = ctx.content.stages[0].id;

function strong(): SaveState {
  const s = newGame(ctx, 0, D1);
  return { ...s, heroes: s.heroes.map((h) => ({ ...h, rarity: 'red', level: 100 })) };
}

function cleared(): SaveState {
  const out = actPlayStage(strong(), D1, stageId, 1, ctx, 0);
  expect(out.result.winner).toBe('A');
  return out.save;
}

describe('Дневная добыча повторов и тренировка', () => {
  it('первые прохождения всегда дают полную награду и не расходуют бюджет повторов', () => {
    const s = { ...strong(), campaignFarm: { day: D1, wins: 6 } };
    const out = actPlayStage(s, D1, stageId, 1, ctx, 0);
    expect(out.result.winner).toBe('A');
    expect(out.save.resources.gold - s.resources.gold).toBe(ctx.content.stages[0].rewards.gold);
    expect(out.drops).toHaveLength(1);
    expect(out.save.campaignFarm).toEqual(s.campaignFarm);
    expect(out.replay).toBeUndefined();
  });

  it('шесть побед с добычей на день; все пути затем дают тренировку без золота, опыта, вещей и карт', () => {
    let save = cleared();
    for (let k = 0; k < 6; k++) {
      const out = k % 2 ? actSkipStage(save, D1, stageId, k + 2, ctx) : actPlayStage(save, D1, stageId, k + 2, ctx);
      expect(out.result.winner).toBe('A');
      expect(out.replay).toEqual({ rewarded: true, used: k + 1, limit: 6 });
      expect(out.drops).toHaveLength(1);
      expect(out.save.heroes.length - save.heroes.length).toBe(2);
      expect(out.save.resources.gold).toBeGreaterThan(save.resources.gold);
      save = deserialize(serialize(out.save));
    }
    expect(replayAllowance(save, D1, ctx)).toEqual({ used: 6, remaining: 0, limit: 6 });
    const attempts = [
      () => actPlayStage(save, D1, stageId, 8, ctx),
      () => actSkipStage(save, D1, stageId, 8, ctx),
      () => playStage(save, stageId, 8, ctx, undefined, D1),
      () => skipStage(save, stageId, 8, ctx, D1),
      () => repeatStage(save, stageId, 8, ctx, D1),
    ];
    for (const attempt of attempts) {
      const out = attempt();
      expect(out.result.winner).toBe('A');
      expect(out.replay).toEqual({ rewarded: false, used: 6, limit: 6 });
      expect(out.save.resources).toEqual(save.resources);
      expect(out.save.heroes).toEqual(save.heroes);
      expect(out.save.inventory).toEqual(save.inventory);
      expect(out.save.currency).toEqual(save.currency);
      expect(out.save.battleSeq).toBe(save.battleSeq + 1);
      expect(out.events.some((e) => e.type === 'heroCard' || e.type === 'blessedOre')).toBe(false);
    }
  });

  it('поражение не расходует награду, победа после него по-прежнему доступна', () => {
    const s = cleared();
    const weak = { ...s, campaign: { cleared: ctx.content.stages.map((x) => x.id) }, heroes: s.heroes.map((h) => ({ ...h, rarity: 'green' as const, level: 1 })) };
    const out = actPlayStage(weak, D1, ctx.content.stages.at(-1)!.id, 1, ctx);
    expect(out.result.winner).not.toBe('A');
    expect(out.save.campaignFarm).toBeUndefined();
    expect(replayAllowance(out.save, D1, ctx).remaining).toBe(6);
  });

  it('новый день обновляет бюджет; старый день и возврат часов не дают дополнительных наград', () => {
    const s = { ...cleared(), campaignFarm: { day: D1, wins: 6 } };
    const next = actSkipStage(s, D2, stageId, 1, ctx);
    expect(next.replay).toEqual({ rewarded: true, used: 1, limit: 6 });
    expect(next.save.campaignFarm).toEqual({ day: D2, wins: 1 });
    const older = actSkipStage(next.save, D1, stageId, 1, ctx);
    expect(older.replay?.rewarded).toBe(false);
    expect(older.save.resources).toEqual(next.save.resources);
    expect(older.save.campaignFarm).toEqual(next.save.campaignFarm);
    expect(replayAllowance(older.save, D2, ctx).remaining).toBe(5);
  });

  it('старый save без campaignFarm получает бюджет; прямой повтор без явного дня — без добычи', () => {
    const s = deserialize(serialize(cleared()));
    expect(s.campaignFarm).toBeUndefined();
    expect(replayAllowance(s, D1, ctx).remaining).toBe(6);
    const out = playStage(s, stageId, 1, ctx);
    expect(out.replay?.rewarded).toBe(false);
    expect(out.save.resources).toEqual(s.resources);
    expect(out.save.heroes).toEqual(s.heroes);
    expect(() => playStage(s, stageId, 1, ctx, undefined, 'wrong')).toThrow(expect.objectContaining({ code: 'invalid_day' }));
  });

  it('бюджет общий для этапов, и 0 в конфиге полностью отключает награды повторов', () => {
    const s = { ...cleared(), campaign: { cleared: ctx.content.stages.slice(0, 2).map((x) => x.id) }, campaignFarm: { day: D1, wins: 6 } };
    expect(actSkipStage(s, D1, ctx.content.stages[1].id, 1, ctx).replay?.rewarded).toBe(false);
    const noFarm = { ...ctx, progression: { ...ctx.progression, campaign: { ...ctx.progression.campaign, replayDailyWins: 0 } } };
    expect(actSkipStage(cleared(), D1, stageId, 1, noFarm).save.resources).toEqual(cleared().resources);
  });
});
