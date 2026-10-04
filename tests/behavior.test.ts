/**
 * Профили поведения в бою (docs/design/battle-behavior.md): каркас, нулевой профиль, правила профилей, детерминизм.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lintBehaviors, resolveBehavior, simulateBattle, type BattleEvent, type BattleResult } from '../src/core';
import { loadFullContext, ROOT } from '../scripts/lib/content-node';
import { compSquad, scenarioHashes } from './behavior-scenarios';
import { SMOOTH_SQUADS, smoothSquads } from '../scripts/lib/player-model';

const ctx = loadFullContext();
const zeroReference = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/behavior-zero-reference.json'), 'utf8')) as {
  scenarioCount: number;
  seeds: number;
  config: unknown;
  traces: Record<string, Pick<BattleResult, 'winner' | 'reason' | 'duration' | 'log'>>;
};

describe('каркас профилей', () => {
  it('нулевой профиль: 292 полных лога совпадают с эталоном после исправления целей и лимита 100 с', () => {
    // Общие multihit fix и cap100 действуют и без профилей: 68 логов обновлены, 224 остались прежними.
    // Составы и seeds прежние. Обновление: npx tsx scripts/behavior-zero-fixture.ts --write; причина — в reference JSON.
    const want = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/behavior-zero-hashes.json'), 'utf8')) as Record<string, string>;
    expect(zeroReference.scenarioCount).toBe(292);
    expect(zeroReference.seeds).toBe(4);
    expect(zeroReference.config).toEqual({
      tickSeconds: ctx.combat.tickSeconds, actionThreshold: ctx.combat.actionThreshold,
      timeLimitSeconds: ctx.combat.timeLimitSeconds, statusTurnSeconds: ctx.combat.statusTurnSeconds,
      energy: { max: ctx.combat.energy.max, perBasicAction: ctx.combat.energy.perBasicAction, perHitTaken: ctx.combat.energy.perHitTaken },
    });
    const traces: typeof zeroReference.traces = {};
    const got = scenarioHashes(ctx, zeroReference.seeds, { behavior: false }, (key, r) => {
      if (key in zeroReference.traces) traces[key] = { winner: r.winner, reason: r.reason, duration: r.duration, log: r.log.slice(0, 40) };
      // Off выключает каркас, даже если данные юнита содержат профиль, заряд, фазу, связь, ауру или стихию.
      const framework = r.log.filter(e =>
        ['link', 'phase', 'spawn', 'enrage', 'aura'].includes(e.type) ||
        (e.type === 'move' && e.reason !== undefined) ||
        (e.type === 'cast' && (e.charge || e.at !== undefined)) ||
        (e.type === 'damage' && (e.redirect !== undefined || e.elem !== undefined)));
      expect(framework, key).toEqual([]);
    });
    expect(Object.keys(got)).toHaveLength(292);
    expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
    const diff = Object.keys(want).filter((k) => want[k] !== got[k]);
    expect(diff, diff.slice(0, 5).join(', ')).toEqual([]);
    expect(Object.keys(traces)).toHaveLength(3);
    expect(traces).toEqual(zeroReference.traces);
    expect(scenarioHashes(ctx, zeroReference.seeds, { behavior: false })).toEqual(got);
  });

  it('все профили из библиотеки и ссылки на них целы', () => {
    const { errors } = lintBehaviors(ctx.content, ctx.combat);
    expect(errors).toEqual([]);
  });

  it('профиль юнита: свой → профессия/форма героя → по умолчанию; выключено — только «остаться в тылу»', () => {
    const [sq] = smoothSquads(ctx, 45, [['alan', 'vika', 'bran', 'kai', 'zara']]);
    expect(sq.map((u) => u.behavior)).toEqual(['guard', 'medic', 'marksman', 'caster', 'assassin']);
    expect(resolveBehavior(ctx.content.units.mob_lunatic, false, ctx.combat).id).toBe('leaper');
    expect(resolveBehavior(ctx.content.units.mob_poporing, false, ctx.combat).id).toBe('pack');
    expect(resolveBehavior(ctx.content.units.mob_tank, false, ctx.combat).id).toBe('line');
    expect(resolveBehavior(ctx.content.units.mob_lunatic, false, ctx.combat, false).profile.dive?.stay).toBe(true);
    expect(resolveBehavior({ ...sq[2] }, true, ctx.combat, false).profile).toEqual({ name: 'Держит линию' });
  });
});

const moves = (r: BattleResult, uid: string) => r.log.filter((e): e is Extract<BattleEvent, { type: 'move' }> => e.type === 'move' && e.unit === uid);
const B = ctx.combat.field.bounds!;
/** Отряды героев по главе (как scripts/balance-behavior.ts): фиолетовые ур. 45, ветка своей роли. */
const SQ = smoothSquads(ctx, 45, SMOOTH_SQUADS);

describe('шаг 1: стрелок, лекарь, ассасин, вор', () => {
  it('стрелок отходит от ближнего не больше 3 раз за бой, в пределах поля и не чаще перезарядки', () => {
    const kite = ctx.combat.behaviors!.marksman.kite!;
    let total = 0;
    for (const [name] of [['ch4_s10'], ['ch6_s10'], ['ch9_s18']])
      for (const [i, sq] of SQ.entries())
        for (let seed = 1; seed <= 4; seed++) {
          const r = simulateBattle(ctx.content, [...sq], compSquad(ctx, name), seed, { combat: ctx.combat });
          for (const u of r.units) {
            const k = moves(r, u.uid).filter((m) => m.reason === 'kite');
            total += k.length;
            expect(k.length, `${name} sq${i} ${u.uid}`).toBeLessThanOrEqual(kite.max);
            for (let j = 1; j < k.length; j++) expect(k[j].t - k[j - 1].t).toBeGreaterThanOrEqual(kite.cooldown - 1e-9);
            for (const m of k) {
              expect(m.to[0]).toBeGreaterThanOrEqual(B.minX);
              expect(m.to[0]).toBeLessThanOrEqual(B.maxX);
              expect(m.to[1]).toBeGreaterThanOrEqual(B.minY);
              expect(m.to[1]).toBeLessThanOrEqual(B.maxY);
            }
          }
        }
    expect(total, 'отходы вообще случаются').toBeGreaterThan(5);
  });

  it('лекарь заднего ряда через 3 с боя стоит позади своего танка (x меньше, по высоте — ближе к нему, чем был)', () => {
    // Отряд 0: Алан-рыцарь (танк, слот 0), Вика-жрица перенесена в задний ряд (слот 4).
    const sq = SQ[0];
    const squad = [sq[0], null, sq[2], sq[3], sq[1]];
    let checked = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const r = simulateBattle(ctx.content, squad, compSquad(ctx, 'ch5_s10'), seed, { combat: ctx.combat });
      const follow = moves(r, 'A4').filter((m) => m.reason === 'follow' && m.t <= 3);
      expect(follow.length, String(seed)).toBeGreaterThan(0);
      const last = follow.at(-1)!;
      const tank = moves(r, 'A0').filter((m) => m.t <= last.t).at(-1)?.to ?? [r.units[0].x, r.units[0].y];
      expect(last.to[0], 'позади танка').toBeLessThan(tank[0]);
      expect(Math.abs(last.to[1] - tank[1]), 'ближе к танку по высоте').toBeLessThan(Math.abs(1730 - tank[1]));
      checked++;
    }
    expect(checked).toBe(6);
  });

  it('ассасин прыгает в лекаря, а не в ближайшего из тыла', () => {
    // Зара-ассасин против отряда с лекарем в дальнем слоте 4; «Ядовитый всплеск» (dash) — в тыл.
    const zara = smoothSquads(ctx, 60, [['zara', 'zara', 'zara', 'zara', 'zara']])[0][0];
    const [alan, vika, bran, kai] = SQ[0];
    const def = [alan, null, bran, kai, vika];
    let dives = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const r = simulateBattle(ctx.content, [zara, null, null, null, null], def, seed, { combat: ctx.combat });
      for (const e of r.log) if (e.type === 'attack' && e.unit === 'A0' && e.skill === 'job_assassin_venom_splasher') {
        dives++;
        expect(e.targets, String(seed)).toEqual(['B4']);
      }
      // Без профилей — в ближайшего заднего (не в лекаря).
      const off = simulateBattle(ctx.content, [zara, null, null, null, null], def, seed, { combat: ctx.combat, behavior: false });
      const first = off.log.find((e) => e.type === 'attack' && e.unit === 'A0' && e.skill === 'job_assassin_venom_splasher');
      if (first && first.type === 'attack') expect(first.targets).not.toEqual(['B4']);
    }
    expect(dives).toBeGreaterThan(0);
  });

  it('один seed — один лог для каждого профиля (отряды со всеми профилями героев против сценариев)', () => {
    for (const [i, sq] of SQ.entries()) {
      const run = () => simulateBattle(ctx.content, [...sq], compSquad(ctx, 'ch7_s10'), 11 + i, { combat: ctx.combat }).log;
      expect(run()).toEqual(run());
    }
  });
});
