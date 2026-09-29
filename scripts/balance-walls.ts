/**
 * Темп глав по модели игрока: где пройдены боссы глав, стены «забери сундук» внутри глав, побед кампании по дням
 * (docs/content/balance.md, раздел 6а, «Стены внутри глав 4–7»). Только чтение — данные не меняет.
 *
 *   npx tsx scripts/balance-walls.ts                          seed 1–6, 11 дней, 4 сессии в день
 *   npx tsx scripts/balance-walls.ts --seeds 1,2,3 --days 10 --wall 4 --json /tmp/w.json
 *
 * Для каждой главы также — побед по сессиям (4-часовой слот) и больше всего за одну сессию.
 * Стена — промежуток ≥ --wall часов (4) между первыми прохождениями соседних этапов (как findWalls: этап, на котором стоял).
 * Для каждой главы: час прохождения босса (медиана и разброс), стены внутри главы (рядовые этапы) и серии побед между ними.
 */
import { writeFileSync } from 'node:fs';
import { loadFullContext, PLAYER_MODEL, runBalance } from './lib/player-model';

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const SEEDS = (opt('seeds') ?? '1,2,3,4,5,6').split(',').map(Number);
const DAYS = Number(opt('days') ?? 11);
const WALL = Number(opt('wall') ?? 4);

const ctx = loadFullContext();
const chapters = ctx.content.chapters.map((c) => c.id);
const stageChapter = new Map(ctx.content.stages.map((s) => [s.id, s.chapter]));
const bossOf = new Map(chapters.map((c) => [c, ctx.content.stages.filter((s) => s.chapter === c).at(-1)!.id]));
const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};

interface SeedRun {
  seed: number;
  boss: Record<string, number | null>;
  /** Стены по главам: этап, часов стоял, час прохождения. */
  walls: Record<string, { stage: string; hours: number; at: number }[]>;
  /** Побед (первых прохождений) по главам между стенами: серии. */
  runs: Record<string, number[]>;
  /** Побед главы по сессиям (сессия — 4-часовой слот от начала первой): «ровный темп» — не вся глава за одну сессию. */
  perSession: Record<string, number[]>;
  winsByDay: number[];
  battlesByDay: number[];
  battleWinsByDay: number[];
}

const out: SeedRun[] = [];
for (const seed of SEEDS) {
  const res = runBalance(ctx, DAYS, { ...PLAYER_MODEL, seedBase: seed });
  const t0 = res.rows[0].time_h;
  const r: SeedRun = { seed, boss: {}, walls: {}, runs: {}, perSession: {}, winsByDay: Array(DAYS).fill(0), battlesByDay: Array(DAYS).fill(0), battleWinsByDay: Array(DAYS).fill(0) };
  for (const c of chapters) {
    const bySession = new Map<number, number>();
    for (const f of res.firstClears.filter((x) => stageChapter.get(x.stageId) === c)) {
      const k = Math.floor((f.time_h - t0 + 0.01) / 4);
      bySession.set(k, (bySession.get(k) ?? 0) + 1);
    }
    r.perSession[c] = [...bySession.values()];
    r.walls[c] = [];
    r.runs[c] = [];
    const fc = res.firstClears.find((f) => f.stageId === bossOf.get(c));
    r.boss[c] = fc ? Math.round(fc.time_h - t0) : null;
  }
  let prev = t0;
  let streak = 0;
  let streakChapter = '';
  for (const f of res.firstClears) {
    const c = stageChapter.get(f.stageId)!;
    const gap = f.time_h - prev;
    if (c !== streakChapter) {
      if (streakChapter) r.runs[streakChapter].push(streak);
      streak = 0;
      streakChapter = c;
    }
    if (gap >= WALL) {
      if (streak) r.runs[c].push(streak);
      streak = 0;
      r.walls[c].push({ stage: f.stageId, hours: Math.round(gap), at: Math.round(f.time_h - t0) });
    }
    streak++;
    prev = f.time_h;
  }
  if (streakChapter) r.runs[streakChapter].push(streak);
  for (const b of res.battles) {
    if (b.kind !== 'stage') continue;
    const d = Math.min(DAYS - 1, Math.floor(b.t / 24));
    r.battlesByDay[d]++;
    if (b.win) r.battleWinsByDay[d]++;
  }
  for (const f of res.firstClears) r.winsByDay[Math.min(DAYS - 1, Math.floor(f.time_h / 24))]++;
  out.push(r);
}

console.log(`Модель: ${DAYS} дн., 4 сессии, seed ${SEEDS.join(',')}; стена — ≥ ${WALL} ч между первыми прохождениями`);
for (const c of chapters) {
  const times = out.map((r) => r.boss[c]);
  const done = times.filter((t): t is number => t !== null);
  const med = done.length * 2 > times.length ? median(times.map((t) => t ?? Infinity)) : null;
  console.log(`\n${c}: босс ${bossOf.get(c)} — медиана ${med === null ? 'не пройден' : `${med} ч (день ${Math.floor((med + 8) / 24) + 1})`}; по seed ${times.map((t) => t ?? '—').join(' / ')}`);
  for (const r of out) {
    const inner = r.walls[c].filter((w) => w.stage !== bossOf.get(c));
    const bw = r.walls[c].find((w) => w.stage === bossOf.get(c));
    console.log(
      `  seed ${r.seed}: стены ${inner.map((w) => `${w.stage} ${w.hours} ч (@${w.at})`).join(', ') || '—'}${bw ? `; босс ${bw.hours} ч` : ''}; серии побед ${r.runs[c].join('+')}; по сессиям ${r.perSession[c].join('+')}`,
    );
  }
  const innerCounts = out.map((r) => r.walls[c].filter((w) => w.stage !== bossOf.get(c)).length);
  console.log(`  стен внутри главы (медиана): ${median(innerCounts)}; по seed ${innerCounts.join(' ')}`);
  const maxShare = out.map((r) => Math.max(0, ...r.perSession[c]));
  console.log(`  больше всего побед главы за одну сессию: медиана ${median(maxShare)}; по seed ${maxShare.join(' ')}`);
}
console.log(`\nПобед (первых прохождений) по дням: seed 1 — ${out[0].winsByDay.join(' ')}`);
console.log(`  медиана — ${Array.from({ length: DAYS }, (_, d) => median(out.map((r) => r.winsByDay[d]))).join(' ')}`);
console.log(`  боёв/побед кампании по дням, seed 1: ${out[0].battlesByDay.map((b, d) => `${b}/${out[0].battleWinsByDay[d]}`).join(', ')}`);
console.log(`  дней без побед (по seed): ${out.map((r) => r.winsByDay.filter((w) => w === 0).length).join(' ')}`);
if (opt('json')) writeFileSync(opt('json')!, JSON.stringify(out, null, 1) + '\n');
