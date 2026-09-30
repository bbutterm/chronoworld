import { enemySquad, simulateBattle } from '../src/core';
import { loadFullContext, scaledEnemies, stageThreshold } from './lib/player-model';
import { bandSquads } from './balance-behavior';
const ctx = loadFullContext();
if (process.env.EN) { const [a, b] = process.env.EN.split(",").map(Number); (ctx.combat as any).enrage = { afterSeconds: 60, perSecond: a, healPerSecond: b }; }
for (const ch of (process.argv[2] ?? 'chapter4,chapter5').split(',')) {
  const no = ctx.content.chapters.find((c) => c.id === ch)!.order;
  const squads = bandSquads(ctx, no);
  const stats = { on: { to: 0, loss: 0, n: 0, dur: 0 }, off: { to: 0, loss: 0, n: 0, dur: 0 } };
  for (const st of ctx.content.stages.filter((s) => s.chapter === ch)) {
    const e = enemySquad(st.id, ctx);
    for (const sq of squads.slice(0, 3)) {
      const k = stageThreshold({ ...ctx }, sq, e, 4, 7);
      const ee = scaledEnemies(e, k);
      for (const [name, behavior] of [['on', true], ['off', false]] as const)
        for (let seed = 1; seed <= 6; seed++) {
          const r = simulateBattle(ctx.content, [...sq], ee, seed, { combat: ctx.combat, log: false, behavior });
          const s = stats[name];
          s.n++;
          s.dur += r.duration;
          if (r.winner === 'B') s.loss++;
          if (r.reason === 'timeout') s.to++;
        }
    }
  }
  for (const [name, s] of Object.entries(stats)) console.log(ch, name, 'поражений', s.loss, 'из них по таймеру', s.to, 'из', s.n, 'средний бой', (s.dur / s.n).toFixed(1));
}
