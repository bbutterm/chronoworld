/**
 * Регулятор сложности этапов глав 2–3 по графику (docs/content/balance.md, «Как подобраны mult глав 2–3»).
 *   npx tsx scripts/balance-fit.ts [итераций=1] [gamma=0.8] [--dry]
 * Цикл: модель игрока (runBalance, 7 дней, PLAYER_MODEL) → когда пройден каждый этап (часы от начала первой сессии) →
 * этап раньше окна W — умножить mult всех его врагов на (P(начало окна) / P(прохождение))^gamma (сложнее), позже окна —
 * на (P(конец окна) / P(прохождение))^gamma (легче; дальше первого опоздавшего этапа не понижаем — их время сдвинуто им).
 * P(t) — мощь отряда модели к моменту t. Соотношения mult внутри этапа не меняются (состав — как задумал дизайнер);
 * после шага выдерживается монотонность Σhp/Σatk внутри главы (тест QA T5-21 в tests/chapters.test.ts) — этап целиком
 * поднимается на 1%, пока не станет не слабее предыдущего. Лучший по сумме опозданий вариант остаётся в data/campaign.
 * --dry — только показать, где этапы относительно окон. Награды этапов не трогает.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/content-node';
import { loadFullContext, runBalance, PLAYER_MODEL } from './lib/player-model';

/** Окна первого прохождения, часы от начала первой сессии (4 сессии в день: 0, 4, 8, 12, затем 24, 28, …). */
const W: Record<string, [number, number]> = {
  ch2_s1: [0, 1], ch2_s2: [0, 1], ch2_s3: [0.5, 4.5], ch2_s4: [4, 8.5], ch2_s5: [8, 12.5], ch2_s6: [12, 16.5], ch2_s7: [16, 24.5], ch2_s8: [24, 28.5], ch2_s9: [24, 32.5], ch2_s10: [32, 36.5],
  ch3_s1: [32, 48.5], ch3_s2: [36, 52.5], ch3_s3: [48, 56.5], ch3_s4: [52, 60.5], ch3_s5: [52, 60.5], ch3_s6: [60, 72.5], ch3_s7: [72, 80.5], ch3_s8: [76, 84.5], ch3_s9: [84, 100.5], ch3_s10: [96, 108.5],
};
const iters = Number(process.argv[2] ?? 1);
const gamma = Number(process.argv[3] ?? 0.8);
const DAYS = 7;

interface Enemy { unit: string; mult?: number }
interface Stage { id: string; enemies: (Enemy | null)[] }

const files = [2, 3].map((ch) => join(ROOT, `data/campaign/chapter${ch}.json`));
let best = { score: Infinity, data: files.map((f) => readFileSync(f, 'utf8')) };
for (let it = 0; it < iters; it++) {
  const ctx = loadFullContext();
  const growth = 1 + ctx.progression.campaign.enemyStatGrowthPerStage;
  const res = runBalance(ctx, DAYS, PLAYER_MODEL);
  const t0 = res.rows[0].time_h;
  const end = res.rows[res.rows.length - 1].time_h - t0;
  const clear = new Map(res.firstClears.map((f) => [f.stageId, f.time_h - t0]));
  const battles = res.battles.map((b) => ({ t: b.t - t0, p: b.squadPower }));
  const P = (t: number) => {
    let best = 0;
    for (const b of battles) if (b.t <= t + 0.2) best = Math.max(best, b.p);
    return best || battles[0].p;
  };
  const factors: Record<string, number> = {};
  let log = '';
  let score = 0;
  let blocked = false; // после первого опоздавшего этапа — только понижение не делаем (время сдвинуто им)
  for (const s of ctx.content.stages) {
    const w = W[s.id];
    if (!w) continue;
    const a = clear.get(s.id) ?? end + 24;
    const [lo, hi] = w;
    let f = 1;
    if (a < lo) {
      score += Math.log((lo + 2) / (a + 2));
      f = Math.min(1.25, Math.max(1.02, Math.pow(P(lo) / P(a), gamma)));
    } else if (a > hi) {
      score += Math.log((a + 2) / (hi + 2));
      if (!blocked) f = Math.max(0.8, Math.min(0.98, Math.pow(P(hi) / P(a), gamma)));
      blocked = true;
    }
    factors[s.id] = f;
    log += `${s.id} ${a.toFixed(1)}[${lo},${hi}]×${f.toFixed(2)} `;
  }
  // Понижение этапа, упёртого в монотонность Σ, тянет вниз и предыдущий (наполовину).
  const ids = Object.keys(W);
  for (let i = ids.length - 1; i > 0; i--) {
    const f = factors[ids[i]];
    if (f < 1 && ids[i - 1].split('_')[0] === ids[i].split('_')[0]) factors[ids[i - 1]] = Math.min(factors[ids[i - 1]], Math.sqrt(f));
  }
  console.log(`iter ${it}: score ${score.toFixed(2)}\n  ${log}`);
  if (score < best.score) best = { score, data: files.map((f) => readFileSync(f, 'utf8')) };
  if (process.argv.includes('--dry')) break;
  if (it === iters - 1) {
    files.forEach((f, i) => writeFileSync(f, best.data[i]));
    console.log(`best score ${best.score.toFixed(2)} restored`);
    break;
  }
  for (const ch of [2, 3]) {
    const file = join(ROOT, `data/campaign/chapter${ch}.json`);
    const d = JSON.parse(readFileSync(file, 'utf8')) as { stages: Stage[] };
    let prev: { hp: number; atk: number } | null = null;
    d.stages.forEach((st, idx) => {
      const gi = (ch - 1) * 10 + idx;
      const k = factors[st.id] ?? 1;
      for (const e of st.enemies) if (e) e.mult = Math.round((e.mult ?? 1) * k * 100) / 100;
      const sum = () => {
        let hp = 0;
        let atk = 0;
        for (const e of st.enemies) if (e) {
          const u = ctx.content.units[e.unit];
          hp += Math.round(u.stats.hp * (e.mult ?? 1) * Math.pow(growth, gi));
          atk += Math.round(u.stats.atk * (e.mult ?? 1) * Math.pow(growth, gi));
        }
        return { hp, atk };
      };
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
