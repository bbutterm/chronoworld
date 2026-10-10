/**
 * Таверна (docs/design/heroes-v2.md, раздел 4; data/summon.json): пул 12 героев, детерминизм, шансы на 100 000
 * призывов (±0,5 п. п.), гаранты синей и фиолетовой, первый ×10 (2 героя, 1 синяя), бесплатный раз в день, цены,
 * подарок открытия. С 10.10 (решение владельца) вытягивание — герой (35,5%) или награда: вещь, опыт, золото, алмазы, руда.
 */
import { describe, expect, it } from 'vitest';
import {
  type SummonDraw,
  type SummonResult,
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
const heroesOf = (r: readonly SummonDraw[]): SummonResult[] => r.filter((x): x is SummonResult => x.kind === 'hero');

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
  it('пул — все 12 героев (сюжетные тоже, Грета и Дорн — с открытия); герои 30 / 5 / 0,5, остальное — награды; гаранты синей (10) и фиолетовой (50)', () => {
    const all = Object.keys(ctx.content.heroes).sort();
    expect(all).toHaveLength(12);
    for (const r of ['green', 'blue', 'purple'] as CardRarity[]) expect(summonPool(ctx, r)).toEqual(all);
    expect(summonPool(ctx, 'purple')).toContain('greta');
    expect(summonPool(ctx, 'purple')).toContain('dorn');
    expect(cfg.rates.map((r) => [r.rarity, r.chance])).toEqual([
      ['green', 0.3],
      ['blue', 0.05],
      ['purple', 0.005],
    ]);
    expect(cfg.loot.map((l) => [l.kind, l.chance])).toEqual([
      ['gear', 0.2],
      ['heroExp', 0.2],
      ['gold', 0.19],
      ['gems', 0.05],
      ['ore', 0.005],
    ]);
    expect(cfg.costs).toEqual({ single: 30, ten: 270 });
    expect(cfg.pity).toEqual([
      { rarity: 'blue', every: 10 },
      { rarity: 'purple', every: 50 },
    ]);
    expect(cfg.firstTen).toEqual({ rarity: 'blue', count: 1, heroes: 2 });
  });

  it('один seed — одна выдача; повтор того же save даёт то же самое; seq растёт', () => {
    const s = tavern();
    const a = summon(s, ctx, { count: 10, pay: 'gems', day: D1 });
    const b = summon(s, ctx, { count: 10, pay: 'gems', day: D1 });
    expect(a).toEqual(b);
    expect(a.save.summon.seq).toBe(1);
    const c = summon(a.save, ctx, { count: 10, pay: 'gems', day: D1 });
    expect(c.results).not.toEqual(a.results);
    // Новые экземпляры — в ростере, «Новый!», id по порядку (только герои серии).
    expect(a.save.heroes.slice(3).map((h) => h.id)).toEqual(heroesOf(a.results).map((r) => r.heroId));
    expect(a.save.heroes.slice(3).every((h) => h.isNew)).toBe(true);
    expect(a.save.summon.total).toBe(10);
    // Цена ×10 минус, алмазы из наград серии плюс.
    const gemsBack = a.results.reduce((n, r) => n + (r.kind === 'loot' && r.loot === 'gems' ? r.amount : 0), 0);
    expect(a.save.currency.gems).toBe(s.currency.gems - cfg.costs.ten + gemsBack);
    // isNew — первая копия шаблона (у сюжетной тройки копии — не новые).
    const seen = new Set<string>(s.summon.discovered);
    for (const r of heroesOf(a.results)) {
      expect(r.isNew).toBe(!seen.has(r.templateId));
      seen.add(r.templateId);
    }
    expect(new Set(a.save.summon.discovered)).toEqual(seen);
  });

  it('шансы на 100 000 вытягиваний — герои 30 / 5 / 0,5% и награды по таблице ± 0,5 п. п. (первые 9 карт ×10 — гарант их не трогает)', () => {
    const counts: Record<string, number> = {};
    let n = 0;
    for (let seed = 0; n < 100_000; seed++) {
      const s = tavern(seed * 7919 + 1, {});
      const r = summon({ ...s, summon: { ...s.summon, firstTenDone: true } }, ctx, { count: 10, pay: 'gems', day: D1 });
      for (const x of r.results.slice(0, 9)) {
        expect(x.guaranteed).toBe(false);
        const k = x.kind === 'hero' ? x.rarity : `loot:${x.loot}`;
        counts[k] = (counts[k] ?? 0) + 1;
        n++;
      }
    }
    for (const rate of cfg.rates) expect(Math.abs((counts[rate.rarity] ?? 0) / n - rate.chance), rate.rarity).toBeLessThan(0.005);
    for (const l of cfg.loot) expect(Math.abs((counts[`loot:${l.kind}`] ?? 0) / n - l.chance), l.kind).toBeLessThan(0.005);
  });

  it('награды уже в сохранении: вещь главы — в инвентаре, опыт — в пуле, золото, алмазы, руда; размер — от дохода этапа', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60 && seen.size < 5; seed++) {
      const s = { ...tavern(seed * 4241), summon: { ...tavern(seed * 4241).summon, firstTenDone: true } };
      const r = summon(s, ctx, { count: 10, pay: 'gems', day: D1 });
      let prev = s;
      // Проверяем по одному: выдаём ту же серию вытягиваниями ×1 нельзя (другой seed), поэтому сверяем суммы серии.
      const loot = r.results.filter((x) => x.kind === 'loot');
      const sum = (k: string) => loot.filter((x) => x.kind === 'loot' && x.loot === k).reduce((a, x) => a + (x.kind === 'loot' ? x.amount : 0), 0);
      expect(r.save.resources.gold - prev.resources.gold).toBe(sum('gold'));
      expect(r.save.resources.heroExp - prev.resources.heroExp).toBe(sum('heroExp'));
      expect(r.save.currency.gems - (prev.currency.gems - cfg.costs.ten)).toBe(sum('gems'));
      expect((r.save.currency.blessedOre ?? 0) - (prev.currency.blessedOre ?? 0)).toBe(sum('ore'));
      const gear = loot.filter((x) => x.kind === 'loot' && x.loot === 'gear');
      expect(r.save.inventory.items.length - prev.inventory.items.length).toBe(gear.length);
      for (const g of gear) {
        if (g.kind !== 'loot') continue;
        const inst = r.save.inventory.items.find((it) => it.id === g.instanceId)!;
        expect(inst.itemId).toBe(g.itemId);
        // Только вещи открытых глав.
        expect(ctx.equipment!.items[g.itemId!].minChapter ?? 1).toBeLessThanOrEqual(1);
      }
      for (const x of loot) if (x.kind === 'loot') {
        seen.add(x.loot);
        expect(x.amount).toBeGreaterThan(0);
        if (x.loot === 'gems') expect(x.amount).toBeGreaterThanOrEqual(10);
      }
      prev = r.save;
    }
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });

  it('внутри редкости герои равновероятны (±25% от среднего на 12 000 фиолетовых); фиолетовый — без ветки', () => {
    const counts: Record<string, number> = {};
    let n = 0;
    for (let seed = 0; n < 12_000; seed++) {
      // Гарант фиолетовой на первом же призыве: sincePurple = every − 1.
      const s = tavern(seed + 1);
      const r = summon({ ...s, summon: { ...s.summon, firstTenDone: true, sincePurple: 49 } }, ctx, { count: 1, pay: 'gems', day: D1 });
      expect(r.results[0]).toMatchObject({ rarity: 'purple' });
      expect(r.save.heroes.at(-1)!.branch).toBeUndefined();
      const got = heroesOf(r.results)[0];
      counts[got.templateId] = (counts[got.templateId] ?? 0) + 1;
      n++;
    }
    const pool = summonPool(ctx, 'purple');
    expect(Object.keys(counts).sort()).toEqual(pool);
    for (const t of pool) expect(Math.abs(counts[t] - n / pool.length)).toBeLessThan((n / pool.length) * 0.25);
  });

  it('гарант синей: 10-й призыв подряд без синей (или выше) — синяя; счётчик общий для гемов, свитков и бесплатных', () => {
    for (let seed = 1; seed <= 40; seed++) {
      let s = tavern(seed * 104729);
      s = { ...s, summon: { ...s.summon, firstTenDone: true } };
      let run = 0;
      let longest = 0;
      for (let i = 0; i < 12; i++) {
        const pay = i % 3 === 0 ? 'scroll' : 'gems';
        const r = summon(s, ctx, { count: pay === 'scroll' ? 1 : 10, pay, day: D1 });
        for (const x of r.results) {
          run = x.rarity === 'green' ? run + 1 : 0;
          longest = Math.max(longest, run);
          if (x.guaranteed) expect(x.rarity).not.toBe('green');
        }
        s = r.save;
        expect(s.summon.sinceBlue).toBe(run);
      }
      expect(longest).toBeLessThan(10);
    }
    const s = tavern();
    const at9 = { ...s, summon: { ...s.summon, firstTenDone: true, sinceBlue: 9 } };
    const r = summon(at9, ctx, { count: 1, pay: 'free', day: D1 });
    expect(['blue', 'purple']).toContain(r.results[0].rarity);
    expect(r.save.summon.sinceBlue).toBe(0);
    expect(summonStatus(at9, D1, ctx)).toMatchObject({ untilPity: 1, pityRarity: 'blue' });
  });

  it('гарант фиолетовой: 50-й призыв подряд без фиолетовой — фиолетовая (старше синего гаранта)', () => {
    const s = tavern();
    const at49 = { ...s, summon: { ...s.summon, firstTenDone: true, sincePurple: 49, sinceBlue: 9 } };
    const r = summon(at49, ctx, { count: 1, pay: 'gems', day: D1 });
    expect(r.results[0]).toMatchObject({ rarity: 'purple', guaranteed: true });
    expect(r.save.summon).toMatchObject({ sincePurple: 0, sinceBlue: 0 });
    expect(summonStatus(at49, D1, ctx).pities).toEqual([
      { rarity: 'blue', until: 1 },
      { rarity: 'purple', until: 1 },
    ]);
    // За 500 призывов подряд без фиолетовой больше 49 не бывает.
    let cur = { ...tavern(77), summon: { ...tavern(77).summon, firstTenDone: true } };
    let run = 0;
    for (let i = 0; i < 50; i++) {
      const x = summon(cur, ctx, { count: 10, pay: 'gems', day: D1 });
      for (const res of x.results) {
        run = res.rarity === 'purple' ? 0 : run + 1;
        expect(run).toBeLessThan(50);
      }
      cur = x.save;
    }
  });

  // Пакет V3 (решение владельца): первый ×10 гарантирует одну синюю (было две) — меньше синих копий в первой сессии.
  // 10.10: и не меньше двух героев (остальное могут быть награды).
  it('первый ×10 — не меньше двух героев и одной синей (или выше), один раз; ×1 его не тратит', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const first = summon(tavern(seed * 31337), ctx, { count: 10, pay: 'gems', day: D1 });
      expect(first.results.filter((r) => r.rarity !== 'green').length, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(heroesOf(first.results).length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(first.save.summon.firstTenDone).toBe(true);
    }
    expect(summon(tavern(), ctx, { count: 1, pay: 'gems', day: D1 }).save.summon.firstTenDone).toBe(false);
    expect(summonStatus(tavern(), D1, ctx)).toMatchObject({ firstTenBonus: true, firstTenRarity: 'blue', firstTenCount: 1 });
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
