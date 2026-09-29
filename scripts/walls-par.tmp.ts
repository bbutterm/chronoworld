import { runModels } from './balance-run';
import { loadFullContext } from './lib/player-model';
const argv = process.argv.slice(2);
const seeds = (argv[0] ?? '1,2,3,4,5').split(',').map(Number);
const days = Number(argv[1] ?? 24);
const ctx = loadFullContext();
const chapters = ctx.content.chapters.map((c) => c.id);
const stCh = new Map(ctx.content.stages.map((s) => [s.id, s.chapter]));
const bossOf = new Map(chapters.map((c) => [c, ctx.content.stages.filter((s) => s.chapter === c).at(-1)!.id]));
const med = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};
const runs = await runModels(seeds, days);
const bossMed: number[] = [];
for (const c of chapters) {
  const times = runs.map((r) => new Map(r.clears).get(bossOf.get(c)!) ?? Infinity);
  const m = med(times);
  bossMed.push(m);
  const walls: string[] = [];
  const maxSess: number[] = [];
  for (const r of runs) {
    let prev = 0;
    const w: string[] = [];
    const sess = new Map<number, number>();
    for (const [st, t] of r.clears) {
      if (stCh.get(st) === c) {
        if (t - prev >= 6) w.push(`${st.split('_')[1]}:${Math.round(t - prev)}`);
        const k = Math.floor((t + 0.01) / 4);
        sess.set(k, (sess.get(k) ?? 0) + 1);
      }
      prev = t;
    }
    walls.push(w.join(',') || '-');
    maxSess.push(Math.max(0, ...sess.values()));
  }
  console.log(
    `${c.padEnd(9)} босс ${isFinite(m) ? m.toFixed(0) : '—'} ч (д${isFinite(m) ? Math.floor((m + 8) / 24) + 1 : '-'}) [${times.map((t) => (isFinite(t) ? t.toFixed(0) : '—')).join('/')}]  maxСесс ${maxSess.join(' ')} | ${walls.join(' | ')}`,
  );
}
console.log('JSON', JSON.stringify(bossMed.map((x) => Math.round(x))));
const P = (r: (typeof runs)[number], t: number) => r.battles.reduce((p, [bt, bp]) => (bt <= t ? Math.max(p, bp) : p), 0);
for (let d = 1; d <= days; d += 1) {
  const t = d * 24 - 8;
  const ps = runs.map((r) => P(r, t));
  console.log(`день ${d} (t ${t}): мощь ${ps.map((p) => p.toFixed(0)).join(' / ')}; медиана ${med(ps).toFixed(0)}`);
}
if (argv[2]) (await import('node:fs')).writeFileSync(argv[2], JSON.stringify(runs));
