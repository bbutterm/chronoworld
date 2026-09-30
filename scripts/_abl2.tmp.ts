import { buildUnit, enemySquad, simulateBattle, type CardRarity, type CombatConfig } from '../src/core';
import { loadFullContext } from './lib/player-model';
const ctx = loadFullContext();
const stage = process.argv[2] ?? 'ch1_s10';
const ids = (process.argv[3] ?? 'alan,vika,bran,kai,zara').split(',');
const level = Number(process.argv[4] ?? 1);
const rarity = (process.argv[5] ?? 'blue') as CardRarity;
const sq = ids.map((templateId, i) => buildUnit({ id: `ref${i}`, templateId, rarity, level }, ctx));
const e = enemySquad(stage, ctx);
const variant = (drop: string): CombatConfig => {
  const beh = JSON.parse(JSON.stringify(ctx.combat.behaviors));
  for (const p of Object.values(beh) as Record<string, unknown>[]) for (const k of drop.split('+')) delete p[k];
  return { ...ctx.combat, behaviors: beh };
};
for (const drop of ['-', 'focus', 'kite', 'anchor', 'panicPct', 'dive', 'flank', 'focus+kite+anchor+panicPct+dive+flank']) {
  let wins = 0;
  for (let seed = 1; seed <= 32; seed++) if (simulateBattle(ctx.content, [...sq], e, seed, { combat: variant(drop) }).winner === 'A') wins++;
  console.log('без', drop.padEnd(10), wins, '/32');
}
