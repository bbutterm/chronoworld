/**
 * Read-only сопоставление подсказки мощи с журналами и replay легальных saved-партий.
 * npx tsx scripts/power-hint-audit.ts --manifest /tmp/power-profiles.json --seeds 64 --out /tmp/power-hint.json
 * Manifest: { runs: [{ name, attempts: "/tmp/attempts.jsonl" }],
 *   profiles: [{ name, save: "/tmp/save.json", clock: "/tmp/save.clock.json", stages: ["ch9_s10"] }] }.
 * --source выбирает checkout; используется его текущий combat config. Saves/контент не меняются.
 * Частоты условны для конкретного состава; единственная первая победа не считается устойчивым порогом.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BattleResult } from '../src/core';

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
}
const root = resolve(arg('source') ?? resolve(import.meta.dirname, '..'));
const manifestArg = arg('manifest');
if (!manifestArg) throw new Error('Нужен --manifest');
const manifestPath = resolve(manifestArg);
interface Profile { name: string; save: string; clock: string; stages: string[] }
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  runs: { name: string; attempts: string }[]; profiles: Profile[];
};
if (!Array.isArray(manifest.runs) || !Array.isArray(manifest.profiles)) throw new Error('Неверный manifest');
const seeds = Number(arg('seeds') ?? 64);
if (!Number.isInteger(seeds) || seeds < 1 || seeds > 1000) throw new Error('--seeds: целое от 1 до 1000');
const out = resolve(arg('out') ?? '/tmp/chronoworld-power-hint.json');
const path = (p: string) => resolve(dirname(manifestPath), p);
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function digest(): string {
  const files = ['src/core/battle.ts', 'src/core/features/power.ts', 'src/core/features/levels.ts'];
  function visit(dir: string) {
    for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = `${dir}/${entry.name}`;
      if (entry.isDirectory()) visit(p);
      else if (entry.isFile() && p.endsWith('.json')) files.push(p);
    }
  }
  visit('data');
  return hash(files.map(p => `${p}\0${readFileSync(resolve(root, p), 'utf8')}\0`).join(''));
}
const sourceDigest = digest();
const core = await import(pathToFileURL(resolve(root, 'src/core/index.ts')).href) as typeof import('../src/core');
const node = await import(pathToFileURL(resolve(root, 'scripts/lib/content-node.ts')).href) as typeof import('./lib/content-node');
const ctx = node.loadFullContext();
const median = (values: number[]) => {
  const v = [...values].sort((a, b) => a - b);
  return v.length ? (v[Math.floor((v.length - 1) / 2)] + v[Math.floor(v.length / 2)]) / 2 : null;
};
interface Attempt { stage: string; winner: string; power: number; recommended: number; duration: number; reason?: string }
function attemptsSummary(attempts: Attempt[]) {
  const wins = attempts.filter(a => a.winner === 'A'), losses = attempts.filter(a => a.winner !== 'A');
  const ratios = (a: Attempt[]) => a.filter(x => x.recommended > 0).map(x => x.power / x.recommended);
  const reasons: Record<string, number> = {};
  for (const a of losses) reasons[a.reason ?? 'unrecorded'] = (reasons[a.reason ?? 'unrecorded'] ?? 0) + 1;
  return { attempts: attempts.length, wins: wins.length, losses: losses.length,
    firstPower: attempts[0]?.power ?? null, firstWinPower: wins[0]?.power ?? null,
    minWinPower: wins.length ? Math.min(...wins.map(a => a.power)) : null,
    maxLossPower: losses.length ? Math.max(...losses.map(a => a.power)) : null,
    medianRatio: median(ratios(attempts)), medianWinRatio: median(ratios(wins)),
    lossesWithEasyVerdict: losses.filter(a => a.recommended > 0 && a.power / a.recommended >= 1.1).length,
    lossReasons: reasons,
  };
}
const runs = manifest.runs.map(run => {
  const text = readFileSync(path(run.attempts), 'utf8');
  const attempts: Attempt[] = text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { name: run.name, attemptsSha256: hash(text),
    total: attemptsSummary(attempts),
    chapters: [...new Set(ctx.content.stages.map(s => s.chapter))].map(chapter => ({
      chapter, ...attemptsSummary(attempts.filter(a => ctx.content.stages.some(s => s.id === a.stage && s.chapter === chapter))),
    })),
    stages: ctx.content.stages.map(stage => ({ stage: stage.id, recommended: core.recommendedPower(stage.id, ctx),
      factor: core.recommendedFactor(stage.id, ctx), ...attemptsSummary(attempts.filter(a => a.stage === stage.id)) })),
  };
});
function hpRemaining(result: BattleResult, side: 'A' | 'B'): number {
  const units = [...result.units, ...(result.spawned ?? [])].filter(u => u.side === side);
  const hp = new Map(units.map(u => [u.uid, u.hp ?? u.maxHp]));
  for (const e of result.log) if ((e.type === 'damage' || e.type === 'heal') && hp.has(e.target)) hp.set(e.target, e.hp);
  return [...hp.values()].reduce((sum, v) => sum + Math.max(0, v), 0) / Math.max(1, units.reduce((sum, u) => sum + u.maxHp, 0));
}
interface ProfileResult {
  name: string; saveSha256: string; stage: string; seedBase: number; seeds: number;
  power: number; recommended: number; ratio: number; verdict: string; factor: number; stagePower: number;
  wins: number; winRate: number; timeouts: number; lossWipes: number; medianDuration: number | null;
  winningDurationMin: number | null; winningDurationMax: number | null;
  firstSeedWinner: string; firstSeedDuration: number;
  meanPlayerHpRemaining: number; meanEnemyHpRemaining: number;
  squad: { template: string; branch: string | null; level: number; rarity: string; focus: string | null }[];
}
const profiles: ProfileResult[] = [];
for (const p of manifest.profiles) {
  const text = readFileSync(path(p.save), 'utf8');
  const clock = JSON.parse(readFileSync(path(p.clock), 'utf8')) as { now: number; day: string; seed?: number };
  if (!Number.isFinite(clock.now) || typeof clock.day !== 'string') throw new Error(`Неверный clock ${p.name}`);
  const save = core.deserialize(text, clock.day);
  const seedBase = Number.isInteger(clock.seed) && clock.seed! > 0 ? clock.seed! : save.battleSeq + 1;
  const power = core.squadPower(save, ctx);
  const squad = save.squad.flatMap(id => {
    const h = id ? save.heroes.find(hero => hero.id === id) : undefined;
    return h ? [{ template: h.templateId, branch: h.branch ?? null, level: h.level, rarity: h.rarity, focus: h.journey?.focus ?? null }] : [];
  });
  for (const stage of p.stages) {
    let wins = 0, timeouts = 0, lossWipes = 0, playerHp = 0, enemyHp = 0;
    let firstSeedWinner = '', firstSeedDuration = 0;
    const durations: number[] = [], winDurations: number[] = [];
    for (let i = 0; i < seeds; i++) {
      const result = core.playStage(save, stage, seedBase + i, ctx, clock.now, clock.day).result;
      if (i === 0) { firstSeedWinner = result.winner; firstSeedDuration = result.duration; }
      wins += Number(result.winner === 'A');
      timeouts += Number(result.reason === 'timeout');
      lossWipes += Number(result.reason === 'wipe' && result.winner !== 'A');
      durations.push(result.duration);
      if (result.winner === 'A') winDurations.push(result.duration);
      playerHp += hpRemaining(result, 'A') / seeds;
      enemyHp += hpRemaining(result, 'B') / seeds;
    }
    const check = core.stagePowerCheck(save, stage, ctx);
    const row = { name: p.name, saveSha256: hash(text), stage, seedBase, seeds,
      power, recommended: check.recommended, ratio: check.ratio, verdict: check.verdict,
      factor: core.recommendedFactor(stage, ctx, save.campaignChoices), stagePower: core.stagePower(stage, ctx, save.campaignChoices),
      wins, winRate: wins / seeds, timeouts, lossWipes, medianDuration: median(durations),
      winningDurationMin: winDurations.length ? Math.min(...winDurations) : null,
      winningDurationMax: winDurations.length ? Math.max(...winDurations) : null,
      meanPlayerHpRemaining: playerHp, meanEnemyHpRemaining: enemyHp, firstSeedWinner, firstSeedDuration, squad };
    profiles.push(row);
    console.log(JSON.stringify(row));
  }
}
const candidates = [...new Set(profiles.map(p => p.stage))].map(stage => {
  const a = profiles.filter(p => p.stage === stage), success = a.filter(p => p.winRate >= 0.8), failure = a.filter(p => p.winRate <= 0.2);
  const low = failure.length ? Math.max(...failure.map(p => p.power)) : null;
  const high = success.length ? Math.min(...success.map(p => p.power)) : null;
  const bracketed = low !== null && high !== null && low < high;
  const proposedPower = bracketed ? (low + high) / 2 * 1.03 : null;
  return { stage, currentFactor: a[0].factor, currentRecommended: a[0].recommended,
    strongestMostlyLosingPower: low, weakestReliableWinningPower: high,
    bracketedAcrossObservedCompositions: bracketed, proposedPower,
    proposedFactor: proposedPower !== null ? Math.round(proposedPower / a[0].stagePower * 10000) / 10000 : null,
    caveat: 'Диагностическая узкая гипотеза, не изменение данных: выборка конкретных составов и таймера. Если нет границы или диапазоны пересекаются, единый порог не установлен. Проверить на свежем полном after100 и соседних составах.' };
});
const drops = ctx.content.stages.slice(1).flatMap((stage, i) => {
  const previous = ctx.content.stages[i];
  const before = core.recommendedPower(previous.id, ctx), after = core.recommendedPower(stage.id, ctx);
  return after < before * 0.9 ? [{ previous: previous.id, stage: stage.id, previousRecommended: before,
    recommended: after, drop: 1 - after / before, sameChapter: previous.chapter === stage.chapter }] : [];
});
if (digest() !== sourceDigest) throw new Error('Источник менялся во время аудита; результат не сохранён');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ sourceDigest, timeLimitSeconds: ctx.combat.timeLimitSeconds, seeds,
  dataChanged: false, runs, profiles, candidates, drops }, null, 2) + '\n');
console.log(JSON.stringify({ candidates, drops: drops.length, out }));
