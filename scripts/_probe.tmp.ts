import { enemySquad, simulateBattle } from '../src/core';
import { loadFullContext, scaledEnemies } from './lib/player-model';
import { bandSquads } from './balance-behavior';
const ctx = loadFullContext();
const stage = process.argv[2] ?? 'ch4_s13';
const ch = Number(process.argv[3] ?? 4);
const sqi = Number(process.argv[4] ?? 0);
const sq = bandSquads(ctx, ch)[sqi];
const e = scaledEnemies(enemySquad(stage, ctx), Number(process.argv[5] ?? 1));
for (const on of [false, true]) {
  let wins = 0;
  let dur = 0;
  const reasons: Record<string, number> = {};
  for (let seed = 1; seed <= 20; seed++) {
    const r = simulateBattle(ctx.content, [...sq], e, seed, { combat: ctx.combat, behavior: on });
    if (r.winner === 'A') wins++;
    dur += r.duration;
    for (const ev of r.log) if (ev.type === 'move' && ev.reason) reasons[ev.reason] = (reasons[ev.reason] ?? 0) + 1;
    if (seed === 1 && on) {
      const units = r.units.map((u) => `${u.uid}:${u.unitId}`).join(' ');
      console.log(units);
      for (const ev of r.log) if (ev.type === 'move' && ev.reason) console.log(ev.t, ev.unit, ev.reason, ev.from, ev.to);
      for (const ev of r.log) if (ev.type === 'death') console.log(ev.t, 'death', ev.unit);
    }
  }
  console.log(on ? 'ON ' : 'OFF', 'wins', wins, 'avg', (dur / 20).toFixed(1), JSON.stringify(reasons));
}
