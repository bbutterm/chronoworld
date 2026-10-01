/**
 * Строй боя (QA T2-05 / T1-13, BUG-045): бой держится у центра поля двумя линиями, а не схлопывается в кучу
 * у заднего ряда героев. Метрики — tests/formation.ts; этапы главы 1 с Таверны (ch1_s5 … босс ch1_s10, 13 из 18),
 * отряды 3/4/5 героев, по 10 seed'ов. Глава 1 из 18 этапов (28.09): ур. 1 — 131 / 12% / 45%, ур. 10 — 125 / 11% / 40%.
 *
 * Ядро до правки (a9931c4 + P2, K = 10):   джоб 1 — центроид 190, куча 33%, левая треть 54%;
 *                                          джоб 10 — центроид 178, куча 35%, левая треть 51%.
 * После (лимит бойцов на цель, возврат после прыжка, «Бросок» Поринга/Дропса — во фронт):
 *                                          джоб 1 — 139 / 10% / 44%; джоб 10 — 144 / 6% / 44%.
 */
import { describe, expect, it } from 'vitest';
import { enemySquad, simulateBattle } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { FORMATION_SQUADS, FORMATION_STAGES, formationStats, heroSquad, sampleBattle } from './formation';

const ctx = loadFullContext();

describe('строй боя (T2-05)', () => {
  for (const lvl of [1, 10]) {
    it(`ур. ${lvl}: центроид ближе к центру, кучи (> 3 фигур в радиусе 150) почти нет`, () => {
      const s = formationStats(ctx, 10, lvl);
      expect(s.battles).toBe(FORMATION_STAGES.length * 3 * 10);
      // Было ~180–190: бой уезжал в левую треть.
      expect(s.centroidDist).toBeLessThan(160);
      // Было 33–35% времени боя.
      expect(s.clumpFrac).toBeLessThan(0.15);
      // Было > 50% «юнит-тиков» в левой трети (задний ряд героев сам по себе — ~33% при 5 героях).
      expect(s.leftThird).toBeLessThan(0.48);
    });
  }

  it('босс главы 1 (seed из QA): после «Липкого плюха» Мастеринг возвращается к фронту, а не стоит на Маге', () => {
    for (const seed of [2027808044, 387277725]) {
      const r = simulateBattle(ctx.content, heroSquad(ctx, FORMATION_SQUADS[5], 1), enemySquad('ch1_s10', ctx), seed, { combat: ctx.combat });
      const boss = r.units.find((u) => u.unitId === 'ch1_s10_1')!;
      const dashes = r.log.filter((e) => e.type === 'move' && e.kind === 'dash' && e.unit === boss.uid);
      expect(dashes.length, String(seed)).toBeGreaterThan(0);
      // Каждый прыжок в тыл (x < линии фронта героев) сопровождается прыжком назад.
      const frontX = ctx.combat.field.slotsA[ctx.combat.slots.front[0]][0];
      // Прыжок назад — следующий рывок босса через dashSeconds + diveReturnSeconds (± тик). Куда — к прежнему
      // противнику: пока фронт героев стоит, это x ≥ линии фронта; когда фронт пал (LT-01: бой после потолка щита
      // идёт иначе), прежний противник может стоять и глубже — поэтому считаем по времени, а не по x.
      const returnAt = ctx.combat.movement.dashSeconds + (ctx.combat.movement.diveReturnSeconds ?? 0.8);
      // Прыжок, когда фронт героев уже пал целиком, возвращаться некуда (прежний противник погиб) — такой не считаем
      // (01.10, ульты героев: босс главы 1 стал крепче ×1.11, отряд ур. 1 теряет фронт к 16 с и босс прыгает по тылу).
      const frontUids = r.units.filter((u) => u.side === 'A' && ctx.combat.slots.front.includes(u.slot)).map((u) => u.uid);
      const deaths = frontUids.map((uid) => r.log.find((e) => e.type === 'death' && e.unit === uid)?.t ?? Infinity);
      const frontFell = frontUids.length ? Math.max(...deaths) : Infinity;
      const into = dashes.filter((e) => e.type === 'move' && e.to[0] < frontX && e.t < frontFell - 1e-9);
      const back = into.filter((d) => dashes.some((e) => e !== d && Math.abs(e.t - d.t - returnAt) <= ctx.combat.tickSeconds + 1e-9));
      // Последний прыжок может остаться без возврата, если бой кончился раньше: босс погиб или отряд героев пал
      // (баланс 27.09: босс главы 1 рассчитан на отряд с Таверной, отряд ур. 1 здесь проигрывает).
      const ended = r.log.some((e) => e.type === 'death' && e.unit === boss.uid) || r.winner === 'B';
      expect(back.length, String(seed)).toBeGreaterThanOrEqual(into.length - (ended ? 1 : 0));
      // Не больше 3 фигур у одного юнита в радиусе 150 дольше секунды подряд.
      let run = 0;
      let worst = 0;
      // Пока держатся хотя бы двое героев: последнего живого облепляют все оставшиеся враги — это не куча у Мага, а конец
      // проигранного боя (стая порингов, шаг 5 поведения, добивает его втроём: seed 2027808044 — 1,3 с у последнего Лучника в углу).
      sampleBattle(r, ctx.combat, (pts, uids) => {
        if (uids.filter((u) => u.startsWith('A')).length < 2) {
          run = 0;
          return;
        }
        run = pts.some((p) => pts.filter((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= 150).length > 3) ? run + 1 : 0;
        worst = Math.max(worst, run);
      });
      expect(worst * ctx.combat.tickSeconds, String(seed)).toBeLessThanOrEqual(1);
    }
  });

  it('детерминизм: одинаковый seed — одинаковый лог', () => {
    const run = () => simulateBattle(ctx.content, heroSquad(ctx, FORMATION_SQUADS[4], 5), enemySquad('ch1_s6', ctx), 42, { combat: ctx.combat }).log;
    expect(run()).toEqual(run());
  });
});
