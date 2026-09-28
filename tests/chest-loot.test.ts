import { describe, expect, it } from 'vitest';
import {
  actUseFastRewards,
  CHEST_LIMITS,
  chestDailyExpectation,
  chestRule,
  claimOffline,
  fastRewardsLoot,
  newGame,
  offlineFullInMs,
  offlineLoot,
  offlineRewards,
  rollChestLoot,
  useFastRewards,
  validateEquipment,
  type SaveState,
} from '../src/core';
import { loadFullContext, loadGameContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const MIN = 60_000;
const H = 60 * MIN;
const T0 = 1_000_000_000;
const D1 = '2026-09-26';
const chest = ctx.equipment.drops.chest!;
const cap = ctx.progression.offline.capHours;
const stageOf = (chapter: string) => ctx.content.stages.find((s) => s.chapter === chapter)!;

/** Сохранение с пройденными этапами до stageId включительно, якорь сундука — T0. */
function saveAt(stageId: string, createdAt = T0): SaveState {
  const idx = ctx.content.stages.findIndex((s) => s.id === stageId);
  const base = newGame(ctx, createdAt);
  return { ...base, offline: { lastClaimAt: T0 }, campaign: { cleared: ctx.content.stages.slice(0, idx + 1).map((s) => s.id) } };
}
const ch2 = stageOf('chapter2').id;

describe('трофеи сундука простоя', () => {
  it('конфиг есть: тик и правило для каждой главы', () => {
    expect(chest.tickMinutes).toBeGreaterThan(0);
    for (const s of ctx.content.stages) expect(chestRule(s.chapter, ctx)).toBeDefined();
  });

  it('детерминизм: те же сохранение и время — те же трофеи; превью = сбор', () => {
    const save = saveAt(ch2);
    const a = offlineLoot(save, T0 + 10 * H, ctx);
    expect(offlineLoot(save, T0 + 10 * H, ctx)).toEqual(a);
    const c1 = claimOffline(save, T0 + 10 * H, ctx);
    const c2 = claimOffline(save, T0 + 10 * H, ctx);
    expect(c1).toEqual(c2);
    expect({ ticks: c1.loot.ticks, items: c1.loot.items, gems: c1.loot.gems, scrolls: c1.loot.scrolls }).toEqual({ ticks: a.ticks, items: a.items, gems: a.gems, scrolls: a.scrolls });
    // Другое сохранение (createdAt) — другой поток случайности.
    const others = [1, 2, 3, 4, 5].map((k) => JSON.stringify(offlineLoot(saveAt(ch2, T0 - k * 7919), T0 + 12 * H, ctx)));
    expect(new Set(others).size).toBeGreaterThan(1);
  });

  it('тики — только полные; уже накопленное не меняется, пока копится дальше', () => {
    const save = saveAt(ch2);
    expect(offlineLoot(save, T0 + (chest.tickMinutes - 1) * MIN, ctx).ticks).toBe(0);
    expect(offlineLoot(save, T0 + chest.tickMinutes * MIN, ctx).ticks).toBe(1);
    let prev = offlineLoot(save, T0, ctx);
    for (let t = 1; t <= cap * 2; t++) {
      const cur = offlineLoot(save, T0 + t * H, ctx);
      expect(cur.items.slice(0, prev.items.length)).toEqual(prev.items);
      expect(cur.gems).toBeGreaterThanOrEqual(prev.gems);
      expect(cur.cards.slice(0, prev.cards.length)).toEqual(prev.cards);
      expect(cur.scrolls).toBeGreaterThanOrEqual(prev.scrolls);
      prev = cur;
    }
  });

  it('лимит сундука: после capHours трофеи не растут', () => {
    const save = saveAt(ch2);
    const full = offlineLoot(save, T0 + cap * H, ctx);
    expect(full.ticks).toBe(Math.floor((cap * 60) / chest.tickMinutes));
    expect(offlineLoot(save, T0 + 100 * cap * H, ctx)).toEqual(full);
    expect(claimOffline(save, T0 + 100 * cap * H, ctx).loot.ticks).toBe(full.ticks);
  });

  it('таймер «полон через»: capHours от сбора, 0 — полон, null — сундук не копится', () => {
    const save = saveAt(ch2);
    expect(offlineFullInMs(save, T0, ctx)).toBe(cap * H);
    expect(offlineFullInMs(save, T0 + 2 * H, ctx)).toBe((cap - 2) * H);
    expect(offlineFullInMs(save, T0 + 2 * cap * H, ctx)).toBe(0);
    expect(offlineRewards(save, T0 + cap * H - (offlineFullInMs(save, T0 + cap * H, ctx) ?? 0), ctx).minutes).toBe(cap * 60);
    expect(offlineFullInMs({ ...newGame(ctx, T0), campaign: { cleared: [] } }, T0 + H, ctx)).toBeNull();
  });

  it('сбор: предметы в инвентарь, гемы и свитки в валюту, карты героя — новыми экземплярами; повторный сбор — пусто', () => {
    // Ищем seed, где выпало всё, кроме, может быть, свитков (редкие).
    let found = false;
    for (let k = 0; k < 200 && !found; k++) {
      const save = saveAt(ch2, T0 - k * 1013);
      const loot = offlineLoot(save, T0 + cap * H, ctx);
      if (!loot.items.length || !loot.gems) continue;
      found = true;
      const out = claimOffline(save, T0 + cap * H, ctx);
      expect(out.loot.added.map((i) => i.itemId)).toEqual(loot.items);
      expect(out.save.inventory.items.length).toBe(save.inventory.items.length + loot.items.length);
      expect(out.save.currency.gems).toBe(save.currency.gems + loot.gems);
      expect(out.save.currency.scrolls).toBe(save.currency.scrolls + loot.scrolls);
      expect(out.save.heroes.length).toBe(save.heroes.length + loot.cards.length);
      expect(out.events.filter((e) => e.type === 'heroCard')).toHaveLength(loot.cards.length);
      for (const id of loot.items) expect(ctx.equipment.items[id]?.drop).toBe(true);
      const again = claimOffline(out.save, T0 + cap * H, ctx);
      expect(again.loot.ticks).toBe(0);
      expect(again.save.inventory.items.length).toBe(out.save.inventory.items.length);
    }
    expect(found).toBe(true);
  });

  it('карты героя из сундука: случайный герой нужной редкости, новый экземпляр с «Новый!», событие heroCard', () => {
    const rich = {
      ...ctx,
      equipment: { ...ctx.equipment, drops: { ...ctx.equipment.drops, chest: { ...chest, rules: chest.rules.map((r) => ({ ...r, heroCards: { blue: 0.3, purple: 0.1 } })) } } },
    };
    const save = saveAt(ch2);
    const loot = offlineLoot(save, T0 + cap * H, rich);
    expect(loot.cards.length).toBeGreaterThan(0);
    expect(loot.cards.some((c) => c.rarity === 'purple')).toBe(true);
    for (const c of loot.cards) expect(rich.content.heroes[c.templateId]).toBeDefined();
    // Герои — не один и тот же (случайные среди 12).
    expect(new Set(loot.cards.map((c) => c.templateId)).size).toBeGreaterThan(1);
    const out = claimOffline(save, T0 + cap * H, rich);
    const added = out.save.heroes.slice(save.heroes.length);
    expect(added.map((h) => ({ templateId: h.templateId, rarity: h.rarity }))).toEqual(loot.cards);
    for (const h of added) {
      expect(h.isNew).toBe(true);
      expect(h.branch).toBeUndefined();
    }
    expect(out.events.filter((e) => e.type === 'heroCard').map((e) => (e.type === 'heroCard' ? e.heroId : ''))).toEqual(added.map((h) => h.id));
  });

  it('без пройденных этапов и без экипировки в контексте — трофеев нет (золото и опыт как раньше)', () => {
    expect(offlineLoot({ ...newGame(ctx, T0), campaign: { cleared: [] } }, T0 + cap * H, ctx).ticks).toBe(0);
    const bare = loadGameContext();
    const save = saveAt(ch2);
    const a = claimOffline(save, T0 + cap * H, bare);
    const b = claimOffline(save, T0 + cap * H, ctx);
    expect(a.loot.ticks).toBe(0);
    expect(a.rewards).toEqual(b.rewards);
    expect(a.save.inventory).toEqual(save.inventory);
  });

  it('ставки в пределах: гемов ≤ 60 и свитков ≤ 1 за сутки простоя; предметы — «трофей» в каждом полном сундуке', () => {
    for (const rule of chest.rules) {
      const e = chestDailyExpectation(rule, chest.tickMinutes);
      expect(e.gems).toBeLessThanOrEqual(CHEST_LIMITS.gemsPerDay);
      expect(e.scrolls).toBeLessThanOrEqual(CHEST_LIMITS.scrollsPerDay);
      expect(e.items * (cap / 24)).toBeGreaterThanOrEqual(1); // хотя бы ~1 предмет в полном сундуке
    }
    // Эмпирически: 400 полных сундуков главы 2 — средние близки к ожиданию.
    const rule = chestRule('chapter2', ctx)!;
    const ticks = Math.floor((cap * 60) / chest.tickMinutes);
    const sum = { items: 0, gems: 0, scrolls: 0, cards: 0 };
    const N = 400;
    for (let k = 0; k < N; k++) {
      const l = rollChestLoot('chapter2', ticks, k * 2654435761, ctx);
      sum.items += l.items.length;
      sum.gems += l.gems;
      sum.scrolls += l.scrolls;
      sum.cards += l.cards.length;
    }
    const exp = chestDailyExpectation(rule, chest.tickMinutes);
    const k = cap / 24;
    expect(sum.items / N).toBeGreaterThan(exp.items * k * 0.8);
    expect(sum.items / N).toBeLessThan(exp.items * k * 1.2);
    expect(sum.gems / N).toBeLessThan(exp.gems * k * 1.3 + 1);
    expect(sum.gems / N).toBeLessThanOrEqual(CHEST_LIMITS.gemsPerDay / 2);
  });

  it('валидатор ловит слишком щедрый сундук', () => {
    const greedy = { ...ctx.equipment, drops: { ...ctx.equipment.drops, chest: { tickMinutes: 30, rules: [{ item: 0.1, gems: { chance: 0.5, count: 10 } }] } } };
    expect(validateEquipment(greedy, ctx).join('; ')).toMatch(/гемов/);
    const unknown = { ...ctx.equipment, drops: { ...ctx.equipment.drops, chest: { tickMinutes: 30, rules: [{ chapter: 'nope', item: 0.1 }] } } };
    expect(validateEquipment(unknown, ctx).join('; ')).toMatch(/неизвестная глава/);
  });
});

describe('трофеи быстрых наград', () => {
  it('те же трофеи за fastRewards.hours: тиков пропорционально, превью = получение', () => {
    const save = saveAt(ch2);
    const loot = fastRewardsLoot(save, D1, ctx);
    expect(loot.ticks).toBe(Math.floor((ctx.features.fastRewards.hours * 60) / chest.tickMinutes));
    const out = useFastRewards(save, D1, ctx);
    expect(out.loot.items).toEqual(loot.items);
    expect(out.loot.gems).toBe(loot.gems);
    expect(out.save.inventory.items.length).toBe(save.inventory.items.length + loot.items.length);
    expect(out.save.currency.gems).toBe(save.currency.gems + loot.gems);
    expect(useFastRewards(save, D1, ctx)).toEqual(out);
    // Сундук не тронут.
    expect(out.save.offline).toEqual(save.offline);
    expect(actUseFastRewards(save, D1, ctx).loot).toEqual(out.loot);
  });

  it('следующее использование и другой день — другой seed', () => {
    const variants = new Set<string>();
    for (let k = 0; k < 20; k++) {
      const s = saveAt(ch2, T0 - k * 31);
      variants.add(JSON.stringify(fastRewardsLoot(s, D1, ctx)));
      variants.add(JSON.stringify(fastRewardsLoot(s, '2026-09-27', ctx)));
    }
    expect(variants.size).toBeGreaterThan(5);
  });

  it('за сутки быстрых наград по максимуму (1 + 3 за гемы) гемов из трофеев меньше, чем потрачено', () => {
    let s: SaveState = { ...saveAt(ch2), currency: { gems: 1000, scrolls: 0 } };
    let got = 0;
    let spent = 0;
    for (let i = 0; i < 1 + ctx.features.fastRewards.gemCosts.length; i++) {
      const before = s.currency.gems;
      const out = useFastRewards(s, D1, ctx);
      got += out.loot.gems;
      spent += before + out.loot.gems - out.save.currency.gems;
      s = out.save;
    }
    expect(got).toBeLessThan(spent);
  });
});
