import { describe, expect, it } from 'vitest';
import {
  actRefineAll,
  addItems,
  buildUnit,
  deserialize,
  equip,
  EquipmentError,
  gearUpgrades,
  heroGearStats,
  heroPower,
  newGame,
  refineAllPlan,
  refineCost,
  refinedName,
  refinedStats,
  refineItem,
  refineLevel,
  refineUnlocked,
  serialize,
  squadPower,
  withGear,
  type SaveState,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const cfg = ctx.equipment.drops.refine!;

/** Новая игра: заточка открыта (этап из data/unlocks.json пройден), золота с запасом, на первом герое меч и доспех. */
function setup(gold = 10_000_000): { save: SaveState; heroId: string; weapon: string; armor: string } {
  let save = newGame(ctx, 0, '2026-01-01');
  const stage = ctx.unlocks!.features.find((f) => f.id === 'refine')!.stage;
  save = { ...save, campaign: { ...save.campaign, cleared: [...save.campaign.cleared, stage] }, resources: { ...save.resources, gold } };
  const heroId = save.heroes[0].id;
  const r = addItems(save, ['claymore', 'full_plate']);
  save = r.save;
  for (const it of r.added) save = equip(save, heroId, it.id, ctx);
  return { save, heroId, weapon: r.added[0].id, armor: r.added[1].id };
}

const inst = (save: SaveState, id: string) => save.inventory.items.find((i) => i.id === id)!;

describe('Заточка: конфиг', () => {
  it('data/drops.json → refine: +15, прирост и цены из данных', () => {
    expect(cfg.maxLevel).toBe(15);
    expect(cfg.bonusPerLevel).toBeGreaterThan(0);
    // Открывается по таблице открытий, не с самого начала.
    expect(ctx.unlocks!.features.some((f) => f.id === 'refine')).toBe(true);
  });

  it('цена растёт с уровнем и редкостью; ранние шаги — тысячи, поздние шаги эпика — миллионы', () => {
    const epic = ctx.equipment.items.claymore;
    const common = Object.values(ctx.equipment.items).find((d) => d.rarity === 'common')!;
    let prev = 0;
    for (let n = 0; n < cfg.maxLevel; n++) {
      const c = refineCost({ refine: n }, epic, ctx)!.gold;
      expect(c).toBeGreaterThan(prev);
      prev = c;
    }
    expect(refineCost({}, common, ctx)!.gold).toBeLessThan(refineCost({}, epic, ctx)!.gold);
    expect(refineCost({ refine: 4 }, common, ctx)!.gold).toBeLessThan(50_000);
    expect(refineCost({ refine: 12 }, epic, ctx)!.gold).toBeGreaterThanOrEqual(1_000_000);
    expect(refineCost({ refine: cfg.maxLevel }, epic, ctx)).toBeNull();
  });

  it('статы и имя с заточкой', () => {
    const def = ctx.equipment.items.claymore;
    expect(refinedStats(def, 0, ctx)).toEqual(def.stats);
    expect(refinedStats(def, 5, ctx).atk).toBe(Math.round(def.stats.atk! * (1 + cfg.bonusPerLevel * 5)));
    expect(refinedName(def, 7)).toBe(`+7 ${def.name}`);
    expect(refinedName(def, 0)).toBe(def.name);
  });
});

describe('Заточка: refineItem', () => {
  it('шаг +0 → +1: золото списано, событие refined', () => {
    const { save, weapon } = setup();
    const cost = refineCost(inst(save, weapon), ctx.equipment.items.claymore, ctx)!;
    const r = refineItem(save, weapon, ctx);
    expect(refineLevel(inst(r.save, weapon))).toBe(1);
    expect(r.save.resources.gold).toBe(save.resources.gold - cost.gold);
    expect(r.events).toEqual([{ type: 'refined', instanceId: weapon, itemId: 'claymore', from: 0, to: 1, gold: cost.gold }]);
    // Исходное сохранение не тронуто (чистая функция).
    expect(refineLevel(inst(save, weapon))).toBe(0);
  });

  it('максимум: refine_max', () => {
    const { save, weapon } = setup();
    const maxed = { ...save, inventory: { items: save.inventory.items.map((i) => (i.id === weapon ? { ...i, refine: cfg.maxLevel } : i)) } };
    expect(() => refineItem(maxed, weapon, ctx)).toThrow(expect.objectContaining({ code: 'refine_max' }));
  });

  it('нет золота: not_enough_gold, сохранение не меняется', () => {
    const { save, weapon } = setup(10);
    expect(() => refineItem(save, weapon, ctx)).toThrow(EquipmentError);
    expect(() => refineItem(save, weapon, ctx)).toThrow(expect.objectContaining({ code: 'not_enough_gold' }));
  });

  it('нет предмета: unknown_item; закрыто: refine_locked', () => {
    const { save, weapon } = setup();
    expect(() => refineItem(save, 'it999', ctx)).toThrow(expect.objectContaining({ code: 'unknown_item' }));
    const fresh = { ...save, campaign: { ...save.campaign, cleared: [] } };
    expect(refineUnlocked(fresh, ctx)).toBe(false);
    expect(() => refineItem(fresh, weapon, ctx)).toThrow(expect.objectContaining({ code: 'refine_locked' }));
  });

  it('детерминированно: одинаковый вход — одинаковый результат', () => {
    const { save, weapon } = setup();
    expect(serialize(refineItem(save, weapon, ctx).save)).toBe(serialize(refineItem(save, weapon, ctx).save));
  });
});

describe('Заточка: бой и мощь', () => {
  it('статы экипировки, юнит боя и мощь растут с заточкой', () => {
    const { save, heroId, weapon, armor } = setup();
    const hero = save.heroes.find((h) => h.id === heroId)!;
    let s = save;
    for (let n = 0; n < 5; n++) s = refineItem(refineItem(s, weapon, ctx).save, armor, ctx).save;
    const g0 = heroGearStats(save, heroId, ctx);
    const g5 = heroGearStats(s, heroId, ctx);
    expect(g5.atk).toBe(Math.round(34 * (1 + cfg.bonusPerLevel * 5)));
    expect(g5.hp).toBeGreaterThan(g0.hp);
    // Бой: buildUnit с withGear (так собирают отряд playStage / башня / охота).
    expect(buildUnit(hero, withGear(ctx, s)).stats.atk).toBe(buildUnit(hero, withGear(ctx, save)).stats.atk + (g5.atk - g0.atk));
    expect(heroPower(hero, ctx, s)).toBeGreaterThan(heroPower(hero, ctx, save));
    expect(squadPower(s, ctx)).toBeGreaterThan(squadPower(save, ctx));
  });

  it('«Надеть лучшее» учитывает заточку: заточенный надетый не меняется на такой же голый', () => {
    const { save, heroId, weapon } = setup();
    let s = refineItem(save, weapon, ctx).save;
    s = addItems(s, ['claymore']).save;
    expect(gearUpgrades(s, heroId, ctx).some((u) => u.slot === 'weapon')).toBe(false);
  });
});

describe('Заточка: «Заточить всё надетое»', () => {
  it('по шагу каждому надетому предмету, сумма = списанное золото', () => {
    const { save, heroId, weapon, armor } = setup();
    const plan = refineAllPlan(save, heroId, ctx);
    expect(plan.steps.map((s) => s.instanceId).sort()).toEqual([weapon, armor].sort());
    const r = actRefineAll(save, heroId, ctx);
    expect(r.events).toHaveLength(2);
    expect(save.resources.gold - r.save.resources.gold).toBe(plan.gold);
  });

  it('золота на один шаг — точится только то, на что хватает', () => {
    const { save, heroId } = setup(4_000);
    const plan = refineAllPlan(save, heroId, ctx);
    expect(plan.steps).toHaveLength(1);
    expect(plan.gold).toBeLessThanOrEqual(4_000);
  });
});

describe('Заточка: сохранение', () => {
  it('старое сохранение без поля refine читается как +0; поле переживает сохранение/загрузку', () => {
    const { save, weapon } = setup();
    const raw = JSON.parse(serialize(save));
    for (const it of raw.inventory.items) delete it.refine;
    const old = deserialize(JSON.stringify(raw));
    expect(refineLevel(inst(old, weapon))).toBe(0);
    const refined = refineItem(old, weapon, ctx).save;
    expect(refineLevel(inst(deserialize(serialize(refined)), weapon))).toBe(1);
  });
});
