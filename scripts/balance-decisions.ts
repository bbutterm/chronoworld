/**
 * Бой с решениями (docs/design/battle-decisions.md, docs/content/balance.md «Бой с решениями»): насколько стихии, заряд
 * босса и новые профили монстров сдвинули силу этапов, и что даёт ручная ульта на боссах.
 *
 *   npx tsx scripts/balance-decisions.ts                 k* всех этапов «до» (правила боя без стихий, заряда и новых
 *                                                        профилей — тот же контент, эти поля сняты) и «после», по главам
 *   npx tsx scripts/balance-decisions.ts --out r.json   то же и отношения k* после/до по этапам — в файл
 *   npx tsx scripts/balance-decisions.ts --apply [1] --from r.json
 *                                                        mult врагов этапа × (k* после / до) — сила этапа для эталонных
 *                                                        отрядов как до правки (главы 1–3 — отношением главы, сдвиг < 2% не
 *                                                        трогаем); боссы глав не выравниваются (заряд делает их тяжелее в авто), только × boss (по умолчанию 1)
 *   npx tsx scripts/balance-decisions.ts --bosses        боссы глав: k* в авто и у «игрока» (ульты вручную: одну держит
 *                                                        на заряд босса, остальные — сразу), без правки данных
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { breaksCharge, enemySquad, simulateBattle, ultSkillOf, type BattleEvent, type BattleInput, type BattleResult, type UnitDef } from '../src/core';
import { bandSquads } from './balance-behavior';
import { ROOT } from './lib/content-node';
import { loadFullContext, scaledEnemies, stageThreshold, type FullContext } from './lib/player-model';

/** Профили поведения, добавленные монстрам глав вместе с этой правкой (в «до» — сняты). */
export const NEW_BEHAVIORS = [
  'alde_punk', 'maze_hunter_fly', 'mob4_fast', 'mob6_fast', 'mob7_fast', 'mob5_fast',
  'orc_warrior', 'mob6_melee', 'mob5_melee', 'sewer_familiar', 'mob3_melee',
  'alde_alarm',
  'alde_elder', 'maze_deviruchi', 'mob4_support', 'mob5_support', 'mob6_support', 'mob7_support', 'mob_marin', 'sewer_bug_female',
];

/** Контекст «как до правки»: без стихий, заряда и новых профилей. */
export function beforeContext(ctx: FullContext): FullContext {
  const units: Record<string, UnitDef> = {};
  for (const [id, u] of Object.entries(ctx.content.units)) {
    const { charge: _c, element: _e, ...rest } = u;
    units[id] = NEW_BEHAVIORS.includes(id) ? { ...rest, behavior: undefined } : rest;
  }
  const { elements: _el, ...combat } = ctx.combat;
  return { ...ctx, content: { ...ctx.content, units }, combat };
}

const geo = (xs: number[]) => Math.exp(xs.reduce((a, b) => a + Math.log(b), 0) / xs.length);
const tick = (t: number, dt: number) => Math.round((Math.floor(t / dt + 1e-6) + 1) * dt * 1000) / 1000;

/**
 * «Игрок» с ручной ультой: ульты — сразу, как готовы; ульту «сбивающего» (первый герой с контрольной ультой — breaksCharge) держит на заряд
 * босса и жмёт через 0.3 с после его начала. Бой пересчитывается после каждого ввода (как сцена).
 */
export function manualBattle(ctx: FullContext, squad: readonly (UnitDef | null)[], enemies: readonly (UnitDef | null)[], seed: number): BattleResult {
  const dt = ctx.combat.tickSeconds;
  const ults = new Map<string, string>();
  squad.forEach((d, i) => {
    const s = d ? ultSkillOf(d, ctx.content.skills, ctx.combat) : null;
    if (s) ults.set(`A${i}`, s.id);
  });
  const charger = enemies.some((u) => u?.charge);
  let breaker: string | null = null;
  if (charger)
    for (const [uid, sid] of ults) {
      const s = ctx.content.skills[sid];
      if (s.target.side === 'enemy' && breaksCharge(s)) {
        breaker = uid;
        break;
      }
    }
  const inputs: BattleInput[] = [];
  let done = -1;
  for (let it = 0; it < 80; it++) {
    const r = simulateBattle(ctx.content, [...squad], [...enemies], seed, { combat: ctx.combat, log: true, manualUlt: true, inputs });
    let breakerReady = false;
    let next: BattleInput | null = null;
    let at = Infinity;
    for (const e of r.log as BattleEvent[]) {
      if (e.type === 'ready' && e.unit === breaker) breakerReady = !e.lost;
      if ((e.type === 'attack' || e.type === 'ult') && e.unit === breaker && e.skill === ults.get(breaker!)) breakerReady = false;
      if (e.t <= done + 1e-9) continue;
      if (e.type === 'ready' && !e.lost && e.unit !== breaker) {
        next = { t: tick(e.t, dt), uid: e.unit };
        at = e.t;
        break;
      }
      if (e.type === 'cast' && e.charge && e.action === 'start' && breaker && breakerReady) {
        next = { t: tick(e.t + 0.3, dt), uid: breaker };
        at = e.t;
        break;
      }
    }
    if (!next) return r;
    inputs.push(next);
    done = at;
  }
  return simulateBattle(ctx.content, [...squad], [...enemies], seed, { combat: ctx.combat, log: false, manualUlt: true, inputs });
}

/** k* с «игроком» вручную (двоичный поиск, как stageThreshold). */
function manualThreshold(ctx: FullContext, squad: readonly (UnitDef | null)[], enemies: readonly (UnitDef | null)[], seeds = 6, steps = 8, lo = 0.03, hi = 30): number {
  let a = Math.log(lo);
  let b = Math.log(hi);
  for (let i = 0; i < steps; i++) {
    const mid = (a + b) / 2;
    const e = scaledEnemies(enemies, Math.exp(mid));
    let n = 0;
    for (let seed = 1; seed <= seeds; seed++) if (manualBattle(ctx, squad, e, seed).winner === 'A') n++;
    if (n * 2 >= seeds) a = mid;
    else b = mid;
  }
  return Math.exp((a + b) / 2);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const ctx = loadFullContext();
  if (args.includes('--bosses')) {
    for (const ch of ctx.content.chapters) {
      const st = ctx.content.stages.find((s) => s.chapter === ch.id && s.boss);
      if (!st) continue;
      const squads = bandSquads(ctx, ch.order).slice(0, 3);
      const e = enemySquad(st.id, ctx);
      const pre = beforeContext(ctx);
      const kb = geo(squads.map((sq) => stageThreshold(pre, sq, enemySquad(st.id, pre), 6, 8)));
      const ka = geo(squads.map((sq) => stageThreshold(ctx, sq, e, 6, 8)));
      const km = geo(squads.map((sq) => manualThreshold(ctx, sq, e, 6, 8)));
      console.log(`${st.id}: k* до ${kb.toFixed(3)} · авто ${ka.toFixed(3)} (×${(ka / kb).toFixed(2)}) · вручную ${km.toFixed(3)} (×${(km / kb).toFixed(2)}, выигрыш ручной ×${(km / ka).toFixed(2)})`);
    }
  } else {
    const apply = args.includes('--apply');
    const bossK = Number(args.find((a) => /^\d/.test(a)) ?? 1);
    const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
    const from = opt('--from');
    const out = opt('--out');
    const pre = beforeContext(ctx);
    const ratio: Record<string, number> = from ? JSON.parse(readFileSync(from, 'utf8')) : {};
    const factor = new Map<string, number>();
    for (const ch of ctx.content.chapters) {
      if (from) {
        const ids = ctx.content.stages.filter((s) => s.chapter === ch.id).map((s) => s.id);
        factor.set(ch.id, geo(ids.map((id) => ratio[id])));
        continue;
      }
      const squads = bandSquads(ctx, ch.order).slice(0, 3);
      const ids = ctx.content.stages.filter((s) => s.chapter === ch.id).map((s) => s.id);
      for (const id of ids) {
        const kb = geo(squads.map((sq) => stageThreshold(pre, sq, enemySquad(id, pre), 6, 8)));
        const ka = geo(squads.map((sq) => stageThreshold(ctx, sq, enemySquad(id, ctx), 6, 8)));
        ratio[id] = ka / kb;
      }
      const r = geo(ids.map((id) => ratio[id]));
      factor.set(ch.id, r);
      console.log(`глава ${ch.order}: k* после/до ×${r.toFixed(3)} (этапы ${ids.map((id) => ratio[id].toFixed(2)).join(' ')})`);
    }
    if (out) writeFileSync(out, JSON.stringify(ratio));
    if (apply)
      for (const ch of ctx.content.chapters) {
        const file = join(ROOT, 'data/campaign', `${ch.id}.json`);
        const raw = JSON.parse(readFileSync(file, 'utf8'));
        let touched = 0;
        for (const s of raw.stages) {
          // Боссы глав не выравниваются: заряд делает их тяжелее в авто — так задумано (ответ — ульта по касанию); bossK — ещё.
          let f = s.boss ? bossK : ch.order <= 3 ? factor.get(ch.id)! : ratio[s.id];
          if (Math.abs(Math.log(f)) < Math.log(1.02)) f = 1;
          if (f === 1) continue;
          for (const e of s.enemies) if (e) e.mult = Math.round(e.mult * f * 10000) / 10000;
          touched++;
        }
        writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
        console.log(`${ch.id}: ${touched} этапов, в среднем ×${factor.get(ch.id)!.toFixed(3)}, босс ×${bossK}`);
      }
  }
}
