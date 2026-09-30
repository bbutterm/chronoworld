import { enemySquad, simulateBattle } from '../src/core';
import { loadFullContext, scaledEnemies, stageThreshold } from './lib/player-model';
import { bandSquads } from './balance-behavior';
const ctx = loadFullContext();
const st = process.argv[2] ?? 'ch9_s5';
const no = ctx.content.chapters.find((c) => c.id === ctx.content.stages.find((s) => s.id === st)!.chapter)!.order;
const sq = bandSquads(ctx, no)[Number(process.argv[3] ?? 0)];
const e = enemySquad(st, ctx);
const k = stageThreshold(ctx, sq, e, 4, 7);
const ee = scaledEnemies(e, k);
for (let seed = 1; seed <= 6; seed++) {
  const r = simulateBattle(ctx.content, [...sq], ee, seed, { combat: ctx.combat });
  if (r.reason !== 'timeout') continue;
  console.log('seed', seed, st, 'k', k.toFixed(2));
  const hp = new Map<string, number>();
  for (const ev of r.log) if (ev.type === 'damage') hp.set(ev.target, ev.hp);
  for (const u of r.units) {
    const rep = r.report[u.uid];
    console.log(u.uid, (u.side === 'A' ? sq[u.slot]?.behavior : ee[u.slot]?.id) ?? '', 'hp', hp.get(u.uid) ?? u.maxHp, '/', u.maxHp, 'dmg', rep.damageDealt, 'heal', rep.healingDone, 'shield', rep.shieldGiven, 'taken', rep.damageTaken, rep.alive ? 'жив' : 'пал');
  }
  break;
}
