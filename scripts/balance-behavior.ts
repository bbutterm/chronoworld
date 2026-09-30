/**
 * Сила этапов «с профилями поведения» против «как до профилей» (docs/design/battle-behavior.md §4, docs/content/balance.md,
 * «Поведение в бою»). Для каждого этапа — порог k* (множитель статов врагов, при котором отряд побеждает в половине боёв,
 * stageThreshold) у пяти эталонных отрядов SMOOTH_SQUADS с behavior on и off; сила этапа ∝ 1 / k*, поэтому
 * отношение k*on / k*off > 1 — этап стал легче для игрока (множитель этапа можно поднять во столько же), < 1 — тяжелее.
 * Отряды по главе: глава 1 — зелёные ур. 15 … глава 10 — красные ур. 100 (первые формы до фиолетового, дальше ветка своей роли).
 * Плюс средняя длина боя на пороге (k*off): до и после — бои «на грани», как у стен.
 *   npx tsx scripts/balance-behavior.ts                 боссы и мини-боссы глав
 *   npx tsx scripts/balance-behavior.ts --all           все этапы (минуты), сводка по главам
 *   npx tsx scripts/balance-behavior.ts --json out.json отношения по этапам — для --apply
 *   npx tsx scripts/balance-behavior.ts --scale ch1_s10=1.06            ручная поправка этапа
 *   npx tsx scripts/balance-behavior.ts --apply out.json [--per-stage] [--from 4]  умножить mult врагов этапов на отношение
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildUnit, enemySquad, simulateBattle, type CardRarity, type UnitDef } from '../src/core';
import { ROOT } from './lib/content-node';
import { loadFullContext, scaledEnemies, SMOOTH_SQUADS, stageThreshold, type FullContext } from './lib/player-model';

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const arg = (n: string) => (argv.indexOf(`--${n}`) >= 0 ? argv[argv.indexOf(`--${n}`) + 1] : undefined);

/** Редкость и уровень эталонных отрядов по номеру главы (с 1). */
export const BAND: [CardRarity, number][] = [
  ['green', 15],
  ['green', 20],
  ['blue', 35],
  ['purple', 50],
  ['purple', 60],
  ['gold', 70],
  ['gold', 80],
  ['red', 85],
  ['red', 92],
  ['red', 100],
];

export function bandSquads(ctx: FullContext, chapterNo: number): UnitDef[][] {
  const [rarity, level] = BAND[Math.min(BAND.length, Math.max(1, chapterNo)) - 1];
  return SMOOTH_SQUADS.map((ids) =>
    ids.map((templateId, i) => {
      const t = ctx.content.heroes[templateId];
      const branch = (t.branches.find((b) => b.role === t.role) ?? t.branches[0]).job;
      return buildUnit({ id: `ref${i}`, templateId, rarity, level, branch }, ctx);
    }),
  );
}

const geo = (xs: number[]) => Math.exp(xs.reduce((a, b) => a + Math.log(b), 0) / xs.length);

function measure(ctx: FullContext, stageId: string, seeds = 6, steps = 9) {
  const st = ctx.content.stages.find((s) => s.id === stageId)!;
  const chNo = ctx.content.chapters.find((c) => c.id === st.chapter)!.order;
  const squads = bandSquads(ctx, chNo);
  const enemies = enemySquad(stageId, ctx);
  const on = { ...ctx, combat: ctx.combat };
  const ratios: number[] = [];
  const durOff: number[] = [];
  const durOn: number[] = [];
  for (const sq of squads) {
    const kOff = thresholdWith(ctx, sq, enemies, false, seeds, steps);
    const kOn = stageThreshold(on, sq, enemies, seeds, steps);
    ratios.push(kOn / kOff);
    const e = scaledEnemies(enemies, kOff);
    for (let seed = 1; seed <= seeds; seed++) {
      durOff.push(simulateBattle(ctx.content, [...sq], e, seed, { combat: ctx.combat, log: false, behavior: false }).duration);
      durOn.push(simulateBattle(ctx.content, [...sq], e, seed, { combat: ctx.combat, log: false }).duration);
    }
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return { stageId, chapter: st.chapter, boss: st.boss, ratio: geo(ratios), ratios, durOff: mean(durOff), durOn: mean(durOn) };
}

/** stageThreshold с behavior off (та же двоичная подборка). */
function thresholdWith(ctx: FullContext, squad: UnitDef[], enemies: (UnitDef | null)[], behavior: boolean, seeds: number, steps: number, lo = 0.03, hi = 30): number {
  let a = Math.log(lo);
  let b = Math.log(hi);
  for (let it = 0; it < steps; it++) {
    const mid = (a + b) / 2;
    const e = scaledEnemies(enemies, Math.exp(mid));
    let n = 0;
    for (let seed = 1; seed <= seeds; seed++) if (simulateBattle(ctx.content, [...squad], e, seed, { combat: ctx.combat, log: false, behavior }).winner === 'A') n++;
    if (n * 2 >= seeds) a = mid;
    else b = mid;
  }
  return Math.exp((a + b) / 2);
}

/** Этапы с боссом или мини-боссом (юнит kind boss или с репликами barks). */
function keyStages(ctx: FullContext): string[] {
  return ctx.content.stages
    .filter((s) => s.boss || s.enemies.some((e) => e && (ctx.content.units[e.unit].kind === 'boss' || ctx.content.units[e.unit].barks)))
    .map((s) => s.id);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ctx = loadFullContext();
  if (arg('scale')) {
    // Ручная поправка: --scale ch1_s10=1.06,ch4_s10=1.1 — mult всех врагов этапа × k.
    const want = new Map(arg('scale')!.split(',').map((kv) => [kv.split('=')[0], Number(kv.split('=')[1])] as const));
    for (const c of ctx.content.chapters) {
      const file = join(ROOT, 'data/campaign', `${c.id}.json`);
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      let touched = false;
      for (const s of raw.stages) {
        const f = want.get(s.id);
        if (!f) continue;
        for (const e of s.enemies) if (e) e.mult = Math.round(e.mult * f * 10000) / 10000;
        touched = true;
      }
      if (touched) writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
    }
  } else if (arg('apply')) {
    // Рядовые этапы — среднее (геометрическое) рядовых этапов главы (меньше шума замера, кривая главы остаётся гладкой);
    // босс и мини-босс — своё отношение, но не меньше главы (ступенька босса над трендом не проваливается). Главы раньше
    // --from (номер главы, по умолчанию 4) не трогаются: их числа сверяют тесты прохождения главы 1 и Σhp глав 2–3, а сдвиг
    // в них в пределах шума замера. --per-stage — каждому этапу своё.
    const rows = JSON.parse(readFileSync(arg('apply')!, 'utf8')) as { stageId: string; chapter: string; ratio: number }[];
    const key = new Set(keyStages(ctx));
    const byCh = new Map<string, number[]>();
    for (const r of rows) if (!key.has(r.stageId)) byCh.set(r.chapter, [...(byCh.get(r.chapter) ?? []), r.ratio]);
    const from = Number(arg('from') ?? 4);
    const order = new Map(ctx.content.chapters.map((c) => [c.id, c.order]));
    const chK = (c: string) => (byCh.has(c) ? geo(byCh.get(c)!) : 1);
    const k = new Map(
      rows
        .filter((r) => (order.get(r.chapter) ?? 0) >= from)
        .map((r) => [r.stageId, flag('per-stage') ? r.ratio : key.has(r.stageId) ? Math.max(r.ratio, chK(r.chapter)) : chK(r.chapter)]),
    );
    for (const c of ctx.content.chapters) {
      const file = join(ROOT, 'data/campaign', `${c.id}.json`);
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      let touched = 0;
      for (const s of raw.stages) {
        const f = k.get(s.id);
        if (!f) continue;
        for (const e of s.enemies) if (e) e.mult = Math.round(e.mult * f * 10000) / 10000;
        touched++;
      }
      if (touched) writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
      if (touched) console.log(`${c.id}: ${touched} этапов`);
    }
  } else {
    const ids = flag('all') ? ctx.content.stages.map((s) => s.id) : keyStages(ctx);
    const rows = ids.map((id) => {
      const r = measure(ctx, id);
      console.log(
        `${id.padEnd(9)} ${r.boss ? 'босс' : '    '} k on/off ${r.ratio.toFixed(3)} [${r.ratios.map((x) => x.toFixed(2)).join(' ')}]  бой на пороге ${r.durOff.toFixed(1)} → ${r.durOn.toFixed(1)} с`,
      );
      return r;
    });
    const chs = [...new Set(rows.map((r) => r.chapter))];
    for (const c of chs) {
      const rs = rows.filter((r) => r.chapter === c);
      console.log(`${c.padEnd(10)} сила ×${(1 / geo(rs.map((r) => r.ratio))).toFixed(3)} (k on/off ${geo(rs.map((r) => r.ratio)).toFixed(3)}), бой ${(rs.reduce((a, r) => a + r.durOff, 0) / rs.length).toFixed(1)} → ${(rs.reduce((a, r) => a + r.durOn, 0) / rs.length).toFixed(1)} с`);
    }
    if (arg('json')) writeFileSync(arg('json')!, JSON.stringify(rows.map(({ stageId, chapter, ratio, durOff, durOn }) => ({ stageId, chapter, ratio, durOff, durOn }))));
  }
}
