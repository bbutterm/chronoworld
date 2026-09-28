/**
 * Инструмент баланса (T7, v2): модель игрока проходит полный цикл игры D дней — кампания, башня, экипировка,
 * быстрые награды, задания, поручения, достижения. Только функции ядра (обёртки act*).
 *   npm run balance                           14 дней, CSV в balance.csv
 *   npm run balance -- --days 10 --sessions 6 --out /tmp/b.csv
 *   npm run balance -- --days 7 --no-events   без «Входа 7 дней», «7 дней новичка» и почты (сравнить «до/после»)
 * Модель игрока — scripts/lib/player-model.ts (PLAYER_MODEL). Описание — docs/content/balance.md.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { newGame, recommendedPower } from '../src/core';
import { ROOT } from './lib/content-node';
import { findWalls, fitRecommended, hookMetrics, loadFullContext, perDay, PLAYER_MODEL, runBalance, signals, SOURCES, timeline, toCsv, total } from './lib/player-model';

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
const model = {
  ...PLAYER_MODEL,
  sessionsPerDay: intArg('sessions', PLAYER_MODEL.sessionsPerDay),
  sessionMinutes: intArg('minutes', PLAYER_MODEL.sessionMinutes),
  fastRewardsPerDay: arg('fast') !== undefined ? Number(arg('fast')) : PLAYER_MODEL.fastRewardsPerDay,
  events: !process.argv.includes('--no-events'),
};
const out = resolve(ROOT, arg('out') ?? 'balance.csv');

const started = performance.now();
const ctx = loadFullContext();

if (process.argv.includes('--fit-recommended')) {
  // Подбор power.recommendedStages: пороги мощи по 12 моделям игрока (docs/content/balance.md, «Рекомендуемая мощь»).
  const fit = fitRecommended(ctx, days);
  const defaults = ctx.features.power;
  const overrides: Record<string, number> = {};
  console.log('этап      поражение  победа  порог  сейчас  предложение  (доля от мощи врагов; моделей с поражением)');
  for (const f of fit) {
    const stage = ctx.content.stages.find((s) => s.id === f.stageId)!;
    const def = (stage.boss ? (defaults.recommendedBoss ?? defaults.recommended) : defaults.recommended) ?? 1;
    if (Math.abs(f.suggested / def - 1) > 0.05) overrides[f.stageId] = f.suggested;
    console.log(
      `${f.stageId.padEnd(8)}  ${f.loss.toFixed(2).padStart(9)}  ${f.win.toFixed(2).padStart(6)}  ${f.threshold.toFixed(2)}  ${f.current.toFixed(2).padStart(6)}  ${f.suggested.toFixed(2).padStart(11)}  (${f.n})`,
    );
  }
  console.log(`\npower.recommendedStages (отличие от общего коэффициента > 5%):\n${JSON.stringify(overrides, null, 2)}`);
  process.exit(0);
}
const res = runBalance(ctx, days, model);
writeFileSync(out, toCsv(res.rows));
const ms = performance.now() - started;

const stage = (id: string) => ctx.content.stages.find((s) => s.id === id);
const name = (id: string) => stage(id)?.name ?? id;
console.log(
  `Модель: ${days} дн. с ${model.startDate} × ${model.sessionsPerDay} сесс. по ${model.sessionMinutes} мин (первая — ${model.firstSessionMinutes} мин, в ${model.firstSessionHour}:00, шаг ${model.hoursBetweenSessions} ч), ` +
    `кампания до ${model.maxLossesPerSession} пораж., башня до ${model.towerMaxAttemptsPerSession} штурмов/${model.towerMaxLossesPerSession} пораж. за сессию`,
);
console.log(`Этапов в кампании: ${ctx.content.stages.length}, пройдено: ${res.save.campaign.cleared.length}`);

console.log('\nПервое прохождение:');
const cleared = new Map(res.firstClears.map((fc) => [fc.stageId, fc]));
for (const s of ctx.content.stages) {
  const fc = cleared.get(s.id);
  const when = fc
    ? `день ${fc.day}, сессия ${fc.session} (${fc.time_h.toFixed(1)} ч, актив ${fc.active_min} мин), боёв ${fc.attempts}`
    : `не пройден (боёв ${res.stageAttempts[s.id] ?? 0})`;
  console.log(`  ${s.id.padEnd(8)} ${name(s.id).padEnd(24)} рек. ${String(recommendedPower(s.id, ctx)).padStart(6)}  ${when}`);
  if (!fc && !res.stageAttempts[s.id]) {
    const rest = ctx.content.stages.length - ctx.content.stages.indexOf(s) - 1;
    if (rest > 0) console.log(`  … и ещё ${rest} этап(ов) не тронуто`);
    break;
  }
}

console.log('\nНа конец дня:');
for (const d of perDay(res)) {
  const g = res.gemsByDay[d.day - 1] ?? { income: 0, spend: 0 };
  console.log(
    `  день ${String(d.day).padStart(2)}: этап ${d.stage_reached.padEnd(8)} (${String(d.cleared_count).padStart(2)}), этаж ${String(d.tower_floor).padStart(3)}, ` +
      `ур. ${d.avg_level}, отряд ${d.rarities}, призвано ${d.summons}, золото ${d.gold}, гемы ${d.gems} (+${g.income} −${g.spend})`,
  );
}

const hm = hookMetrics(res, ctx);
console.log('\nПо часам (от начала первой сессии; мощь — перед последним боем):');
console.log('  время      этап     пройд.  мощь / рек.        ур.  повыш.  отряд   призв.');
const marks = [0.25, 0.5, 0.75, 1, 2, 4, 8, 12, 24, 36, 48, 72, 96, 120, 144, 168].filter((h) => h <= days * 24);
for (const p of timeline(res, ctx, marks)) {
  const label = p.h < 1 ? `${Math.round(p.h * 60)} мин` : `${p.h} ч`;
  console.log(
    `  ${label.padEnd(9)}  ${p.stage.padEnd(8)} ${String(p.cleared).padStart(3)}  ${String(p.power).padStart(6)} / ${String(p.rec).padStart(6)} (${p.ratio.toFixed(2)})  ` +
      `${String(p.avgLevel).padStart(4)}  ${String(p.levelUps).padStart(5)}  ${p.rarities.padEnd(6)}  ${String(p.summons).padStart(4)}`,
  );
}

console.log('\nКрючки:');
const ch = (xs: (number | null)[], unit: string) => xs.map((x, i) => `гл.${i + 1} ${x === null ? '—' : `${x} ${unit}`}`).join(', ');
console.log(`  главы — активных минут: ${ch(hm.chapterActiveMin, 'мин')}`);
console.log(`  главы — часов от начала: ${ch(hm.chapterHours, 'ч')}`);
console.log(`  первые 30 мин: боёв ${hm.first30.battles}, повышений ${hm.first30.levelUps} (боёв на повышение ${hm.first30.battlesPerLevelUp})`);
console.log(`  прирост за уровень (мощь / боевая сила hp×atk): ${hm.levelGainPct.map((b) => `ур. ${b.band}: +${b.pct}% / +${b.effPct}% (${b.n})`).join(', ')}`);
console.log(`  первые 30 мин: мощь отряда между боями с «Улучшить» +${hm.first30BurstPct}%; повышений за активный час по дням: ${hm.levelUpsPerActiveHour.join(' ')}`);
console.log(`  первое вознесение: ${hm.firstAscend ? `${hm.firstAscend.templateId} → ${hm.firstAscend.rarity}, актив ${hm.firstAscend.active_min} мин (${hm.firstAscend.hours} ч)` : '—'}`);
console.log(`  первый ×10: ${hm.firstTen ? `${hm.firstTen.pay}, актив ${hm.firstTen.active_min} мин (${hm.firstTen.hours} ч)` : '—'}; ×10 за гемы по дням: ${hm.tenPullsByDay.join(' ')}`);
console.log(`  стены ≥ 4 ч: ${hm.walls.map((w) => `${w.stageId} ${w.hours} ч`).join(', ') || 'нет'}`);
console.log(`  поражения по мощь/рек.: ${hm.lossRatio.map((b) => `${b.band}: ${b.n}`).join(', ')}`);
console.log(`  победы по мощь/рек.:    ${hm.winRatio.map((b) => `${b.band}: ${b.n}`).join(', ')}`);

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
  if (i.gold || i.gems || x.gold || x.gems || i.exp || x.exp) {
    console.log(`  ${s.padEnd(13)} золото +${i.gold}${x.gold ? ` −${x.gold}` : ''}, гемы +${i.gems}${x.gems ? ` −${x.gems}` : ''}, опыт +${i.exp}${x.exp ? ` −${x.exp}` : ''}`);
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
    `призывов ${res.summons}, вознесений ${res.ascensions.length}, заданий ${Object.values(res.questClaims).reduce((a, n) => a + n, 0)}, ` +
    `поручений ${res.save.achievements.counters.bounties_done ?? 0}`,
);
const scrolls = Object.entries(res.scrollsIn).map(([k, n]) => `${k} ${n}`).join(', ');
if (scrolls) console.log(`  свитки призыва: ${scrolls}`);
if (model.events) {
  // События новичка (data/events.json): когда получены награды входа и сундуки новичка.
  const when = (kind: string) => res.eventClaims.filter((e) => e.kind === kind).map((e) => `${e.id}@д${e.day}`).join(' ');
  console.log('\nСобытия новичка:');
  console.log(`  вход 7 дней (день входа @ день модели): ${when('login') || '—'}`);
  console.log(`  новичок: заданий ${res.eventClaims.filter((e) => e.kind === 'newbie_task').length} из ${ctx.events.newbie.days.reduce((a, d) => a + d.tasks.length, 0)}, сундуки (очки @ день): ${when('newbie_chest') || '—'}`);
  console.log(`  письма (забрано @ день): ${when('mail') || '—'}`);
}

console.log('\nСигналы:');
for (const s of signals(res, ctx)) console.log(`  • ${s}`);

console.log(`\nCSV: ${out} (${res.rows.length} строк) за ${ms.toFixed(0)} мс`);
