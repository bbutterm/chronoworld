/**
 * Один прогон модели игрока для подборщиков (scripts/balance-smooth.ts --fit): печатает JSON — часы первых прохождений
 * этапов и мощь отряда в боях (от начала первой сессии), конец прогона. Подборщик запускает по процессу на seed
 * параллельно (runModels) — выдачи Таверны разбрасывают темп, и медиана по 5 seed устойчивее, чем по 3.
 *   npx tsx scripts/balance-run.ts <seed> <дней>
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadFullContext, PLAYER_MODEL, runBalance } from './lib/player-model';

export interface ModelRun {
  seed: number;
  /** Конец прогона, часов от начала первой сессии. */
  end: number;
  /** [этап, час первого прохождения]. */
  clears: [string, number][];
  /** [час, мощь отряда] каждого боя. */
  battles: [number, number][];
}

/** Прогоны модели по seed параллельно (отдельные процессы). */
export function runModels(seeds: number[], days: number): Promise<ModelRun[]> {
  const self = fileURLToPath(import.meta.url);
  return Promise.all(
    seeds.map(
      (seed) =>
        new Promise<ModelRun>((resolve, reject) => {
          const p = spawn(process.execPath, [...process.execArgv, self, String(seed), String(days)], { stdio: ['ignore', 'pipe', 'inherit'] });
          let out = '';
          p.stdout.on('data', (d) => (out += d));
          p.on('close', (code) => (code ? reject(new Error(`balance-run seed ${seed}: код ${code}`)) : resolve(JSON.parse(out) as ModelRun)));
        }),
    ),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [seed, days] = process.argv.slice(2).map(Number);
  const res = runBalance(loadFullContext(), days, { ...PLAYER_MODEL, seedBase: seed });
  const t0 = res.rows[0].time_h;
  const run: ModelRun = {
    seed,
    end: res.rows[res.rows.length - 1].time_h - t0,
    clears: res.firstClears.map((f) => [f.stageId, f.time_h - t0]),
    battles: res.battles.map((b) => [b.t - t0, b.squadPower]),
  };
  process.stdout.write(JSON.stringify(run));
}
