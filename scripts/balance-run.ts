/**
 * Один прогон модели игрока для подборщиков (scripts/balance-smooth.ts --fit, balance-stagefit, balance-pace,
 * balance --fit-recommended): печатает JSON — часы первых прохождений этапов, мощь отряда в боях (от начала первой сессии),
 * бои этапов (для рекомендуемой мощи), конец прогона. Подборщики запускают по процессу на seed параллельно (runModels) —
 * выдачи Таверны разбрасывают темп, и медиана по многим seed устойчивее.
 *   npx tsx scripts/balance-run.ts <seed> <дней> [сессий в день]
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fitModel, loadFullContext, PLAYER_MODEL, runBalance, type StageBattle } from './lib/player-model';

export interface ModelRun {
  seed: number;
  /** Сессий в день модели (4 — PLAYER_MODEL). */
  sessions?: number;
  /** Конец прогона, часов от начала первой сессии. */
  end: number;
  /** [этап, час первого прохождения]. */
  clears: [string, number][];
  /** [час, мощь отряда] каждого боя. */
  battles: [number, number][];
  /** Бои этапов кампании: этап, победа, мощь отряда. */
  stageBattles?: StageBattle[];
}

/**
 * Прогоны модели по seed параллельно: отдельные процессы, не больше jobs одновременно (8 — ≈ 1.5 ГБ памяти).
 * sessions — сессий в день (по умолчанию как PLAYER_MODEL); модель — как у fitRecommended (fitModel).
 */
export async function runModels(seeds: number[], days: number, sessions?: number, jobs = 8): Promise<ModelRun[]> {
  const self = fileURLToPath(import.meta.url);
  const one = (seed: number) =>
    new Promise<ModelRun>((resolve, reject) => {
      const args = [...process.execArgv, self, String(seed), String(days), ...(sessions ? [String(sessions)] : [])];
      const p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'] });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.on('close', (code) => (code ? reject(new Error(`balance-run seed ${seed}: код ${code}`)) : resolve(JSON.parse(out) as ModelRun)));
    });
  const out: ModelRun[] = new Array(seeds.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(jobs, seeds.length) }, async () => {
      while (next < seeds.length) {
        const i = next++;
        out[i] = await one(seeds[i]);
      }
    }),
  );
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [seed, days, sessions] = process.argv.slice(2).map(Number);
  const model = sessions ? fitModel(sessions, seed) : { ...PLAYER_MODEL, seedBase: seed };
  const res = runBalance(loadFullContext(), days, model);
  const t0 = res.rows[0].time_h;
  const run: ModelRun = {
    seed,
    sessions: model.sessionsPerDay,
    end: res.rows[res.rows.length - 1].time_h - t0,
    clears: res.firstClears.map((f) => [f.stageId, f.time_h - t0]),
    battles: res.battles.map((b) => [b.t - t0, b.squadPower]),
    stageBattles: res.battles.filter((b) => b.kind === 'stage').map((b) => ({ target: b.target, win: b.win, squadPower: b.squadPower })),
  };
  process.stdout.write(JSON.stringify(run));
}
