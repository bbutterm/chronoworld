import { describe, expect, it } from 'vitest';
import { claimOffline, idleIncome, newGame, offlineRewards, type SaveState } from '../src/core';
import { loadGameContext } from '../scripts/lib/content-node';

const ctx = loadGameContext();
const stages = ctx.content.stages;
const MIN = 60_000;
const T0 = 1_000_000_000;

/** Сохранение с пройденными этапами (в любом порядке), lastClaimAt = T0. */
const saveWith = (cleared: string[]): SaveState => ({ ...newGame(ctx, T0), campaign: { cleared } });

describe('офлайн-награды', () => {
  it('ноль, пока нет пройденных этапов', () => {
    expect(offlineRewards(saveWith([]), T0 + 60 * MIN, ctx)).toEqual({ minutes: 0, gold: 0, jobExp: 0 });
  });

  it('доход по последнему пройденному этапу × минуты', () => {
    // Порядок в cleared не важен: берётся этап с максимальным globalIndex.
    const save = saveWith([stages[2].id, stages[0].id, stages[1].id]);
    expect(offlineRewards(save, T0 + 30 * MIN + 59_999, ctx)).toEqual({ minutes: 30, ...idleIncome(stages[2], 30, ctx) });
    expect(offlineRewards(save, T0, ctx)).toEqual({ minutes: 0, gold: 0, jobExp: 0 });
    // После ранних этапов (P9) — полная ставка offlinePerMinute.
    const late = stages[6];
    const per = late.offlinePerMinute;
    expect(offlineRewards(saveWith([late.id]), T0 + 30 * MIN, ctx)).toEqual({ minutes: 30, gold: per.gold * 30, jobExp: per.jobExp * 30 });
  });

  it('лимит capHours', () => {
    const save = saveWith([stages[0].id]);
    const cap = ctx.progression.offline.capHours * 60;
    const r = offlineRewards(save, T0 + 100 * 60 * MIN, ctx);
    expect(r).toEqual({ minutes: cap, ...idleIncome(stages[0], cap, ctx) });
    expect(offlineRewards(save, T0 + cap * MIN, ctx)).toEqual(r);
  });

  it('часы переведены назад — ноль, lastClaimAt = now', () => {
    const save = saveWith([stages[0].id]);
    const now = T0 - 5 * 60 * MIN;
    expect(offlineRewards(save, now, ctx)).toEqual({ minutes: 0, gold: 0, jobExp: 0 });
    const out = claimOffline(save, now, ctx);
    expect(out.rewards).toEqual({ minutes: 0, gold: 0, jobExp: 0 });
    expect(out.events).toEqual([]);
    // P11 (T4-09): якорь = now, а скачок назад (5 ч, не больше лимита) — долг сундука.
    expect(out.save).toEqual({ ...save, offline: { lastClaimAt: now, debtMs: 5 * 60 * MIN } });
  });

  it('claimOffline: золото в ресурсы, опыт в общий пул героев, повторный сбор сразу — ноль', () => {
    const save = saveWith([stages[0].id]);
    const copy = structuredClone(save);
    const now = T0 + 90 * MIN;
    const { save: next, rewards, events } = claimOffline(save, now, ctx);
    expect(save).toEqual(copy);
    expect(rewards.minutes).toBe(90);
    expect(next.resources.gold).toBe(save.resources.gold + rewards.gold);
    expect(next.offline.lastClaimAt).toBe(now);
    expect(next.resources.heroExp).toBe(save.resources.heroExp + rewards.jobExp);
    expect(next.heroes).toEqual(save.heroes);
    expect(events[0]).toEqual({ type: 'rewards', gold: rewards.gold, heroExp: rewards.jobExp });

    const again = claimOffline(next, now, ctx);
    expect(again.rewards).toEqual({ minutes: 0, gold: 0, jobExp: 0 });
    expect(again.save).toEqual(next);
  });
});
