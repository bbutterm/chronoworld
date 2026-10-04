/**
 * Подбор только двух Fabre ch1_s1 в памяти; campaign JSON и сохранения не записываются.
 * Проверяет стартовый состав ур.1/2 и, при --driver, полную первую главу легальным драйвером.
 *
 * npx tsx scripts/first-stage-combat-audit.ts --source /path/checkout \
 *   --driver /path/checkout/scripts/night-playthrough.ts --out /tmp/first-stage.json
 * Драйвер должен экспортировать runNightCampaign; его checkout задаёт реализацию действий.
 * По умолчанию 256 боевых seed для каждого уровня и 32 начальных seed легального прохождения.
 * После применения множителя в контенте задайте --baseline-mult 0.8085 для прежнего сравнения.
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
function count(name: string, fallback: number): number {
  const n = Number(arg(name) ?? fallback);
  if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error(`--${name}: целое от 1 до 1000`);
  return n;
}
const root = resolve(arg('source') ?? resolve(import.meta.dirname, '..'));
const seeds = count('seeds', 256), chapterSeeds = count('chapter-seeds', 32);
const out = resolve(arg('out') ?? '/tmp/chronoworld-first-stage-audit.json');
const candidate = Number(arg('mult') ?? 1.8);
if (!Number.isFinite(candidate) || candidate <= 0) throw new Error('--mult: положительное число');
const core = await import(pathToFileURL(resolve(root, 'src/core/index.ts')).href) as typeof import('../src/core');
const node = await import(pathToFileURL(resolve(root, 'scripts/lib/content-node.ts')).href) as typeof import('./lib/content-node');
const ctx = node.loadFullContext();
const stage = ctx.content.stages.find(s => s.id === 'ch1_s1');
if (!stage || stage.enemies.filter(Boolean).length !== 2 || stage.enemies.some(e => e && e.unit !== 'mob_fabre')) {
  throw new Error('ch1_s1 должен содержать ровно двух Fabre');
}
const sourceMult = stage.enemies.find(e => e)!.mult ?? 1;
if (stage.enemies.some(e => e && (e.mult ?? 1) !== sourceMult)) throw new Error('Разные исходные mult у Fabre');
const original = Number(arg('baseline-mult') ?? sourceMult);
if (!Number.isFinite(original) || original <= 0) throw new Error('--baseline-mult: положительное число');
if (original === candidate) throw new Error('Множитель уже применён; задайте прежний --baseline-mult для сравнения');
const digest = () => {
  const h = createHash('sha256');
  for (const p of ['src/core/battle.ts', 'data/combat.json', 'data/campaign/chapter1.json']) {
    h.update(p).update('\0').update(readFileSync(resolve(root, p))).update('\0');
  }
  return h.digest('hex');
};
const sourceDigest = digest();
function fitted(mult: number): FullContext {
  return { ...ctx, content: { ...ctx.content, stages: ctx.content.stages.map(s => s.id === stage!.id
    ? { ...s, enemies: s.enemies.map(e => e ? { ...e, mult } : null) } : s) } };
}
function durationStats(values: number[]) {
  const v = [...values].sort((a, b) => a - b);
  return { min: v[0], median: v[Math.floor(v.length / 2)], max: v.at(-1)!, mean: v.reduce((a, b) => a + b, 0) / v.length };
}
const save = core.newGame(ctx, 0);
const unitCombats = [];
for (const level of [1, 2]) {
  const squad = save.squad.map(id => id ? core.buildUnit({ ...save.heroes.find(h => h.id === id)!, level }, ctx) : null);
  for (const mult of [original, candidate]) {
    const combatContext = fitted(mult);
    const foes = core.enemySquad(stage.id, combatContext);
    let wins = 0, alanAlive = 0, ultsA = 0;
    const durations: number[] = [];
    for (let seed = 1; seed <= seeds; seed++) {
      const result = core.simulateBattle(ctx.content, squad, foes, seed, { combat: ctx.combat });
      wins += Number(result.winner === 'A');
      alanAlive += Number(result.report.A0.alive);
      ultsA += Object.values(result.report).filter(u => u.uid.startsWith('A')).reduce((n, u) => n + u.ults, 0);
      durations.push(result.duration);
    }
    const row = { level, mult, seeds, wins, alanAlive, ultsA, duration: durationStats(durations) };
    unitCombats.push(row);
    console.log(JSON.stringify(row));
  }
}
interface DriverResult {
  cleared: number; totalWaits: number;
  attempts: { stage: string; winner: string; duration: number; ults: { A: number; B: number; firstA: number | null } }[];
}
type Driver = (context: FullContext, options: { seedBase: number; maxStages: number; maxWaits: number }) => DriverResult;
const chapters = [];
const driverPath = arg('driver') ? resolve(arg('driver')!) : undefined;
if (driverPath) {
  const driverModule = await import(pathToFileURL(driverPath).href) as { runNightCampaign?: Driver };
  const run = driverModule.runNightCampaign;
  if (typeof run !== 'function') throw new Error('--driver должен экспортировать runNightCampaign');
  for (const mult of [original, candidate]) {
    const chapterContext = fitted(mult);
    const outcomes = [];
    for (let seedBase = 1; seedBase <= chapterSeeds; seedBase++) {
      const result = run(chapterContext, { seedBase, maxStages: 18, maxWaits: 0 });
      const first = result.attempts.find(a => a.stage === stage.id);
      if (!first) throw new Error(`Драйвер не сыграл ${stage.id}`);
      outcomes.push({ seedBase, complete: result.cleared === 18, cleared: result.cleared,
        totalAttempts: result.attempts.length, losses: result.attempts.filter(a => a.winner !== 'A').length,
        waits: result.totalWaits, firstDuration: first.duration, firstUlts: first.ults,
        stageWins: result.attempts.filter(a => a.winner === 'A').map(a => ({ stage: a.stage, duration: a.duration, ults: a.ults })) });
    }
    const row = { mult, seeds: chapterSeeds, completed: outcomes.filter(o => o.complete).length,
      cleared: outcomes.reduce((n, o) => n + o.cleared, 0), attempts: outcomes.reduce((n, o) => n + o.totalAttempts, 0),
      losses: outcomes.reduce((n, o) => n + o.losses, 0), waits: outcomes.reduce((n, o) => n + o.waits, 0),
      firstDuration: durationStats(outcomes.map(o => o.firstDuration)), outcomes };
    chapters.push(row);
    const { outcomes: _outcomes, ...brief } = row;
    console.log(JSON.stringify(brief));
  }
}
if (digest() !== sourceDigest) throw new Error('Источник менялся во время аудита; результат не сохранён');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ source: root, sourceDigest, driver: driverPath ?? null,
  candidateOnlyInMemory: true, stage: stage.id, originalMult: original, candidateMult: candidate,
  unitCombats, chapters }, null, 2) + '\n');
console.log(`Сохранён audit без правки контента: ${out}`);
