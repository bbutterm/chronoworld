import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  actPlayStage,
  addJobExp,
  availableJobChanges,
  changeJob,
  claimOffline,
  deserialize,
  expBankCap,
  expBankStatus,
  expToNext,
  getJob,
  newGame,
  offlineRewards,
  playStage,
  serialize,
  useFastRewards,
  withFeatures,
  type HeroState,
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

const canChange = (save: SaveState) => save.heroes.some((h) => availableJobChanges(h, ctx).length > 0);

describe('P9 / T1-01: быстрые награды и сундук не перескакивают смену профессии после этапа 4', () => {
  // Бесплатная быстрая награда — раз в день; в первой сессии её берут сразу после этапа 1 (T1-01).
  // Проверяем любые один-два дня с бесплатной наградой между этапами 1–3.
  const plans = [[0], [1], [2], [0, 1], [0, 2], [1, 2]];
  for (const plan of plans) {
    it(`быстрые награды после этапов ${plan.map((i) => i + 1).join(', ')} — джоб 10 только после этапа 4`, () => {
      let save = newGame(ctx, 0, day(0));
      const seed = { n: 1 };
      for (let i = 0; i < 4; i++) {
        save = clear(save, ch1[i].id, seed);
        if (i === 3) break;
        expect(canChange(save), `после ${ch1[i].id}`).toBe(false);
        if (!plan.includes(i)) continue;
        const r = useFastRewards(save, day(i + 1), ctx);
        // Ускоряют (опыт есть), но смены профессии ещё нет.
        expect(r.rewards.jobExp).toBeGreaterThan(0);
        save = r.save;
        expect(canChange(save), `быстрые награды после ${ch1[i].id}`).toBe(false);
      }
      expect(save.heroes.every((h) => availableJobChanges(h, ctx).length > 0)).toBe(true);
    });
  }

  it('сундук 2 ч после этапа 1 тоже не даёт джоб 10', () => {
    let save = clear({ ...newGame(ctx, 0), offline: { lastClaimAt: 0 } }, ch1[0].id, { n: 1 });
    const r = claimOffline(save, 2 * HOUR, ctx);
    expect(r.rewards.jobExp).toBeGreaterThan(0);
    save = r.save;
    expect(canChange(save)).toBe(false);
  });

  it('опыт в начале — доля награды этапа в час; после ранних этапов — прежняя ставка offlinePerMinute', () => {
    const early = ctx.progression.offline.earlyExp!;
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

describe('P9 / T1-02: опыт на максимуме Новичка копится и переходит в новую профессию', () => {
  const novice = ctx.progression.heroes.startJob;
  const maxed = (): HeroState => ({ id: 'h1', name: 'Алан', job: novice, jobLevel: getJob(ctx, novice).maxJobLevel, jobExp: 0, jobHistory: [] });

  it('на джобе 10/10 опыт уходит в запас (до предела), событие expBanked, статус для UI', () => {
    const cap = expBankCap(maxed(), ctx);
    expect(cap).toBeGreaterThan(0);
    const r = addJobExp(maxed(), 30, ctx);
    expect(r.hero.bankedExp).toBe(30);
    expect(r.hero.jobExp).toBe(0);
    expect(r.events).toEqual([{ type: 'expBanked', heroId: 'h1', amount: 30, banked: 30 }]);
    expect(expBankStatus(r.hero, ctx)).toEqual({ banking: true, banked: 30, cap, full: false });
    const big = addJobExp(r.hero, cap * 10, ctx);
    expect(big.hero.bankedExp).toBe(cap);
    expect(expBankStatus(big.hero, ctx).full).toBe(true);
    // Полный запас — событий больше нет.
    expect(addJobExp(big.hero, 10, ctx).events).toEqual([]);
  });

  it('остаток опыта при достижении максимума тоже не пропадает', () => {
    const job = getJob(ctx, novice);
    const hero: HeroState = { ...maxed(), jobLevel: job.maxJobLevel - 1 };
    const r = addJobExp(hero, expToNext(job.maxJobLevel - 1, ctx.progression, job.tier) + 7, ctx);
    expect(r.hero.jobLevel).toBe(job.maxJobLevel);
    expect(r.hero.bankedExp).toBe(7);
  });

  it('смена профессии начисляет запас новой профессии и обнуляет его', () => {
    const hero = addJobExp(maxed(), 250, ctx).hero;
    const to = availableJobChanges(hero, ctx)[0];
    const r = changeJob(hero, to, ctx);
    expect(r.hero.bankedExp).toBeUndefined();
    const tier = getJob(ctx, to).tier;
    let total = r.hero.jobExp;
    for (let l = 1; l < r.hero.jobLevel; l++) total += expToNext(l, ctx.progression, tier);
    expect(total).toBe(250);
    expect(r.events[0]).toMatchObject({ type: 'jobChanged' });
    expect(expBankStatus(r.hero, ctx).banking).toBe(false);
  });

  it('обычный герой: статус banking = false, запаса нет', () => {
    const h = addJobExp({ ...maxed(), jobLevel: 1 }, 5, ctx).hero;
    expect(h.bankedExp).toBeUndefined();
    expect(expBankStatus(h, ctx)).toEqual({ banking: false, banked: 0, cap: 0, full: false });
  });

  it('старые сохранения без bankedExp загружаются; запас переживает serialize/deserialize', () => {
    const save = newGame(ctx, 0);
    const text = serialize({ ...save, heroes: [{ ...addJobExp(maxed(), 40, ctx).hero }, ...save.heroes.slice(1)] });
    expect(deserialize(text).heroes[0].bankedExp).toBe(40);
    expect(deserialize(serialize(save)).heroes[0].bankedExp).toBeUndefined();
  });
});

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
