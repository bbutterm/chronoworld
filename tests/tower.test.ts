import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  actClimbTower,
  climbTower,
  GameRuleError,
  newGame,
  parseTowerConfig,
  simulateBattle,
  TowerError,
  towerFloor,
  towerStatus,
  validateTower,
  withTower,
  type SaveState,
  type TowerConfig,
  type TowerContext,
} from '../src/core';
import { loadGameContext } from '../scripts/lib/content-node';

const root = join(import.meta.dirname, '..');
const towerJson = JSON.parse(readFileSync(join(root, 'data/tower.json'), 'utf8'));
const ctx: TowerContext = withTower(loadGameContext(), towerJson);
const D1 = '2026-09-26';

/** Контекст с подкрученной силой врагов: 0.01 — гарантированная победа, 1000 — поражение. */
const withMult = (baseMult: number, patch: Partial<TowerConfig> = {}): TowerContext => ({ ...ctx, tower: { ...ctx.tower, baseMult, ...patch } });
const easy = withMult(0.01);
const hard = withMult(1000);

function unlocked(floor = 0): SaveState {
  const s = newGame(ctx, 0, D1);
  return { ...s, campaign: { cleared: ctx.content.stages.slice(0, 5).map((x) => x.id) }, tower: { floor } };
}

function expectTowerError(fn: () => unknown, code: TowerError['code']) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(TowerError);
    expect((e as TowerError).code).toBe(code);
    return;
  }
  throw new Error(`ожидалась TowerError ${code}`);
}

describe('K4 башня: конфиг', () => {
  it('data/tower.json проходит схему и перекрёстные проверки', () => {
    const problems: string[] = [];
    validateTower(ctx.tower, ctx.content, problems);
    expect(problems).toEqual([]);
    expect(ctx.tower.unlockAfterStage).toBe('ch1_s5');
  });

  it('ошибки схемы и ссылок → invalid_config', () => {
    expectTowerError(() => parseTowerConfig({ ...towerJson, maxFloor: 0 }), 'invalid_config');
    expectTowerError(() => parseTowerConfig({ ...towerJson, bands: [{ ...towerJson.bands[1] }] }), 'invalid_config');
    const band = towerJson.bands[0];
    const bad = (b: object, extra: object = {}) => ({ ...towerJson, ...extra, bands: [{ ...band, ...b }] });
    expectTowerError(() => withTower(loadGameContext(), bad({ layouts: [[{ unit: 'nope' }, null, null, null, null]] })), 'invalid_config');
    expectTowerError(() => withTower(loadGameContext(), bad({ layouts: [[{ unit: 'archer' }, null, null, null, null]] })), 'invalid_config');
    expectTowerError(() => withTower(loadGameContext(), bad({ bossLayouts: [[{ unit: 'mob_melee' }, null, null, null, null]] })), 'invalid_config');
    expectTowerError(() => withTower(loadGameContext(), bad({}, { unlockAfterStage: 'nope' })), 'invalid_config');
    expectTowerError(() => parseTowerConfig(bad({ layouts: [[null, null, null, null, null]] })), 'invalid_config');
  });
});

describe('K4 башня: этажи', () => {
  it('детерминированы и строятся для всех этажей', () => {
    for (let n = 1; n <= ctx.tower.maxFloor; n++) {
      const f = towerFloor(n, ctx);
      expect(towerFloor(n, ctx)).toEqual(f);
      expect(f.floor).toBe(n);
      expect(f.enemies).toHaveLength(5);
      const ids = f.enemies.filter((e) => e !== null).map((e) => e!.id);
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((id) => id.startsWith(`tower_f${n}_`))).toBe(true);
    }
  });

  it('босс каждый 5-й этаж: флаг, юнит kind boss, гемы и повышенная награда', () => {
    for (let n = 1; n <= ctx.tower.maxFloor; n++) {
      const f = towerFloor(n, ctx);
      const isBoss = n % 5 === 0;
      expect(f.boss).toBe(isBoss);
      expect(f.enemies.some((e) => e?.kind === 'boss')).toBe(isBoss);
      expect(f.rewards.gems > 0).toBe(isBoss);
    }
    const r4 = towerFloor(4, ctx).rewards;
    const r5 = towerFloor(5, ctx).rewards;
    expect(r5.gold).toBeGreaterThan(r4.gold);
    expect(r5.jobExp).toBeGreaterThan(r4.jobExp);
    expect(r5.gems).toBe(ctx.tower.rewards.bossGems);
  });

  it('сила и награды растут с этажом', () => {
    // Один и тот же состав через layouts.length этажей — статы выше.
    const f1 = towerFloor(1, ctx);
    const f9 = towerFloor(9, ctx); // полоса 1, 4 состава: 1 и 9 — один состав
    expect(f9.enemies.map((e) => e?.stats.hp ?? 0).every((hp, i) => hp >= (f1.enemies[i]?.stats.hp ?? 0))).toBe(true);
    expect(f9.enemies[0]!.stats.hp).toBeGreaterThan(f1.enemies[0]!.stats.hp);
    const g = 1.4 * Math.pow(1.04, 8);
    expect(f9.enemies[0]!.stats.atk).toBe(Math.round(ctx.content.units.mob_melee.stats.atk * g));
    expect(f9.enemies[0]!.stats.spd).toBe(ctx.content.units.mob_melee.stats.spd);
    let prev = towerFloor(1, ctx).rewards;
    for (let n = 2; n <= ctx.tower.maxFloor; n++) {
      if (n % 5 === 0) continue;
      const r = towerFloor(n, ctx).rewards;
      expect(r.gold).toBeGreaterThanOrEqual(prev.gold);
      expect(r.jobExp).toBeGreaterThanOrEqual(prev.jobExp);
      prev = r;
    }
  });

  it('полосы меняют пул врагов', () => {
    expect(towerFloor(1, ctx).band).toBe(0);
    expect(towerFloor(20, ctx).band).toBe(1);
    expect(towerFloor(20, ctx).enemies.some((e) => e?.name === ctx.content.units.mob_boss2.name)).toBe(true);
    expect(towerFloor(41, ctx).band).toBe(2);
    expect(towerFloor(40, ctx).enemies.some((e) => e?.visual.sprite === 'boss3')).toBe(true);
    expect(towerFloor(45, ctx).enemies.filter((e) => e?.kind === 'boss')).toHaveLength(2);
  });

  it('неверный номер этажа → invalid_floor', () => {
    expectTowerError(() => towerFloor(0, ctx), 'invalid_floor');
    expectTowerError(() => towerFloor(1.5, ctx), 'invalid_floor');
    expectTowerError(() => towerFloor(ctx.tower.maxFloor + 1, ctx), 'invalid_floor');
  });

  it('бой на каждом этаже проходит без ошибок', () => {
    const squad = newGame(ctx, 0).squad.map(() => 'archer');
    for (let n = 1; n <= ctx.tower.maxFloor; n += 3) {
      const r = simulateBattle(ctx.content, squad, towerFloor(n, ctx).enemies, n, { log: false, combat: ctx.combat });
      expect(['A', 'B']).toContain(r.winner);
    }
  });
});

describe('K4 башня: штурм', () => {
  it('закрыта до unlockAfterStage; null — открыта сразу', () => {
    const s = newGame(ctx, 0, D1);
    expect(towerStatus(s, ctx)).toMatchObject({ unlocked: false, floor: 0, next: 1, unlockAfterStage: 'ch1_s5' });
    expectTowerError(() => climbTower(s, 1, ctx), 'tower_locked');
    expect(towerStatus(unlocked(), ctx).unlocked).toBe(true);
    const open = withMult(0.01, { unlockAfterStage: null });
    expect(climbTower(s, 1, open).save.tower.floor).toBe(1);
  });

  it('победа: этаж + 1, золото, опыт отряду, события; исходный save не меняется', () => {
    const s = unlocked();
    const before = JSON.stringify(s);
    const out = climbTower(s, 7, easy);
    expect(out.result.winner).toBe('A');
    expect(out.floor).toBe(1);
    expect(JSON.stringify(s)).toBe(before);
    const r = towerFloor(1, easy).rewards;
    expect(out.save.tower.floor).toBe(1);
    expect(out.save.battleSeq).toBe(1);
    expect(out.save.resources.gold).toBe(s.resources.gold + r.gold);
    expect(out.save.currency.gems).toBe(0);
    expect(out.events).toContainEqual({ type: 'towerFloorCleared', floor: 1, boss: false });
    expect(out.events).toContainEqual({ type: 'rewards', gold: r.gold, jobExp: r.jobExp, heroIds: ['h1', 'h2', 'h3', 'h4', 'h5'] });
    for (const h of out.save.heroes) {
      const old = s.heroes.find((x) => x.id === h.id)!;
      expect(h.jobLevel > old.jobLevel || h.jobExp > old.jobExp).toBe(true);
    }
  });

  it('босс-этаж даёт гемы', () => {
    const s = unlocked(4);
    const out = climbTower(s, 3, easy);
    expect(out.save.tower.floor).toBe(5);
    expect(out.save.currency.gems).toBe(ctx.tower.rewards.bossGems);
    expect(out.events).toContainEqual({ type: 'gems', amount: ctx.tower.rewards.bossGems });
    expect(out.events).toContainEqual({ type: 'towerFloorCleared', floor: 5, boss: true });
  });

  it('поражение: только battleSeq', () => {
    const s = unlocked(2);
    const out = climbTower(s, 1, hard);
    expect(out.result.winner).toBe('B');
    expect(out.floor).toBe(3);
    expect(out.events).toEqual([]);
    expect(out.save).toEqual({ ...s, battleSeq: s.battleSeq + 1 });
  });

  it('детерминирован: тот же seed — тот же итог', () => {
    const s = unlocked(10);
    const a = climbTower(s, 42, ctx);
    const b = climbTower(s, 42, ctx);
    expect(b).toEqual(a);
  });

  it('вершина, пустой отряд, неизвестный герой', () => {
    expectTowerError(() => climbTower(unlocked(ctx.tower.maxFloor), 1, ctx), 'tower_completed');
    expect(towerStatus(unlocked(ctx.tower.maxFloor), ctx).next).toBeNull();
    const empty = { ...unlocked(), squad: [null, null, null, null, null] };
    expect(() => climbTower(empty, 1, ctx)).toThrow(GameRuleError);
    const ghost = { ...unlocked(), squad: ['ghost', null, null, null, null] };
    expect(() => climbTower(ghost, 1, ctx)).toThrow(GameRuleError);
  });

  it('actClimbTower засчитывает tower_attempt и при победе, и при поражении', () => {
    const win = actClimbTower(unlocked(), D1, 7, easy);
    expect(win.save.daily.quests.tower_attempt).toBe(1);
    expect(win.save.tower.floor).toBe(1);
    const loss = actClimbTower(unlocked(), D1, 7, hard);
    expect(loss.save.daily.quests).toEqual({ tower_attempt: 1 });
    expect(loss.save.tower.floor).toBe(0);
    expectTowerError(() => actClimbTower(newGame(ctx, 0, D1), D1, 1, ctx), 'tower_locked');
  });
});
