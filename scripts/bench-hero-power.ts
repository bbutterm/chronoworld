/** Парный микрозамер прежнего/нового heroPower на реальном сохранении, без хрупкого порога в CI. */
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildUnit, deserialize, heroPower, unitPower, withGear, type HeroState } from '../src/core';
import { loadFullContext } from './lib/content-node';

const args = process.argv.slice(2);
const index = args.indexOf('--save');
if (index < 0 || !args[index + 1]) throw new Error('Нужен --save /путь/к/реальному/save.json');
const raw = readFileSync(args[index + 1], 'utf8');
const ctx = loadFullContext();
const save = deserialize(raw);
const countIndex = args.indexOf('--iterations');
const iterations = countIndex < 0 ? 3000 : Number(args[countIndex + 1]);
if (!Number.isSafeInteger(iterations) || iterations < 1) throw new Error('--iterations: нужен положительный целый параметр');
if (!save.heroes.length) throw new Error('В сохранении нет героев');
const legacy = (hero: HeroState) => unitPower(buildUnit(hero, withGear(ctx, save)), ctx);
const current = (hero: HeroState) => heroPower(hero, ctx, save);
for (const hero of save.heroes) assert.equal(current(hero), legacy(hero));
function measure(calculate: (hero: HeroState) => number): { milliseconds: number; checksum: number } {
  let checksum = 0;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) checksum += calculate(save.heroes[i % save.heroes.length]);
  return { milliseconds: performance.now() - start, checksum };
}
for (let i = 0; i < 100; i++) { legacy(save.heroes[i % save.heroes.length]); current(save.heroes[i % save.heroes.length]); }
const samples = [];
for (let sample = 0; sample < 5; sample++) {
  const old = sample % 2 ? undefined : measure(legacy);
  const recipient = measure(current);
  const wholeRoster = old ?? measure(legacy);
  assert.equal(recipient.checksum, wholeRoster.checksum);
  samples.push({ wholeRosterMs: wholeRoster.milliseconds, recipientMs: recipient.milliseconds, checksum: recipient.checksum });
}
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const oldMedian = median(samples.map((s) => s.wholeRosterMs));
const newMedian = median(samples.map((s) => s.recipientMs));
console.log(JSON.stringify({ saveSha256: createHash('sha256').update(raw).digest('hex'), heroes: save.heroes.length, items: save.inventory.items.length, equippedItems: save.inventory.items.filter((item) => item.equippedBy).length, iterations, samples, medianWholeRosterMs: oldMedian, medianRecipientMs: newMedian, speedup: oldMedian / newMedian, exactPowerAndChecksum: true }, null, 2));
