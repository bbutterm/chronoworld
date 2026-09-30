import type { CombatConfig } from '../src/core';
import { loadFullContext } from './lib/content-node';
import { formationStats } from '../tests/formation';
const ctx = loadFullContext();
const variant = (keep: string): CombatConfig => {
  const beh = JSON.parse(JSON.stringify(ctx.combat.behaviors));
  for (const p of Object.values(beh) as Record<string, unknown>[]) for (const k of ['focus', 'kite', 'anchor', 'panicPct', 'dive', 'flank']) if (k !== keep && !(k === 'dive' && (p.dive as { priority: string[] } | undefined)?.priority?.length === 0)) delete p[k];
  return { ...ctx.combat, behaviors: beh };
};
for (const keep of (process.argv[2] ?? 'none,all,focus,kite,anchor,flank').split(',')) {
  const cfg = keep === 'all' ? ctx.combat : variant(keep);
  for (const lvl of [1, 10]) {
    const s = formationStats(ctx, 10, lvl, cfg);
    console.log(keep.padEnd(7), lvl, 'centroid', s.centroidDist.toFixed(0), 'dx', s.centroidDx.toFixed(0), 'dy', s.centroidDy.toFixed(0), 'clump', (s.clumpFrac * 100).toFixed(1), 'left', (s.leftThird * 100).toFixed(0), 'wins', s.winsA);
  }
}
