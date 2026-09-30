/**
 * Профили поведения, шаги 2–3 (docs/design/battle-behavior.md): страж (провокация, перехват), крестоносец (связь),
 * фазы боссов со свитой, ярость всех после 60 с. Шаг 1 и каркас — tests/behavior.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { buildUnit, simulateBattle, type BattleEvent, type BattleResult } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { compSquad } from './behavior-scenarios';
import { SMOOTH_SQUADS, smoothSquads } from '../scripts/lib/player-model';

const ctx = loadFullContext();
const SQ = smoothSquads(ctx, 45, SMOOTH_SQUADS);
const moves = (r: BattleResult, uid: string) => r.log.filter((e): e is Extract<BattleEvent, { type: 'move' }> => e.type === 'move' && e.unit === uid);

/** Отряд героев: templateId/ветка, фиолетовые level. */
const heroes = (ids: string[], level = 60) =>
  ids.map((id, i) => {
    const [templateId, branch] = id.split('/');
    return buildUnit({ id: `h${i}`, templateId, rarity: 'purple', level, ...(branch ? { branch } : {}) }, ctx);
  });

describe('шаг 2: страж и крестоносец', () => {
  it('провокация: спровоцированный бьёт одиночными только стража, пока статус висит', () => {
    const squad = heroes(['alan/knight', 'iris/knight', 'bran', 'kai', 'vika/priest']);
    let taunts = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const r = simulateBattle(ctx.content, squad, compSquad(ctx, 'ch4_s10'), seed, { combat: ctx.combat });
      const on = new Map<string, string>();
      for (const e of r.log) {
        if (e.type === 'status' && e.taunt && e.action === 'apply') {
          taunts++;
          on.set(e.target, e.source);
        }
        if (e.type === 'status' && e.action === 'expire' && e.status === 'provoke') on.delete(e.target);
        if (e.type === 'death') on.delete(e.unit);
        if (e.type === 'attack' && on.has(e.unit) && e.targets.length === 1) {
          const skill = ctx.content.skills[e.skill];
          if (skill.target.pick !== 'all' && skill.target.side === 'enemy') expect(e.targets, `${seed} t=${e.t} ${e.unit}`).toEqual([on.get(e.unit)]);
        }
      }
    }
    expect(taunts).toBeGreaterThan(0);
  });

  it('перехват: прыгнувшего к нашему тылу встречает страж рывком, не чаще перезарядки', () => {
    // Вика-монахиня (страж) и Алан-рыцарь против ассасинов (юнит assassin — прыгает в тыл и остаётся там).
    const squad = heroes(['alan/knight', 'vika/monk', 'bran', 'kai', 'lira'], 1);
    const cd = ctx.combat.behaviors!.guard.intercept!.cooldown;
    let n = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const r = simulateBattle(ctx.content, squad, ['guard', 'assassin', 'assassin', 'assassin', 'archer'], seed, { combat: ctx.combat });
      for (const u of ['A0', 'A1']) {
        const ic = moves(r, u).filter((m) => m.reason === 'intercept');
        n += ic.length;
        for (let j = 1; j < ic.length; j++) expect(ic[j].t - ic[j - 1].t).toBeGreaterThanOrEqual(cd - 1e-9);
        for (const m of ic) expect(m.kind).toBe('dash');
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  it('связь крестоносца: доля урона по союзнику — защитнику, без цепочек', () => {
    const squad = heroes(['alan/crusader', 'iris/knight', 'bran', 'kai', 'vika/priest']);
    let redirected = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const r = simulateBattle(ctx.content, squad, compSquad(ctx, 'ch6_s10'), seed, { combat: ctx.combat });
      for (const e of r.log) {
        if (e.type === 'link') expect(e.target, 'защитник не связывает сам себя').not.toBe(e.unit);
        if (e.type !== 'damage' || !e.redirect) continue;
        redirected++;
        expect(e.target, 'урон по связи — защитнику').toBe('A0');
        expect(e.redirect).not.toBe('A0');
      }
    }
    expect(redirected).toBeGreaterThan(0);
  });
});

describe('шаг 3: фазы боссов и ярость', () => {
  it('фазы — по разу, после порога (на следующем тике), свита не больше 4 живых', () => {
    let phases = 0;
    let spawns = 0;
    for (const name of ['ch1_s10', 'ch3_s10', 'ch6_s10', 'ch9_s18', 'ch10_s18'])
      for (const [i, sq] of SQ.entries())
        for (let seed = 1; seed <= 3; seed++) {
          const r = simulateBattle(ctx.content, [...sq], compSquad(ctx, name), seed, { combat: ctx.combat });
          const seen = new Set<string>();
          const alive = new Set<string>();
          for (const [k, e] of r.log.entries()) {
            if (e.type === 'phase') {
              phases++;
              const key = `${e.unit}:${e.index}`;
              expect(seen.has(key), `${name} sq${i} ${key}`).toBe(false);
              seen.add(key);
              const hit = [...r.log.slice(0, k)].reverse().find((x) => x.type === 'damage' && x.target === e.unit);
              expect(!!hit && hit.t < e.t, `${name} ${key}`).toBe(true);
            }
            if (e.type === 'spawn') {
              spawns++;
              alive.add(e.unit);
            }
            if (e.type === 'death') alive.delete(e.unit);
            expect(alive.size).toBeLessThanOrEqual(4);
          }
          expect((r.spawned ?? []).length).toBe(r.log.filter((e) => e.type === 'spawn').length);
        }
    expect(phases).toBeGreaterThan(10);
    expect(spawns).toBeGreaterThan(5);
  });

  it('ярость после 60 с — одно событие, только в долгих боях; бой с фазами и свитой воспроизводим', () => {
    for (const [i, sq] of SQ.entries()) {
      const run = () => simulateBattle(ctx.content, [...sq], compSquad(ctx, 'ch10_s18'), 5 + i, { combat: ctx.combat });
      const r = run();
      const rage = r.log.filter((e) => e.type === 'enrage');
      expect(rage.length).toBe(r.duration > 60 ? 1 : 0);
      if (rage.length) expect(rage[0].t).toBeCloseTo(60, 5);
      expect(run().log).toEqual(r.log);
    }
  });
});
