/**
 * Симулятор боёв.
 *   npm run sim -- --a guard,warrior,archer,mage,priest --b guard,warrior,archer,mage,priest --n 1000
 *   npm run sim -- --a <отряд> --swaps --n 500     замена одного героя в зеркальном отряде
 *   npm run sim -- --log --seed 42                 лог одного боя
 *   npm run sim -- ... --behavior off              бой как до профилей поведения (docs/design/battle-behavior.md) — для сравнения
 * Отряд — 5 id юнитов через запятую по слотам (0–1 фронт, 2–4 тыл), "-" — пустой слот.
 */
import { parseSquad, runSeries, simulateBattle, swapCheck } from '../src/core';
import phase0 from '../data/phase0.json';
import { loadContent } from './lib/content-node';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const content = loadContent();
const squadA = parseSquad(arg('a') ?? phase0.defaultSquadA.join(','));
const squadB = parseSquad(arg('b') ?? arg('a') ?? phase0.defaultSquadB.join(','));
const n = Number(arg('n') ?? 1000);
const seed = Number(arg('seed') ?? 1);
const opts = { behavior: arg('behavior') !== 'off' };

const name = (id: string | null) => (id ? (content.units[id]?.name ?? id) : '—');
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmtSquad = (s: (string | null)[]) => `[${s.slice(0, 2).map(name).join(', ')} | ${s.slice(2).map(name).join(', ')}]`;

if (flag('log')) {
  const r = simulateBattle(content, squadA, squadB, seed, opts);
  for (const e of r.log) {
    const { t, type, ...rest } = e;
    console.log(`${t.toFixed(1).padStart(5)}  ${type.padEnd(7)} ${JSON.stringify(rest)}`);
  }
} else if (flag('swaps')) {
  const heroes = Object.values(content.units).filter((u) => u.kind === 'hero').map((u) => u.id);
  const started = performance.now();
  const res = swapCheck(content, squadA, n, heroes);
  const ms = performance.now() - started;
  console.log(`Замены в отряде ${fmtSquad(squadA)}, ${n} боёв × 2 стороны на вариант`);
  console.table(
    res.sort((x, y) => y.winRate - x.winRate).map((r) => ({ слот: r.slot, было: name(r.from), стало: name(r.to), винрейт: pct(r.winRate) })),
  );
  console.log(`${(ms / 1000).toFixed(2)} с`);
} else {
  const started = performance.now();
  const r = runSeries(content, squadA, squadB, n, seed, opts);
  const ms = performance.now() - started;
  console.log(`A ${fmtSquad(squadA)}`);
  console.log(`B ${fmtSquad(squadB)}`);
  console.log(`Боёв: ${n} за ${ms.toFixed(0)} мс (seed ${seed}…${seed + n - 1})`);
  console.log(`Винрейт A: ${pct(r.winRateA)}   По таймеру (поражение A): ${pct(r.timeoutRate)}`);
  console.log(`Длительность: средняя ${r.avgDuration.toFixed(1)} с, мин ${r.minDuration.toFixed(1)} с, макс ${r.maxDuration.toFixed(1)} с`);
  console.table(
    r.units.map((u) => ({
      юнит: u.uid,
      герой: name(u.heroId),
      урон: Math.round(u.avgDamage),
      лечение: Math.round(u.avgHealing),
      щит: Math.round(u.avgShield),
      ульт: u.avgUlts.toFixed(1),
      выжил: pct(u.survival),
    })),
  );
}
