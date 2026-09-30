/**
 * Поражения «время вышло при живом отряде» и средняя длина боя на пороге этапов (docs/content/balance.md, «Поведение в бою»):
 * для каждого этапа главы — три эталонных отряда полосы главы (REFERENCE_SQUADS, редкость и уровень — BAND из balance-behavior)
 * на пороге k* (сила врагов, при которой отряд побеждает в половине из 6 боёв), 6 seed на пороге. Бои «на грани», как у стен.
 *   npx tsx scripts/balance-timeouts.ts 6,9,10       главы по номеру (с 1); без аргумента — все
 *   npx tsx scripts/balance-timeouts.ts 6 --json out.json
 */
import { writeFileSync } from 'node:fs';
import { enemySquad, simulateBattle } from '../src/core';
import { bandSquads } from './balance-behavior';
import { loadFullContext, scaledEnemies, stageThreshold } from './lib/player-model';

const argv = process.argv.slice(2);
const ctx = loadFullContext();
const want = argv[0] && !argv[0].startsWith('--') ? argv[0].split(',').map(Number) : ctx.content.chapters.map((c) => c.order);
const jsonAt = argv.indexOf('--json');
const SEEDS = 6;
const rows: { chapter: number; battles: number; timeouts: number; meanDuration: number }[] = [];
for (const ch of ctx.content.chapters.filter((c) => want.includes(c.order))) {
  const squads = bandSquads(ctx, ch.order).slice(0, 3);
  let battles = 0;
  let timeouts = 0;
  let dur = 0;
  for (const st of ctx.content.stages.filter((s) => s.chapter === ch.id)) {
    const enemies = enemySquad(st.id, ctx);
    for (const sq of squads) {
      const k = stageThreshold(ctx, sq, enemies, SEEDS, 9);
      const e = scaledEnemies(enemies, k);
      for (let seed = 1; seed <= SEEDS; seed++) {
        const r = simulateBattle(ctx.content, [...sq], e, seed, { combat: ctx.combat, log: false });
        battles++;
        dur += r.duration;
        if (r.reason === 'timeout') timeouts++;
      }
    }
  }
  const row = { chapter: ch.order, battles, timeouts, meanDuration: Math.round((dur / battles) * 10) / 10 };
  rows.push(row);
  console.log(`глава ${ch.order}: поражений по таймеру ${timeouts} из ${battles}, средний бой ${row.meanDuration} с`);
}
if (jsonAt >= 0) writeFileSync(argv[jsonAt + 1], JSON.stringify(rows));
