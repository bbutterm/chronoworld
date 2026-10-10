import { describe, expect, it } from 'vitest';
import {
  claimAllQuests, claimActivity, newGame, questStatus,
  startTowerRun, towerEnemyMult, runFloorEnemies, serialize, deserialize,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { withQuestsDone } from './helpers';

const ctx = loadFullContext();
const day = '2026-10-03';
const fresh = () => newGame(ctx, 0, day);
const atStage = (index: number) => {
  const s = fresh();
  return { ...s, campaign: { ...s.campaign, cleared: ctx.content.stages.slice(0, index + 1).map((x) => x.id) } };
};

describe('Ежедневные задания без принудительной прокачки', () => {
  it('все награды доступны без улучшения героев и дополнительных боёв', () => {
    // Все функции открыты: заданий без «Улучшить» — больше 100 очков (daily-loop-2026-10-10: Охота, Арена, Лавка,
    // экспедиции), до последнего порога хватает и без прокачки.
    const s = withQuestsDone(fresh(), day, ctx, ctx.features.quests.quests.filter((q) => q.event !== 'hero_level_up'));
    const result = claimAllQuests(s, day, ctx);
    expect(result.points).toBeGreaterThanOrEqual(100);
    expect(result.milestones).toEqual([20, 40, 60, 80, 100]);
    expect(result.quests).not.toContain('level_ups');
    expect(result.save.heroes).toEqual(s.heroes);
    // Без новых заданий (Охота, Арена, Лавка, экспедиции, Кухня) — прежние 100 очков: старый набор по-прежнему закрывает пороги.
    const old = withQuestsDone(fresh(), day, ctx, ctx.features.quests.quests.filter((q) => q.event !== 'hero_level_up' && !['expedition', 'hunt', 'arena', 'shop', 'kitchen'].includes(q.id)));
    expect(claimAllQuests(old, day, ctx).points).toBe(100);
    expect(claimAllQuests(result.save, day, ctx).rewards).toEqual({ gold: 0, gems: 0, jobExp: 0 });
  });

  it('уже полученное задание даёт новые очки, а полученные пороги не выдаются повторно', () => {
    const s = fresh();
    // Прежний набор заданий без «Улучшить» — ровно 100 очков (новые задания daily-loop-2026-10-10 не берём).
    s.daily.claimedQuests = ctx.features.quests.quests.filter((q) => q.id !== 'level_ups' && !['expedition', 'hunt', 'arena', 'shop', 'kitchen'].includes(q.id)).map((q) => q.id);
    s.daily.activityClaimed = [20, 40, 60, 80];
    expect(questStatus(s, ctx).activity).toBe(100);
    const out = claimAllQuests(s, day, ctx);
    expect(out.quests).toEqual([]);
    expect(out.milestones).toEqual([100]);
    expect(out.rewards).toEqual({ gold: 0, gems: 60, jobExp: 0 });
    expect(() => claimActivity(out.save, day, 100, ctx)).toThrow();
    expect(claimAllQuests(out.save, day, ctx).milestones).toEqual([]);
  });
});

describe('Плавная сила Башни', () => {
  it('сила монотонна, совпадает с прежней с середины главы, скачок за этап не выше 11%', () => {
    let previous = towerEnemyMult(fresh(), ctx);
    for (const [i, stage] of ctx.content.stages.entries()) {
      const mult = towerEnemyMult(atStage(i), ctx);
      expect(mult).toBeGreaterThanOrEqual(previous - 1e-10);
      expect(mult / previous).toBeLessThanOrEqual(1.11);
      const chapter = ctx.content.chapters.find((c) => c.id === stage.chapter)!;
      if (stage.index + 1 >= Math.ceil(chapter.stages.length / 2)) {
        const tiers = ctx.tower.run!.tierMult;
        expect(mult).toBeCloseTo(tiers[Math.min(chapter.order, tiers.length) - 1], 10);
      }
      previous = mult;
    }
  });

  it('новый забег фиксирует силу и переживает сохранение; старый сохраняет прежний tier', () => {
    const index = ctx.content.stages.findIndex((s) => s.id === 'ch4_s1');
    const before = atStage(index);
    const started = startTowerRun(before, before.squad, ctx);
    const restored = deserialize(serialize(started));
    const run = restored.tower.run!;
    expect(run.enemyMult).toBeCloseTo(towerEnemyMult(before, ctx), 10);
    const expected = runFloorEnemies(run, 1, 'battle', ctx);
    restored.campaign.cleared = ctx.content.stages.map((s) => s.id);
    expect(runFloorEnemies(restored.tower.run!, 1, 'battle', ctx)).toEqual(expected);
    const { enemyMult: _, ...legacy } = run;
    const legacySave = { ...restored, tower: { ...restored.tower, run: legacy } };
    expect(deserialize(serialize(legacySave)).tower.run!.enemyMult).toBeUndefined();
    const old = runFloorEnemies(legacy, 1, 'battle', ctx);
    expect(old).toEqual(runFloorEnemies({ ...legacy, enemyMult: ctx.tower.run!.tierMult[legacy.tier - 1] }, 1, 'battle', ctx));
    expect(old.filter(Boolean)[0]!.stats.hp).toBeGreaterThan(expected.filter(Boolean)[0]!.stats.hp);
  });
});
