/**
 * Воспроизводит сохранённые легальные партии с разными лимитами боя без правки saves/контента.
 * Отдельно сравнивает все 292 Golden-сценария при behavior:false на тех же 4 seed.
 *
 * npx tsx scripts/combat-timer-audit.ts --baseline /path/before --after /path/after \
 *   --snapshots /tmp/snapshots.json --limits 90,100 --seeds 64 --out /tmp/timers.json
 * snapshots.json: [{ "name": "first-wall-7", "save": "/tmp/save.json",
 *   "clock": "/tmp/save.clock.json", "stages": ["ch7_s10"] }]
 * Clock содержит now и day из драйвера легального прохождения. Файлы только читаются.
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
function required(name: string): string {
  const value = arg(name);
  if (!value) throw new Error(`Нужен --${name}`);
  return resolve(value);
}
interface Snapshot { name: string; save: string; clock: string; stages: string[] }
const manifest = required('snapshots');
const snapshots: Snapshot[] = JSON.parse(readFileSync(manifest, 'utf8'));
if (!Array.isArray(snapshots) || !snapshots.length || snapshots.some(s =>
  typeof s.name !== 'string' || typeof s.save !== 'string' || typeof s.clock !== 'string' ||
  !Array.isArray(s.stages) || !s.stages.length || s.stages.some(x => typeof x !== 'string'))) {
  throw new Error('Неверный manifest snapshots');
}
const limits = (arg('limits') ?? '90,100').split(',').map(Number);
if (limits.length < 2 || new Set(limits).size !== limits.length || limits.some(x => !Number.isFinite(x) || x <= 0)) {
  throw new Error('--limits: минимум два разных положительных лимита');
}
const seeds = Number(arg('seeds') ?? 64);
if (!Number.isInteger(seeds) || seeds < 1 || seeds > 1000) throw new Error('--seeds: целое от 1 до 1000');
const out = resolve(arg('out') ?? '/tmp/chronoworld-combat-timers.json');
const sources = [['baseline', required('baseline')], ['combatFixes', required('after')]] as const;

function sourceDigest(root: string): string {
  const paths = ['src/core/battle.ts', 'tests/behavior-scenarios.ts'];
  function visit(dir: string) {
    for (const e of readdirSync(resolve(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) visit(p);
      else if (e.isFile() && e.name.endsWith('.json')) paths.push(p);
    }
  }
  visit('data');
  const hash = createHash('sha256');
  for (const p of paths) hash.update(p).update('\0').update(readFileSync(resolve(root, p))).update('\0');
  return hash.digest('hex');
}
function remainingHp(result: BattleResult, side: 'A' | 'B'): number {
  const units = [...result.units, ...(result.spawned ?? [])];
  const hp = new Map(units.map(u => [u.uid, u.hp ?? u.maxHp]));
  for (const e of result.log) if ((e.type === 'damage' || e.type === 'heal') && hp.has(e.target)) hp.set(e.target, e.hp);
  const friendly = units.filter(u => u.side === side);
  return friendly.reduce((sum, u) => sum + Math.max(0, hp.get(u.uid) ?? 0), 0) /
    Math.max(1, friendly.reduce((sum, u) => sum + u.maxHp, 0));
}
interface Row {
  source: string; snapshot: string; saveSha256: string; stage: string; limit: number; seedBase: number; seeds: number;
  wins: number; lossWipes: number; timeouts: number; meanDuration: number;
  meanEnemyHpRemaining: number; meanPlayerHpRemaining: number; winningDurations: number[];
}
const rows: Row[] = [];
const goldenHashes: Record<string, Record<string, Record<string, string>>> = {};
const digests: Record<string, string> = {};
for (const [source, root] of sources) {
  const digest = sourceDigest(root);
  const core = await import(pathToFileURL(resolve(root, 'src/core/index.ts')).href) as typeof import('../src/core');
  const node = await import(pathToFileURL(resolve(root, 'scripts/lib/content-node.ts')).href) as typeof import('./lib/content-node');
  const scenarios = await import(pathToFileURL(resolve(root, 'tests/behavior-scenarios.ts')).href) as typeof import('../tests/behavior-scenarios');
  const base = node.loadFullContext();
  for (const s of snapshots) {
    const savePath = resolve(dirname(manifest), s.save);
    const clockPath = resolve(dirname(manifest), s.clock);
    const text = readFileSync(savePath, 'utf8');
    const clock = JSON.parse(readFileSync(clockPath, 'utf8')) as { now: number; day: string };
    if (!Number.isFinite(clock.now) || typeof clock.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(clock.day)) {
      throw new Error(`Некорректный clock ${clockPath}`);
    }
    const save = core.deserialize(text, clock.day);
    const snapshotHash = createHash('sha256').update(text).digest('hex');
    for (const stage of s.stages) for (const limit of limits) {
      const ctx = { ...base, combat: { ...base.combat, timeLimitSeconds: limit } };
      const row: Row = { source, snapshot: s.name, saveSha256: snapshotHash, stage, limit,
        seedBase: save.battleSeq + 1, seeds, wins: 0, lossWipes: 0, timeouts: 0,
        meanDuration: 0, meanEnemyHpRemaining: 0, meanPlayerHpRemaining: 0, winningDurations: [] };
      for (let i = 0; i < seeds; i++) {
        const result = core.playStage(save, stage, row.seedBase + i, ctx, clock.now, clock.day).result;
        row.wins += Number(result.winner === 'A');
        row.lossWipes += Number(result.winner !== 'A' && result.reason === 'wipe');
        row.timeouts += Number(result.reason === 'timeout');
        row.meanDuration += result.duration / seeds;
        row.meanEnemyHpRemaining += remainingHp(result, 'B') / seeds;
        row.meanPlayerHpRemaining += remainingHp(result, 'A') / seeds;
        if (result.winner === 'A') row.winningDurations.push(result.duration);
      }
      rows.push(row);
      const { winningDurations, ...brief } = row;
      console.log(JSON.stringify({ ...brief, winningDurationMin: winningDurations.length ? Math.min(...winningDurations) : null,
        winningDurationMax: winningDurations.length ? Math.max(...winningDurations) : null }));
    }
  }
  goldenHashes[source] = {};
  for (const limit of limits) {
    const ctx = { ...base, combat: { ...base.combat, timeLimitSeconds: limit } };
    goldenHashes[source][String(limit)] = scenarios.scenarioHashes(ctx, 4, { behavior: false });
  }
  if (sourceDigest(root) !== digest) throw new Error(`Исходники ${source} менялись во время аудита; результат не сохранён`);
  digests[source] = digest;
}
function compare(a: Record<string, string>, b: Record<string, string>) {
  const keys = Object.keys(a).sort();
  if (keys.length !== 292 || JSON.stringify(keys) !== JSON.stringify(Object.keys(b).sort())) throw new Error('Изменился набор Golden-сценариев');
  const changedKeys = keys.filter(key => a[key] !== b[key]);
  return { total: keys.length, unchanged: keys.length - changedKeys.length, changed: changedKeys.length, changedKeys };
}
const original = String(limits[0]);
const golden = {
  behavior: false, seeds: 4, squadsChanged: false, perfThresholdChanged: false,
  fixesAtOriginalLimit: compare(goldenHashes.baseline[original], goldenHashes.combatFixes[original]),
  limits: limits.slice(1).map(limit => ({ limit,
    baselineLimitOnly: compare(goldenHashes.baseline[original], goldenHashes.baseline[String(limit)]),
    afterLimitOnly: compare(goldenHashes.combatFixes[original], goldenHashes.combatFixes[String(limit)]),
    fixesAtCandidateLimit: compare(goldenHashes.baseline[String(limit)], goldenHashes.combatFixes[String(limit)]),
    combined: compare(goldenHashes.baseline[original], goldenHashes.combatFixes[String(limit)]),
  })),
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ sourceDigest: digests, snapshotManifest: snapshots, limits, seeds, rows, golden }, null, 2) + '\n');
for (const { limit, baselineLimitOnly, afterLimitOnly, fixesAtCandidateLimit, combined } of golden.limits) console.log(JSON.stringify({
  goldenLimit: limit, fixesAtOriginalLimit: golden.fixesAtOriginalLimit.changed,
  baselineLimitOnly: baselineLimitOnly.changed, afterLimitOnly: afterLimitOnly.changed,
  fixesAtCandidateLimit: fixesAtCandidateLimit.changed, combined: combined.changed,
}));
console.log(`Сохранено ${rows.length} cohort и полный список изменившихся Golden-сценариев: ${out}`);
