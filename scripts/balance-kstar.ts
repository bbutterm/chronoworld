/**
 * Порог k* всех этапов для эталонных отрядов полосы главы (REFERENCE_SQUADS, BAND из balance-behavior) — снимок силы этапов
 * до и после правки боя: отношение k*после / k*до > 1 — этап стал легче (mult врагов можно поднять во столько же).
 *   npx tsx scripts/balance-kstar.ts before.json                снять снимок
 *   npx tsx scripts/balance-kstar.ts after.json before.json     снять и сравнить по главам (геометрическое среднее)
 *   npx tsx scripts/balance-kstar.ts after.json before.json --apply   умножить mult врагов глав на отношение (главы 4+ целиком,
 *                                                                      главы 1–3 — только если сдвиг больше 3%)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { enemySquad } from '../src/core';
import { bandSquads } from './balance-behavior';
import { ROOT } from './lib/content-node';
import { loadFullContext, stageThreshold } from './lib/player-model';

const [out, before] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
const ctx = loadFullContext();
const geo = (xs: number[]) => Math.exp(xs.reduce((a, b) => a + Math.log(b), 0) / xs.length);
const k: Record<string, number> = {};
for (const ch of ctx.content.chapters) {
  const squads = bandSquads(ctx, ch.order).slice(0, 3);
  for (const st of ctx.content.stages.filter((s) => s.chapter === ch.id)) {
    const e = enemySquad(st.id, ctx);
    k[st.id] = geo(squads.map((sq) => stageThreshold(ctx, sq, e, 6, 8)));
  }
}
writeFileSync(out, JSON.stringify(k));
if (before) {
  const b = JSON.parse(readFileSync(before, 'utf8')) as Record<string, number>;
  const factor = new Map<string, number>();
  for (const ch of ctx.content.chapters) {
    const ids = ctx.content.stages.filter((s) => s.chapter === ch.id).map((s) => s.id);
    const r = geo(ids.map((id) => k[id] / b[id]));
    factor.set(ch.id, r);
    console.log(`глава ${ch.order}: k* после/до ×${r.toFixed(3)} (этапы ${ids.map((id) => (k[id] / b[id]).toFixed(2)).join(' ')})`);
  }
  if (apply)
    for (const ch of ctx.content.chapters) {
      const f = factor.get(ch.id)!;
      if (ch.order <= 3 && Math.abs(Math.log(f)) < Math.log(1.03)) continue;
      const file = join(ROOT, 'data/campaign', `${ch.id}.json`);
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      for (const s of raw.stages) for (const e of s.enemies) if (e) e.mult = Math.round(e.mult * f * 10000) / 10000;
      writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
      console.log(`${ch.id}: mult ×${f.toFixed(3)}`);
    }
}
