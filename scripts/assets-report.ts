/**
 * O: `npm run assets:report` — сколько весят нужные и лишние ассеты, самые большие файлы, листы больше 2048 px.
 * «Нужные» — то, что сборка кладёт в dist (scripts/lib/used-assets.ts).
 */
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/content-node';
import { pngSize } from './lib/png';
import { ASSETS_DIR, collectUsedAssets, listAssetFiles } from './lib/used-assets';

const MAX_SIDE = 2048;
const TOP = 10;

const kb = (n: number) => `${(n / 1024).toFixed(1)} КБ`;
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} МБ`;

const used = collectUsedAssets(ROOT);
const usedSet = new Set(used.files);
const all = listAssetFiles(ROOT).map((file) => ({ file, size: statSync(join(ROOT, ASSETS_DIR, file)).size, used: usedSet.has(file) }));
const present = new Set(all.map((f) => f.file));
const sum = (xs: { size: number }[]) => xs.reduce((s, x) => s + x.size, 0);
const usedFiles = all.filter((f) => f.used);
const unused = all.filter((f) => !f.used);

console.log(`Ассеты в ${ASSETS_DIR}/: ${all.length} файлов, ${mb(sum(all))}`);
console.log(`  нужные (попадают в dist): ${usedFiles.length} файлов, ${mb(sum(usedFiles))}`);
console.log(`  лишние (не попадают):     ${unused.length} файлов, ${mb(sum(unused))}`);

const missing = used.files.filter((f) => !present.has(f));
if (missing.length) {
  console.log(`\nНет на диске (ссылки есть — в игре будет плейсхолдер):`);
  for (const f of missing) console.log(`  ${f}  ← ${used.refs[f].join(', ')}`);
}
if (used.missingSprites.length) console.log(`\nСпрайты из контента без записи в реестре (плейсхолдеры): ${used.missingSprites.join(', ')}`);

console.log(`\nСамые большие файлы:`);
for (const f of [...all].sort((a, b) => b.size - a.size).slice(0, TOP)) {
  console.log(`  ${kb(f.size).padStart(10)}  ${f.used ? 'нужен ' : 'лишний'}  ${f.file}`);
}

const big = all
  .filter((f) => f.file.endsWith('.png'))
  .map((f) => ({ ...f, ...pngSize(join(ROOT, ASSETS_DIR, f.file)) }))
  .filter((f) => f.w > MAX_SIDE || f.h > MAX_SIDE)
  .sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));
console.log(`\nPNG больше ${MAX_SIDE} px по стороне (часть мобильных GPU такие текстуры не держит): ${big.length}`);
for (const f of big) console.log(`  ${`${f.w}×${f.h}`.padStart(12)}  ${f.used ? 'нужен ' : 'лишний'}  ${f.file}`);
