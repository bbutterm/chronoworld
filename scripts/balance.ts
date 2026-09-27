/**
 * Инструмент баланса (T7, v2): модель игрока проходит полный цикл игры D дней — кампания, башня, экипировка,
 * быстрые награды, задания, поручения, достижения. Только функции ядра (обёртки act*).
 *   npm run balance                           14 дней, CSV в balance.csv
 *   npm run balance -- --days 10 --sessions 6 --out /tmp/b.csv
 * Модель игрока — scripts/lib/player-model.ts (PLAYER_MODEL). Описание — docs/content/balance.md.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { newGame } from '../src/core';
import { ROOT } from './lib/content-node';
import { findWalls, loadFullContext, perDay, PLAYER_MODEL, runBalance, signals, SOURCES, toCsv, total } from './lib/player-model';

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

const days = intArg('days', 14);
const model = { ...PLAYER_MODEL, sessionsPerDay: intArg('sessions', PLAYER_MODEL.sessionsPerDay) };
const out = resolve(ROOT, arg('out') ?? 'balance.csv');

const started = performance.now();
const ctx = loadFullContext();
const res = runBalance(ctx, days, model);
writeFileSync(out, toCsv(res.rows));
const ms = performance.now() - started;

const stage = (id: string) => ctx.content.stages.find((s) => s.id === id);
const name = (id: string) => stage(id)?.name ?? id;
console.log(
  `Модель: ${days} дн. с ${model.startDate} × ${model.sessionsPerDay} сесс. (первая в ${model.firstSessionHour}:00, шаг ${model.hoursBetweenSessions} ч), ` +
    `кампания до ${model.maxLossesPerSession} пораж., башня до ${model.towerMaxAttemptsPerSession} штурмов/${model.towerMaxLossesPerSession} пораж. за сессию`,
);
console.log(`Этапов в кампании: ${ctx.content.stages.length}, пройдено: ${res.save.campaign.cleared.length}`);

console.log('\nПервое прохождение:');
const cleared = new Map(res.firstClears.map((fc) => [fc.stageId, fc]));
for (const s of ctx.content.stages) {
  const fc = cleared.get(s.id);
  const when = fc ? `день ${fc.day}, сессия ${fc.session} (${fc.time_h} ч), боёв ${fc.attempts}` : `не пройден (боёв ${res.stageAttempts[s.id] ?? 0})`;
  console.log(`  ${s.id.padEnd(8)} ${name(s.id).padEnd(24)} ${when}`);
  if (!fc && !res.stageAttempts[s.id]) {
    const rest = ctx.content.stages.length - ctx.content.stages.indexOf(s) - 1;
    if (rest > 0) console.log(`  … и ещё ${rest} этап(ов) не тронуто`);
    break;
  }
}

console.log('\nБашня и кампания на конец дня:');
for (const d of perDay(res)) {
  console.log(`  день ${String(d.day).padStart(2)} ${d.date}: этаж ${String(d.tower_floor).padStart(3)}, этапов ${String(d.cleared_count).padStart(2)}, золото ${d.gold}, гемы ${d.gems}`);
}

const walls = findWalls(res, ctx).slice(0, 3);
if (walls.length) {
  console.log('\nСтены (топ-3 по времени):');
  for (const w of walls) console.log(`  ${w.stageId.padEnd(8)} ${name(w.stageId).padEnd(24)} ${w.hours} ч, ${w.attempts} боёв${w.cleared ? '' : ' — не пройден к концу'}`);
}

console.log('\nЭкономика (доход / расход):');
const inc = total(res.income);
const sp = total(res.spend);
for (const s of SOURCES) {
  const i = res.income[s];
  const x = res.spend[s];
  if (i.gold || i.gems || x.gold || x.gems) {
    console.log(`  ${s.padEnd(13)} золото +${i.gold}${x.gold ? ` −${x.gold}` : ''}, гемы +${i.gems}${x.gems ? ` −${x.gems}` : ''}`);
  }
}
// Стартовые золото/гемы новой игры — не доход, но входят в итог на руках.
const start = newGame(ctx, 0);
const startText = (n: number) => (n ? `${n} ` : '');
console.log(
  `  ${'итого'.padEnd(13)} золото ${startText(start.resources.gold)}+${inc.gold} −${sp.gold} = ${res.save.resources.gold}, ` +
    `гемы ${startText(start.currency.gems)}+${inc.gems} −${sp.gems} = ${res.save.currency.gems}`,
);
console.log(
  `  предметов: ${res.save.inventory.items.length} (надето ${res.save.inventory.items.filter((i) => i.equippedBy).length}), надеваний ${res.equips}, ` +
    `смен профессий ${res.jobChanges.length}, заданий ${Object.values(res.questClaims).reduce((a, n) => a + n, 0)}, ` +
    `поручений ${res.save.achievements.counters.bounties_done ?? 0}`,
);

console.log('\nСигналы:');
for (const s of signals(res, ctx)) console.log(`  • ${s}`);

console.log(`\nCSV: ${out} (${res.rows.length} строк) за ${ms.toFixed(0)} мс`);
