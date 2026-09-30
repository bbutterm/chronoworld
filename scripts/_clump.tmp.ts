import { enemySquad, simulateBattle } from '../src/core';
import { loadFullContext } from './lib/content-node';
import { FORMATION_SQUADS, heroSquad } from '../tests/formation';
const ctx = loadFullContext();
const seed = Number(process.argv[2] ?? 2027808044);
const r = simulateBattle(ctx.content, heroSquad(ctx, FORMATION_SQUADS[5], 1), enemySquad('ch1_s10', ctx), seed, { combat: ctx.combat, behavior: process.argv[3] !== 'off' });
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
    if (e.type === 'move') {
      mv[e.unit] = { from: pos(e.unit, e.t), to: e.to, t0: e.t, dur: e.duration };
      console.log(`${e.t} move ${e.unit} ${e.kind} ${e.reason ?? ''} -> ${e.to}`);
    }
    if (e.type === 'death') dead.add(e.unit);
  }
  const alive = r.units.filter((u) => !dead.has(u.uid));
  for (const p of alive) {
    const pp = pos(p.uid, t);
    const near = alive.filter((q) => Math.hypot(pp[0] - pos(q.uid, t)[0], pp[1] - pos(q.uid, t)[1]) <= 150);
    if (near.length > 3) {
      console.log(`t=${t} clump around ${p.uid}: ${near.map((q) => `${q.uid}(${pos(q.uid, t).map(Math.round)})`).join(' ')}`);
      break;
    }
  }
}
console.log(r.winner, r.duration);
