/**
 * Экономика (аудит 11.10, пакет economy): «вещь главы» в Таверне и Лавке — вещи своей главы (как трофеи кампании),
 * Лавка не продаёт опыт за золото, когда опыта с избытком, экспедиции поздних локаций растут с доходом их этапа.
 */
import { describe, expect, it } from 'vitest';
import { newGame, rollShop, summon, validateShop, type SaveState, type ShopContext } from '../src/core';
import { chapterDropRule, chapterItemPools } from '../src/core/equipment/chapterPools';
import { heroExpAbundant, squadExpNeed } from '../src/core/heroes/expNeed';
import { idleIncome } from '../src/core/campaign/offline';
import { levelUpCost } from '../src/core/heroes/level';
import { loadFullContext } from '../scripts/lib/content-node';

const full = loadFullContext();
const ctx = full as typeof full & ShopContext;
const items = ctx.equipment.items;
const D1 = '2026-10-11';

/** Сохранение, где пройдены все этапы глав с номером ≤ chapter. */
function atChapter(chapter: number, createdAt = 4242, patch: Partial<SaveState> = {}): SaveState {
  const s = newGame(ctx, createdAt, D1);
  const ids = new Set(ctx.content.chapters.filter((c) => c.order <= chapter).map((c) => c.id));
  const cleared = ctx.content.stages.filter((st) => ids.has(st.chapter)).map((st) => st.id);
  return { ...s, campaign: { cleared }, currency: { ...s.currency, gems: 100_000, scrolls: 100 }, ...patch };
}

describe('вещь главы: Таверна и Лавка берут вещи своей главы', () => {
  it('глава 8: правило выпадения главы задаёт нижнюю границу; обычных вещей нет', () => {
    const from = chapterDropRule(8, ctx)?.itemsFromChapter ?? 1;
    expect(from).toBeGreaterThanOrEqual(6);
    const pools = chapterItemPools(atChapter(8), ctx);
    expect(pools.common).toEqual([]);
    for (const id of [...pools.rare, ...pools.epic]) expect(items[id].minChapter ?? 1).toBeGreaterThanOrEqual(from);
    // Главы 1–3 — по-прежнему все открытые вещи (как трофеи кампании).
    const ch1 = chapterItemPools(atChapter(1), ctx);
    expect(ch1.common.length).toBeGreaterThan(0);
    expect(ch1.epic).toEqual([]);
  });

  it('Таверна в главе 8 — вещи не старше правила главы (нож главы 1 больше не выпадает)', () => {
    const from = chapterDropRule(8, ctx)?.itemsFromChapter ?? 1;
    let gear = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = atChapter(8, seed * 7717);
      const r = summon({ ...s, summon: { ...s.summon, firstTenDone: true } }, ctx, { count: 10, pay: 'gems', day: D1 });
      for (const x of r.results) {
        if (x.kind !== 'loot' || x.loot !== 'gear') continue;
        gear++;
        expect(items[x.itemId!].minChapter ?? 1, x.itemId).toBeGreaterThanOrEqual(from);
      }
    }
    expect(gear).toBeGreaterThan(20);
  });

  it('Лавка в главе 8 — ни одной вещи старых глав; эпик за гемы — своей главы', () => {
    const s = atChapter(8);
    const from = chapterDropRule(8, ctx)?.itemsFromChapter ?? 1;
    let offered = 0;
    for (let r = 0; r < 40; r++) {
      for (const slot of rollShop(s, D1, r, ctx)) {
        if (slot.kind !== 'item') continue;
        offered++;
        expect(slot.good).not.toBe('item_common');
        expect(items[slot.itemId!].minChapter ?? 1, slot.itemId).toBeGreaterThanOrEqual(from);
      }
    }
    expect(offered).toBeGreaterThan(40);
  });
});

describe('Лавка: опыт за золото — только когда опыта не хватает', () => {
  const expGoods = new Set(ctx.shop.goods.filter((g) => g.kind === 'heroExp').map((g) => g.id));
  const offeredExp = (s: SaveState) => {
    let n = 0;
    for (let r = 0; r < 30; r++) n += rollShop(s, D1, r, ctx).filter((x) => expGoods.has(x.good)).length;
    return n;
  };

  it('опыта в запасе на 5 уровней отряда — наборов опыта нет; опыта нет, а золото есть — наборы бывают', () => {
    const base = atChapter(5);
    const need = squadExpNeed(base, ctx);
    expect(need).toBeGreaterThan(0);
    const rich = { ...base, resources: { ...base.resources, heroExp: need, gold: 0 } };
    expect(heroExpAbundant(rich, ctx)).toBe(true);
    expect(offeredExp(rich)).toBe(0);
    const poor = { ...base, resources: { ...base.resources, heroExp: 0, gold: 10_000_000 } };
    expect(heroExpAbundant(poor, ctx)).toBe(false);
    expect(offeredExp(poor)).toBeGreaterThan(0);
  });

  it('уровни упираются в золото — опыт с избытком, даже если его меньше, чем на 5 уровней', () => {
    const base = atChapter(5);
    const squad = base.squad.filter((id): id is string => !!id).map((id) => base.heroes.find((h) => h.id === id)!);
    const low = squad.reduce((a, h) => (h.level < a.level ? h : a));
    const cost = levelUpCost(low.level, ctx);
    const goldBound = { ...base, resources: { ...base.resources, heroExp: cost.exp, gold: cost.gold - 1 } };
    expect(heroExpAbundant(goldBound, ctx)).toBe(true);
    const expBound = { ...base, resources: { ...base.resources, heroExp: cost.exp - 1, gold: cost.gold * 100 } };
    expect(heroExpAbundant(expBound, ctx)).toBe(false);
  });

  it('в каждом слоте есть товар без условий; слот из одних наборов опыта или с untilStage — ошибка проверки', () => {
    const problems: string[] = [];
    validateShop(ctx.shop, ctx.content, ctx.equipment, problems);
    expect(problems).toEqual([]);
    const bad: string[] = [];
    validateShop({ ...ctx.shop, slots: [['exp_small', 'exp_large']] }, ctx.content, ctx.equipment, bad);
    expect(bad.some((p) => p.includes('слот 1'))).toBe(true);
    const until: string[] = [];
    validateShop(
      { ...ctx.shop, slots: [['gold_pack']], goods: ctx.shop.goods.map((g) => (g.id === 'gold_pack' ? { ...g, untilStage: 'ch2_s18' } : g)) },
      ctx.content,
      ctx.equipment,
      until,
    );
    expect(until.some((p) => p.includes('слот 1'))).toBe(true);
  });

  it('untilStage: товар пропадает после этапа', () => {
    const shop = {
      ...ctx.shop,
      slots: [['gold_pack', 'scroll']],
      goods: ctx.shop.goods.map((g) => (g.id === 'gold_pack' ? { ...g, untilStage: 'ch2_s1', weight: 1000 } : g)),
    };
    const c = { ...ctx, shop };
    const early = atChapter(1);
    const later = { ...early, campaign: { cleared: [...early.campaign.cleared, 'ch2_s1'] } };
    const goods = (s: SaveState) => new Set(Array.from({ length: 20 }, (_, r) => rollShop(s, D1, r, c).map((x) => x.good)).flat());
    expect(goods(early).has('gold_pack')).toBe(true);
    expect(goods(later).has('gold_pack')).toBe(false);
  });
});

describe('экспедиции: добыча поздних локаций растёт с доходом их этапа', () => {
  it('золото и опыт за час добычи — не меньше 2 минут дохода этапа локации (с главы 4)', () => {
    for (const loc of ctx.meta.expeditions.locations) {
      const stage = ctx.content.stages.find((s) => s.id === loc.stage)!;
      const chapter = ctx.content.chapters.find((c) => c.id === stage.chapter)!.order;
      if (chapter < 4) continue;
      const inc = idleIncome(stage, 2, ctx);
      expect(loc.perHour.gold, loc.id).toBeGreaterThanOrEqual(Math.floor(inc.gold * 0.95));
      expect(loc.perHour.jobExp, loc.id).toBeGreaterThanOrEqual(Math.floor(inc.jobExp * 0.95));
    }
  });
});
