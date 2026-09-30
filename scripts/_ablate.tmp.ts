import { enemySquad, simulateBattle, type CombatConfig, type UnitDef } from '../src/core';
import { loadFullContext, scaledEnemies, type FullContext } from './lib/player-model';
import { bandSquads } from './balance-behavior';
const ctx = loadFullContext();
const stages = (process.argv[2] ?? 'ch1_s10,ch4_s13,ch6_s10,ch9_s18').split(',');
function thr(c: FullContext, squad: UnitDef[], enemies: (UnitDef | null)[], behavior: boolean, seeds = 6, steps = 9) {
  let a = Math.log(0.03);
  let b = Math.log(30);
  for (let it = 0; it < steps; it++) {
    const mid = (a + b) / 2;
    const e = scaledEnemies(enemies, Math.exp(mid));
    let n = 0;
    for (let seed = 1; seed <= seeds; seed++) if (simulateBattle(c.content, [...squad], e, seed, { combat: c.combat, log: false, behavior }).winner === 'A') n++;
    if (n * 2 >= seeds) a = mid;
    else b = mid;
  }
  return Math.exp((a + b) / 2);
}
const variant = (keep: string): CombatConfig => {
  const beh = JSON.parse(JSON.stringify(ctx.combat.behaviors));
  for (const p of Object.values(beh) as Record<string, unknown>[]) for (const k of ['focus', 'kite', 'anchor', 'panicPct', 'dive', 'flank']) if (k !== keep && !(k === 'dive' && (p.dive as { priority: string[] } | undefined)?.priority?.length === 0)) delete p[k];
  return { ...ctx.combat, behaviors: beh };
};
for (const keep of ['all', 'focus', 'kite', 'anchor', 'panicPct', 'dive', 'flank']) {
  const c = keep === 'all' ? ctx : { ...ctx, combat: variant(keep) };
  const out: string[] = [];
  let lg = 0;
  let n = 0;
  for (const st of stages) {
    const ch = ctx.content.chapters.find((x) => x.id === ctx.content.stages.find((s) => s.id === st)!.chapter)!.order;
    const e = enemySquad(st, ctx);
    const rs = bandSquads(ctx, ch).map((sq) => thr(c, sq, e, true) / thr(ctx, sq, e, false));
    const g = Math.exp(rs.reduce((a, r) => a + Math.log(r), 0) / rs.length);
    lg += Math.log(g);
    n++;
    out.push(`${st} ${g.toFixed(3)}`);
  }
  console.log(keep.padEnd(9), Math.exp(lg / n).toFixed(3), out.join('  '));
}
