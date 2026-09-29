/**
 * Доводка сложности поздних глав по этапам: «профиль модели» (29.09, общий баланс 10 глав; docs/content/balance.md,
 * «Общий баланс 10 глав»). balance-smooth ставит форму главы по бою эталонных отрядов (фиолетовые ур. 45 без вещей) и якоря
 * глав целиком. Но отряды модели игрока (с вещами, заточкой, золотыми и красными героями) видят главу иначе: у них свои
 * «неудобные» этапы — ch6_s3 после трёх лёгких (×1.6 разом), Совиный барон ch7_s13, ch8_s12–s15; на них и стоят сутки–четверо.
 *
 * 1. Замер (--measure): отряды модели по seed --squad-seeds на дни --squad-days (с вещами, как в игре); для каждого этапа глав
 *    --chapters — k* (множитель статов врагов, при котором отряд побеждает через раз, stageThreshold). Профиль отряда
 *    ln(1/k*) нормирован на его среднее по этапам; сила этапа «для модели» — среднее профилей. Плюс сила этапа по бою
 *    эталонных отрядов, как в tests/chapters.test.ts (для теста тренда). Оба замера линейны по mult — хранятся с mult замера.
 * 2. Цель: час первого прохождения этапа T(s) по графику (босс главы c — --targets[c], начало первой главы — --start;
 *    внутри главы доля пути: рядовые до мини-босса 0.03…--pre, мини-босс --mini-at, дальше до --post, босс — 1).
 *    Сила этапа для модели = ln P(T(s)) + C: P — медианная мощь отряда модели к часу (прогоны --runs, JSON из
 *    runModels), C — медиана (сила − ln P(час прохождения)) по этапам-стенам текущих данных (где модель стояла ≥ 4 ч).
 * 3. mult этапа × exp(цель − сила), не больше ×--max-step за раз; затем прижать к тренду главы по эталонным отрядам
 *    (рядовые ×0.88…1.12 тренда, босс ×1.03…1.3; у теста ±15% и ×1…1.35 — запас на шум замера).
 *
 *   npx tsx scripts/balance-stagefit.ts --measure --out <папка>                     замер (минуты, по процессу на seed)
 *   npx tsx scripts/balance-stagefit.ts --out <папка> --runs <runs.json> [--dry]    записать mult (или только показать)
 * Проверка — scripts/balance-walls.ts или модель по seed (balance-run.ts).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUnit, enemySquad, withGear } from '../src/core';
import type { ModelRun } from './balance-run';
import { ROOT } from './lib/content-node';
import { loadFullContext, PLAYER_MODEL, runBalance, SMOOTH_SQUADS, smoothSquads, stageThreshold } from './lib/player-model';

const argv = process.argv.slice(2);
const flag = (name: string) => argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] !== undefined ? [argv[i + 1]] : []));
const num = (name: string, def: number) => (flag(name).length ? Number(flag(name).at(-1)) : def);
const list = (name: string, def: number[]) => (flag(name).length ? flag(name).at(-1)!.split(',').map(Number) : def);
const CHAPTERS = (flag('chapters').at(-1) ?? 'chapter4,chapter5,chapter6,chapter7,chapter8,chapter9,chapter10').split(',');
const TARGETS = list('targets', [100, 152, 205, 260, 318, 380, 446]);
const START = num('start', 52);
const PRE = num('pre', 0.36);
const MINI_AT = num('mini-at', 0.5);
const POST = num('post', 0.8);
const MAX_STEP = num('max-step', 1.15);
const SQUAD_SEEDS = list('squad-seeds', [1, 2, 3, 4]);
const SQUAD_DAYS = list('squad-days', [5, 9, 13, 17]);
const OUT = flag('out').at(-1) ?? join(ROOT, '.balance-stagefit');
const TREND_LO = Math.log(0.88);
const TREND_HI = Math.log(1.12);
const BOSS_LO = Math.log(1.03);
const BOSS_HI = Math.log(1.3);

/** Мини-боссы середины глав — как в scripts/balance-smooth.ts. */
const MINI_BOSS_UNITS = new Set(['mob4_ancient_mummy', 'mob5_munak_elder', 'mob6_bosun', 'mob7_bridge_warden', 'mob3_boss', 'orc_hero', 'sewer_bug_leader', 'alde_owl_baron', 'maze_scribe']);

interface Enemy { unit: string; mult?: number }
interface ChapterJson { id: string; stages: { id: string; boss?: boolean; enemies: (Enemy | null)[] }[] }
const files = new Map<string, string>();
for (const f of readdirSync(join(ROOT, 'data/campaign')).filter((x) => x.endsWith('.json'))) {
  const path = join(ROOT, 'data/campaign', f);
  files.set((JSON.parse(readFileSync(path, 'utf8')) as ChapterJson).id, path);
}
const readChapter = (c: string) => JSON.parse(readFileSync(files.get(c)!, 'utf8')) as ChapterJson;
const firstMult = (st: ChapterJson['stages'][number]) => st.enemies.find((e) => e)!.mult ?? 1;
const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};
const lateIds = (ctx: ReturnType<typeof loadFullContext>) => {
  const late = ctx.content.chapters.slice(3).map((c) => c.id);
  return ctx.content.stages.filter((s) => late.includes(s.chapter)).map((s) => s.id);
};

// --- дочерний процесс замера: отряды модели seed на дни SQUAD_DAYS → { этап: [ln(1/k*) по дням] } ---
if (argv[0] === '--child') {
  const seed = Number(argv[1]);
  const ctx = loadFullContext();
  const ids = lateIds(ctx);
  const out: Record<string, number[]> = Object.fromEntries(ids.map((id) => [id, []]));
  for (const day of SQUAD_DAYS) {
    const save = runBalance(ctx, day, { ...PLAYER_MODEL, seedBase: seed }).save;
    const gear = withGear(ctx, save);
    const squad = save.squad.map((id) => (id ? buildUnit(save.heroes.find((h) => h.id === id)!, gear) : null));
    for (const id of ids) out[id].push(Math.log(1 / stageThreshold(ctx, squad, enemySquad(id, ctx), 8, 9)));
  }
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
if (argv.includes('--measure')) {
  const self = fileURLToPath(import.meta.url);
  const child = (seed: number) =>
    new Promise<Record<string, number[]>>((resolve, reject) => {
      const p = spawn(process.execPath, [...process.execArgv, self, '--child', String(seed), ...argv.filter((a) => a !== '--measure')], { stdio: ['ignore', 'pipe', 'inherit'] });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.on('close', (code) => (code ? reject(new Error(`seed ${seed}: код ${code}`)) : resolve(JSON.parse(out))));
    });
  const parts = await Promise.all(SQUAD_SEEDS.map(child));
  // Эталонные отряды — как tests/chapters.test.ts.
  const ctx = loadFullContext();
  const ids = lateIds(ctx);
  const squads = smoothSquads(ctx, 45, SMOOTH_SQUADS);
  const profiles = squads.map((sq) => ids.map((id) => Math.log(1 / stageThreshold(ctx, sq, enemySquad(id, ctx), 6, 8))));
  const geo = profiles.map((p) => p.reduce((a, b) => a + b, 0) / p.length);
  const ref = Object.fromEntries(ids.map((id, i) => [id, Math.max(...profiles.map((p, j) => p[i] - geo[j]))]));
  // Модель: профиль каждого отряда (seed × день) нормирован на его среднее, сила — среднее по отрядам.
  const cols = parts.flatMap((p) => SQUAD_DAYS.map((_, k) => ids.map((id) => p[id][k])));
  const colMean = cols.map((c) => c.reduce((a, b) => a + b, 0) / c.length);
  const model = Object.fromEntries(ids.map((id, i) => [id, cols.reduce((a, c, j) => a + c[i] - colMean[j], 0) / cols.length]));
  const mults: Record<string, number> = {};
  for (const c of ctx.content.chapters.slice(3)) for (const st of readChapter(c.id).stages) mults[st.id] = firstMult(st);
  writeFileSync(join(OUT, 'measure.json'), JSON.stringify({ ref, model, mults, raw: parts }) + '\n');
  console.log(`замер записан: ${join(OUT, 'measure.json')}`);
  process.exit(0);
}

const M = JSON.parse(readFileSync(join(OUT, 'measure.json'), 'utf8')) as { ref: Record<string, number>; model: Record<string, number>; mults: Record<string, number> };
const cur = new Map<string, number>();
const chapterStages = new Map<string, ChapterJson['stages']>();
for (const c of CHAPTERS) {
  chapterStages.set(c, readChapter(c).stages);
  for (const st of chapterStages.get(c)!) cur.set(st.id, firstMult(st));
}
const shift = (id: string, mult: number) => Math.log(mult / M.mults[id]);
const refD = (id: string, mult: number) => M.ref[id] + shift(id, mult);
const modelD = (id: string, mult: number) => M.model[id] + shift(id, mult);

// --- график ---
const target = new Map<string, number>();
CHAPTERS.forEach((c, ci) => {
  const stages = chapterStages.get(c)!;
  const t0 = ci ? TARGETS[ci - 1] : START;
  const L = TARGETS[ci] - t0;
  const n = stages.length;
  const m = stages.findIndex((s) => !s.boss && s.enemies.some((e) => e && MINI_BOSS_UNITS.has(e.unit)));
  stages.forEach((s, i) => {
    let g: number;
    if (s.boss) g = 1;
    else if (m < 1) g = 0.03 + ((POST - 0.03) * i) / (n - 2);
    else if (i < m) g = 0.03 + ((PRE - 0.03) * i) / Math.max(1, m - 1);
    else if (i === m) g = MINI_AT;
    else g = MINI_AT + 0.04 + ((POST - MINI_AT - 0.04) * (i - m - 1)) / Math.max(1, n - 2 - m - 1);
    target.set(s.id, t0 + L * g);
  });
});

// --- мощь модели и калибровка C по стенам текущих данных ---
const runs = JSON.parse(readFileSync(flag('runs').at(-1)!, 'utf8')) as ModelRun[];
const curves = runs.map((r) => {
  const pts: [number, number][] = [];
  let p = 0;
  for (const [t, bp] of r.battles) if (bp > p) pts.push([t, (p = bp)]);
  return (t: number) => {
    let v = pts[0][1];
    for (const [pt, pv] of pts) if (pt <= t + 0.2) v = pv;
    return v;
  };
});
const lnP = (t: number) => Math.log(median(curves.map((f) => f(t))));
const clears = runs.map((r) => new Map(r.clears));
const allIds = CHAPTERS.flatMap((c) => chapterStages.get(c)!.map((s) => s.id));
const calib: number[] = [];
allIds.forEach((id, i) => {
  if (!i) return;
  const ts = runs.map((r, k) => clears[k].get(id) ?? r.end + 24);
  const gaps = runs.map((r, k) => ts[k] - (clears[k].get(allIds[i - 1]) ?? r.end + 24));
  if (median(gaps) >= 4 && runs.filter((r, k) => clears[k].has(id)).length * 2 > runs.length) calib.push(modelD(id, cur.get(id)!) - lnP(median(ts)));
});
const C = median(calib);
console.log(`калибровка: ${calib.length} этапов-стен, C = ${C.toFixed(3)}`);

// --- новые mult ---
const next = new Map<string, number>();
for (const id of allIds) {
  const want = lnP(target.get(id)!) + C;
  const f = Math.min(MAX_STEP, Math.max(1 / MAX_STEP, Math.exp(want - modelD(id, cur.get(id)!))));
  next.set(id, cur.get(id)! * f);
}
for (const c of CHAPTERS) {
  const stages = chapterStages.get(c)!;
  for (let pass = 0; pass < 8; pass++) {
    const reg = stages.filter((s) => !s.boss).map((s) => refD(s.id, next.get(s.id)!));
    const n = reg.length;
    const xm = (n - 1) / 2;
    const ym = reg.reduce((a, b) => a + b, 0) / n;
    const slope = reg.reduce((a, y, i) => a + (i - xm) * (y - ym), 0) / reg.reduce((a, _, i) => a + (i - xm) ** 2, 0);
    const trend = (i: number) => ym + slope * (Math.min(i, n - 1) - xm);
    stages.forEach((s, i) => {
      const dev = refD(s.id, next.get(s.id)!) - trend(i);
      const [lo, hi] = s.boss ? [BOSS_LO, BOSS_HI] : [TREND_LO, TREND_HI];
      const cl = Math.min(hi, Math.max(lo, dev));
      if (cl !== dev) next.set(s.id, next.get(s.id)! * Math.exp(cl - dev));
    });
  }
}
for (const c of CHAPTERS) {
  const row = chapterStages.get(c)!.map((s) => {
    const f = next.get(s.id)! / cur.get(s.id)!;
    const t = median(runs.map((r, k) => clears[k].get(s.id) ?? r.end + 24));
    return `${s.id.split('_')[1]}${s.boss ? '*' : ''} ${t.toFixed(0)}→${target.get(s.id)!.toFixed(0)} ×${f.toFixed(2)}`;
  });
  console.log(`${c}: ${row.join(' | ')}`);
}
if (!argv.includes('--dry')) {
  for (const c of CHAPTERS) {
    const json = readChapter(c);
    for (const st of json.stages) {
      const f = next.get(st.id)! / firstMult(st);
      for (const e of st.enemies) if (e) e.mult = Number(((e.mult ?? 1) * f).toPrecision(4));
    }
    writeFileSync(files.get(c)!, JSON.stringify(json, null, 2) + '\n');
  }
  console.log('записано в data/campaign');
}
