/**
 * Метрики строя боя (QA T2-05 / T1-13, BUG-045): насколько бой «читается» — держится ли у центра поля двумя линиями
 * или схлопывается в кучу у заднего ряда героев. Позиции — как их рисует сцена (move: равномерно from→to за duration).
 */
import { buildUnit, enemySquad, simulateBattle, type BattleResult, type CombatConfig, type UnitDef } from '../src/core';
import { cardHero, JOB_CARD } from './helpers';
import type { loadFullContext } from '../scripts/lib/content-node';

type FullContext = ReturnType<typeof loadFullContext>;

/**
 * Вторая половина главы 1 — все этапы с Таверны до босса в порядке игры (глава 1 — 18 этапов с 28.09; было ch1_s5…s10 из 10).
 * Прежние 6 этапов после перебаланса длинной главы стали сильнее (mult ×1.1–1.35) — метрика строя меряется по всей
 * половине главы, как и задумывалось («середина главы 1 и босс»).
 */
export const FORMATION_STAGES = ['ch1_s5', 'ch1_s12', 'ch1_s6', 'ch1_s13', 'ch1_s7', 'ch1_s14', 'ch1_s8', 'ch1_s15', 'ch1_s9', 'ch1_s16', 'ch1_s17', 'ch1_s18', 'ch1_s10'];

/** Отряды 3–5 героев первых профессий (слоты 0–1 — фронт, 2–4 — тыл). */
export const FORMATION_SQUADS: Record<number, (string | null)[]> = {
  3: ['swordman', null, 'archer', null, 'acolyte'],
  4: ['swordman', 'thief', 'archer', null, 'acolyte'],
  5: ['swordman', 'thief', 'archer', 'mage', 'acolyte'],
};

/** Отряд карточек по классам (tests/helpers.ts JOB_CARD: Мечник — Алан, Вор — Дорн, Лучник — Бран, Маг — Кай, Аколит — Вика). */
export function heroSquad(ctx: FullContext, jobs: (string | null)[], level: number): (UnitDef | null)[] {
  return jobs.map((job, i) => (job ? buildUnit(cardHero(ctx, JOB_CARD[job], level, { id: `h${i}` }), ctx) : null));
}

export interface FormationStats {
  battles: number;
  /** Среднее (по тикам всех боёв) расстояние центроида живых юнитов от центра поля. */
  centroidDist: number;
  /** Среднее |x центроида − центр поля по x|. */
  centroidDx: number;
  /** Среднее (со знаком) смещение y центроида от центра расстановки. */
  centroidDy: number;
  /** Доля тиков, когда вокруг какого-то юнита в радиусе 150 стоят больше 3 юнитов (он сам + ещё ≥ 3). */
  clumpFrac: number;
  /** Доля «юнит-тиков» в левой трети поля (x < width/3) — куча у заднего ряда героев. */
  leftThird: number;
  winsA: number;
}

/** Позиции юнитов боя по тикам. */
export function sampleBattle(r: BattleResult, cfg: CombatConfig, onTick: (pts: number[][]) => void) {
  const mv: Record<string, { from: number[]; to: number[]; t0: number; dur: number }> = {};
  for (const u of r.units) mv[u.uid] = { from: [u.x, u.y], to: [u.x, u.y], t0: 0, dur: 0 };
  const pos = (uid: string, t: number) => {
    const m = mv[uid];
    const k = m.dur <= 0 ? 1 : Math.min(1, (t - m.t0) / m.dur);
    return [m.from[0] + (m.to[0] - m.from[0]) * k, m.from[1] + (m.to[1] - m.from[1]) * k];
  };
  const dead = new Set<string>();
  // Свита фаз босса (spawn) — на поле с момента появления.
  const present = r.units.map((u) => u.uid);
  let i = 0;
  for (let t = 0; t <= r.duration + 1e-9; t = Math.round((t + cfg.tickSeconds) * 1000) / 1000) {
    while (i < r.log.length && r.log[i].t <= t + 1e-9) {
      const e = r.log[i++];
      if (e.type === 'spawn') {
        mv[e.unit] = { from: [e.x, e.y], to: [e.x, e.y], t0: e.t, dur: 0 };
        present.push(e.unit);
      }
      if (e.type === 'move') mv[e.unit] = { from: pos(e.unit, e.t), to: e.to, t0: e.t, dur: e.duration };
      if (e.type === 'death') dead.add(e.unit);
    }
    onTick(present.filter((u) => !dead.has(u)).map((u) => pos(u, t)));
  }
}

export function formationStats(ctx: FullContext, seeds: number, jobLevel = 10, cfg: CombatConfig = ctx.combat): FormationStats {
  // Центр поля — центр расстановки: середина по ширине, средний y слотов.
  const cx = cfg.field.width / 2;
  const cy = cfg.field.slotsA.reduce((a, s) => a + s[1], 0) / cfg.field.slotsA.length;
  let ticks = 0;
  let unitTicks = 0;
  let sumD = 0;
  let sumDx = 0;
  let sumDy = 0;
  let clump = 0;
  let left = 0;
  let battles = 0;
  let winsA = 0;
  for (const stage of FORMATION_STAGES)
    for (const size of [3, 4, 5]) {
      const squad = heroSquad(ctx, FORMATION_SQUADS[size], jobLevel);
      for (let s = 1; s <= seeds; s++) {
        const r = simulateBattle(ctx.content, squad, enemySquad(stage, ctx), s * 7919 + size, { combat: cfg });
        battles++;
        if (r.winner === 'A') winsA++;
        sampleBattle(r, cfg, (pts) => {
          if (pts.length === 0) return;
          ticks++;
          const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
          const my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
          sumD += Math.hypot(mx - cx, my - cy);
          sumDx += Math.abs(mx - cx);
          sumDy += my - cy;
          for (const p of pts) {
            unitTicks++;
            if (p[0] < cfg.field.width / 3) left++;
          }
          if (pts.some((p) => pts.filter((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= 150).length > 3)) clump++;
        });
      }
    }
  return { battles, centroidDist: sumD / ticks, centroidDx: sumDx / ticks, centroidDy: sumDy / ticks, clumpFrac: clump / ticks, leftThird: left / unitTicks, winsA: winsA / battles };
}
