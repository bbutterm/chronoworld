import { simulateBattle, type BattleOptions } from './battle';
import type { Content, Squad } from './types';

type HeroId = string;

/** "guard,warrior,-,mage,priest" → отряд; "-" или пусто — пустой слот. */
export function parseSquad(text: string, slots = 5): Squad {
  const parts = text.split(',').map((s) => s.trim());
  if (parts.length > slots) throw new Error(`В отряде не больше ${slots} слотов: ${text}`);
  const squad: Squad = parts.map((p) => (p === '' || p === '-' ? null : p));
  while (squad.length < slots) squad.push(null);
  return squad;
}

export interface UnitAggregate {
  uid: string;
  heroId: HeroId;
  avgDamage: number;
  avgHealing: number;
  avgShield: number;
  avgUlts: number;
  survival: number;
}

export interface SeriesResult {
  n: number;
  winRateA: number;
  timeoutRate: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  units: UnitAggregate[];
}

export function runSeries(content: Content, squadA: Squad, squadB: Squad, n: number, seedStart = 1, opts: BattleOptions = {}): SeriesResult {
  let winsA = 0;
  let timeouts = 0;
  let totalDuration = 0;
  let minDuration = Infinity;
  let maxDuration = 0;
  const acc = new Map<string, UnitAggregate>();

  for (let i = 0; i < n; i++) {
    const r = simulateBattle(content, squadA, squadB, seedStart + i, { ...opts, log: false });
    if (r.winner === 'A') winsA++;
    if (r.reason === 'timeout') timeouts++;
    totalDuration += r.duration;
    minDuration = Math.min(minDuration, r.duration);
    maxDuration = Math.max(maxDuration, r.duration);
    for (const rep of Object.values(r.report)) {
      let a = acc.get(rep.uid);
      if (!a) {
        a = { uid: rep.uid, heroId: rep.unitId, avgDamage: 0, avgHealing: 0, avgShield: 0, avgUlts: 0, survival: 0 };
        acc.set(rep.uid, a);
      }
      a.avgDamage += rep.damageDealt / n;
      a.avgHealing += rep.healingDone / n;
      a.avgShield += rep.shieldGiven / n;
      a.avgUlts += rep.ults / n;
      a.survival += (rep.alive ? 1 : 0) / n;
    }
  }

  return {
    n,
    winRateA: winsA / n,
    timeoutRate: timeouts / n,
    avgDuration: totalDuration / n,
    minDuration,
    maxDuration,
    units: [...acc.values()],
  };
}

export interface SwapResult {
  slot: number;
  from: HeroId | null;
  to: HeroId;
  /** Винрейт изменённого отряда против базового, среднее за бои атакой и защитой. */
  winRate: number;
}

/**
 * Проверка «зеркала»: в базовом отряде по очереди меняем одного героя на каждого другого
 * и прогоняем против исходного отряда с обеих сторон.
 */
export function swapCheck(content: Content, base: Squad, n: number, heroIds: HeroId[], opts: BattleOptions = {}): SwapResult[] {
  const results: SwapResult[] = [];
  base.forEach((from, slot) => {
    for (const to of heroIds) {
      if (to === from) continue;
      const modified = [...base];
      modified[slot] = to;
      const asAttacker = runSeries(content, modified, base, n, 1, opts).winRateA;
      const asDefender = 1 - runSeries(content, base, modified, n, 1, opts).winRateA;
      results.push({ slot, from, to, winRate: (asAttacker + asDefender) / 2 });
    }
  });
  return results;
}
