import { describe, expect, it } from 'vitest';
import {
  chapterNumber,
  fastRewardsLoot,
  itemPools,
  lintItemGates,
  newGame,
  offlineLoot,
  parseDrops,
  parseShopConfig,
  progressChapter,
  rollChestLoot,
  rollDrops,
  rollShop,
  sweepHunt,
  huntBoss,
  type FullContext,
  type ItemDef,
  type SaveState,
  type ShopContext,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

/**
 * Ворота предметов по главам (data/items → minChapter): «Слейпнир в самом начале — это перебор».
 * Каждый источник предметов выбирает только предметы с minChapter ≤ своей главы.
 */
const ctx = loadFullContext() as FullContext & ShopContext;
const D1 = '2026-09-26';
const T0 = 1_000_000_000;
const items = ctx.equipment.items;
const EPIC_ONLY = { chance: 1, rarityWeights: { epic: 1 }, firstClearRarityWeights: { epic: 1 } };
const stagesOf = (chapter: string) => ctx.content.stages.filter((s) => s.chapter === chapter).map((s) => s.id);
const LEGENDARY = Object.values(items).filter((d) => (d.minChapter ?? 1) >= 3).map((d) => d.id);

/** Пройдены все этапы до stageId включительно. */
function saveAt(stageId: string, createdAt = T0): SaveState {
  const idx = ctx.content.stages.findIndex((s) => s.id === stageId);
  const s = newGame(ctx, createdAt, D1);
  return { ...s, offline: { lastClaimAt: T0 }, campaign: { cleared: ctx.content.stages.slice(0, idx + 1).map((x) => x.id) } };
}
const lastOf = (chapter: string) => stagesOf(chapter).at(-1)!;
const withItems = (patch: (d: ItemDef) => ItemDef) => ({
  ...ctx,
  equipment: { ...ctx.equipment, items: Object.fromEntries(Object.entries(items).map(([k, d]) => [k, patch(d)])) },
});

describe('ворота предметов: данные', () => {
  it('Слейпнир — с главы 3, остальные эпики — с главы 2, в главе 1 — только обычные и редкие', () => {
    expect(items.sleipnir.minChapter).toBe(3);
    expect(LEGENDARY).toContain('sleipnir');
    for (const d of Object.values(items)) if (d.rarity === 'epic') expect(d.minChapter).toBeGreaterThanOrEqual(2);
    const ch1 = itemPools(items, 1);
    expect(ch1.epic).toEqual([]);
    expect(ch1.common.length).toBeGreaterThan(0);
    expect(ch1.rare.length).toBeGreaterThan(0);
    expect(itemPools(items, 2).epic).not.toContain('sleipnir');
    expect(itemPools(items, 3).epic).toContain('sleipnir');
    expect(itemPools(items).epic).toContain('sleipnir');
  });

  it('номер главы и глава игрока', () => {
    expect(chapterNumber('chapter1', ctx)).toBe(1);
    expect(chapterNumber('chapter3', ctx)).toBe(3);
    expect(progressChapter(newGame(ctx, 0, D1), ctx)).toBe(1);
    expect(progressChapter(saveAt(lastOf('chapter1')), ctx)).toBe(1);
    expect(progressChapter(saveAt('ch2_s1'), ctx)).toBe(2);
    expect(progressChapter(saveAt('ch3_s1'), ctx)).toBe(3);
  });

  it('content:check: в данных ошибок ворот нет', () => {
    expect(lintItemGates(ctx).errors).toEqual([]);
  });
});

describe('ворота предметов: выпадение с этапов', () => {
  it('реальные правила: этапы главы 1 не дают эпиков ни при первом прохождении, ни потом', () => {
    for (const st of stagesOf('chapter1')) {
      for (let seed = 1; seed <= 200; seed++) {
        for (const first of [true, false]) for (const id of rollDrops(st, seed, first, ctx)) expect(items[id].rarity).not.toBe('epic');
      }
    }
  });

  it('только эпики в весах: глава 1 — ничего, глава 2 — эпик без легендарных, глава 3 — бывает Слейпнир', () => {
    const epic = { ...ctx, equipment: { ...ctx.equipment, drops: parseDrops({ rules: [EPIC_ONLY] }) } };
    expect(rollDrops('ch1_s5', 3, true, epic)).toEqual([]);
    const ch2 = new Set<string>();
    const ch3 = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      rollDrops('ch2_s5', seed, true, epic).forEach((id) => ch2.add(id));
      rollDrops('ch3_s5', seed, true, epic).forEach((id) => ch3.add(id));
    }
    expect(ch2.size).toBeGreaterThan(0);
    for (const id of ch2) expect(items[id].rarity).toBe('epic');
    for (const id of LEGENDARY) expect(ch2.has(id)).toBe(false);
    expect(ch3.has('sleipnir')).toBe(true);
  });
});

describe('трофеи глав 4–7 (LT-06): свои вещи главы, босс — эпик', () => {
  const late = ['chapter4', 'chapter5', 'chapter6', 'chapter7'];
  // Глава 7 берёт вещи глав 6–7 (редких вещей главы 7 нет — редкие из главы 6).
  const from = (chapter: string) => Math.min(chapterNumber(chapter, ctx), 6);

  it('у каждой главы 4–7 — 4 новые вещи (оружие, доспех, шлем, обувь) с minChapter этой главы', () => {
    for (const chapter of late) {
      const n = chapterNumber(chapter, ctx);
      const own = Object.values(items).filter((d) => d.minChapter === n);
      expect(own.map((d) => d.slot).sort(), chapter).toEqual(['armor', 'boots', 'helmet', 'weapon']);
    }
  });

  it('этапы глав 4–7: только вещи своей главы (не главы 1), первая победа над боссом — эпик', () => {
    for (const chapter of late) {
      const stages = stagesOf(chapter);
      for (const st of stages) {
        for (let seed = 1; seed <= 60; seed++) {
          for (const first of [true, false]) {
            for (const id of rollDrops(st, seed, first, ctx)) {
              expect(items[id].minChapter ?? 1, `${st}: ${id}`).toBeGreaterThanOrEqual(from(chapter));
              expect(items[id].minChapter ?? 1, `${st}: ${id}`).toBeLessThanOrEqual(chapterNumber(chapter, ctx));
            }
          }
        }
      }
      for (let seed = 1; seed <= 30; seed++) {
        const boss = rollDrops(stages.at(-1)!, seed, true, ctx);
        expect(boss).toHaveLength(1);
        expect(items[boss[0]].rarity, chapter).toBe('epic');
      }
    }
  });

  it('сундук глав 4–7: вещи своей главы', () => {
    for (const chapter of late) {
      const loot = rollChestLoot(chapter, 2000, 7, ctx).items;
      expect(loot.length, chapter).toBeGreaterThan(0);
      for (const id of loot) expect(items[id].minChapter ?? 1, `${chapter}: ${id}`).toBeGreaterThanOrEqual(from(chapter));
    }
  });
});

describe('ворота предметов: сундук и быстрые награды', () => {
  const epicChest = { ...ctx, equipment: { ...ctx.equipment, drops: parseDrops({ rules: [EPIC_ONLY], chest: { tickMinutes: 30, rules: [{ item: 1 }] } }) } };

  it('глава 1 — ни эпиков, ни легендарных; глава 2 — без легендарных; глава 3 — Слейпнир бывает', () => {
    expect(rollChestLoot('chapter1', 500, 42, epicChest).items).toEqual([]);
    const ch2 = rollChestLoot('chapter2', 500, 42, epicChest).items;
    expect(ch2.length).toBe(500);
    for (const id of LEGENDARY) expect(ch2).not.toContain(id);
    expect(rollChestLoot('chapter3', 500, 42, epicChest).items).toContain('sleipnir');
  });

  it('реальные правила: сундук и быстрые награды в главе 1 не дают эпиков', () => {
    const s = saveAt(lastOf('chapter1'));
    for (let k = 0; k < 20; k++) {
      const loot = offlineLoot({ ...s, createdAt: T0 + k }, T0 + 12 * 3_600_000, ctx);
      for (const id of loot.items) expect(items[id].rarity).not.toBe('epic');
      for (const id of fastRewardsLoot({ ...s, createdAt: T0 + k }, D1, ctx).items) expect(items[id].rarity).not.toBe('epic');
    }
  });
});

describe('ворота предметов: Лавка', () => {
  const epicShop: typeof ctx = {
    ...ctx,
    shop: parseShopConfig({
      ...ctx.shop,
      slots: Array.from({ length: 8 }, () => ['item_epic', 'item_common']),
      goods: ctx.shop.goods.map((g) => (g.id === 'item_epic' ? { ...g, fromStage: undefined, weight: 100 } : g)),
    }),
  };
  const offered = (s: SaveState) => {
    const out: string[] = [];
    for (let r = 0; r < 30; r++) for (const slot of rollShop(s, D1, r, epicShop)) if (slot.itemId) out.push(slot.itemId);
    return out;
  };

  it('глава 1 — эпика нет даже без fromStage; глава 2 — эпики без легендарных; глава 3 — Слейпнир бывает', () => {
    const ch1 = offered(saveAt(lastOf('chapter1')));
    expect(ch1.length).toBeGreaterThan(0);
    for (const id of ch1) expect(items[id].rarity).toBe('common');
    const ch2 = offered(saveAt('ch2_s1'));
    expect(ch2.some((id) => items[id].rarity === 'epic')).toBe(true);
    for (const id of LEGENDARY) expect(ch2).not.toContain(id);
    expect(offered(saveAt('ch3_s1'))).toContain('sleipnir');
  });

  it('реальный товар item_epic открыт с главы 2', () => {
    const g = ctx.shop.goods.find((x) => x.id === 'item_epic')!;
    expect(g.fromStage).toBeDefined();
    expect(chapterNumber(ctx.content.stages.find((s) => s.id === g.fromStage)!.chapter, ctx)).toBeGreaterThanOrEqual(2);
  });
});

describe('ворота предметов: охота на босса', () => {
  // Порог с эпиком за любой урон; зачистка по рекордному урону.
  const epicHunt: FullContext = { ...ctx, hunt: { ...ctx.hunt, attemptsPerDay: 99, tiers: [{ damage: 1, rewards: { item: 'epic' } }] } };
  const sweepAll = (stageId: string, c: FullContext) => {
    const got: string[] = [];
    for (let k = 0; k < 60; k++) {
      const s = saveAt(stageId, T0 + k);
      const unit = huntBoss(D1, c).unit;
      const out = sweepHunt({ ...s, hunt: { day: D1, used: 0, best: { [unit]: 1e9 } } }, D1, c);
      got.push(...out.grant.items.map((i) => i.itemId));
    }
    return got;
  };

  it('глава 2 — эпик без легендарных; глава 3 — Слейпнир бывает', () => {
    const ch2 = sweepAll('ch2_s1', epicHunt);
    expect(ch2).toHaveLength(60);
    for (const id of ch2) expect(items[id].rarity).toBe('epic');
    for (const id of LEGENDARY) expect(ch2).not.toContain(id);
    expect(sweepAll('ch3_s1', epicHunt)).toContain('sleipnir');
  });

  it('нет открытых предметов редкости порога — предмет редкостью ниже, а не пусто', () => {
    const late = { ...epicHunt, equipment: withItems((d) => (d.rarity === 'epic' ? { ...d, minChapter: 3 } : d)).equipment };
    const ch2 = sweepAll('ch2_s1', late);
    expect(ch2).toHaveLength(60);
    for (const id of ch2) expect(items[id].rarity).toBe('rare');
  });
});

describe('ворота предметов: content:check', () => {
  it('правило главы 1 только с эпиками — ошибка; вес эпика в главе 1 — предупреждение', () => {
    const drops = parseDrops({ rules: [{ chapter: 'chapter1', ...EPIC_ONLY }, { chance: 0.3, rarityWeights: { common: 1, epic: 1 } }] });
    const r = lintItemGates({ ...ctx, equipment: { ...ctx.equipment, drops } });
    expect(r.errors.some((e) => e.includes('drops.rules (chapter1)'))).toBe(true);
    const soft = parseDrops({ rules: [{ chapter: 'chapter1', chance: 0.3, rarityWeights: { common: 1, epic: 1 } }, { chance: 0.3, rarityWeights: { common: 1 } }] });
    const w = lintItemGates({ ...ctx, equipment: { ...ctx.equipment, drops: soft } });
    expect(w.errors).toEqual([]);
    expect(w.warnings.some((x) => x.includes('вес epic'))).toBe(true);
  });

  it('сундук с шансом предмета и только закрытыми редкостями — ошибка', () => {
    const drops = parseDrops({ rules: ctx.equipment.drops.rules, chest: { tickMinutes: 30, rules: [{ item: 0.1, rarityWeights: { epic: 1 } }] } });
    const r = lintItemGates({ ...ctx, equipment: { ...ctx.equipment, drops } });
    expect(r.errors.some((e) => e.includes('drops.chest.rules (chapter1)'))).toBe(true);
  });

  it('товар Лавки с эпиком раньше главы 2 — ошибка с подсказкой', () => {
    const shop = { ...ctx.shop, goods: ctx.shop.goods.map((g) => (g.id === 'item_epic' ? { ...g, fromStage: 'ch1_s10' } : g)) };
    const r = lintItemGates({ ...ctx, shop });
    expect(r.errors.some((e) => e.includes('item_epic') && e.includes('главы 2'))).toBe(true);
  });

  it('порог охоты с редкостью, закрытой во всех главах, — ошибка; предмет позже последней главы и пустой слот — предупреждения', () => {
    const late = withItems((d) => (d.rarity === 'epic' ? { ...d, minChapter: 9 } : d));
    const r = lintItemGates({ ...late, hunt: { ...ctx.hunt, tiers: [{ damage: 1, rewards: { item: 'epic' } }] } });
    expect(r.errors.some((e) => e.includes('data/hunt.json'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('sleipnir') && w.includes('не выпадает'))).toBe(true);
    const noBoots = withItems((d) => (d.slot === 'boots' ? { ...d, minChapter: 2 } : d));
    expect(lintItemGates(noBoots).warnings.some((w) => w.includes('глава 1') && w.includes('boots'))).toBe(true);
  });
});
