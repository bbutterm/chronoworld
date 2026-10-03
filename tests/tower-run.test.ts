import { describe, expect, it } from 'vitest';
import {
  abandonTowerRun,
  blessingBattle,
  buyTowerUpgrade,
  chooseTowerPath,
  deserialize,
  enemySquad,
  familyStates,
  fightTowerFloor,
  newGame,
  pickTowerBlessing,
  rerollTowerBlessing,
  resolveTowerEvent,
  runConfig,
  runEffects,
  serialize,
  simulateBattle,
  startTowerRun,
  towerEventDef,
  TowerError,
  towerRunSquad,
  towerRunStatus,
  validateTower,
  type BattleEvent,
  type FullContext,
  type SaveState,
  type SourcedEffect,
  type TowerRun,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { autoRun, playerSave, tierFloors, TOWER_SQUADS } from '../scripts/balance-tower';

const ctx = loadFullContext();
const cfg = runConfig(ctx);
const DAY = '2026-10-01';

/** Контекст с силой врагов забега × m (0.01 — лёгкие победы, 1000 — поражение). */
function withMult(m: number): FullContext {
  return { ...ctx, tower: { ...ctx.tower, run: { ...cfg, tierMult: cfg.tierMult.map(() => m) } } };
}
const easy = withMult(0.01);
const hard = withMult(1000);

const player = (tier = 3, salt = 1) => playerSave(ctx, tier, TOWER_SQUADS[0], salt);
const run = (s: SaveState): TowerRun => s.tower.run!;

function expectCode(fn: () => unknown, code: TowerError['code']) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(TowerError);
    expect((e as TowerError).code).toBe(code);
    return;
  }
  throw new Error(`ожидалась TowerError ${code}`);
}

/** Выбрать первый путь-бой и сразиться. */
function fightNext(s: SaveState, c: FullContext) {
  const r = run(s);
  if (!r.node) s = chooseTowerPath(s, Math.max(0, r.paths.findIndex((k) => k === 'battle' || k === 'elite' || k === 'boss')), c);
  return fightTowerFloor(s, DAY, c);
}

/** Пропустить выбор карты/событие (для теста хода забега). */
function clearPending(s: SaveState): SaveState {
  const r = run(s);
  if (r.pending?.kind === 'blessing') return pickTowerBlessing(s, r.pending.options[0], ctx).save;
  if (r.pending?.kind === 'event') return resolveTowerEvent(s, 0, ctx).save;
  return s;
}

describe('Башня-рогалик: данные', () => {
  it('data/tower.json: раздел run проходит схему и перекрёстные проверки', () => {
    const problems: string[] = [];
    validateTower(ctx.tower, ctx.content, problems);
    expect(problems).toEqual([]);
    expect(cfg.blessings.length).toBeGreaterThanOrEqual(24);
    expect(cfg.blessings.length).toBeLessThanOrEqual(30);
    for (const r of ['common', 'rare', 'legendary']) expect(cfg.blessings.filter((b) => b.rarity === r).length).toBeGreaterThanOrEqual(5);
    // Вид карты даёт бонус только если карт этого вида хотя бы need.
    for (const f of cfg.families) expect(cfg.blessings.filter((b) => b.family === f.id).length).toBeGreaterThanOrEqual(f.need);
    expect(cfg.upgrades.length).toBeGreaterThanOrEqual(5);
    expect(cfg.upgrades.length).toBeLessThanOrEqual(8);
  });

  it('вид карт: две карты одного вида включают бонус', () => {
    const guard = cfg.blessings.filter((b) => b.family === 'guard').map((b) => b.id);
    expect(familyStates(guard.slice(0, 1), cfg).find((f) => f.family.id === 'guard')!.active).toBe(false);
    expect(familyStates(guard.slice(0, 2), cfg).find((f) => f.family.id === 'guard')!.active).toBe(true);
    expect(runEffects(guard.slice(0, 2), cfg).some((e) => e.card === 'family_guard')).toBe(true);
  });
});

describe('Башня-рогалик: благословения в бою', () => {
  const s = player();
  const hs = startTowerRun(s, s.squad, ctx);
  const { squad } = towerRunSquad(hs, ctx);
  // Враги этапа 3-5 с запасом силы — бой длится, карты успевают сработать.
  const enemies = enemySquad('ch3_s5', ctx).map((u) => (u ? { ...u, stats: { ...u.stats, hp: u.stats.hp * 2, atk: Math.round(u.stats.atk * 1.5) } } : null));
  const fight = (effects: SourcedEffect[], hp: Record<string, number> = {}, seed = 7) => {
    const bb = blessingBattle(effects, hp)!;
    return { r: simulateBattle(ctx.content, squad, enemies, seed, { combat: ctx.combat, hooks: bb.hooks }), end: bb.endHp() };
  };
  const eff = (id: string): SourcedEffect[] => runEffects([id], cfg);

  it('без карт и ран бой — прежний лог (хуки ничего не меняют)', () => {
    for (const seed of [1, 7, 42]) {
      const plain = simulateBattle(ctx.content, squad, enemies, seed, { combat: ctx.combat });
      const hooked = fight([], {}, seed).r;
      expect(JSON.stringify(hooked)).toBe(JSON.stringify(plain));
    }
  });

  it('раны переходят в бой: снимок и ОЗ после боя', () => {
    const hp = Object.fromEntries(squad.filter(Boolean).map((u) => [u!.id, 400]));
    const { r, end } = fight([], hp);
    for (const u of r.units.filter((x) => x.side === 'A')) expect(u.hp).toBe(Math.round(u.maxHp * 0.4));
    for (const [id, v] of Object.entries(end)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1000);
      expect(r.report[r.units.find((u) => u.unitId === id)!.uid].alive).toBe(v > 0);
    }
  });

  it('каждая карта отрабатывает без ошибок, лог целостный', () => {
    for (const b of cfg.blessings) {
      const { r } = fight(eff(b.id), {}, 11);
      for (const e of r.log) {
        if (e.type === 'damage' || e.type === 'heal') {
          const snap = [...r.units, ...(r.spawned ?? [])].find((u) => u.uid === e.target)!;
          expect(e.hp, `${b.id}: ОЗ в пределах`).toBeGreaterThanOrEqual(0);
          expect(e.hp).toBeLessThanOrEqual(snap.maxHp);
        }
      }
      expect(r.log.at(-1)!.type).toBe('end');
    }
  });

  it('Пупа: щит каждому герою в начале боя; Шёпот: первый удар по герою — промах', () => {
    const { r } = fight(eff('pupa'));
    const shields = r.log.filter((e) => e.t === 0 && e.type === 'buff');
    expect(shields.length).toBe(squad.filter(Boolean).length);
    const w = fight(eff('whisper')).r;
    for (const u of w.units.filter((x) => x.side === 'A')) {
      const first = w.log.find((e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.target === u.uid && w.units.find((x) => x.uid === e.source)?.side === 'B');
      if (first) expect(first.amount).toBe(0);
    }
  });

  it('Поринг: «Крит!» по каждому врагу не больше одного раза', () => {
    const { r } = fight(eff('poring'));
    const crits = r.log.filter((e) => e.type === 'bless' && e.text === 'Крит!').map((e) => (e as { unit: string }).unit);
    expect(crits.length).toBeGreaterThan(0);
    expect(new Set(crits).size).toBe(crits.length);
  });

  it('Осирис: павший раз за бой встаёт (против сильного врага)', () => {
    const strong = enemies.map((u) => (u ? { ...u, stats: { ...u.stats, hp: u.stats.hp * 6, atk: u.stats.atk * 6 } } : null));
    const bb = blessingBattle(eff('osiris'))!;
    const r = simulateBattle(ctx.content, squad, strong, 3, { combat: ctx.combat, hooks: bb.hooks });
    expect(r.log.filter((e) => e.type === 'bless' && e.text === 'Встаёт!').length).toBe(1);
  });

  it('Девиручи: сила растёт, ОЗ в начале ниже', () => {
    const base = fight([]).r;
    const dev = fight(eff('deviruchi')).r;
    const dealt = (r: typeof base) => Object.values(r.report).filter((x) => x.uid.startsWith('A')).reduce((s, x) => s + x.damageDealt, 0) / r.duration;
    expect(dealt(dev)).toBeGreaterThan(dealt(base));
    expect(dev.units.filter((u) => u.side === 'A').every((u) => (u.hp ?? u.maxHp) < u.maxHp)).toBe(true);
  });
});

describe('Башня-рогалик: ход забега', () => {
  it('старт: отряд, полные ОЗ, первый этаж — бой; второй забег поверх — ошибка', () => {
    const s = startTowerRun(player(), player().squad, ctx);
    expect(run(s).floor).toBe(0);
    expect(run(s).paths).toEqual(['battle']);
    expect(Object.values(run(s).hp).every((v) => v === 1000)).toBe(true);
    expect(s.tower.runs).toBe(1);
    expectCode(() => startTowerRun(s, s.squad, ctx), 'run_active');
    expectCode(() => fightTowerFloor(s, DAY, ctx), 'bad_choice');
  });

  it('закрытая башня и пустой отряд — ошибки', () => {
    const fresh = newGame(ctx, 0, DAY);
    expectCode(() => startTowerRun(fresh, [], ctx), 'tower_locked');
    expectCode(() => startTowerRun(player(), [null, null, null, null, null], ctx), 'bad_choice');
  });

  it('победы: этажи, осколки, карта каждые 3 этажа, развилка из двух путей, рекорд', () => {
    let s = startTowerRun(player(), player().squad, easy);
    const out = fightNext(s, easy);
    s = out.save;
    expect(out.result.winner).toBe('A');
    expect(run(s).floor).toBe(1);
    expect(run(s).shards).toBe(cfg.shards.floor);
    expect(s.tower.floor).toBe(1);
    expect(s.currency.gems).toBe(player().currency.gems + cfg.record.gemsPerFloor);
    expect(run(s).paths.length).toBe(2);
    while (run(s).floor < 3) {
      s = clearPending(s);
      const r = run(s);
      const idx = r.paths.findIndex((k) => k === 'battle' || k === 'elite');
      if (idx < 0) s = chooseTowerPath(s, 0, easy);
      else s = fightNext(chooseTowerPath(s, idx, easy), easy).save;
    }
    // После 3-го этажа (или элиты раньше) — выбор карты.
    expect(run(s).pending?.kind === 'blessing' || run(s).cards.length > 0).toBe(true);
  });

  it('поражение заканчивает забег: осколки в копилку, добыча раз в день за новые этажи', () => {
    let s = startTowerRun(player(), player().squad, easy);
    s = fightNext(s, easy).save;
    s = clearPending(s);
    s = chooseTowerPath(s, run(s).paths.findIndex((k) => k === 'battle' || k === 'elite') >= 0 ? run(s).paths.findIndex((k) => k === 'battle' || k === 'elite') : 0, easy);
    s = clearPending(s);
    if (!run(s).node) s = chooseTowerPath(s, 0, hard);
    const gold0 = s.resources.gold;
    const floor = run(s).floor;
    // Сила теперь зафиксирована в забеге: для сценария поражения меняем именно снимок.
    s = { ...s, tower: { ...s.tower, run: { ...run(s), enemyMult: 1000 } } };
    const out = fightTowerFloor(s, DAY, hard);
    expect(out.result.winner).toBe('B');
    expect(out.ended).toBeTruthy();
    expect(out.save.tower.run).toBeUndefined();
    expect(out.save.tower.last!.floor).toBe(floor);
    expect(out.save.tower.shards).toBe(out.ended!.shards);
    expect(out.save.resources.gold - gold0).toBe(floor * run(s).loot.gold);
    expect(out.save.tower.lootDay).toBe(DAY);
    // Второй забег того же дня: этажи не выше оплаченных — без добычи.
    let s2 = startTowerRun(out.save, out.save.squad, easy);
    s2 = fightNext(s2, easy).save;
    const end = abandonTowerRun(s2, DAY, easy);
    expect(end.summary.gold).toBe(floor >= 1 ? 0 : run(s2).loot.gold);
    // Новый день — снова с добычей.
    const s3 = fightNext(startTowerRun(end.save, end.save.squad, easy), easy).save;
    expect(abandonTowerRun(s3, '2026-10-02', easy).summary.gold).toBe(run(s3).loot.gold);
  });

  it('павший выбывает до конца забега, раны переходят', () => {
    const mid = withMult(cfg.tierMult[2] * 0.5);
    let found = false;
    for (let salt = 1; salt < 8 && !found; salt++) {
      let s = startTowerRun(player(3, salt), player(3, salt).squad, mid);
      const r0 = run(s);
      const tank = r0.squad[0]!;
      // Все, кроме первого, — на последнем издыхании (1% ОЗ): кто-то падает, первый (полный) тащит бой.
      s = { ...s, tower: { ...s.tower, run: { ...r0, hp: Object.fromEntries(Object.keys(r0.hp).map((id) => [id, id === tank ? 1000 : 10])) } } };
      const out = fightNext(s, mid);
      if (out.result.winner !== 'A') continue;
      const r = run(out.save);
      if (!r.fallen.length) continue;
      found = true;
      for (const id of r.fallen) {
        expect(r.squad).not.toContain(id);
        expect(r.hp[id]).toBeUndefined();
        expect(towerRunStatus(out.save, ctx).heroes.find((h) => h.id === id)!.fallen).toBe(true);
      }
      // Раны выживших переходят: не больше «было + лечение после боя».
      for (const id of r.squad) if (id && id !== tank) expect(r.hp[id]).toBeLessThanOrEqual(1000);
    }
    expect(found).toBe(true);
  });

  it('детерминизм: тот же забег — тот же итог', () => {
    const a = autoRun(ctx, player(3, 5));
    const b = autoRun(ctx, player(3, 5));
    expect(a.floor).toBe(b.floor);
    expect(a.cards).toEqual(b.cards);
    expect(serialize(a.save)).toBe(serialize(b.save));
  });

  it('карты с немедленным эффектом: Осирис поднимает павших, Волк приводит героя из запаса', () => {
    const base = player();
    const extra = { ...base, heroes: [...base.heroes, { id: 'reserve1', templateId: 'otto', rarity: 'blue' as const, level: 35 }] };
    let s = startTowerRun(extra, [extra.squad[0], extra.squad[1], null, null, null], ctx);
    const r = run(s);
    s = { ...s, tower: { ...s.tower, run: { ...r, squad: [r.squad[0], null, null, null, null], fallen: [r.squad[1]!], hp: { [r.squad[0]!]: 1000 }, pending: { kind: 'blessing', options: ['osiris', 'wolf'], source: 'floor', rolls: 0 } } } };
    const o = pickTowerBlessing(s, 'osiris', ctx).save;
    expect(run(o).fallen).toEqual([]);
    expect(run(o).hp[r.squad[1]!]).toBe(500);
    const w = pickTowerBlessing(s, 'wolf', ctx).save;
    const joined = run(w).squad.filter((x) => x && x !== r.squad[0]);
    expect(joined.length).toBe(1);
    expect(run(w).hp[joined[0]!]).toBe(1000);
    expect(joined[0]).not.toBe(r.squad[1]);
  });

  it('события: каждый доступный вариант разрешается', () => {
    const s0 = fightNext(startTowerRun(player(), player().squad, easy), easy).save;
    for (const ev of cfg.events) {
      ev.options.forEach((_, i) => {
        const r = run(s0);
        const s = { ...s0, tower: { ...s0.tower, run: { ...r, shards: 10, cards: ['pupa'], pending: { kind: 'event' as const, event: ev.id } } } };
        expect(towerEventDef(s, ctx)!.id).toBe(ev.id);
        const opt = ev.options[i];
        if (opt.requires?.fallen) {
          expectCode(() => resolveTowerEvent(s, i, ctx), 'bad_choice');
          return;
        }
        const out = resolveTowerEvent(s, i, ctx);
        expect(run(out.save).floor).toBe(r.floor + 1);
        expect(out.text.length).toBeGreaterThan(0);
      });
    }
  });
});

describe('Башня-рогалик: QA 01.10', () => {
  it('BUG-197: событие не повторяется в забеге; Писарь (обмен карты) — только при картах', () => {
    const s0 = fightNext(startTowerRun(player(), player().squad, easy), easy).save;
    const base = run(s0);
    const scribe = cfg.events.filter((e) => e.options.some((o) => o.requires?.cards)).map((e) => e.id);
    expect(scribe.length).toBeGreaterThan(0);
    for (let floor = 1; floor <= 40; floor++) {
      // Без карт: события по очереди, без повторов, пока есть новые; Писаря нет.
      let s: SaveState = { ...s0, tower: { ...s0.tower, run: { ...base, floor, cards: [], pending: undefined, node: undefined, paths: ['event'], seenEvents: [] } } };
      const got: string[] = [];
      const fits = cfg.events.length - scribe.length;
      for (let k = 0; k < fits; k++) {
        s = chooseTowerPath(s, 0, easy);
        const ev = run(s).pending;
        expect(ev?.kind).toBe('event');
        const id = ev?.kind === 'event' ? ev.event : '';
        expect(scribe).not.toContain(id);
        expect(got).not.toContain(id);
        got.push(id);
        s = { ...s, tower: { ...s.tower, run: { ...run(s), pending: undefined, paths: ['event'] } } };
      }
    }
  });

  it('BUG-196: забег кончился на событии выше рекорда — рекорд и итог в одних единицах, причина конца записана', () => {
    const s0 = fightNext(startTowerRun(player(), player().squad, easy), easy).save;
    const r = run(s0);
    const best = s0.tower.floor;
    const s = { ...s0, tower: { ...s0.tower, run: { ...r, floor: best + 2, pending: undefined } } };
    const out = abandonTowerRun(s, DAY, easy);
    expect(out.summary.record).toBe(true);
    expect(out.summary.end).toBe('surrender');
    expect(out.save.tower.floor).toBe(best + 2);
    expect(towerRunStatus(out.save, easy, DAY).best).toBe(out.summary.floor);
    const lost = fightTowerFloor(chooseTowerPath(startTowerRun(player(), player().squad, hard), 0, hard), DAY, hard);
    if (lost.ended) expect(lost.ended.end).toBe('defeat');
  });
});

describe('Башня-рогалик: постоянный прогресс и сохранения', () => {
  it('улучшения: цена, нехватка осколков, максимум; «Дар Башни» и «Широкий выбор»', () => {
    const s = { ...player(), tower: { ...player().tower, shards: 100 } };
    expectCode(() => buyTowerUpgrade(player(), 'start_card', ctx), 'not_enough_shards');
    let t = buyTowerUpgrade(s, 'start_card', ctx);
    expect(t.tower.shards).toBe(100 - cfg.upgrades.find((u) => u.id === 'start_card')!.costs[0]);
    t = buyTowerUpgrade(t, 'wide_choice', ctx);
    expectCode(() => buyTowerUpgrade(t, 'wide_choice', ctx), 'max_level');
    const started = startTowerRun(t, t.squad, ctx);
    const p = run(started).pending;
    expect(p?.kind).toBe('blessing');
    expect(p?.kind === 'blessing' && p.options.length).toBe(cfg.choices + 1);
    // «Перетасовка»: без уровня — нельзя.
    expectCode(() => rerollTowerBlessing(started, ctx), 'bad_choice');
    const sh = startTowerRun(buyTowerUpgrade(t, 'shuffle', ctx), t.squad, ctx);
    const re = rerollTowerBlessing(sh, ctx);
    expect(run(re).rerolls).toBe(0);
  });

  it('старое сохранение башни (только floor) читается: этаж становится рекордом', () => {
    const old = JSON.parse(serialize(player()));
    old.tower = { floor: 37 };
    const s = deserialize(JSON.stringify(old));
    expect(s.tower).toEqual({ floor: 37 });
    const st = towerRunStatus(s, ctx);
    expect(st.best).toBe(37);
    expect(st.run).toBeNull();
    // Рекордные гемы — только за этажи выше 37.
    const f = fightNext(startTowerRun(s, s.squad, easy), easy);
    expect(f.save.currency.gems).toBe(s.currency.gems);
    expect(f.save.tower.floor).toBe(37);
  });

  it('забег в сохранении переживает serialize → deserialize', () => {
    let s = startTowerRun(player(), player().squad, easy);
    s = fightNext(s, easy).save;
    const back = deserialize(serialize(s));
    expect(back.tower).toEqual(s.tower);
    expect(serialize(back)).toBe(serialize(s));
  });
});

describe('Башня-рогалик: баланс (авто-забег эталонов)', () => {
  it('ступень 3 (середина главы 3): с картами этаж 8–15 и заметно выше, чем без', () => {
    const w = tierFloors(ctx, 3, 2, true);
    const wo = tierFloors(ctx, 3, 2, false);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(w)).toBeGreaterThanOrEqual(8);
    expect(mean(w)).toBeLessThanOrEqual(15);
    expect(mean(w)).toBeGreaterThan(mean(wo) * 1.2);
  });
});
