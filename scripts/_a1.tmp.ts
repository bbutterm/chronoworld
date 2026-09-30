import { enemySquad, simulateBattle } from '../src/core';
import { loadFullContext } from './lib/content-node';
import { FORMATION_SQUADS, heroSquad } from '../tests/formation';
const ctx = loadFullContext();
const who = process.argv[2] ?? 'A1';
for (const on of [false, true]) {
  const r = simulateBattle(ctx.content, heroSquad(ctx, FORMATION_SQUADS[5], 1), enemySquad('ch1_s10', ctx), 2027808044, { combat: ctx.combat, behavior: on });
  console.log(on, r.log.filter((e) => (e.type === 'attack' && e.unit === who) || (e.type === 'move' && e.unit === who)).slice(0, 8).map((e) => JSON.stringify(e)).join('\n'));
}
