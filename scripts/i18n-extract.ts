/**
 * Словарь перевода: собрать ключи (scripts/lib/i18n-keys.ts) и разложить по locales/en/<корзина>.json,
 * сохраняя готовые переводы. Новые ключи — с пустым переводом "". Ключи, которых больше нет в коде и data/, удаляются.
 *
 *   npm run i18n:extract            # обновить файлы
 *   npm run i18n:extract -- --check # только отчёт: сколько ключей и сколько без перевода (код выхода 1, если есть)
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectKeys, loadTranslations } from './lib/i18n-keys';

const root = process.cwd();
const check = process.argv.includes('--check');
const keys = collectKeys(root);
const done = loadTranslations(root);

const buckets = new Map<string, Record<string, string>>();
for (const [key, { bucket }] of keys) {
  if (!buckets.has(bucket)) buckets.set(bucket, {});
  buckets.get(bucket)![key] = done.get(key) ?? '';
}

let missing = 0;
const lines: string[] = [];
for (const [bucket, entries] of [...buckets].sort(([a], [b]) => a.localeCompare(b))) {
  const total = Object.keys(entries).length;
  const empty = Object.values(entries).filter((v) => !v).length;
  missing += empty;
  lines.push(`${bucket.padEnd(28)} ${String(total).padStart(6)} ключей, без перевода ${empty}`);
}
console.log(lines.join('\n'));
console.log(`Всего ${keys.size} ключей, без перевода ${missing}.`);

if (check) process.exit(missing ? 1 : 0);

const dir = join(root, 'locales/en');
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) if (f.endsWith('.json') && !f.startsWith('_') && !buckets.has(f.replace(/\.json$/, ''))) rmSync(join(dir, f));
for (const [bucket, entries] of buckets) writeFileSync(join(dir, `${bucket}.json`), `${JSON.stringify(entries, null, 1)}\n`);
console.log(`Записано: locales/en/*.json (${buckets.size} файлов).`);
