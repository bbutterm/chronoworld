import { buildUnit, enemySquad, simulateBattle, type CardRarity } from '../src/core';
import { loadFullContext } from './lib/player-model';
const ctx = loadFullContext();
const stage = process.argv[2] ?? 'ch1_s10';
const ids = (process.argv[3] ?? 'alan,vika,bran').split(',');
const level = Number(process.argv[4] ?? 1);
const rarity = (process.argv[5] ?? 'green') as CardRarity;
const sq = ids.map((templateId, i) => buildUnit({ id: `ref${i}`, templateId, rarity, level }, ctx));
const e = enemySquad(stage, ctx);
for (const on of [false, true]) {
  let wins = 0;
  let dur = 0;
  let to = 0;
  for (let seed = 1; seed <= 16; seed++) {
    const r = simulateBattle(ctx.content, [...sq], e, seed, { combat: ctx.combat, behavior: on });
    if (r.winner === 'A') wins++;
    if (r.reason === 'timeout') to++;
    dur += r.duration;
    if (seed === 1 && on && process.argv[6]) for (const ev of r.log) if (['move', 'death', 'attack', 'status', 'phase', 'spawn', 'link'].includes(ev.type)) console.log(JSON.stringify(ev));
  }
  console.log(on ? 'ON ' : 'OFF', 'wins', wins, '/16 timeouts', to, 'avg', (dur / 16).toFixed(1));
}
