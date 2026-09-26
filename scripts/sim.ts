/**
 * Симулятор боёв.
 *   npm run sim -- --a guard,warrior,archer,mage,priest --b guard,warrior,archer,mage,priest --n 1000
 *   npm run sim -- --a <отряд> --swaps --n 500     проверка замены одного героя в зеркальном отряде
 * Отряд — 5 id героев через запятую по слотам (0–1 фронт, 2–4 тыл), "-" — пустой слот.
 */
import { HEROES, parseSquad, runSeries, swapCheck } from '../src/core';
import phase0 from '../data/phase0.json';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const squadA = parseSquad(arg('a') ?? phase0.defaultSquadA.join(','));
const squadB = parseSquad(arg('b') ?? arg('a') ?? phase0.defaultSquadB.join(','));
const n = Number(arg('n') ?? 1000);
const seed = Number(arg('seed') ?? 1);

const name = (id: string | null) => (id ? (HEROES[id]?.name ?? id) : '—');
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmtSquad = (s: (string | null)[]) => `[${s.slice(0, 2).map(name).join(', ')} | ${s.slice(2).map(name).join(', ')}]`;

if (flag('swaps')) {
  const started = performance.now();
  const res = swapCheck(squadA, n);
  const ms = performance.now() - started;
  console.log(`Замены в отряде ${fmtSquad(squadA)}, ${n} боёв × 2 стороны на вариант`);
  console.table(
    res
      .sort((x, y) => y.winRate - x.winRate)
      .map((r) => ({ слот: r.slot, было: name(r.from), стало: name(r.to), винрейт: pct(r.winRate), ok: r.winRate <= 0.65 ? '✓' : '✗ > 65%' })),
  );
  const worst = Math.max(...res.map((r) => r.winRate));
  console.log(`Максимальный винрейт замены: ${pct(worst)} ${worst <= 0.65 ? '(в норме)' : '(выше 65%!)'}; ${(ms / 1000).toFixed(2)} с`);
} else {
  const started = performance.now();
  const r = runSeries(squadA, squadB, n, seed);
  const ms = performance.now() - started;
  console.log(`A ${fmtSquad(squadA)}`);
  console.log(`B ${fmtSquad(squadB)}`);
  console.log(`Боёв: ${n} за ${ms.toFixed(0)} мс (seed ${seed}…${seed + n - 1})`);
  console.log(`Винрейт A: ${pct(r.winRateA)}   Ничьих по таймеру (поражение A): ${pct(r.timeoutRate)}`);
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
