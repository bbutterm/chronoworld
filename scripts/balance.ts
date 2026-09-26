/**
 * Инструмент баланса (T7): модель игрока проходит кампанию D дней, только через функции ядра.
 *   npm run balance                           5 дней, CSV в balance.csv
 *   npm run balance -- --days 10 --sessions 6 --out /tmp/b.csv
 * Модель игрока — scripts/lib/player-model.ts (PLAYER_MODEL). Описание — docs/content/balance.md.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadGameContext, ROOT } from './lib/content-node';
import { findWalls, PLAYER_MODEL, runBalance, toCsv } from './lib/player-model';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function intArg(name: string, def: number): number {
  const v = arg(name);
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name}: ожидалось целое ≥ 1, получено ${v}`);
  return n;
}

const days = intArg('days', 5);
const model = { ...PLAYER_MODEL, sessionsPerDay: intArg('sessions', PLAYER_MODEL.sessionsPerDay) };
const out = resolve(ROOT, arg('out') ?? 'balance.csv');

const started = performance.now();
const ctx = loadGameContext();
const res = runBalance(ctx, days, model);
writeFileSync(out, toCsv(res.rows));
const ms = performance.now() - started;

const name = (id: string) => ctx.content.stages.find((s) => s.id === id)?.name ?? id;
console.log(
  `Модель: ${days} дн. × ${model.sessionsPerDay} сесс. (первая в ${model.firstSessionHour}:00, шаг ${model.hoursBetweenSessions} ч), ` +
    `до ${model.maxLossesPerSession} поражений за сессию`,
);
console.log(`Этапов в кампании: ${ctx.content.stages.length}, пройдено: ${res.save.campaign.cleared.length}`);
console.log('\nПервое прохождение:');
for (const fc of res.firstClears) {
  console.log(`  ${fc.stageId.padEnd(8)} ${name(fc.stageId).padEnd(24)} день ${fc.day}, сессия ${fc.session} (${fc.time_h} ч), боёв ${fc.attempts}`);
}
const walls = findWalls(res, ctx);
const wall = walls[0];
if (wall) {
  console.log(
    `\nСтена: ${wall.stageId} (${name(wall.stageId)}) — ${wall.hours} ч, ${wall.attempts} боёв` +
      (wall.cleared ? '' : ' — не пройден к концу симуляции'),
  );
  const rest = walls.slice(1, 4).map((w) => `${w.stageId} ${w.hours} ч/${w.attempts} б.${w.cleared ? '' : ' (не пройден)'}`);
  if (rest.length) console.log(`Дальше: ${rest.join(', ')}`);
}
console.log(`\nCSV: ${out} (${res.rows.length} строк) за ${ms.toFixed(0)} мс`);
