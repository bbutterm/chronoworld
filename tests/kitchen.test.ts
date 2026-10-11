// Кухня в Таверне (docs/design/kitchen.md, src/core/kitchen): блюдо раз в день, часы назад, источники продуктов,
// предел кладовой, совет повара, прибавка в кампании/Башне/охоте, но не на Арене; совместимость старых сохранений.
import { describe, expect, it } from 'vitest';
import {
  activeMeal,
  actBuyIngredient,
  actClaimExpedition,
  actClaimOffline,
  actCookMeal,
  autobattlerBattle,
  autobattlerConfig,
  buyIngredient,
  claimOffline,
  cookMeal,
  deserialize,
  fightHunt,
  grantChestIngredients,
  grantHuntIngredients,
  huntIngredientCount,
  kitchenAdvice,
  KitchenError,
  kitchenReady,
  kitchenSituation,
  kitchenStatus,
  recipeScore,
  sortRecipes,
  newGame,
  parseKitchenConfig,
  playStage,
  serialize,
  squadUnits,
  startAutobattlerRun,
  startExpedition,
  startTowerRun,
  towerRunSquad,
  withMeal,
  type KitchenContext,
  type SaveState,
} from '../src/core';
import { loadFullContext, readRawGameData } from '../scripts/lib/content-node';
import { withReplay } from './helpers';

const ctx = loadFullContext();
if (!ctx.kitchen) throw new Error('нет data/kitchen.json');
const cfg = ctx.kitchen;
const kctx = ctx as KitchenContext;
const D0 = '2026-10-09';
const D1 = '2026-10-10';
const D2 = '2026-10-11';
const HOUR = 3_600_000;

const chapter1 = ctx.content.stages.filter((s) => s.chapter === 'chapter1').map((s) => s.id);
/** Этапы до открытия Кухни включительно (решение владельца 10.10: 2-3, ch2_s2 — на 1-10 и так Башня и Арена). */
const KITCHEN_STAGE = 'ch2_s2';
const toKitchen = ctx.content.stages.slice(0, ctx.content.stages.findIndex((s) => s.id === KITCHEN_STAGE) + 1).map((s) => s.id);

/** Предел кладовой (data/kitchen.json → pantryCap). */
const CAP = cfg.pantryCap ?? Infinity;
/** Сколько каждого продукта в кладовой openSave: хватает на любое блюдо, и до предела есть место. */
const STOCK = 15;

/** Этапы до 2-3 пройдены (Кухня открыта), в кладовой по STOCK каждого продукта, золото есть. */
function openSave(extra: Partial<SaveState> = {}, createdAt = 777): SaveState {
  const s = newGame(ctx, createdAt, D1);
  const pantry = Object.fromEntries(cfg.ingredients.map((g) => [g.id, STOCK]));
  return { ...s, campaign: { cleared: [...toKitchen] }, resources: { ...s.resources, gold: 1_000_000 }, kitchen: { pantry }, ...extra };
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(KitchenError);
    return (e as KitchenError).code;
  }
  return undefined;
}

const total = (p: Record<string, number> | undefined) => Object.values(p ?? {}).reduce((a, n) => a + n, 0);

describe('Кухня: конфиг и открытие', () => {
  it('data/kitchen.json собран в контекст; продукты рецептов существуют', () => {
    expect(cfg.ingredients.map((g) => g.id)).toEqual(['meat', 'apple', 'carrot', 'honey', 'milk']);
    expect(cfg.recipes.length).toBeGreaterThanOrEqual(6);
    const ids = new Set(cfg.ingredients.map((g) => g.id));
    for (const r of cfg.recipes) for (const k of Object.keys(r.cost)) expect(ids.has(k)).toBe(true);
  });

  it('битый kitchen.json — ошибка с именем файла', () => {
    const raw = readRawGameData();
    expect(() => parseKitchenConfig({ ...(raw.kitchen as object), recipes: [{ ...cfg.recipes[0], cost: { truffle: 1 } }] })).toThrow(/data\/kitchen.json/);
  });

  it('Кухня открывается на 2-3 (ch2_s2)', () => {
    const def = ctx.unlocks?.features.find((f) => f.id === 'kitchen');
    expect(def?.stage).toBe(KITCHEN_STAGE);
    const closed = { ...openSave(), campaign: { cleared: toKitchen.slice(0, -1) } };
    expect(kitchenStatus(closed, D1, kctx).unlocked).toBe(false);
    expect(codeOf(() => cookMeal(closed, D1, 'feast', kctx))).toBe('kitchen_locked');
    expect(kitchenReady(closed, D1, kctx)).toBe(false);
    expect(kitchenReady(openSave(), D1, kctx)).toBe(true);
  });
});

describe('Кухня: блюдо раз в день', () => {
  it('готовка списывает продукты и ставит блюдо дня; второе в тот же день — нельзя', () => {
    const s = openSave();
    const out = actCookMeal(s, D1, 'feast', kctx);
    const feast = cfg.recipes.find((r) => r.id === 'feast')!;
    for (const [id, n] of Object.entries(feast.cost)) expect(out.kitchen!.pantry[id] ?? 0).toBe(STOCK - n);
    expect(out.kitchen!.meal).toEqual({ id: 'feast', day: D1 });
    expect(activeMeal(out, D1, kctx)?.id).toBe('feast');
    expect(kitchenStatus(out, D1, kctx).canCook).toBe(false);
    expect(kitchenReady(out, D1, kctx)).toBe(false);
    expect(codeOf(() => cookMeal(out, D1, 'roast_meat', kctx))).toBe('already_cooked');
    expect(s.kitchen!.meal).toBeUndefined();
  });

  it('новый день — блюдо закончилось, можно готовить снова', () => {
    const cooked = cookMeal(openSave(), D1, 'feast', kctx);
    expect(activeMeal(cooked, D2, kctx)).toBeNull();
    const next = cookMeal(cooked, D2, 'roast_meat', kctx);
    expect(next.kitchen!.meal).toEqual({ id: 'roast_meat', day: D2 });
  });

  it('часы назад: второго блюда нет, а прибавка вчерашнего дня не действует', () => {
    const cooked = cookMeal(openSave(), D1, 'feast', kctx);
    expect(codeOf(() => cookMeal(cooked, D0, 'roast_meat', kctx))).toBe('already_cooked');
    expect(activeMeal(cooked, D0, kctx)).toBeNull();
    expect(kitchenStatus(cooked, D0, kctx).canCook).toBe(false);
  });

  it('не хватает продуктов — not_enough; неизвестное блюдо — unknown_recipe', () => {
    const s = openSave({ kitchen: { pantry: { meat: 1 } } });
    expect(codeOf(() => cookMeal(s, D1, 'roast_meat', kctx))).toBe('not_enough');
    expect(codeOf(() => cookMeal(s, D1, 'cake', kctx))).toBe('unknown_recipe');
    expect(kitchenStatus(s, D1, kctx).recipes.find((r) => r.id === 'roast_meat')!.missing).toEqual({ meat: 2, honey: 1 });
  });
});

describe('Кухня: покупка продуктов', () => {
  it('цена — золотом, лимит в день, часы назад лимит не возвращают', () => {
    const s = openSave({ kitchen: { pantry: {} } });
    const price = kitchenStatus(s, D1, kctx).pantry.find((p) => p.id === 'meat')!.priceNow;
    expect(price).toBeGreaterThan(0);
    let x = actBuyIngredient(s, D1, 'meat', kctx);
    expect(x.resources.gold).toBe(s.resources.gold - price);
    expect(x.kitchen!.pantry.meat).toBe(1);
    x = buyIngredient(x, D1, 'meat', kctx, cfg.shop.dailyLimit - 1);
    expect(kitchenStatus(x, D1, kctx).buyLeft).toBe(0);
    expect(codeOf(() => buyIngredient(x, D1, 'apple', kctx))).toBe('day_limit');
    expect(codeOf(() => buyIngredient(x, D0, 'apple', kctx))).toBe('day_limit');
    expect(buyIngredient(x, D2, 'apple', kctx).kitchen!.pantry.apple).toBe(1);
    expect(codeOf(() => buyIngredient({ ...s, resources: { ...s.resources, gold: 0 } }, D1, 'meat', kctx))).toBe('not_enough_gold');
  });

  it('цена растёт с главой', () => {
    const s = openSave();
    const ch1 = kitchenStatus(s, D1, kctx).pantry[0].priceNow;
    const ch3 = kitchenStatus({ ...s, campaign: { cleared: [...chapter1, 'ch2_s1', 'ch3_s1'] } }, D1, kctx).pantry[0].priceNow;
    expect(ch3).toBeGreaterThan(ch1);
  });
});

describe('Кухня: источники продуктов', () => {
  it('экспедиция: от min до max продуктов, детерминированно; в среднем меньше одного', () => {
    const t0 = 1_000 * HOUR;
    let sum = 0;
    const N = 24;
    for (let k = 0; k < N; k++) {
      let s = newGame(ctx, 4242 + k, D1);
      s = { ...s, campaign: { cleared: chapter1 } };
      s = startExpedition(s, 'ant_hell', 1, t0, ctx);
      const a = actClaimExpedition(s, D1, 'ant_hell', t0 + HOUR, ctx);
      const b = actClaimExpedition(s, D1, 'ant_hell', t0 + HOUR, ctx);
      expect(total(a.ingredients)).toBeGreaterThanOrEqual(cfg.sources.expedition.min);
      expect(total(a.ingredients)).toBeLessThanOrEqual(cfg.sources.expedition.max);
      expect(a.save.kitchen?.pantry ?? {}).toEqual(a.ingredients ?? {});
      expect(b.ingredients).toEqual(a.ingredients);
      sum += total(a.ingredients);
    }
    // Экспедиций в день много (модель — около 14): больше одного продукта за экспедицию — и кладовая снова
    // переполняется (замер 11.10.2026: 545 продуктов к 14-му дню при 2–4 за экспедицию; docs/design/kitchen.md).
    expect(sum / N).toBeLessThan(1);
    expect(sum).toBeGreaterThan(0);
  });

  it('охота: продукты по взятому порогу', () => {
    const base = openSave({ kitchen: undefined });
    const save: SaveState = { ...base, campaign: { cleared: [...chapter1, 'ch2_s1'] }, heroes: base.heroes.map((h) => ({ ...h, level: 30 })) };
    const out = fightHunt(save, D1, ctx);
    expect(total(out.grant.ingredients)).toBe(huntIngredientCount(out.tier, cfg));
    expect(total(out.save.kitchen?.pantry)).toBe(huntIngredientCount(out.tier, cfg));
    expect(huntIngredientCount(-1, cfg)).toBe(0);
    expect(huntIngredientCount(99, cfg)).toBe(cfg.sources.hunt.max);
  });

  // Выпущенные данные повторы этапов запрещают (campaign.replay: false), и источника sources.replay в data/kitchen.json нет.
  // Код источника остаётся для контекстов с разрешёнными повторами — проверяем его на явном replay: true.
  it('выпущенные данные: повтор этапа не сражается и продуктов не даёт; источника replay нет', () => {
    expect(cfg.sources.replay).toBeUndefined();
    const s = openSave({ kitchen: undefined });
    expect(() => playStage(s, 'ch1_s1', 1, ctx, undefined, D1)).toThrow(expect.objectContaining({ code: 'stage_cleared' }));
    // Разрешённые повторы без sources.replay — бой есть, продуктов нет.
    const out = playStage(s, 'ch1_s1', 1, withReplay(ctx), undefined, D1);
    expect(out.ingredients).toBeUndefined();
  });

  it('replay: true и sources.replay — повтор с наградой иногда даёт продукт; первое прохождение — никогда', () => {
    const src = { chance: 0.5, count: 1 };
    const rctx = withReplay(ctx, { kitchenReplay: src });
    const s = openSave({ kitchen: undefined });
    let got = 0;
    let wins = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const out = playStage(s, 'ch1_s1', seed, rctx, undefined, D1);
      if (out.result.winner !== 'A') continue;
      wins++;
      if (out.ingredients) {
        got++;
        expect(total(out.save.kitchen!.pantry)).toBe(src.count);
      }
    }
    expect(wins).toBeGreaterThan(30);
    expect(got / wins).toBeGreaterThan(0.2);
    expect(got / wins).toBeLessThan(0.8);
    const fresh = newGame(ctx, 1, D1);
    const first = playStage(fresh, 'ch1_s1', 1, rctx, undefined, D1);
    expect(first.result.winner).toBe('A');
    expect(first.ingredients).toBeUndefined();
    // Без дня повтор — тренировка без добычи и без продуктов.
    expect(playStage(s, 'ch1_s1', 3, rctx).ingredients).toBeUndefined();
  });

  it('сундук простоя: изредка продукт за полный тик, тот же сбор — тот же итог', () => {
    let sum = 0;
    for (let k = 0; k < 20; k++) {
      const s = { ...openSave({ kitchen: undefined }, 100 + k), offline: { lastClaimAt: 0 } };
      const a = actClaimOffline(s, 12 * HOUR, D1, ctx);
      const b = claimOffline(s, 12 * HOUR, ctx);
      expect(b.ingredients).toEqual(a.ingredients);
      sum += total(a.ingredients);
    }
    // 24 тика × 20 сохранений × шанс (0.08 — после отмены повторов этапов): ожидание около 38.
    const expected = 24 * 20 * cfg.sources.chest.chancePerTick;
    expect(sum).toBeGreaterThan(expected * 0.4);
    expect(sum).toBeLessThan(expected * 1.8);
  });
});

describe('Кухня: прибавка блюда', () => {
  const pct = (a: number, b: number) => Math.round((a / b - 1) * 1000) / 10;
  const recipe = (id: string) => cfg.recipes.find((r) => r.id === id)!;

  it('кампания: статы отряда растут только в день блюда; опыт каши — к награде этапа', () => {
    const feast = recipe('feast').buff;
    const s = openSave({ kitchen: { pantry: {}, meal: { id: 'feast', day: D1 } } });
    const plain = squadUnits(s, ctx).squad.find(Boolean)!;
    const fed = squadUnits(s, ctx, D1).squad.find(Boolean)!;
    const other = squadUnits(s, ctx, D2).squad.find(Boolean)!;
    expect(feast.atk).toBeGreaterThan(0);
    expect(pct(fed.stats.atk, plain.stats.atk)).toBeCloseTo(feast.atk!, 0);
    expect(pct(fed.stats.hp, plain.stats.hp)).toBeCloseTo(feast.hp!, 0);
    expect(fed.stats.def).toBe(plain.stats.def);
    expect(other.stats).toEqual(plain.stats);

    const fresh = newGame(ctx, 5, D1);
    const porridge = { ...fresh, kitchen: { pantry: {}, meal: { id: 'milk_porridge', day: D1 } } };
    const base = playStage(fresh, 'ch1_s1', 1, ctx, undefined, D1);
    const more = playStage(porridge, 'ch1_s1', 1, ctx, undefined, D1);
    const exp = (o: typeof base) => o.events.find((e) => e.type === 'rewards') as { heroExp: number };
    const bonus = recipe('milk_porridge').buff.exp!;
    expect(bonus).toBeGreaterThan(0);
    expect(exp(more).heroExp).toBe(Math.floor(exp(base).heroExp * (1 + bonus / 100)));
  });

  it('Башня: отряд забега сильнее в день блюда', () => {
    const roast = recipe('roast_meat').buff;
    const s = openSave({ kitchen: { pantry: {}, meal: { id: 'roast_meat', day: D1 } } });
    const run = startTowerRun(s, s.squad, ctx);
    const plain = towerRunSquad(run, ctx).squad.find(Boolean)!;
    const fed = towerRunSquad(run, ctx, D1).squad.find(Boolean)!;
    expect(fed.stats.atk).toBe(Math.round(plain.stats.atk * (1 + roast.atk! / 100)));
    expect(fed.stats.hp).toBe(plain.stats.hp);
  });

  it('Арена (автобатлер) нормализована: блюдо дня её не меняет', () => {
    const abCfg = autobattlerConfig(ctx);
    const p = { ...newGame(ctx, 1001, D1), campaign: { cleared: [abCfg.unlockAfterStage!] } };
    const ordinary = startAutobattlerRun(p, D1, ctx);
    const fed = { ...ordinary, kitchen: { pantry: {}, meal: { id: 'feast', day: D1 } } };
    expect(autobattlerBattle(fed, ctx)).toEqual(autobattlerBattle(ordinary, ctx));
  });

  it('withMeal без блюда — тот же массив', () => {
    const s = openSave();
    const sq = squadUnits(s, ctx).squad;
    expect(withMeal(sq, s, D1, ctx)).toBe(sq);
  });
});

describe('Кухня: сохранения', () => {
  it('старое сохранение без kitchen читается, кладовая пуста', () => {
    const old = newGame(ctx, 99, D1);
    expect(old.kitchen).toBeUndefined();
    const back = deserialize(serialize(old));
    expect(back.kitchen).toBeUndefined();
    const st = kitchenStatus({ ...back, campaign: { cleared: chapter1 } }, D1, kctx);
    expect(st.pantry.every((p) => p.count === 0)).toBe(true);
    expect(st.meal).toBeNull();
    expect(st.ready).toBe(false);
  });

  it('старый запас больше предела кладовой читается и тратится на блюда', () => {
    const big = openSave({ kitchen: { pantry: { meat: 110, apple: 125, honey: 71, milk: 84, carrot: 155 } } });
    const back = deserialize(serialize(big));
    expect(back.kitchen!.pantry.meat).toBe(110);
    const cooked = cookMeal(back, D1, 'feast', kctx);
    expect(cooked.kitchen!.pantry.meat).toBe(110 - cfg.recipes.find((r) => r.id === 'feast')!.cost.meat!);
  });

  it('kitchen переживает serialize/deserialize без смены версии', () => {
    const s = cookMeal(buyIngredient(openSave(), D1, 'milk', kctx), D1, 'feast', kctx);
    const back = deserialize(serialize(s));
    expect(back.kitchen).toEqual(s.kitchen);
    expect(back.version).toBe(s.version);
  });
});

describe('Кухня: предел кладовой', () => {
  it('в данных есть предел; выдача не начисляет сверх него и сообщает только то, что легло', () => {
    expect(CAP).toBeLessThanOrEqual(30);
    let s = openSave({ kitchen: { pantry: Object.fromEntries(cfg.ingredients.map((g) => [g.id, CAP - 1])) } });
    let got = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const g = grantChestIngredients(s, 48, seed, ctx);
      s = g.save;
      got += total(g.gained);
      for (const n of Object.values(g.gained)) expect(n).toBeGreaterThan(0);
    }
    // Каждого продукта поместилось не больше одной штуки.
    expect(got).toBeGreaterThan(0);
    expect(got).toBeLessThanOrEqual(cfg.ingredients.length);
    for (const g of cfg.ingredients) expect(s.kitchen!.pantry[g.id]).toBeLessThanOrEqual(CAP);
    // Полная кладовая: охота ничего не даёт, сохранение то же.
    const full = openSave({ kitchen: { pantry: Object.fromEntries(cfg.ingredients.map((g) => [g.id, CAP])) } });
    const h = grantHuntIngredients(full, 5, 7, ctx);
    expect(h.gained).toEqual({});
    expect(h.save).toBe(full);
  });

  it('запас сверх предела (старое сохранение) не сгорает; купить сверх предела нельзя; ячейка — «полна»', () => {
    const old = openSave({ kitchen: { pantry: { meat: CAP + 30, apple: CAP } } });
    const g = grantHuntIngredients(old, 9, 3, ctx);
    expect(g.save.kitchen!.pantry.meat).toBe(CAP + 30);
    expect(codeOf(() => buyIngredient(old, D1, 'apple', kctx))).toBe('pantry_full');
    const almost = openSave({ kitchen: { pantry: { apple: CAP - 1 } } });
    expect(codeOf(() => buyIngredient(almost, D1, 'apple', kctx, 2))).toBe('pantry_full');
    expect(buyIngredient(almost, D1, 'apple', kctx).kitchen!.pantry.apple).toBe(CAP);
    const st = kitchenStatus(old, D1, kctx);
    expect(st.cap).toBe(CAP);
    expect(st.pantry.find((p) => p.id === 'meat')!.full).toBe(true);
    expect(st.pantry.find((p) => p.id === 'apple')!.full).toBe(true);
    expect(st.pantry.find((p) => p.id === 'milk')!.full).toBe(false);
  });
});

describe('Кухня: блюда и совет повара', () => {
  const R = (id: string) => cfg.recipes.find((r) => r.id === id)!;
  const bossIdx = ctx.content.stages.findIndex((s, i) => s.boss && i >= toKitchen.length);
  const bossStage = ctx.content.stages[bossIdx];
  /** Следующий этап — босс (всё до него пройдено). */
  const beforeBoss = (pantry: Record<string, number>) => openSave({ campaign: { cleared: ctx.content.stages.slice(0, bossIdx).map((s) => s.id) }, kitchen: { pantry } });
  const full = Object.fromEntries(cfg.ingredients.map((g) => [g.id, STOCK]));
  /** Опыта вдоволь (героев держит не опыт) — обычный день без ситуации level. */
  const rich = (s: SaveState): SaveState => ({ ...s, resources: { ...s.resources, heroExp: 1_000_000_000 } });

  it('у каждого блюда своя картинка из продуктов; есть блюда для босса и для опыта', () => {
    for (const r of cfg.recipes) {
      expect(r.dish, r.id).toBeDefined();
      for (const id of r.dish!.items) expect(cfg.ingredients.some((g) => g.id === id)).toBe(true);
    }
    expect(new Set(cfg.recipes.map((r) => JSON.stringify(r.dish))).size).toBe(cfg.recipes.length);
    expect(cfg.recipes.some((r) => r.goodFor?.includes('boss'))).toBe(true);
    expect(cfg.recipes.some((r) => r.goodFor?.includes('level') && r.buff.exp)).toBe(true);
  });

  it('Пир — самое сильное блюдо, но мёда и молока (редких продуктов) в нём больше, чем в любом другом', () => {
    const feast = R('feast');
    const rare = (r: (typeof cfg.recipes)[number]) => (r.cost.honey ?? 0) + (r.cost.milk ?? 0);
    for (const r of cfg.recipes) {
      if (r.id === 'feast') continue;
      expect(recipeScore(feast.buff), r.id).toBeGreaterThan(recipeScore(r.buff));
      expect(rare(feast), r.id).toBeGreaterThan(rare(r));
    }
  });

  it('впереди босс — Пир; не хватает на Пир — Медовый пирог; ни на что для босса — самое сильное из доступных', () => {
    expect(bossStage?.boss).toBe(true);
    const s = beforeBoss(full);
    expect(kitchenSituation(s, ctx)).toEqual({ situation: 'boss', stageId: bossStage.id });
    expect(kitchenAdvice(s, D1, ctx)).toEqual({ recipeId: 'feast', reason: 'boss', stageId: bossStage.id });
    expect(kitchenAdvice(beforeBoss({ ...full, meat: 0 }), D1, ctx)?.recipeId).toBe('honey_pie');
    expect(kitchenAdvice(beforeBoss({ apple: 3 }), D1, ctx)).toEqual({ recipeId: 'apple_juice', reason: 'best' });
  });

  it('обычный день — блюдо попроще, Пир бережём (saving); сегодня уже готовили или нечего готовить — совета нет', () => {
    const s = rich(openSave({ kitchen: { pantry: full } }));
    expect(kitchenSituation(s, ctx)).toBeNull();
    const a = kitchenAdvice(s, D1, ctx)!;
    expect(a).toEqual({ recipeId: 'roast_meat', reason: 'best', saving: 'feast' });
    expect(R(a.recipeId).goodFor?.includes('boss')).toBeFalsy();
    // Доступно только блюдо для босса — советуем его (лучше, чем ничего).
    expect(kitchenAdvice(rich(openSave({ kitchen: { pantry: { honey: 2, apple: 2, milk: 1 } } })), D1, ctx)).toEqual({ recipeId: 'honey_pie', reason: 'best' });
    expect(kitchenAdvice(cookMeal(s, D1, 'roast_meat', kctx), D1, ctx)).toBeNull();
    // Ни на что не хватает и купить не на что (нет золота или лимит дня исчерпан) — совета нет.
    const empty = rich(openSave({ kitchen: { pantry: {} } }));
    expect(kitchenAdvice({ ...empty, resources: { ...empty.resources, gold: 0 } }, D1, ctx)).toBeNull();
    expect(kitchenAdvice({ ...empty, kitchen: { pantry: {}, bought: { day: D1, count: cfg.shop.dailyLimit } } }, D1, ctx)).toBeNull();
  });

  it('ни на что не хватает — совет докупить недостающее к самому дешёвому блюду (к боссу — к блюду для босса)', () => {
    const empty = rich(openSave({ kitchen: { pantry: {} } }));
    const price = (id: string) => kitchenStatus(empty, D1, kctx).pantry.find((p) => p.id === id)!.priceNow;
    const a = kitchenAdvice(empty, D1, ctx)!;
    expect(a.reason).toBe('buy');
    expect(a.recipeId).toBe('apple_juice');
    expect(a.buy).toEqual(R('apple_juice').cost);
    expect(a.gold).toBe(3 * price('apple'));
    // Купили, что советовали, — теперь совет приготовить.
    let s = empty;
    for (const [id, n] of Object.entries(a.buy!)) s = buyIngredient(s, D1, id, kctx, n);
    expect(kitchenAdvice(s, D1, ctx)?.recipeId).toBe('apple_juice');
    expect(kitchenAdvice(s, D1, ctx)?.reason).toBe('best');
    // Впереди босс: докупить к Медовому пирогу (не хватает одного молока), а не сок.
    const boss = beforeBoss({ honey: 2, apple: 2 });
    expect(kitchenAdvice(boss, D1, ctx)).toEqual({ recipeId: 'honey_pie', reason: 'buy', buy: { milk: 1 }, gold: price('milk') });
    // В списке рецептов совет «докупить» — первым.
    expect(sortRecipes(kitchenStatus(empty, D1, kctx).recipes, a)[0].id).toBe('apple_juice');
  });

  it('героям не хватает опыта, а золото есть — каша на опыт; нет и золота — обычный совет', () => {
    const s = openSave({ kitchen: { pantry: full } });
    const poor = { ...s, resources: { ...s.resources, heroExp: 0, gold: 10_000_000 } };
    expect(kitchenSituation(poor, ctx)).toEqual({ situation: 'level' });
    expect(kitchenAdvice(poor, D1, ctx)).toEqual({ recipeId: 'milk_porridge', reason: 'level' });
    const broke = { ...s, resources: { ...s.resources, heroExp: 0, gold: 0 } };
    expect(kitchenSituation(broke, ctx)).toBeNull();
  });

  it('порядок рецептов: блюдо дня, совет, доступные (сильнее — выше), остальные', () => {
    const s = rich(openSave({ kitchen: { pantry: { meat: 3, honey: 1, apple: 3, carrot: 3, milk: 1 } } }));
    const st = kitchenStatus(s, D1, kctx);
    const advice = kitchenAdvice(s, D1, ctx);
    const order = sortRecipes(st.recipes, advice);
    expect(order).toHaveLength(cfg.recipes.length);
    expect(order[0].id).toBe(advice!.recipeId);
    const ok = order.filter((r) => r.affordable).length;
    expect(order.slice(0, ok).every((r) => r.affordable)).toBe(true);
    for (let i = 2; i < ok; i++) expect(recipeScore(order[i - 1].buff)).toBeGreaterThanOrEqual(recipeScore(order[i].buff));
    const cooked = cookMeal(s, D1, 'apple_juice', kctx);
    expect(sortRecipes(kitchenStatus(cooked, D1, kctx).recipes, kitchenAdvice(cooked, D1, ctx))[0].id).toBe('apple_juice');
  });
});
