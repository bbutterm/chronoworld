import { buildUnit, enemySquad, withGear } from '../src/core';
import { loadFullContext, PLAYER_MODEL, runBalance, stageThreshold } from './lib/player-model';
// npx tsx scripts/diag.tmp.ts <seed> <day> chapter7[,chapter8]
const [seed, day, chs] = process.argv.slice(2);
const ctx = loadFullContext();
const save = runBalance(ctx, Number(day), { ...PLAYER_MODEL, seedBase: Number(seed) }).save;
const gear = withGear(ctx, save);
const squad = save.squad.map((id) => (id ? buildUnit(save.heroes.find((h) => h.id === id)!, gear) : null));
console.log(`seed ${seed} day ${day}: ${save.squad.map((id) => { const h = save.heroes.find((x) => x.id === id); return h ? `${h.templateId}/${h.rarity}/${h.level}` : '-'; }).join(' ')}`);
for (const c of chs.split(',')) {
  const out: string[] = [];
  for (const s of ctx.content.stages.filter((x) => x.chapter === c)) {
    const k = stageThreshold(ctx, squad, enemySquad(s.id, ctx), 8, 9);
    out.push(`${s.id.split('_')[1]}:${k.toFixed(2)}`);
  }
  console.log(c, out.join(' '));
}
