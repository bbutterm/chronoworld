/**
 * Осознанное обновление regression reference нулевого профиля после изменения общей симуляции/контента.
 * Без --write проверяет эталон; с --write сохраняет хэши и три читаемых trace. Не вызывается из test/check.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadFullContext, ROOT } from './lib/content-node';
import { scenarioHashes, MIRRORS } from '../tests/behavior-scenarios';
import type { BattleResult } from '../src/core';

const ctx = loadFullContext();
const hashesPath = join(ROOT, 'tests/fixtures/behavior-zero-hashes.json');
const referencePath = join(ROOT, 'tests/fixtures/behavior-zero-reference.json');
const traceKeys = new Set(['ch1_s10/sq0#1', 'ch9_s18/sq3#2', `${MIRRORS[0].join('|')}#1`]);
const traces: Record<string, Pick<BattleResult, 'winner' | 'reason' | 'duration' | 'log'>> = {};
const hashes = scenarioHashes(ctx, 4, { behavior: false }, (key, r) => {
  if (traceKeys.has(key)) traces[key] = { winner: r.winner, reason: r.reason, duration: r.duration, log: r.log.slice(0, 40) };
});
const reference = {
  revision: 'combat-tempo-2026-10-04',
  reason: '04.10: actionThreshold 1000 → 1500, общая энергия 25/10 → 18/5 и корректное истечение статусов. Глобальные изменения действуют и с behavior:false; составы, seeds и полный hash-контроль сохранены.',
  scenarioCount: Object.keys(hashes).length,
  seeds: 4,
  config: {
    tickSeconds: ctx.combat.tickSeconds,
    actionThreshold: ctx.combat.actionThreshold,
    timeLimitSeconds: ctx.combat.timeLimitSeconds,
    statusTurnSeconds: ctx.combat.statusTurnSeconds,
    energy: { max: ctx.combat.energy.max, perBasicAction: ctx.combat.energy.perBasicAction, perHitTaken: ctx.combat.energy.perHitTaken },
  },
  traces,
};
if (reference.scenarioCount !== 292 || Object.keys(traces).length !== traceKeys.size) throw new Error('Неполный набор сценариев');
const old = JSON.parse(readFileSync(hashesPath, 'utf8')) as Record<string, string>;
const changed = Object.keys(hashes).filter(key => old[key] !== hashes[key]);
if (process.argv.includes('--write')) {
  writeFileSync(hashesPath, JSON.stringify(hashes, null, 2) + '\n');
  writeFileSync(referencePath, JSON.stringify(reference, null, 2) + '\n');
  console.log(`Обновлён эталон ${reference.revision}: ${reference.scenarioCount} боёв, ${changed.length} изменённых хэшей, ${traceKeys.size} trace.`);
} else {
  const saved = JSON.parse(readFileSync(referencePath, 'utf8'));
  const sameKeys = JSON.stringify(Object.keys(old).sort()) === JSON.stringify(Object.keys(hashes).sort());
  const sameReference = JSON.stringify(saved) === JSON.stringify(reference);
  console.log(`${reference.scenarioCount} боёв: ${changed.length} изменённых хэшей; trace ${sameReference ? 'совпадает' : 'изменился'}.`);
  if (changed.length || !sameKeys || !sameReference) process.exitCode = 1;
}
