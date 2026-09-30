import { parseSquad, runSeries } from '../src/core';
import { loadFullContext, smoothSquads } from './lib/player-model';
const ctx = loadFullContext();
const raw = parseSquad('guard,warrior,archer,mage,priest');
const heroes = smoothSquads(ctx, 45, [['alan', 'bran', 'vika', 'lira', 'meilin']])[0];
const foes = smoothSquads(ctx, 45, [['iris', 'zara', 'teo', 'kai', 'otto']])[0];
for (const [name, a, b] of [['raw', raw, raw], ['heroes', heroes, foes]] as const) {
  for (const behavior of [false, true]) {
    runSeries(ctx.content, [...a], [...b], 30, 1, { combat: ctx.combat, behavior });
    const t0 = performance.now();
    const r = runSeries(ctx.content, [...a], [...b], 1000, 1, { combat: ctx.combat, behavior });
    console.log(name, behavior, (performance.now() - t0).toFixed(0), 'ms', 'avg', r.avgDuration.toFixed(1), 'win', r.winRateA.toFixed(2), 'to', r.timeoutRate.toFixed(2));
  }
}
