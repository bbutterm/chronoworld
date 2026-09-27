import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  actPlayStage,
  claimOffline,
  newGame,
  offlineRewards,
  playStage,
  useFastRewards,
  withFeatures,
  type SaveState,
} from '../src/core';
import { loadGameContext } from '../scripts/lib/content-node';

const root = join(import.meta.dirname, '..');
const progressionJson = JSON.parse(readFileSync(join(root, 'data/progression.json'), 'utf8'));
const questsJson = JSON.parse(readFileSync(join(root, 'data/quests.json'), 'utf8'));
const ctx = withFeatures(loadGameContext(), progressionJson, questsJson);
const ch1 = ctx.content.stages.filter((s) => s.chapter === ctx.content.chapters[0].id);
const HOUR = 3_600_000;
const day = (i: number) => `2026-09-${String(10 + i).padStart(2, '0')}`;

/** Пройти этап (до 6 попыток), вернуть сохранение после победы. */
function clear(save: SaveState, stageId: string, seed: { n: number }, now?: number): SaveState {
  for (let t = 0; t < 6; t++) {
    const out = playStage(save, stageId, seed.n++, ctx, now);
    save = out.save;
    if (out.result.winner === 'A') return save;
  }
  throw new Error(`не прошли ${stageId}`);
}

describe('P9 / T1-01: быстрые награды и сундук в начале кампании не обгоняют темп первых этапов', () => {
  // v4: смены профессии нет, опыт идёт в общий пул — ограничение earlyExp держит пул ранних этапов в рамках
  // stageRewardsPerHour × награды этапа в час (быстрые награды ускоряют, но не заменяют бои).
  const early = ctx.progression.offline.earlyExp!;
  for (let last = 0; last < 3; last++) {
    it(`быстрые награды после этапа ${last + 1} — опыт не больше ${early.stageRewardsPerHour} × награды этапа в час`, () => {
      let save = newGame(ctx, 0, day(0));
      const seed = { n: 1 };
      for (let i = 0; i <= last; i++) save = clear(save, ch1[i].id, seed);
      const r = useFastRewards(save, day(1), ctx);
      expect(r.rewards.jobExp).toBeGreaterThan(0);
      const hours = ctx.features.fastRewards.hours;
      expect(r.rewards.jobExp).toBeLessThanOrEqual(Math.floor(ch1[last].rewards.jobExp * early.stageRewardsPerHour * hours));
      // Опыт — в пул, уровни сами не растут.
      expect(r.save.resources.heroExp).toBe(save.resources.heroExp + r.rewards.jobExp);
      expect(r.save.heroes).toEqual(save.heroes);
    });
  }

  it('сундук 2 ч после этапа 1 — тоже по ставке ранних этапов', () => {
    const save = clear({ ...newGame(ctx, 0), offline: { lastClaimAt: 0 } }, ch1[0].id, { n: 1 });
    const r = claimOffline(save, 2 * HOUR, ctx);
    expect(r.rewards.jobExp).toBeGreaterThan(0);
    expect(r.rewards.jobExp).toBeLessThanOrEqual(Math.floor(ch1[0].rewards.jobExp * early.stageRewardsPerHour * 2));
  });

  it('опыт в начале — доля награды этапа в час; после ранних этапов — прежняя ставка offlinePerMinute', () => {
    expect(early.stages).toBeGreaterThan(0);
    const at = (stage: (typeof ch1)[number]) => offlineRewards({ ...newGame(ctx, 0), campaign: { cleared: [stage.id] } }, HOUR, ctx);
    const s1 = at(ch1[0]);
    expect(s1.jobExp).toBe(Math.min(ch1[0].offlinePerMinute.jobExp * 60, Math.floor(ch1[0].rewards.jobExp * early.stageRewardsPerHour)));
    expect(s1.gold).toBe(ch1[0].offlinePerMinute.gold * 60);
    const late = ch1[early.stages];
    expect(at(late).jobExp).toBe(late.offlinePerMinute.jobExp * 60);
    // Опыт растёт с прогрессом.
    const series = ch1.map((s) => at(s).jobExp);
    for (let i = 1; i < series.length; i++) expect(series[i]).toBeGreaterThan(series[i - 1]);
  });
});

// P9 / T1-02 («опыт на максимуме Новичка копится в запас до смены профессии») снят вместе с Новичками и сменой
// профессии (решение владельца 27.09, docs/design/heroes.md): опыт всегда копится в общем пуле resources.heroExp.

describe('P9 / T1-15: сундук копит время с первой победы', () => {
  it('playStage/actPlayStage с now ставят lastClaimAt = now при первой победе в кампании', () => {
    const created = 0;
    const won = 10 * 60_000;
    const save = clear(newGame(ctx, created), ch1[0].id, { n: 1 }, won);
    expect(save.offline.lastClaimAt).toBe(won);
    expect(offlineRewards(save, won + 60_000, ctx).minutes).toBe(1);
    const viaAct = actPlayStage(newGame(ctx, created), day(0), ch1[0].id, 1, ctx, won);
    if (viaAct.result.winner === 'A') expect(viaAct.save.offline.lastClaimAt).toBe(won);
    // Следующие победы накопленное не теряют: час по ставке этапа 1 зафиксирован в banked (P11, T4-10).
    const later = clear(save, ch1[1].id, { n: 1 }, won + HOUR);
    expect(offlineRewards(later, won + HOUR, ctx).minutes).toBe(60);
    expect(later.offline.banked?.minutes).toBe(60);
  });

  it('без now — прежнее поведение (lastClaimAt не меняется)', () => {
    const save = clear(newGame(ctx, 0), ch1[0].id, { n: 1 });
    expect(save.offline.lastClaimAt).toBe(0);
  });
});
