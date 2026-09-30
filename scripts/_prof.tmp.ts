import { runSeries } from '../src/core';
import { loadFullContext, smoothSquads } from './lib/player-model';
const ctx = loadFullContext();
const heroes = smoothSquads(ctx, 45, [['alan', 'bran', 'vika', 'lira', 'meilin']])[0];
const foes = smoothSquads(ctx, 45, [['iris', 'zara', 'teo', 'kai', 'otto']])[0];
const t0 = performance.now();
runSeries(ctx.content, [...heroes], [...foes], 1500, 1, { combat: ctx.combat });
console.log((performance.now() - t0).toFixed(0));
