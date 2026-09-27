/**
 * Таверна (docs/design/heroes.md, раздел 4; data/summon.json): детерминизм, шансы на 100 000 призывов (±0,5 п. п.),
 * гарант, первый ×10, бесплатный раз в день, цены, подарок открытия, осколки из Таверны.
 */
import { describe, expect, it } from 'vitest';
import {
  grantTavernWelcome,
  HeroError,
  newGame,
  playStage,
  summon,
  summonPool,
  summonStatus,
  type CardRarity,
  type SaveState,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const cfg = ctx.summon;
const D1 = '2026-09-27';
const unlockIdx = ctx.content.stages.findIndex((s) => s.id === cfg.unlockAfterStage);

/** Сохранение с открытой Таверной, гемами и свитками (без подарка). */
function tavern(createdAt = 1000, patch: Partial<SaveState> = {}): SaveState {
  const s = newGame(ctx, createdAt, D1);
  return { ...s, campaign: { cleared: ctx.content.stages.slice(0, unlockIdx + 1).map((x) => x.id) }, currency: { gems: 100_000, scrolls: 100 }, ...patch };
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(HeroError);
    return (e as HeroError).code;
  }
  return undefined;
}

describe('Таверна: правила', () => {
  it('пулы редкостей: зелёный/синий — 7 первых профессий призыва, фиолетовый — 13 вторых', () => {
    expect(summonPool(ctx, 'green')).toEqual(['iris', 'kai', 'lira', 'meilin', 'otto', 'teo', 'zara']);
    expect(summonPool(ctx, 'blue')).toEqual(summonPool(ctx, 'green'));
    expect(summonPool(ctx, 'purple')).toHaveLength(13);
    // Сюжетных в призыве нет.
    for (const r of ['green', 'blue', 'purple'] as CardRarity[]) expect(summonPool(ctx, r).some((t) => ctx.content.heroes[t].source === 'story')).toBe(false);
    expect(cfg.rates.map((r) => [r.rarity, r.chance])).toEqual([
      ['green', 0.64],
      ['blue', 0.32],
      ['purple', 0.04],
    ]);
    expect(cfg.costs).toEqual({ single: 30, ten: 270 });
    expect(cfg.pity).toEqual({ rarity: 'purple', every: 30 });
  });

  it('один seed — одна выдача; повтор того же save даёт то же самое; seq растёт', () => {
    const s = tavern();
    const a = summon(s, ctx, { count: 10, pay: 'gems', day: D1 });
    const b = summon(s, ctx, { count: 10, pay: 'gems', day: D1 });
    expect(a).toEqual(b);
    expect(a.save.summon.seq).toBe(1);
    const c = summon(a.save, ctx, { count: 10, pay: 'gems', day: D1 });
    expect(c.results.map((r) => r.templateId)).not.toEqual(a.results.map((r) => r.templateId));
    // Новые экземпляры — в ростере, «Новый!», id по порядку.
    expect(a.save.heroes.slice(3).map((h) => h.id)).toEqual(a.results.map((r) => r.heroId));
    expect(a.save.heroes.slice(3).every((h) => h.isNew)).toBe(true);
    expect(a.save.summon.total).toBe(10);
    expect(a.save.currency.gems).toBe(s.currency.gems - cfg.costs.ten);
    // isNew — первая копия шаблона.
    const seen = new Set<string>(s.summon.discovered);
    for (const r of a.results) {
      expect(r.isNew).toBe(!seen.has(r.templateId));
      seen.add(r.templateId);
    }
    expect(new Set(a.save.summon.discovered)).toEqual(seen);
  });

  it('шансы на 100 000 призывов — 64 / 32 / 4% ± 0,5 п. п. (без гаранта)', () => {
    const counts: Record<string, number> = {};
    let n = 0;
    for (let seed = 0; n < 100_000; seed++) {
      // Первый ×10 уже был, счётчик гаранта с нуля: за 10 призывов гарант не срабатывает.
      const s = tavern(seed * 7919 + 1, {});
      const r = summon({ ...s, summon: { ...s.summon, firstTenDone: true } }, ctx, { count: 10, pay: 'gems', day: D1 });
      for (const x of r.results) {
        expect(x.guaranteed).toBe(false);
        counts[x.rarity] = (counts[x.rarity] ?? 0) + 1;
        n++;
      }
    }
    for (const rate of cfg.rates) expect(Math.abs(counts[rate.rarity] / n - rate.chance), rate.rarity).toBeLessThan(0.005);
    // Внутри редкости — равновероятно по шаблонам (грубая проверка: каждый встречается).
  });

  it('внутри редкости шаблоны равновероятны (±25% от среднего на 20 000 фиолетовых)', () => {
    const counts: Record<string, number> = {};
    let n = 0;
    for (let seed = 0; n < 20_000; seed++) {
      // Гарант на первом же призыве: sincePurple = every − 1.
      const s = tavern(seed + 1);
      const r = summon({ ...s, summon: { ...s.summon, firstTenDone: true, sincePurple: cfg.pity.every - 1 } }, ctx, { count: 1, pay: 'gems', day: D1 });
      expect(r.results[0].rarity).toBe('purple');
      counts[r.results[0].templateId] = (counts[r.results[0].templateId] ?? 0) + 1;
      n++;
    }
    const pool = summonPool(ctx, 'purple');
    expect(Object.keys(counts).sort()).toEqual(pool);
    for (const t of pool) expect(Math.abs(counts[t] - n / pool.length)).toBeLessThan((n / pool.length) * 0.25);
  });

  it('гарант: 30-й призыв подряд без фиолетового — фиолетовый; счётчик общий для гемов, свитков и бесплатных', () => {
    for (let seed = 1; seed <= 40; seed++) {
      let s = tavern(seed * 104729);
      s = { ...s, summon: { ...s.summon, firstTenDone: true } };
      let run = 0;
      let longest = 0;
      for (let i = 0; i < 12; i++) {
        const pay = i % 3 === 0 ? 'scroll' : 'gems';
        const r = summon(s, ctx, { count: pay === 'scroll' ? 1 : 10, pay, day: D1 });
        for (const x of r.results) {
          run = x.rarity === 'purple' ? 0 : run + 1;
          longest = Math.max(longest, run);
          if (x.guaranteed) expect(x.rarity).toBe('purple');
        }
        s = r.save;
        expect(s.summon.sincePurple).toBe(run);
      }
      expect(longest).toBeLessThan(cfg.pity.every);
    }
    const s = tavern();
    const at29 = { ...s, summon: { ...s.summon, firstTenDone: true, sincePurple: 29 } };
    const r = summon(at29, ctx, { count: 1, pay: 'free', day: D1 });
    expect(r.results[0]).toMatchObject({ rarity: 'purple', guaranteed: true });
    expect(r.save.summon.sincePurple).toBe(0);
    expect(summonStatus(at29, D1, ctx).untilPity).toBe(1);
  });

  it('первый ×10 всегда с фиолетовым (один раз); следующие ×10 — без гарантии', () => {
    let noPurpleSecond = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const first = summon(tavern(seed * 31337), ctx, { count: 10, pay: 'gems', day: D1 });
      expect(first.results.some((r) => r.rarity === 'purple'), `seed ${seed}`).toBe(true);
      expect(first.save.summon.firstTenDone).toBe(true);
      const second = summon(first.save, ctx, { count: 10, pay: 'gems', day: D1 });
      if (!second.results.some((r) => r.rarity === 'purple')) noPurpleSecond++;
    }
    // Без гарантии фиолетовый в ×10 выпадает примерно в 1 − 0,96^10 ≈ 34% случаев.
    expect(noPurpleSecond).toBeGreaterThan(80);
    // ×1 первый ×10 не тратит.
    expect(summon(tavern(), ctx, { count: 1, pay: 'gems', day: D1 }).save.summon.firstTenDone).toBe(false);
  });

  it('бесплатный — раз в день; переводом часов назад второй не получить; на следующий день снова', () => {
    const s = tavern();
    expect(summonStatus(s, D1, ctx).freeLeft).toBe(1);
    const a = summon(s, ctx, { count: 1, pay: 'free', day: D1 });
    expect(a.save.currency).toEqual(s.currency);
    expect(summonStatus(a.save, D1, ctx).freeLeft).toBe(0);
    expect(codeOf(() => summon(a.save, ctx, { count: 1, pay: 'free', day: D1 }))).toBe('free_used');
    expect(codeOf(() => summon(a.save, ctx, { count: 1, pay: 'free', day: '2026-09-20' }))).toBe('free_used');
    const b = summon(a.save, ctx, { count: 1, pay: 'free', day: '2026-09-28' });
    expect(b.save.summon.freeDay).toBe('2026-09-28');
    expect(codeOf(() => summon(s, ctx, { count: 10, pay: 'free', day: D1 }))).toBe('bad_count');
  });

  it('цены и ошибки: нехватка гемов/свитков, закрытая Таверна, не 1 и не 10 — ошибка без изменений', () => {
    const poor = tavern(1000, { currency: { gems: 269, scrolls: 9 } });
    expect(codeOf(() => summon(poor, ctx, { count: 10, pay: 'gems', day: D1 }))).toBe('not_enough_gems');
    expect(codeOf(() => summon(poor, ctx, { count: 10, pay: 'scroll', day: D1 }))).toBe('not_enough_scrolls');
    expect(codeOf(() => summon(poor, ctx, { count: 3, pay: 'gems', day: D1 }))).toBe('bad_count');
    expect(codeOf(() => summon(newGame(ctx, 0), ctx, { count: 1, pay: 'free', day: D1 }))).toBe('tavern_locked');
    const one = summon(poor, ctx, { count: 1, pay: 'gems', day: D1 });
    expect(one.save.currency).toEqual({ gems: 239, scrolls: 9 });
    const scroll = summon(poor, ctx, { count: 1, pay: 'scroll', day: D1 });
    expect(scroll.save.currency).toEqual({ gems: 269, scrolls: 8 });
    const st = summonStatus(poor, D1, ctx);
    expect(st.can).toEqual({ gems1: true, gems10: false, scroll1: true, scroll10: false, free: true });
    expect(summonStatus(newGame(ctx, 0), D1, ctx).unlocked).toBe(false);
  });

  it('осколки из Таверны: с шансом storyShard.chance — «отстающему» сюжетному герою', () => {
    let shards = 0;
    let pulls = 0;
    let s = tavern(4242);
    for (let i = 0; i < 100; i++) {
      const r = summon(s, ctx, { count: 10, pay: 'gems', day: D1 });
      for (const x of r.results) {
        pulls++;
        if (x.shard) {
          shards++;
          expect(ctx.progression.heroes.start).toContain(x.shard.templateId);
        }
      }
      s = r.save;
    }
    expect(Math.abs(shards / pulls - cfg.storyShard.chance)).toBeLessThan(0.03);
    expect(Object.values(s.shards).reduce((a, n) => a + n, 0)).toBe(shards * cfg.storyShard.count);
    // Отстающий получает первым: осколки распределены почти поровну.
    const v = Object.values(s.shards);
    expect(Math.max(...v) - Math.min(...v)).toBeLessThanOrEqual(1);
  });
});

describe('Таверна: подарок открытия', () => {
  it('первая победа на unlockAfterStage — 150 гемов и свиток, событие tavernUnlocked; повтор — ничего', () => {
    const before = { ...newGame(ctx, 0, D1), campaign: { cleared: ctx.content.stages.slice(0, unlockIdx).map((x) => x.id) } };
    const strong = { ...before, heroes: before.heroes.map((h) => ({ ...h, rarity: 'blue' as const, level: 40 })) };
    let out = playStage(strong, cfg.unlockAfterStage, 1, ctx);
    for (let seed = 2; out.result.winner !== 'A'; seed++) out = playStage(strong, cfg.unlockAfterStage, seed, ctx);
    expect(out.events).toContainEqual({ type: 'tavernUnlocked', gems: cfg.welcome.gems, scrolls: cfg.welcome.scrolls });
    expect(out.save.currency).toEqual({ gems: cfg.welcome.gems, scrolls: cfg.welcome.scrolls });
    expect(out.save.summon.welcomeGiven).toBe(true);
    const again = playStage(out.save, cfg.unlockAfterStage, 1, ctx);
    expect(again.events.some((e) => e.type === 'tavernUnlocked')).toBe(false);
    expect(grantTavernWelcome(out.save, ctx).save).toBe(out.save);
    // До открытия подарка нет.
    expect(grantTavernWelcome(before, ctx).save).toBe(before);
  });
});
