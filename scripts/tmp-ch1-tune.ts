/**
 * Временный (не коммитить): доля побед по этапам главы 1 в среднем по выдачам Таверны.
 *   npx tsx scripts/tmp-ch1-tune.ts [saves=16] [seeds=24] [--tune]
 * Как tests/chapter1-playthrough.test.ts: K сохранений (newGame в разное время → разные выдачи), перед каждым этапом —
 * доля побед на N seed, затем попытки (≤ 5).
 * --tune: для каждого этапа по порядку подобрать множитель mult (бинарный поиск) под цель из TARGET, записать в
 * scratchpad/mults.json (множители к базовым mult генератора gen_ch1.py).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { claimOffline, ascendHero, ascendRequirement, autoFodder, autoFormation, autoLevel, heroCopies, heroTemplate, newGame, playStage, summon, summonStatus, type SaveState, type GameContext } from '../src/core';
import { loadFullContext } from './lib/content-node';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const SAVES = Number(args[0] ?? 16);
const SEEDS = Number(args[1] ?? 24);
const tune = process.argv.includes('--tune');
const MULTS = process.env.MULTS ?? '/tmp/claude-0/-home-user-chronoworld/f2fe4333-4c2a-57a5-b5b2-db51f3f090ee/scratchpad/mults.json';
const DAY = '2026-01-01';

const TARGET: Record<string, { avg?: number; min?: number }> = JSON.parse(process.env.TARGET ?? '{}');

function develop(s: SaveState, ctx: GameContext): SaveState {
  const st = summonStatus(s, DAY, ctx);
  if (st.unlocked) {
    if (st.can.free) s = summon(s, ctx, { count: 1, pay: 'free', day: DAY }).save;
    while (s.currency.scrolls >= 10) s = summon(s, ctx, { count: 10, pay: 'scroll', day: DAY }).save;
    while (s.currency.gems >= ctx.summon.costs.ten) s = summon(s, ctx, { count: 10, pay: 'gems', day: DAY }).save;
    s = { ...s, squad: autoFormation(s, ctx) };
  }
  for (let guard = 0; guard < 10; guard++) {
    const tops = [...new Set(s.heroes.map((h) => h.templateId))].map((t) => heroCopies(s, t)[0]);
    const ready = tops.find((h) => ascendRequirement(s, h.id, ctx)?.blockers.length === 0 && autoFodder(s, h.id, ctx));
    if (!ready) break;
    const req = ascendRequirement(s, ready.id, ctx)!;
    const t = heroTemplate(ctx, ready.templateId);
    const branch = req.branch && !ready.branch ? (t.branches.find((b) => b.role === t.role) ?? t.branches[0]).job : undefined;
    s = ascendHero(s, ready.id, autoFodder(s, ready.id, ctx)!, ctx, branch ? { branch } : {}).save;
    s = { ...s, squad: autoFormation(s, ctx) };
  }
  s = autoLevel(s, ctx).save;
  s = { ...s, squad: autoFormation(s, ctx) };
  return autoLevel(s, ctx).save;
}

const base = loadFullContext();
const stages = base.content.stages.filter((s) => s.chapter === 'chapter1');

function withMult(ctx: GameContext, id: string, k: number): GameContext {
  const st = ctx.content.stages.map((s) => (s.id === id ? { ...s, enemies: s.enemies.map((e) => (e ? { ...e, mult: e.mult * k } : e)) } : s));
  return { ...ctx, content: { ...ctx.content, stages: st } };
}

function rates(saves: SaveState[], ctx: GameContext, id: string): { avg: number; min: number } {
  const per = saves.map((s) => {
    let w = 0;
    for (let j = 0; j < SEEDS; j++) if (playStage(s, id, 100_000 + j, ctx).result.winner === 'A') w++;
    return w / SEEDS;
  });
  return { avg: per.reduce((a, b) => a + b, 0) / per.length, min: Math.min(...per) };
}
const ok = (r: { avg: number; min: number }, t: { avg?: number; min?: number }) => (t.avg === undefined || r.avg > t.avg) && (t.min === undefined || r.min > t.min);

let saves = Array.from({ length: SAVES }, (_, k) => newGame(base, k * 3_600_000 + 1));
let ctx = base;
const found: Record<string, number> = tune ? {} : {};
let seed = 1;
for (const st of stages) {
  let k = 1;
  if (tune && TARGET[st.id] !== undefined) {
    let lo = 0.5;
    let hi = 2.0;
    for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2;
      const r = rates(saves, withMult(ctx, st.id, mid), st.id);
      if (ok(r, TARGET[st.id])) lo = mid;
      else hi = mid;
    }
    k = Math.round(((lo + hi) / 2) * 100) / 100;
    found[st.id] = k;
    ctx = withMult(ctx, st.id, k);
  }
  const r = rates(saves, ctx, st.id);
  const tries: number[] = [];
  let stuck = 0;
  const chestMin: number[] = [];
  saves = saves.map((s0) => {
    let s = s0;
    for (let t = 1; t <= 5; t++) {
      const out = playStage(s, st.id, seed++, ctx);
      s = develop(out.save, ctx);
      if (out.result.winner === 'A') {
        tries.push(t);
        return s;
      }
    }
    stuck++;
    tries.push(6);
    if (process.env.DEBUG) console.log('  застрял:', saves.indexOf(s0), s.squad.map((id) => { const h = s.heroes.find((x) => x.id === id); return h ? `${h.templateId}/${h.rarity}/${h.level}` : '-'; }).join(' '));
    // Стена: забрать сундук по 10 мин и ещё 2 попытки, до 4 ч.
    for (let m = 10; m <= 240; m += 10) {
      s = develop(claimOffline(s, s.offline.lastClaimAt + 600_000, ctx).save, ctx);
      for (let t = 0; t < 2; t++) {
        const out = playStage(s, st.id, seed++, ctx);
        s = develop(out.save, ctx);
        if (out.result.winner === 'A') {
          chestMin.push(m);
          return s;
        }
      }
    }
    chestMin.push(999);
    return { ...s, campaign: { cleared: [...s.campaign.cleared, st.id] } };
  });
  const per = saves.map(() => 0);
  const lv = saves.map((s) => s.squad.map((id) => s.heroes.find((h) => h.id === id)?.level ?? 0));
  const avgLv = lv.flat().reduce((a, b) => a + b, 0) / lv.flat().length;
  console.log(`${st.id.padEnd(8)} ${st.name.padEnd(24)} k ${k.toFixed(2)} побед ${(100 * r.avg).toFixed(0).padStart(3)}% (мин ${(100 * r.min).toFixed(0).padStart(3)}%) попыток ср ${(tries.reduce((a, b) => a + b, 0) / tries.length).toFixed(2)} макс ${Math.max(...tries)} застряли ${stuck}${chestMin.length ? ` (сундук мин: ${chestMin.join(',')})` : ''} ур. ${avgLv.toFixed(1)}${per.length ? '' : ''}`);
}
if (tune) {
  let prev: Record<string, number> = {};
  try {
    prev = JSON.parse(readFileSync(MULTS, 'utf8'));
  } catch {}
  for (const [id, k] of Object.entries(found)) prev[id] = Math.round((prev[id] ?? 1) * k * 100) / 100;
  writeFileSync(MULTS, JSON.stringify(prev, null, 1));
  console.log('mults →', MULTS, JSON.stringify(prev));
}
