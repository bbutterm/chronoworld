/**
 * Строй боя (QA T2-05 / T1-13, BUG-045): бой держится у центра поля двумя линиями, а не схлопывается в кучу
 * у заднего ряда героев. Метрики — tests/formation.ts; этапы ch1_s5…s10, отряды 3/4/5 героев, по 10 seed'ов.
 *
 * Ядро до правки (a9931c4 + P2, K = 10):   джоб 1 — центроид 190, куча 33%, левая треть 54%;
 *                                          джоб 10 — центроид 178, куча 35%, левая треть 51%.
 * После (лимит бойцов на цель, возврат после прыжка, «Бросок» Поринга/Дропса — во фронт):
 *                                          джоб 1 — 139 / 10% / 44%; джоб 10 — 144 / 6% / 44%.
 */
import { describe, expect, it } from 'vitest';
import { enemySquad, simulateBattle } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { FORMATION_SQUADS, formationStats, heroSquad, sampleBattle } from './formation';

const ctx = loadFullContext();

describe('строй боя (T2-05)', () => {
  for (const lvl of [1, 10]) {
    it(`джоб ${lvl}: центроид ближе к центру, кучи (> 3 фигур в радиусе 150) почти нет`, () => {
      const s = formationStats(ctx, 10, lvl);
      expect(s.battles).toBe(180);
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
      const into = dashes.filter((e) => e.type === 'move' && e.to[0] < frontX);
      const back = dashes.filter((e) => e.type === 'move' && e.to[0] >= frontX);
      expect(back.length, String(seed)).toBeGreaterThanOrEqual(into.length - (r.log.some((e) => e.type === 'death' && e.unit === boss.uid) ? 1 : 0));
      // Не больше 3 фигур у одного юнита в радиусе 150 дольше секунды подряд.
      let run = 0;
      let worst = 0;
      sampleBattle(r, ctx.combat, (pts) => {
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
