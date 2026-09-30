import { enemySquad, simulateBattle, type CombatConfig } from '../src/core';
import { loadFullContext } from './lib/content-node';
import { FORMATION_SQUADS, FORMATION_STAGES, heroSquad } from '../tests/formation';
const ctx = loadFullContext();
const variant = (keep: string): CombatConfig => {
  const beh = JSON.parse(JSON.stringify(ctx.combat.behaviors));
  for (const p of Object.values(beh) as Record<string, unknown>[]) for (const k of ['focus', 'kite', 'anchor', 'panicPct', 'dive', 'flank']) if (k !== keep && !(k === 'dive' && (p.dive as { priority: string[] } | undefined)?.priority?.length === 0)) delete p[k];
  return { ...ctx.combat, behaviors: beh };
};
const lvl = Number(process.argv[3] ?? 10);
for (const keep of (process.argv[2] ?? 'none,all').split(',')) {
  const cfg = keep === 'all' ? ctx.combat : variant(keep);
  const acc: Record<string, { y: number; x: number; n: number }> = {};
  for (const stage of FORMATION_STAGES)
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = simulateBattle(ctx.content, heroSquad(ctx, FORMATION_SQUADS[5], lvl), enemySquad(stage, ctx), seed, { combat: cfg });
      const mv: Record<string, { from: number[]; to: number[]; t0: number; dur: number }> = {};
      for (const u of r.units) mv[u.uid] = { from: [u.x, u.y], to: [u.x, u.y], t0: 0, dur: 0 };
      const pos = (uid: string, t: number) => {
        const m = mv[uid];
        const k = m.dur <= 0 ? 1 : Math.min(1, (t - m.t0) / m.dur);
        return [m.from[0] + (m.to[0] - m.from[0]) * k, m.from[1] + (m.to[1] - m.from[1]) * k];
      };
      const dead = new Set<string>();
      let i = 0;
      for (let t = 0; t <= r.duration; t = Math.round((t + 0.1) * 1000) / 1000) {
        while (i < r.log.length && r.log[i].t <= t + 1e-9) {
          const e = r.log[i++];
          if (e.type === 'move') mv[e.unit] = { from: pos(e.unit, e.t), to: e.to, t0: e.t, dur: e.duration };
          if (e.type === 'death') dead.add(e.unit);
        }
        for (const u of r.units) {
          if (dead.has(u.uid)) continue;
          const p = pos(u.uid, t);
          const a = (acc[u.uid] ??= { x: 0, y: 0, n: 0 });
          a.x += p[0];
          a.y += p[1];
          a.n++;
        }
      }
    }
  console.log(keep, Object.entries(acc).map(([k, a]) => `${k}:(${(a.x / a.n).toFixed(0)},${(a.y / a.n).toFixed(0)}) n${a.n}`).join(' '));
}
