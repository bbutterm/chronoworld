// Повтор первых побед из законного прохождения, без добавления ресурсов или подмены боя.
// npx tsx scripts/qa-v1-replay.ts /path/to/campaign /path/to/replay.json
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { actPlayStage, deserialize, serialize } from '../src/core/index';
import { loadFullContext } from './lib/content-node';

assert.ok(process.argv[2], 'Укажите каталог законного прохождения.');
const root = resolve(process.argv[2]);
const out = resolve(process.argv[3] ?? `${root}/replay.json`);
const ctx = loadFullContext();
const sourceFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = `${directory}/${entry.name}`;
  return entry.isDirectory() ? sourceFiles(path) : entry.isFile() ? [path] : [];
});
const sourceSha256 = createHash('sha256').update([
  ...sourceFiles('src/core'), ...sourceFiles('data'),
  'scripts/lib/player-model.ts', 'scripts/lib/tower-player.ts', 'scripts/lib/content-node.ts',
].sort().map(path => `${path}:${createHash('sha256').update(readFileSync(path)).digest('hex')}`).join('\n')).digest('hex');
assert.equal(sourceSha256, JSON.parse(readFileSync(resolve(root, 'metadata.json'), 'utf8')).sourceSha256,
  'Снимки должны соответствовать текущему ядру и контенту.');

const rows = [];
for (const file of readdirSync(resolve(root, 'saves')).filter(f => /^before-first-win-.*\.clock\.json$/.test(f)).sort()) {
  const clock = JSON.parse(readFileSync(resolve(root, 'saves', file), 'utf8'));
  const save = deserialize(readFileSync(resolve(root, 'saves', file.replace('.clock.json', '.json')), 'utf8'));
  const before = serialize(save);
  const hasCompanions = () => ['h1', 'h2', 'h3'].every(id => save.heroes.some(h => h.id === id));
  assert.ok(hasCompanions(), `${clock.stage}: исходные спутники`);
  assert.ok(!save.campaign.cleared.includes(clock.stage), `${clock.stage}: до первой победы`);
  const result = actPlayStage(save, clock.day, clock.stage, clock.seed, ctx, clock.now);
  assert.equal(result.result.winner, 'A', `${clock.stage}: победа`);
  assert.equal(serialize(save), before, `${clock.stage}: входное сохранение не изменено`);
  assert.ok(['h1', 'h2', 'h3'].every(id => result.save.heroes.some(h => h.id === id)));
  assert.equal(serialize(deserialize(serialize(result.save))), serialize(result.save), `${clock.stage}: roundtrip`);
  rows.push({ stage: clock.stage, seed: clock.seed, winner: result.result.winner, duration: result.result.duration });
}
assert.equal(rows.length, ctx.content.stages.length);
assert.equal(new Set(rows.map(row => row.stage)).size, ctx.content.stages.length);
const report = { status: 'pass', count: rows.length, sourceSha256, originalCompanionsPreserved: true, saveRoundtrip: true, rows };
writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, rows: undefined }));
