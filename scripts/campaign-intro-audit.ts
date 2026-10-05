/**
 * Парное легальное прохождение 18 этапов после перестановки знакомства Ива/Попоринг.
 * npx tsx scripts/campaign-intro-audit.ts --driver /path/scripts/night-playthrough.ts --seeds 32
 * Исходный mob_poporing восстанавливается только в памяти; текущий mob_tank проверяется по JSON.
 * Драйвер экспортирует runNightCampaign и выполняет реальные действия из newGame без выдачи ресурсов.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FullContext } from '../src/core';

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
}
const root = resolve(arg('source') ?? resolve(import.meta.dirname, '..'));
const driverArg = arg('driver');
if (!driverArg) throw new Error('Нужен --driver с экспортом runNightCampaign');
const driverPath = resolve(driverArg);
const seeds = Number(arg('seeds') ?? 32);
if (!Number.isInteger(seeds) || seeds < 1 || seeds > 1000) throw new Error('--seeds: целое от 1 до 1000');
const out = resolve(arg('out') ?? '/tmp/chronoworld-campaign-intro-audit.json');
const digest = () => createHash('sha256').update(['src/core/battle.ts', 'data/combat.json',
  'data/progression.json', 'data/campaign/chapter1.json'].map(p => `${p}\0${readFileSync(resolve(root, p), 'utf8')}\0`).join(''))
  .update(readFileSync(driverPath)).digest('hex');
const sourceDigest = digest();
const node = await import(pathToFileURL(resolve(root, 'scripts/lib/content-node.ts')).href) as typeof import('./lib/content-node');
const after = node.loadFullContext();
const stage = after.content.stages.find(s => s.id === 'ch1_s4');
if (stage?.enemies[2]?.unit !== 'mob_tank' || stage.enemies[2].mult !== 0.9818)
  throw new Error('После правки ch1_s4/слот2 должен быть mob_tank с прежним .9818');
const before: FullContext = { ...after, content: { ...after.content, stages: after.content.stages.map(s => s.id === stage.id
  ? { ...s, enemies: s.enemies.map((e, j) => j === 2 && e ? { ...e, unit: 'mob_poporing' } : e) } : s) } };
function firstEncounter(ctx: FullContext, unit: string) {
  const s = ctx.content.stages.find(s => s.chapter === 'chapter1' && s.enemies.some(e => e?.unit === unit));
  if (!s) throw new Error(`Нет ${unit} в первой главе`);
  return { stage: s.id, order: s.index + 1, slot: s.enemies.findIndex(e => e?.unit === unit) };
}
const intro = {
  before: { willow: firstEncounter(before, 'mob_tank'), poporing: firstEncounter(before, 'mob_poporing') },
  after: { willow: firstEncounter(after, 'mob_tank'), poporing: firstEncounter(after, 'mob_poporing') },
};
if (intro.after.willow.order >= intro.after.poporing.order) throw new Error('Ива не предшествует Попорингу');
interface Attempt { stage: string; winner: string; duration: number; seed: number; power: number }
interface DriverResult { cleared: number; totalWaits: number; attempts: Attempt[] }
type Driver = (ctx: FullContext, options: { seedBase: number; maxStages: number; maxWaits: number }) => DriverResult;
const driver = await import(pathToFileURL(driverPath).href) as { runNightCampaign?: Driver };
if (typeof driver.runNightCampaign !== 'function') throw new Error('--driver не экспортирует runNightCampaign');
const cohorts = [];
for (const [revision, ctx] of [['before', before], ['after', after]] as const) {
  const outcomes = [];
  for (let seedBase = 1; seedBase <= seeds; seedBase++) {
    const r = driver.runNightCampaign(ctx, { seedBase, maxStages: 18, maxWaits: 0 });
    outcomes.push({ seedBase, cleared: r.cleared, waits: r.totalWaits, attempts: r.attempts.length,
      losses: r.attempts.filter(a => a.winner !== 'A').length,
      changedStage: r.attempts.filter(a => a.stage === stage.id),
      wins: r.attempts.filter(a => a.winner === 'A').map(a => ({ stage: a.stage, duration: a.duration, seed: a.seed, power: a.power })) });
  }
  const row = { revision, seeds, completed: outcomes.filter(o => o.cleared === 18).length,
    cleared: outcomes.reduce((n, o) => n + o.cleared, 0), attempts: outcomes.reduce((n, o) => n + o.attempts, 0),
    losses: outcomes.reduce((n, o) => n + o.losses, 0), waits: outcomes.reduce((n, o) => n + o.waits, 0), outcomes };
  cohorts.push(row);
  const { outcomes: _outcomes, ...brief } = row;
  console.log(JSON.stringify(brief));
}
const [baseline, candidate] = cohorts;
const regressions = candidate.outcomes.filter((o, i) => o.cleared < baseline.outcomes[i].cleared ||
  o.losses > baseline.outcomes[i].losses || o.waits > baseline.outcomes[i].waits);
if (digest() !== sourceDigest) throw new Error('Источник менялся во время аудита; результат не сохранён');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ sourceDigest, source: root, driver: driverPath,
  simulatedContextsOnly: true, comparison: 'Только ch1_s4/enemies/2 unit; mult=.9818 и остальные данные одинаковы',
  intro, cohorts, regressionSeeds: regressions.map(r => r.seedBase) }, null, 2) + '\n');
if (candidate.completed !== seeds || regressions.length) throw new Error(`Не все главы пройдены либо регрессия: ${regressions.length}`);
console.log(JSON.stringify({ out, intro, regressionSeeds: [] }));
