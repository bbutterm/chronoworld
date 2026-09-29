import { describe, expect, it } from 'vitest';
import {
  buyShopSlot,
  deserialize,
  ensureShop,
  newGame,
  parseShopConfig,
  refreshCost,
  refreshShop,
  rollShop,
  serialize,
  shopMultiplier,
  shopStatus,
  ShopError,
  type SaveState,
  type ShopContext,
} from '../src/core';
import { loadFullContext, readRawGameData } from '../scripts/lib/content-node';
import { PLAYER_MODEL, runBalance } from '../scripts/lib/player-model';

const full = loadFullContext();
if (!full.shop) throw new Error('нет data/shop.json');
const ctx = full as typeof full & ShopContext;
const D1 = '2026-09-26';
const D2 = '2026-09-27';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ShopError);
    return (e as ShopError).code;
  }
  return undefined;
}

/** Сохранение, где пройдена глава 1 и ch2_s1 (Лавка открыта), с валютой. */
function openSave(gold = 1_000_000, gems = 10_000, createdAt = 12345): SaveState {
  const s = newGame(ctx, createdAt, D1);
  const cleared = ctx.content.stages.filter((st) => st.chapter === 'chapter1').map((st) => st.id);
  return {
    ...s,
    campaign: { cleared: [...cleared, 'ch2_s1'] },
    resources: { ...s.resources, gold },
    currency: { ...s.currency, gems },
  };
}

describe('Лавка: конфиг', () => {
  it('data/shop.json собран в контекст; 8 слотов', () => {
    expect(ctx.shop.slots.length).toBe(8);
  });

  it('битый shop.json — ошибка с именем файла', () => {
    const raw = readRawGameData();
    raw.shop = { ...(raw.shop as object), slots: [['nope']] };
    expect(() => parseShopConfig(raw.shop)).toThrow(/data\/shop.json/);
  });

  it('товар-предмет без редкости — ошибка схемы', () => {
    const raw = readRawGameData();
    const cfg = raw.shop as { goods: object[] };
    expect(() => parseShopConfig({ ...cfg, goods: [...cfg.goods, { id: 'x', kind: 'item', price: { currency: 'gold', amount: 1 }, weight: 1 }] })).toThrow(ShopError);
  });
});

describe('Лавка: ассортимент дня', () => {
  it('детерминирован: одно сохранение и день — один ассортимент', () => {
    const s = openSave();
    expect(rollShop(s, D1, 0, ctx)).toEqual(rollShop(s, D1, 0, ctx));
    expect(ensureShop(s, D1, ctx).shop).toEqual(ensureShop(s, D1, ctx).shop);
    expect(rollShop(s, D1, 0, ctx)).toHaveLength(8);
  });

  it('другой день, другое обновление или другое сохранение — другой ассортимент', () => {
    const s = openSave();
    const a = JSON.stringify(rollShop(s, D1, 0, ctx));
    expect(JSON.stringify(rollShop(s, D2, 0, ctx))).not.toBe(a);
    expect(JSON.stringify(rollShop(s, D1, 1, ctx))).not.toBe(a);
    // За 20 разных сохранений хотя бы одно отличается (seed — createdAt).
    const others = Array.from({ length: 20 }, (_, i) => JSON.stringify(rollShop(openSave(1, 1, 1000 + i), D1, 0, ctx)));
    expect(others.some((o) => o !== a)).toBe(true);
  });

  it('ensureShop: тот же день — тот же save; новый день — новый ассортимент и сброс счётчиков; день раньше — без изменений', () => {
    const s = ensureShop(openSave(), D1, ctx);
    expect(ensureShop(s, D1, ctx)).toBe(s);
    const r = refreshShop(s, D1, ctx);
    const b = buyShopSlot(r, D1, 0, ctx).save;
    const d2 = ensureShop(b, D2, ctx);
    expect(d2.shop!.day).toBe(D2);
    expect(d2.shop!.refreshes).toBe(0);
    expect(d2.shop!.boughtToday).toEqual({});
    expect(d2.shop!.slots.every((x) => x.bought === 0)).toBe(true);
    expect(ensureShop(d2, D1, ctx)).toBe(d2);
  });

  it('цены в золоте растут с главой', () => {
    const s = openSave();
    const later = { ...s, campaign: { cleared: ctx.content.stages.map((st) => st.id) } };
    expect(shopMultiplier(later, ctx)).toBeGreaterThan(shopMultiplier(s, ctx));
  });

  it('товары fromStage и карты героя — только когда доступны', () => {
    const fresh = newGame(ctx, 1, D1);
    for (let i = 0; i < 30; i++) {
      for (const slot of rollShop(fresh, D1, i, ctx)) {
        const g = ctx.shop.goods.find((x) => x.id === slot.good)!;
        expect(g.fromStage === undefined || fresh.campaign.cleared.includes(g.fromStage)).toBe(true);
        if (slot.kind === 'heroCard') {
          expect(ctx.content.heroes[slot.hero!]).toBeTruthy();
          expect(slot.rarity).toBe(g.cardRarity);
        }
        if (slot.kind === 'item') expect(ctx.equipment.items[slot.itemId!]).toBeTruthy();
      }
    }
  });

  it('сохранение с лавкой проходит serialize → deserialize', () => {
    const s = buyShopSlot(ensureShop(openSave(), D1, ctx), D1, 0, ctx).save;
    const text = serialize(s);
    expect(deserialize(text).shop).toEqual(s.shop);
  });
});

describe('Лавка: обновление за гемы', () => {
  it('цена растёт с каждым обновлением за день, первое бесплатно, лимит в день', () => {
    const costs: number[] = [];
    let s = ensureShop(openSave(), D1, ctx);
    for (let i = 0; i < ctx.shop.refresh.maxPerDay; i++) {
      const before = s.currency.gems;
      costs.push(refreshCost(s.shop!.refreshes, ctx)!);
      s = refreshShop(s, D1, ctx);
      expect(before - s.currency.gems).toBe(costs[i]);
    }
    expect(costs[0]).toBe(0);
    for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeGreaterThan(costs[i - 1]);
    expect(shopStatus(s, D1, ctx).nextRefreshCost).toBeNull();
    expect(codeOf(() => refreshShop(s, D1, ctx))).toBe('refresh_limit');
    // Новый день — снова первое бесплатно.
    expect(shopStatus(s, D2, ctx).nextRefreshCost).toBe(0);
  });

  it('не хватает гемов — ошибка, save не меняется', () => {
    let s = ensureShop(openSave(1_000_000, 0), D1, ctx);
    s = refreshShop(s, D1, ctx); // бесплатно
    expect(codeOf(() => refreshShop(s, D1, ctx))).toBe('not_enough_gems');
  });

  it('обновление заменяет ассортимент и возвращает запас', () => {
    let s = ensureShop(openSave(), D1, ctx);
    s = buyShopSlot(s, D1, 0, ctx).save;
    const r = refreshShop(s, D1, ctx);
    expect(r.shop!.slots.every((x) => x.bought === 0)).toBe(true);
    expect(r.shop!.slots).toEqual(rollShop(s, D1, 1, ctx));
  });
});

describe('Лавка: покупки', () => {
  it('закрыта до своего этапа', () => {
    const s = newGame(ctx, 1, D1);
    expect(shopStatus(s, D1, ctx).unlocked).toBe(false);
    expect(codeOf(() => buyShopSlot(s, D1, 0, ctx))).toBe('shop_locked');
    expect(codeOf(() => refreshShop(s, D1, ctx))).toBe('shop_locked');
  });

  it('покупка списывает цену, выдаёт товар и уменьшает запас; распродано — ошибка', () => {
    let s = ensureShop(openSave(), D1, ctx);
    for (let i = 0; i < s.shop!.slots.length; i++) {
      const slot = s.shop!.slots[i];
      const g = ctx.shop.goods.find((x) => x.id === slot.good)!;
      for (let k = 0; k < slot.stock; k++) {
        if (g.perDay && (s.shop!.boughtToday[g.id] ?? 0) >= g.perDay) break;
        const before = s;
        const r = buyShopSlot(s, D1, i, ctx);
        s = r.save;
        if (slot.currency === 'gold') expect(before.resources.gold - s.resources.gold + (slot.kind === 'gold' ? slot.count : 0)).toBe(slot.price);
        else expect(before.currency.gems - s.currency.gems).toBe(slot.price);
        if (slot.kind === 'item') expect(s.inventory.items.length).toBe(before.inventory.items.length + 1);
        if (slot.kind === 'heroExp') expect(s.resources.heroExp - before.resources.heroExp).toBe(slot.count);
        if (slot.kind === 'scrolls') expect(s.currency.scrolls - before.currency.scrolls).toBe(slot.count);
        if (slot.kind === 'heroCard') expect(s.heroes.slice(before.heroes.length).map((h) => [h.templateId, h.rarity])).toEqual([[slot.hero, slot.rarity]]);
      }
      if (s.shop!.slots[i].bought === slot.stock) expect(codeOf(() => buyShopSlot(s, D1, i, ctx))).toBe('sold_out');
    }
    expect(shopStatus(s, D1, ctx).slots.filter((x) => !x.dayLimited).every((x) => x.soldOut)).toBe(true);
  });

  it('не хватает золота или гемов — ошибка', () => {
    const s = ensureShop(openSave(0, 0), D1, ctx);
    const gold = s.shop!.slots.findIndex((x) => x.currency === 'gold');
    expect(codeOf(() => buyShopSlot(s, D1, gold, ctx))).toBe('not_enough_gold');
    const withGems = { ...s, shop: { ...s.shop!, slots: s.shop!.slots.map((x) => ({ ...x, currency: 'gems' as const })) } };
    expect(codeOf(() => buyShopSlot(withGems, D1, 0, ctx))).toBe('not_enough_gems');
    expect(shopStatus(s, D1, ctx).slots.every((x) => !x.affordable)).toBe(true);
  });

  it('неизвестный слот — ошибка', () => {
    const s = ensureShop(openSave(), D1, ctx);
    expect(codeOf(() => buyShopSlot(s, D1, 99, ctx))).toBe('unknown_slot');
  });

  it('свиток — не больше perDay в день даже с обновлениями', () => {
    const scroll = ctx.shop.goods.find((g) => g.kind === 'scrolls')!;
    expect(scroll.perDay).toBe(1);
    let s = ensureShop(openSave(), D1, ctx);
    let bought = 0;
    for (let r = 0; r <= ctx.shop.refresh.maxPerDay; r++) {
      s.shop!.slots.forEach((slot, i) => {
        if (slot.kind !== 'scrolls') return;
        if (bought >= 1) {
          expect(codeOf(() => buyShopSlot(s, D1, i, ctx))).toBe('day_limit');
          return;
        }
        s = buyShopSlot(s, D1, i, ctx).save;
        bought++;
      });
      if (r < ctx.shop.refresh.maxPerDay) s = refreshShop(s, D1, ctx);
    }
    expect(bought).toBeLessThanOrEqual(1);
    // Ручная подмена: свиток во всех слотах — вторая покупка упирается в лимит дня.
    const all = { ...s, shop: { ...s.shop!, boughtToday: {}, slots: s.shop!.slots.map((x) => ({ ...x, good: scroll.id, kind: 'scrolls' as const, bought: 0, currency: 'gems' as const, price: 27, count: 1 })) } };
    const one = buyShopSlot(all, D1, 0, ctx).save;
    expect(codeOf(() => buyShopSlot(one, D1, 1, ctx))).toBe('day_limit');
  });
});

describe('Лавка в модели игрока (npm run balance)', () => {
  it('за 4 дня: тратит золото в Лавке, свитков из Лавки не больше одного в день', () => {
    const days = 4;
    const res = runBalance(full, days, PLAYER_MODEL);
    expect(res.spend.shop.gold).toBeGreaterThan(0);
    expect(res.shopBuys.scroll ?? 0).toBeLessThanOrEqual(days);
    expect(res.scrollsIn.shop ?? 0).toBe(res.shopBuys.scroll ?? 0);
    const off = runBalance(full, days, { ...PLAYER_MODEL, shop: false });
    expect(off.spend.shop.gold).toBe(0);
    expect(off.save.shop).toBeUndefined();
    // Прогон модели игрока на 4 дня — тяжёлый (≈5 с, модель с «Вознести всех» и лекарем); лимит времени вызова, не порог качества.
  }, 30_000);
});
