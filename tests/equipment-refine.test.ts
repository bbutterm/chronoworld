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
  heroSlots,
  newGame,
  Rng,
  refineAllPlan,
  refineBreakChance,
  refineBonus,
  refineCost,
  refineModeCost,
  rollBlessedOre,
  blessedOre,
  actPlayStage,
  climbTower,
  fightHunt,
  sweepHunt,
  huntSeed,
  refineSeed,
  refinedName,
  refinedStats,
  refineItem,
  refineLevel,
  refineUnlocked,
  RefineConfigSchema,
  sanitizeSave,
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
/** Выставить заточку экземпляру напрямую (без бросков). */
const withRefine = (save: SaveState, id: string, refine: number): SaveState => ({
  ...save,
  inventory: { ...save.inventory, items: save.inventory.items.map((i) => (i.id === id ? { ...i, refine } : i)) },
});
/** seed, при котором бросок Rng(seed).next() ниже / не ниже порога (перебором — детерминированно). */
function seedWhere(pred: (seed: number) => boolean): number {
  for (let s = 1; s < 10_000; s++) if (pred(s)) return s;
  throw new Error('seed не найден');
}

describe('Заточка: конфиг', () => {
  it('data/drops.json → refine: +10, прирост и цены из данных', () => {
    // Было +15 без поломки; владелец: «шанс сломать вещь, максимум +10».
    expect(cfg.maxLevel).toBe(10);
    expect(cfg.bonusByLevel).toHaveLength(cfg.maxLevel + 1);
    // Открывается по таблице открытий, не с самого начала.
    expect(ctx.unlocks!.features.some((f) => f.id === 'refine')).toBe(true);
  });

  it('цена растёт с уровнем и редкостью; ранние шаги — тысячи, поздние шаги эпика — сотни тысяч', () => {
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
    expect(refineCost({ refine: cfg.maxLevel - 1 }, epic, ctx)!.gold).toBeGreaterThanOrEqual(200_000);
    expect(refineCost({ refine: cfg.maxLevel }, epic, ctx)).toBeNull();
  });

  it('шанс поломки при шаге на +N — (N−1)·10%: +1 безопасно, +10 — 90%', () => {
    expect([...Array(cfg.maxLevel).keys()].map((from) => refineBreakChance(from, ctx))).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);
    expect(refineBreakChance(cfg.maxLevel, ctx)).toBe(0);
  });

  it('схема: шансов ровно maxLevel и не убывают', () => {
    const base = { maxLevel: 3, bonusByLevel: [0, 0.1, 0.3, 0.8], cost: { base: { common: 1, rare: 2, epic: 3 }, growth: 1.5 } };
    expect(RefineConfigSchema.safeParse({ ...base, breakChance: [0, 0.1, 0.2] }).success).toBe(true);
    expect(RefineConfigSchema.safeParse({ ...base, breakChance: [0, 0.1] }).success).toBe(false);
    expect(RefineConfigSchema.safeParse({ ...base, breakChance: [0, 0.3, 0.2] }).success).toBe(false);
    // Прибавка: ровно maxLevel+1 значений, с нуля, не убывает; надёжная заточка — оба поля вместе.
    expect(RefineConfigSchema.safeParse({ ...base, bonusByLevel: [0, 0.1, 0.3] }).success).toBe(false);
    expect(RefineConfigSchema.safeParse({ ...base, bonusByLevel: [0.1, 0.1, 0.3, 0.8] }).success).toBe(false);
    expect(RefineConfigSchema.safeParse({ ...base, bonusByLevel: [0, 0.3, 0.1, 0.8] }).success).toBe(false);
    expect(RefineConfigSchema.safeParse({ ...base, safeGoldMult: 5 }).success).toBe(false);
    expect(RefineConfigSchema.safeParse({ ...base, safeGoldMult: 5, safeBreakDiv: 5, blessedOre: { min: 1, max: 3 } }).success).toBe(true);
    expect(RefineConfigSchema.safeParse({ ...base, blessedOre: { min: 3, max: 1 } }).success).toBe(false);
  });

  it('статы и имя с заточкой', () => {
    const def = ctx.equipment.items.claymore;
    expect(refinedStats(def, 0, ctx)).toEqual(def.stats);
    expect(refinedStats(def, 5, ctx).atk).toBe(Math.round(def.stats.atk! * (1 + cfg.bonusByLevel[5])));
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
    expect(r.events).toEqual([{ type: 'refined', ok: true, instanceId: weapon, itemId: 'claymore', from: 0, to: 1, gold: cost.gold, chance: 0, mode: 'normal' }]);
    // Счётчик попыток растёт и у безопасного шага.
    expect(r.save.inventory.refineSeq).toBe(1);
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
    const risky = withRefine(save, weapon, 5);
    for (let seq = 0; seq < 20; seq++) {
      const s = { ...risky, inventory: { ...risky.inventory, refineSeq: seq } };
      expect(serialize(refineItem(s, weapon, ctx).save)).toBe(serialize(refineItem(s, weapon, ctx).save));
    }
  });
});

describe('Заточка: поломка', () => {
  it('неудача не уничтожает карту MVP, замок, надетую вещь или её прежнее улучшение', () => {
    const { save, weapon } = setup();
    const s = { ...save, inventory: { ...save.inventory, items: save.inventory.items.map((i) => i.id === weapon ? { ...i, refine: 9, card: 'baphomet_card', locked: true } : i) } };
    const out = refineItem(deserialize(serialize(s)), weapon, ctx, { seed: seedWhere((x) => new Rng(x).next() < 0.9) });
    expect(out.events[0].type).toBe('refineFailed');
    expect(inst(out.save, weapon)).toEqual(inst(s, weapon));
    expect(out.save.inventory.refineSeq).toBe(1);
    expect(out.save.resources.gold).toBeLessThan(s.resources.gold);
    expect(inst(deserialize(serialize(out.save)), weapon)).toEqual(inst(s, weapon));
  });

  it('seed решает исход: ниже шанса — прежняя вещь сохранена, золото списано; иначе +1', () => {
    const { save, weapon } = setup();
    const s = withRefine(save, weapon, 3); // шаг +3 → +4: 30%
    const cost = refineCost({ refine: 3 }, ctx.equipment.items.claymore, ctx)!.gold;
    const bad = seedWhere((x) => new Rng(x).next() < 0.3);
    const good = seedWhere((x) => new Rng(x).next() >= 0.3);
    const broken = refineItem(s, weapon, ctx, { seed: bad });
    expect(broken.events).toEqual([{ type: 'refineFailed', instanceId: weapon, itemId: 'claymore', level: 3, heroId: save.heroes[0].id, gold: cost, chance: 0.3, mode: 'normal' }]);
    expect(inst(broken.save, weapon)).toEqual(inst(s, weapon));
    expect(broken.save.resources.gold).toBe(s.resources.gold - cost);
    const ok = refineItem(s, weapon, ctx, { seed: good });
    expect(ok.events[0]).toMatchObject({ type: 'refined', ok: true, from: 3, to: 4, chance: 0.3 });
    expect(refineLevel(inst(ok.save, weapon))).toBe(4);
  });

  it('неудача сохраняет надетую вещь и все статы героя', () => {
    const { save, heroId, weapon } = setup();
    const s = withRefine(save, weapon, 9); // 90%
    const r = refineItem(s, weapon, ctx, { seed: seedWhere((x) => new Rng(x).next() < 0.9) });
    expect(r.events[0].type).toBe('refineFailed');
    expect(heroSlots(r.save, heroId, ctx).weapon).toEqual(heroSlots(s, heroId, ctx).weapon);
    expect(heroGearStats(r.save, heroId, ctx)).toEqual(heroGearStats(s, heroId, ctx));
  });

  it('без seed — бросок по счётчику сохранения: перезагрузка не даёт переброса, следующая попытка — новый бросок', () => {
    const { save, weapon } = setup();
    const s = withRefine(save, weapon, 5);
    const a = refineItem(s, weapon, ctx);
    // «Перезагрузка»: то же сохранение — тот же исход.
    expect(refineItem(deserialize(serialize(s)), weapon, ctx).events).toEqual(a.events);
    expect(a.events[0].type === 'refineFailed').toBe(new Rng(refineSeed(s.createdAt, 0)).next() < 0.5);
    // Исходы по счётчику различаются (за 40 попыток на 50% есть и поломки, и успехи).
    const kinds = new Set<string>();
    for (let seq = 0; seq < 40; seq++) kinds.add(refineItem({ ...s, inventory: { ...s.inventory, refineSeq: seq } }, weapon, ctx).events[0].type);
    expect(kinds).toEqual(new Set(['refined', 'refineFailed']));
  });
});

describe('Заточка: бой и мощь', () => {
  it('статы экипировки, юнит боя и мощь растут с заточкой', () => {
    const { save, heroId, weapon, armor } = setup();
    const hero = save.heroes.find((h) => h.id === heroId)!;
    // +5 выставляем напрямую: шаги выше +1 могут не удаться.
    const s = withRefine(withRefine(save, weapon, 5), armor, 5);
    const g0 = heroGearStats(save, heroId, ctx);
    const g5 = heroGearStats(s, heroId, ctx);
    expect(g5.atk).toBe(Math.round(34 * (1 + cfg.bonusByLevel[5])));
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
  it('по безопасному шагу каждому надетому предмету, сумма = списанное золото', () => {
    const { save, heroId, weapon, armor } = setup();
    const plan = refineAllPlan(save, heroId, ctx);
    expect(plan.steps.map((s) => s.instanceId).sort()).toEqual([weapon, armor].sort());
    const r = actRefineAll(save, heroId, ctx);
    expect(r.events).toHaveLength(2);
    expect(save.resources.gold - r.save.resources.gold).toBe(plan.gold);
  });

  it('рискованные шаги пропускаются: только вручную', () => {
    const { save, heroId, weapon, armor } = setup();
    const s = withRefine(save, weapon, 1); // у меча следующий шаг — 10%
    const plan = refineAllPlan(s, heroId, ctx);
    expect(plan.steps.map((x) => x.instanceId)).toEqual([armor]);
    expect(plan).toMatchObject({ safe: 1, risky: 1 });
    const none = refineAllPlan(withRefine(s, armor, 1), heroId, ctx);
    expect(none).toMatchObject({ steps: [], gold: 0, safe: 0, risky: 2 });
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

  it('старая заточка выше +10 (до поломки было +15) — sanitizeSave ограничивает до +10', () => {
    const { save, weapon, armor } = setup();
    const old = withRefine(withRefine(save, weapon, 15), armor, 7);
    const r = sanitizeSave(old, ctx);
    expect(refineLevel(inst(r.save, weapon))).toBe(cfg.maxLevel);
    expect(refineLevel(inst(r.save, armor))).toBe(7);
    expect(r.warnings.some((w) => w.includes('+10'))).toBe(true);
    // Ничего выше предела — сохранение не трогается.
    expect(sanitizeSave(r.save, ctx).save).toBe(r.save);
    // Статы и так не выше +10, дальше точить нельзя.
    expect(refinedStats(ctx.equipment.items.claymore, 15, ctx)).toEqual(refinedStats(ctx.equipment.items.claymore, 10, ctx));
    expect(() => refineItem(old, weapon, ctx)).toThrow(expect.objectContaining({ code: 'refine_max' }));
  });
});

describe('Заточка: прирост по ступеням', () => {
  it('+1…+4 — скромные шаги, +8…+10 — огромные; +10 — +250% статов вещи', () => {
    const b = cfg.bonusByLevel;
    const step = (n: number) => b[n] - b[n - 1];
    for (let n = 2; n <= cfg.maxLevel; n++) expect(step(n)).toBeGreaterThanOrEqual(step(n - 1));
    expect(step(10)).toBeGreaterThan(5 * step(1));
    expect(b[cfg.maxLevel]).toBe(2.5);
    const def = ctx.equipment.items.claymore;
    expect(refinedStats(def, 10, ctx).atk).toBe(Math.round(34 * 3.5));
    expect(refineBonus(10, ctx)).toBe(2.5);
  });
});

describe('Заточка: надёжная', () => {
  it('цена × safeGoldMult, шанс ÷ safeBreakDiv (30% → 6%)', () => {
    expect(cfg.safeGoldMult).toBe(5);
    expect(cfg.safeBreakDiv).toBe(5);
    const epic = ctx.equipment.items.claymore;
    expect(refineModeCost({ refine: 3 }, epic, ctx, 'safe')!.gold).toBe(5 * refineCost({ refine: 3 }, epic, ctx)!.gold);
    expect(refineBreakChance(3, ctx, 'safe')).toBe(0.06);
    expect(refineBreakChance(9, ctx, 'safe')).toBe(0.18);
    expect(refineBreakChance(0, ctx, 'safe')).toBe(0);
  });

  it('шаг: списано ×5 золота, бросок против уменьшенного шанса', () => {
    const { save, weapon } = setup();
    const s = withRefine(save, weapon, 3);
    const cost = refineModeCost({ refine: 3 }, ctx.equipment.items.claymore, ctx, 'safe')!.gold;
    // Бросок 0.1: обычный шаг (30%) не удался бы, надёжный (6%) — нет.
    const seed = seedWhere((x) => {
      const v = new Rng(x).next();
      return v >= 0.06 && v < 0.3;
    });
    expect(refineItem(s, weapon, ctx, { seed }).events[0].type).toBe('refineFailed');
    const r = refineItem(s, weapon, ctx, { seed, mode: 'safe' });
    expect(r.events[0]).toMatchObject({ type: 'refined', mode: 'safe', from: 3, to: 4, gold: cost, chance: 0.06 });
    expect(r.save.resources.gold).toBe(s.resources.gold - cost);
    const bad = seedWhere((x) => new Rng(x).next() < 0.06);
    expect(refineItem(s, weapon, ctx, { seed: bad, mode: 'safe' }).events[0].type).toBe('refineFailed');
  });
});

describe('Заточка: Благословенная руда', () => {
  const withOre = (save: SaveState, n: number): SaveState => ({ ...save, currency: { ...save.currency, blessedOre: n } });

  it('100% успех даже на +9 → +10, тратит 1 руду и золото обычного шага', () => {
    const { save, weapon } = setup();
    const s = withOre(withRefine(save, weapon, 9), 2);
    const cost = refineCost({ refine: 9 }, ctx.equipment.items.claymore, ctx)!.gold;
    for (let seed = 1; seed < 50; seed++) {
      const r = refineItem(s, weapon, ctx, { seed, mode: 'ore' });
      expect(r.events[0]).toMatchObject({ type: 'refined', mode: 'ore', to: 10, chance: 0, gold: cost });
      expect(blessedOre(r.save)).toBe(1);
      expect(r.save.resources.gold).toBe(s.resources.gold - cost);
    }
  });

  it('нет руды — not_enough_ore (старое сохранение без поля = 0)', () => {
    const { save, weapon } = setup();
    expect(blessedOre(save)).toBe(0);
    expect(() => refineItem(withRefine(save, weapon, 5), weapon, ctx, { mode: 'ore' })).toThrow(expect.objectContaining({ code: 'not_enough_ore' }));
    const raw = JSON.parse(serialize(withOre(save, 3)));
    delete raw.currency.blessedOre;
    expect(blessedOre(deserialize(JSON.stringify(raw)))).toBe(0);
    expect(blessedOre(deserialize(serialize(withOre(save, 3))))).toBe(3);
  });

  it('выпадение: 1–3 по seed, детерминированно, встречаются все три', () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 200; seed++) {
      const n = rollBlessedOre(seed, ctx);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(3);
      expect(rollBlessedOre(seed, ctx)).toBe(n);
      seen.add(n);
    }
    expect(seen).toEqual(new Set([1, 2, 3]));
    expect(rollBlessedOre(5, { equipment: undefined })).toBe(0);
  });

  it('босс главы при первой победе — руда (событие blessedOre), обычный этап и повтор — нет', () => {
    let save = newGame(ctx, 0, '2026-01-01');
    const strong = save.heroes.map((h) => ({ ...h, rarity: 'purple' as const, level: 60 }));
    save = { ...save, heroes: strong };
    const ch1 = ctx.content.stages.filter((st) => st.chapter === ctx.content.stages[0].chapter);
    const boss = ch1.find((st) => st.boss)!;
    save = { ...save, campaign: { cleared: ch1.filter((st) => st.id !== boss.id).map((st) => st.id) } };
    let first: ReturnType<typeof actPlayStage> | null = null;
    for (let seed = 1; seed < 30 && !first; seed++) {
      const r = actPlayStage(save, '2026-01-01', boss.id, seed, ctx);
      if (r.result.winner === 'A') first = r;
    }
    expect(first).not.toBeNull();
    const ev = first!.events.find((e) => e.type === 'blessedOre');
    expect(ev).toBeDefined();
    const n = ev!.type === 'blessedOre' ? ev!.count : 0;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(blessedOre(first!.save)).toBe(n);
    // Повтор босса — без руды.
    const again = actPlayStage(first!.save, '2026-01-01', boss.id, 1, ctx);
    expect(again.events.some((e) => e.type === 'blessedOre')).toBe(false);
    expect(blessedOre(again.save)).toBe(n);
  });

  it('этаж-босс Башни — руда, обычный этаж — нет', () => {
    let save = newGame(ctx, 0, '2026-01-01');
    save = { ...save, heroes: save.heroes.map((h) => ({ ...h, rarity: 'purple' as const, level: 60 })), campaign: { cleared: ctx.content.stages.map((st) => st.id) } };
    const bossFloor = ctx.tower.bossEvery;
    const before = { ...save, tower: { floor: bossFloor - 2 } };
    const plain = climbTower(before, 1, ctx);
    expect(plain.result.winner).toBe('A');
    expect(plain.events.some((e) => e.type === 'blessedOre')).toBe(false);
    const boss = climbTower(plain.save, 1, ctx);
    expect(boss.result.winner).toBe('A');
    const ev = boss.events.find((e) => e.type === 'blessedOre');
    expect(ev && ev.type === 'blessedOre' ? ev.count : 0).toBe(rollBlessedOre(1, ctx));
    expect(blessedOre(boss.save)).toBe(rollBlessedOre(1, ctx));
  });

  it('Охота: руда только за первую попытку дня со взятым порогом', () => {
    let save = newGame(ctx, 0, '2026-01-01');
    save = { ...save, heroes: save.heroes.map((h) => ({ ...h, rarity: 'purple' as const, level: 60 })), campaign: { cleared: ctx.content.stages.map((st) => st.id) } };
    const day = '2026-01-05';
    const a = fightHunt(save, day, ctx);
    expect(a.tier).toBeGreaterThanOrEqual(0);
    expect(a.grant.ore).toBe(rollBlessedOre(huntSeed(save, day, 'loot'), ctx));
    expect(blessedOre(a.save)).toBe(a.grant.ore);
    const b = sweepHunt(a.save, day, ctx);
    expect(b.grant.ore).toBe(0);
    // Следующий день — снова руда.
    const c = fightHunt(b.save, '2026-01-06', ctx);
    expect(c.grant.ore).toBeGreaterThanOrEqual(1);
  });
});
