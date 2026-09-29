/**
 * Регулятор сложности этапов глав по графику (docs/content/balance.md, «Как подобраны mult глав 2–3»).
 *   npx tsx scripts/balance-fit.ts [итераций=1] [gamma=0.8] [--dry] [--chapter N|chapterN] [--days D] [--seeds 1,2,3]
 * Главы — все из data/campaign (по order), кроме data/progression.json → balance.exclude; окна первого прохождения —
 * balance.windows (глава без окон — правило balance.default, см. fitTargets в scripts/lib/player-model.ts).
 * --chapter — править только эту главу (order или id; можно несколько раз), остальные главы — только как фон.
 * --days — дней модели (по умолчанию balance.fitDays, поднимается сам, если окна дальше).
 * --seeds — seed модели (seedBase: выдачи Таверны, трофеи, бои) через запятую; время прохождения этапа и мощь P(t) —
 *   медиана по ним (по умолчанию один seed 1). Герои v2: выдачи копий сильно разбрасывают темп, один seed — случайность.
 * Цикл: модель игрока (runBalance, PLAYER_MODEL) → когда пройден каждый этап (часы от начала первой сессии) →
 * этап раньше окна W — умножить mult всех его врагов на (P(начало окна) / P(прохождение))^gamma (сложнее), позже окна —
 * на (P(конец окна) / P(прохождение))^gamma (легче; дальше первого опоздавшего этапа не понижаем — их время сдвинуто им).
 * P(t) — мощь отряда модели к моменту t. Соотношения mult внутри этапа не меняются (состав — как задумал дизайнер);
 * после шага выдерживается монотонность Σhp/Σatk внутри главы (тест QA T5-21 в tests/chapters.test.ts) — этап целиком
 * поднимается на 1%, пока не станет не слабее предыдущего. Лучший по сумме опозданий вариант остаётся в data/campaign.
 * --dry — только показать, где этапы относительно окон. Награды этапов не трогает.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/content-node';
import { growthStep } from '../src/core';
import { fitTargets, loadFullContext, runBalance, PLAYER_MODEL } from './lib/player-model';

const argv = process.argv.slice(2);
const flagValues = (name: string) => argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] !== undefined ? [argv[i + 1]] : []));
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--chapter', '--days', '--seeds'].includes(argv[i - 1])));
const iters = Number(positional[0] ?? 1);
const gamma = Number(positional[1] ?? 0.8);
const dry = argv.includes('--dry');

interface Enemy { unit: string; mult?: number }
interface Stage { id: string; enemies: (Enemy | null)[] }

const ctx0 = loadFullContext();
const targets = fitTargets(ctx0);
if (targets.problems.length) {
  for (const p of targets.problems) console.error(`✗ ${p}`);
  process.exit(1);
}
const W = targets.windows;
const DAYS = flagValues('days').length ? Number(flagValues('days').at(-1)) : targets.days;
if (!Number.isInteger(DAYS) || DAYS < 1) throw new Error(`--days: нужно целое ≥ 1`);
const SEEDS = (flagValues('seeds').at(-1) ?? String(PLAYER_MODEL.seedBase)).split(',').map(Number);
if (SEEDS.some((x) => !Number.isInteger(x) || x < 1)) throw new Error(`--seeds: нужны целые ≥ 1 через запятую`);
const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};

// Какие главы править: все с окнами или только --chapter.
const wanted = flagValues('chapter');
const fitChapters = wanted.length
  ? wanted.map((w) => {
      const c = ctx0.content.chapters.find((x) => x.id === w || String(x.order) === w);
      if (!c) throw new Error(`--chapter ${w}: такой главы нет в data/campaign`);
      if (!targets.chapters.some((t) => t.id === c.id)) throw new Error(`--chapter ${w}: глава ${c.id} в balance.exclude — регулятор её не трогает`);
      return c.id;
    })
  : targets.chapters.map((t) => t.id);
const fitSet = new Set(fitChapters);
for (const t of targets.chapters)
  if (fitSet.has(t.id) && t.source !== 'data') console.log(`${t.id}: окна ${t.source === 'default' ? 'по правилу balance.default' : 'частично из balance.windows'} — ${t.stages.map((s) => `${s} [${W.get(s)!.join(',')}]`).join(' ')}`);

// Файл главы — по id внутри data/campaign/*.json.
const chapterFile = new Map<string, string>();
for (const f of readdirSync(join(ROOT, 'data/campaign')).filter((x) => x.endsWith('.json')).sort()) {
  const path = join(ROOT, 'data/campaign', f);
  chapterFile.set((JSON.parse(readFileSync(path, 'utf8')) as { id: string }).id, path);
}
const files = fitChapters.map((id) => chapterFile.get(id)!);
const stageById = new Map(ctx0.content.stages.map((s) => [s.id, s]));

let best = { score: Infinity, data: files.map((f) => readFileSync(f, 'utf8')) };
for (let it = 0; it < iters; it++) {
  const ctx = loadFullContext();
  const growth = 1 + ctx.progression.campaign.enemyStatGrowthPerStage;
  // Модель по каждому seed; время прохождения этапа (не прошёл — конец + 24 ч) и мощь P(t) — медиана по seed.
  const runs = SEEDS.map((seedBase) => {
    const res = runBalance(ctx, DAYS, { ...PLAYER_MODEL, seedBase });
    const t0 = res.rows[0].time_h;
    const end = res.rows[res.rows.length - 1].time_h - t0;
    const clear = new Map(res.firstClears.map((f) => [f.stageId, f.time_h - t0]));
    const battles = res.battles.map((b) => ({ t: b.t - t0, p: b.squadPower }));
    const P = (t: number) => {
      let best = 0;
      for (const b of battles) if (b.t <= t + 0.2) best = Math.max(best, b.p);
      return best || battles[0].p;
    };
    return { end, clear, P };
  });
  const end = median(runs.map((r) => r.end));
  const clear = new Map(ctx.content.stages.map((s) => [s.id, median(runs.map((r) => r.clear.get(s.id) ?? r.end + 24))]));
  const P = (t: number) => median(runs.map((r) => r.P(t)));
  const factors: Record<string, number> = {};
  const ids: string[] = []; // этапы с окнами по порядку кампании
  let log = '';
  let score = 0;
  let blocked = false; // после первого опоздавшего этапа — только понижение не делаем (время сдвинуто им)
  for (const s of ctx.content.stages) {
    const w = W.get(s.id);
    if (!w) continue;
    ids.push(s.id);
    const fit = fitSet.has(s.chapter);
    const a = clear.get(s.id) ?? end + 24;
    const [lo, hi] = w;
    let f = 1;
    if (a < lo) {
      if (fit) score += Math.log((lo + 2) / (a + 2));
      f = Math.min(1.25, Math.max(1.02, Math.pow(P(lo) / P(a), gamma)));
    } else if (a > hi) {
      if (fit) score += Math.log((a + 2) / (hi + 2));
      if (!blocked) f = Math.max(0.8, Math.min(0.98, Math.pow(P(hi) / P(a), gamma)));
      blocked = true;
    }
    factors[s.id] = f;
    if (fit) log += `${s.id} ${a.toFixed(1)}[${lo},${hi}]×${f.toFixed(2)} `;
  }
  // Понижение этапа, упёртого в монотонность Σ, тянет вниз и предыдущие — обратный проход при записи (ниже).
  console.log(`iter ${it}: score ${score.toFixed(2)}\n  ${log}`);
  if (score < best.score) best = { score, data: files.map((f) => readFileSync(f, 'utf8')) };
  if (dry) break;
  if (it === iters - 1) {
    files.forEach((f, i) => writeFileSync(f, best.data[i]));
    console.log(`best score ${best.score.toFixed(2)} restored`);
    break;
  }
  for (const file of files) {
    const d = JSON.parse(readFileSync(file, 'utf8')) as { stages: Stage[] };
    // Σhp/Σatk этапа (ступень роста: вставные этапы её не двигают — src/core/campaign/campaign.ts, growthStep).
    const sumOf = (st: Stage) => {
      const gi = growthStep(stageById.get(st.id)!, ctx0);
      let hp = 0;
      let atk = 0;
      for (const e of st.enemies) if (e) {
        const u = ctx.content.units[e.unit];
        hp += Math.round(u.stats.hp * (e.mult ?? 1) * Math.pow(growth, gi));
        atk += Math.round(u.stats.atk * (e.mult ?? 1) * Math.pow(growth, gi));
      }
      return { hp, atk };
    };
    for (const st of d.stages) {
      const k = factors[st.id] ?? 1;
      for (const e of st.enemies) if (e) e.mult = Math.round((e.mult ?? 1) * k * 100) / 100;
    }
    // Обратный проход: этап, который понижаем (опаздывает), упирается в Σ предыдущего — тогда понижаем и предыдущий,
    // ровно до монотонности (цепочка до начала главы). Иначе прямой проход ниже поднял бы этап обратно и стена
    // (мини-босс из трёх врагов при той же Σ, что у этапа из пяти) не уходила бы никогда.
    const lowered = new Set(d.stages.filter((st) => (factors[st.id] ?? 1) < 1).map((st) => st.id));
    for (let i = d.stages.length - 1; i > 0; i--) {
      if (!lowered.has(d.stages[i].id)) continue;
      const cur = sumOf(d.stages[i]);
      const prev = sumOf(d.stages[i - 1]);
      const r = Math.min(cur.hp / prev.hp, cur.atk / prev.atk) / 1.004;
      if (r >= 1) continue;
      for (const e of d.stages[i - 1].enemies) if (e) e.mult = Math.floor((e.mult ?? 1) * r * 100) / 100;
      lowered.add(d.stages[i - 1].id);
    }
    let prev: { hp: number; atk: number } | null = null;
    d.stages.forEach((st) => {
      const sum = () => sumOf(st);
      let cur = sum();
      // Монотонность Σhp/Σatk: поднять весь этап (соотношения внутри этапа — как задумал дизайнер).
      for (let g = 0; g < 200 && prev && (cur.hp < prev.hp * 1.003 || cur.atk < prev.atk * 1.003); g++) {
        for (const e of st.enemies) if (e) e.mult = Math.round((e.mult ?? 1) * 1.01 * 100) / 100;
        cur = sum();
      }
      prev = cur;
    });
    writeFileSync(file, JSON.stringify(d, null, 2) + '\n');
  }
}
