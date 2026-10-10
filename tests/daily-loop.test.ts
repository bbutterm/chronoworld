/**
 * Ежедневная петля (docs/design/daily-loop-2026-10-10.md): задания дня видят Охоту, Арену, Лавку и экспедиции;
 * задания закрытых функций скрыты; счётчики производных заданий читаются из суточного состояния самих систем.
 */
import { describe, expect, it } from 'vitest';
import {
  actClaimAllExpeditions,
  actClaimExpedition,
  claimQuest,
  featureStage,
  FeatureError,
  newGame,
  questCounter,
  questStatus,
  rollDay,
  startExpedition,
  type SaveState,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const D1 = '2026-10-10';
const D0 = '2026-10-09';
const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 10, 8);
const quests = ctx.features.quests.quests;

/** Новая игра с пройденными этапами до stageId включительно. */
function game(stageId: string): SaveState {
  const s = newGame(ctx, T0, D1);
  const i = ctx.content.stages.findIndex((x) => x.id === stageId);
  return { ...s, campaign: { cleared: ctx.content.stages.slice(0, i + 1).map((x) => x.id) } };
}

/** Все функции из data/unlocks.json открыты. */
const late = () => game(ctx.content.stages.find((s) => s.id === 'ch2_s5')!.id);

describe('задания дня покрывают ежедневные системы', () => {
  it('у Охоты, Арены, Лавки, экспедиций, Башни и Таверны есть задание дня', () => {
    const byUnlock = new Set(quests.map((q) => q.unlock));
    for (const f of ['hunt', 'autobattler', 'shop', 'bounties', 'tower', 'tavern'] as const) expect(byUnlock, f).toContain(f);
  });

  it('пороги активности не изменились: до 100 очков, гемов за день — 90', () => {
    expect(ctx.features.quests.milestones.map((m) => m.points)).toEqual([20, 40, 60, 80, 100]);
    expect(ctx.features.quests.milestones.reduce((a, m) => a + m.rewards.gems, 0)).toBe(90);
  });

  it('у новичка задания закрытых функций скрыты, но до 100 очков хватает', () => {
    const st = questStatus(newGame(ctx, T0, D1), ctx, D1);
    for (const q of st.quests) if (q.unlock) expect(featureStage(q.unlock, ctx), q.id).toBeNull();
    expect(st.quests.map((q) => q.id)).not.toContain('hunt');
    expect(st.maxActivity).toBeGreaterThanOrEqual(100);
  });

  it('функция открыта — задание видно; закрытое задание не забрать', () => {
    const open = questStatus(late(), ctx, D1);
    expect(open.quests.map((q) => q.id)).toEqual(quests.map((q) => q.id));
    expect(open.maxActivity).toBe(quests.reduce((a, q) => a + q.points, 0));
    const s = { ...rollDay(newGame(ctx, T0, D1), D1), hunt: { day: D1, used: 1, best: {} } };
    let err: unknown;
    try {
      claimQuest(s, D1, 'hunt', ctx);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(FeatureError);
    expect((err as FeatureError).code).toBe('quest_locked');
  });
});

describe('производные счётчики', () => {
  const s0 = rollDay(late(), D1);

  it('Охота: попытки сегодня; вчерашние не считаются', () => {
    expect(questCounter(s0, 'hunt_attempt')).toBe(0);
    expect(questCounter({ ...s0, hunt: { day: D0, used: 2, best: {} } }, 'hunt_attempt')).toBe(0);
    const s = { ...s0, hunt: { day: D1, used: 1, best: {} } };
    expect(questCounter(s, 'hunt_attempt')).toBe(1);
    const r = claimQuest(s, D1, 'hunt', ctx);
    expect(r.points).toBe(quests.find((q) => q.id === 'hunt')!.points);
  });

  it('Лавка: покупки сегодняшнего ассортимента', () => {
    expect(questCounter({ ...s0, shop: { day: D0, refreshes: 0, slots: [], boughtToday: { a: 3 } } }, 'shop_buy')).toBe(0);
    const s = { ...s0, shop: { day: D1, refreshes: 0, slots: [], boughtToday: { a: 1, b: 2 } } };
    expect(questCounter(s, 'shop_buy')).toBe(3);
    expect(questStatus(s, ctx).quests.find((q) => q.id === 'shop')).toMatchObject({ done: true, progress: 1 });
  });

  it('Арена: лучший итог дня — награда дня или матч, начатый сегодня', () => {
    const ab = { seq: 1, bestWins: 5, completed: 3 };
    expect(questCounter({ ...s0, autobattler: { ...ab, rewardDay: D0, rewardWins: 5 } }, 'arena_wins')).toBe(0);
    expect(questCounter({ ...s0, autobattler: { ...ab, rewardDay: D1, rewardWins: 3 } }, 'arena_wins')).toBe(3);
    const s = { ...s0, autobattler: { ...ab, rewardDay: D1, rewardWins: 1 } };
    expect(questStatus(s, ctx).quests.find((q) => q.id === 'arena')).toMatchObject({ done: false, progress: 1 });
  });

  it('счётчики не попадают в сохранение (daily.quests без новых ключей)', () => {
    const s = { ...s0, hunt: { day: D1, used: 1, best: {} } };
    const r = claimQuest(s, D1, 'hunt', ctx);
    expect(Object.keys(r.save.daily.quests)).not.toContain('hunt_attempt');
  });
});

describe('экспедиции', () => {
  it('actClaimExpedition и actClaimAllExpeditions засчитывают expedition_claim', () => {
    const s = startExpedition(late(), 'ant_hell', 1, T0, ctx);
    const one = actClaimExpedition(s, D1, 'ant_hell', T0 + 2 * H, ctx);
    expect(one.save.daily.quests.expedition_claim).toBe(1);
    expect(questStatus(one.save, ctx, D1).quests.find((q) => q.id === 'expedition')!.done).toBe(true);
    const all = actClaimAllExpeditions(s, D1, T0 + 2 * H, ctx);
    expect(all.claimed).toEqual(['ant_hell']);
    expect(all.save.daily.quests.expedition_claim).toBe(1);
    // Нечего забрать — счётчик не растёт.
    const none = actClaimAllExpeditions(all.save, D1, T0 + 3 * H, ctx);
    expect(none.save.daily.quests.expedition_claim).toBe(1);
  });
});
