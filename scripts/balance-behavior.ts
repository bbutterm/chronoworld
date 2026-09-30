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
import { buildUnit, enemySquad, recommendedFactor, recommendedHeroLevel, simulateBattle, stageLevels, type CardRarity, type UnitDef } from '../src/core';
import { ROOT } from './lib/content-node';
import { loadFullContext, referenceLevel, scaledEnemies, SMOOTH_SQUADS, smoothSquads, stageThreshold, type FullContext } from './lib/player-model';

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
  if (flag('smooth')) {
    // Гладкость глав 4+ как в тесте chapters.test.ts (LT-02): сила этапа для пяти SMOOTH_SQUADS ур. 45 относительно
    // геометрического тренда рядовых этапов главы; рядовой вне [0.87, 1.13] тренда и босс вне [1.02, 1.33] — mult этапа
    // подтягивается к границе (сила линейна по mult).
    const squads = smoothSquads(ctx, 45, SMOOTH_SQUADS);
    const late = ctx.content.chapters.slice(3).map((c) => c.id);
    const ids = ctx.content.stages.filter((st) => late.includes(st.chapter)).map((st) => st.id);
    const profiles = squads.map((sq) => ids.map((id) => Math.log(1 / stageThreshold(ctx, sq, enemySquad(id, ctx), 6, 8))));
    const g = profiles.map((p) => p.reduce((a, b) => a + b, 0) / p.length);
    const d = new Map(ids.map((id, i) => [id, Math.max(...profiles.map((p, j) => p[i] - g[j]))]));
    const fix: string[] = [];
    for (const ch of late) {
      const list = ctx.content.stages.filter((s) => s.chapter === ch);
      const reg = list.filter((x) => !x.boss).map((x) => d.get(x.id)!);
      const n = reg.length;
      const xm = (n - 1) / 2;
      const ym = reg.reduce((a, b) => a + b, 0) / n;
      const slope = reg.reduce((a, y, i) => a + (i - xm) * (y - ym), 0) / reg.reduce((a, _, i) => a + (i - xm) ** 2, 0);
      list.forEach((x, i) => {
        const r = Math.exp(d.get(x.id)! - (ym + slope * (Math.min(i, n - 1) - xm)));
        const [lo, hi] = x.boss ? [1.02, 1.33] : [0.87, 1.13];
        if (r < lo || r > hi) fix.push(`${x.id}=${(Math.min(hi, Math.max(lo, r)) / r).toFixed(4)}`);
        if (r < lo || r > hi) console.log(`${x.id}: ${r.toFixed(3)} тренда`);
      });
    }
    console.log(fix.length ? `--scale ${fix.join(',')}` : 'все этапы в пределах');
  } else if (flag('fit-levels')) {
    // Рекомендуемая мощь босс-этапов (progression.json → power.recommendedStages) под «уровень по бою» эталонных отрядов
    // (тест features-levels «калибровка»): с профилями герои дерутся лучше, чем говорят статы, — рекомендация и уровень босса
    // (оба от recommendedFactor) опускаются, бой не меняется. Двоичный поиск коэффициента: «рекомендуем без вещей» = по бою.
    const file = join(ROOT, 'data/progression.json');
    let text = readFileSync(file, 'utf8');
    const lv = ctx.features.power.levels!;
    for (const s of ctx.content.stages.filter((x) => x.boss && x.globalIndex > 10)) {
      const battle = referenceLevel(s.id, ctx, 8);
      // Ошибка коэффициента k: наибольшее из |рекомендуем − по бою| и |уровень босса − по бою| (оба от k; рекомендация
      // между редкостями скачет — поэтому перебор сеткой, а не двоичный поиск).
      const err = (k: number) => {
        const c = { ...ctx, features: { ...ctx.features, power: { ...ctx.features.power, recommendedStages: { ...ctx.features.power.recommendedStages, [s.id]: k } } } };
        const cn = { ...c, features: { ...c.features, power: { ...c.features.power, levels: { ...lv, bands: lv.bands.map((b) => ({ ...b, gear: 0 })) } } } };
        const rec = recommendedHeroLevel(s.id, cn).level;
        const boss = stageLevels(s.id, c).boss ?? rec;
        return { rec, boss, e: Math.max(Math.abs(rec - battle), Math.abs(boss - battle)) };
      };
      const cur = recommendedFactor(s.id, ctx);
      const before = err(cur);
      if (before.e <= 2) {
        console.log(`${s.id}: рекомендуем ${before.rec}, босс ${before.boss}, по бою ${battle} — как есть (${cur})`);
        continue;
      }
      let k = cur;
      for (let x = 0.3; x <= 1.6; x += 0.01) if (err(x).e < err(k).e) k = Math.round(x * 100) / 100;
      const after = err(k);
      console.log(`${s.id}: рекомендуем ${before.rec} → ${after.rec}, босс ${before.boss} → ${after.boss}, по бою ${battle}; коэффициент ${cur} → ${k}`);
      const re = new RegExp(`("${s.id}": )[0-9.]+`);
      text = re.test(text) ? text.replace(re, `$1${k}`) : text.replace('"recommendedStages": {', `"recommendedStages": {\n      "${s.id}": ${k},`);
    }
    writeFileSync(file, text);
  } else if (arg('scale')) {
    // Ручная поправка: --scale ch1_s10=1.06,ch4_s10=1.1 — mult всех врагов этапа × k.
    // Ключ — id этапа или главы (chapter5=0.95 — все этапы главы).
    const want = new Map(arg('scale')!.split(',').map((kv) => [kv.split('=')[0], Number(kv.split('=')[1])] as const));
    for (const s of ctx.content.stages) if (want.has(s.chapter)) want.set(s.id, (want.get(s.id) ?? 1) * want.get(s.chapter)!);
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
