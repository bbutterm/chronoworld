/**
 * Ключи перевода (src/game/i18n.ts): все строки с кириллицей, которые может увидеть игрок.
 * - src/game/**, src/core/** — строковые литералы; шаблонные строки `Глава ${n}` → «Глава {0}»; сцепки
 *   'а' + x + 'б' → «а{0}б» (и их литералы по отдельности). Без схем zod и проверок контента (их видит только автор).
 * - data/** — все строки с кириллицей, кроме ключей «$…» (комментарии) и data/schema.
 * Корзина ключа (файл locales/en/<корзина>.json) — по первому источнику: ui, core, затем data-<папка или файл>.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseAst } from 'rolldown/parseAst';

const CYR = /[А-Яа-яЁё]/;

/** Файлы, чьи строки игрок не видит (сообщения схем и проверок контента — для автора). */
const SKIP_SRC = [/\/schema\.ts$/, /\/validate[^/]*\.ts$/, /src\/core\/content\/check[^/]*\.ts$/, /src\/game\/lab\.ts$/];

function walkFiles(dir: string, ext: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkFiles(p, ext, out);
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

type Node = { type: string; [k: string]: unknown };

/** Ключ шаблонной строки: литеральные части + {i} на месте вставок. */
function templateKey(n: Node): string {
  const quasis = n.quasis as { value: { cooked: string | null; raw: string } }[];
  return quasis.map((q, i) => (i ? `{${i - 1}}` : '') + (q.value.cooked ?? q.value.raw)).join('');
}

/** Цепочка «+»: строки как есть, остальное — {i}. null, если в цепочке нет строкового литерала. */
function concatKey(n: Node): string | null {
  const parts: Node[] = [];
  const flat = (x: Node) => {
    if (x.type === 'BinaryExpression' && x.operator === '+') {
      flat(x.left as Node);
      flat(x.right as Node);
    } else parts.push(x);
  };
  flat(n);
  if (!parts.some((p) => p.type === 'Literal' && typeof p.value === 'string')) return null;
  let i = 0;
  return parts.map((p) => (p.type === 'Literal' && typeof p.value === 'string' ? (p.value as string) : `{${i++}}`)).join('');
}

function visit(n: unknown, add: (key: string) => void, parentKey?: string): void {
  if (!n || typeof n !== 'object') return;
  if (Array.isArray(n)) {
    for (const x of n) visit(x, add);
    return;
  }
  const node = n as Node;
  switch (node.type) {
    case 'ImportDeclaration':
    case 'ExportAllDeclaration':
    case 'TSTypeAnnotation':
    case 'TSLiteralType':
      return;
    case 'CallExpression': {
      const callee = node.callee as Node;
      // console.* — отладка, не игрок.
      if (callee?.type === 'MemberExpression' && (callee.object as Node)?.type === 'Identifier' && (callee.object as { name: string }).name === 'console') return;
      break;
    }
    case 'Literal':
      if (typeof node.value === 'string' && CYR.test(node.value) && parentKey !== 'key') add(node.value);
      return;
    case 'TemplateLiteral': {
      const key = templateKey(node);
      if (CYR.test(key.replace(/\{\d+\}/g, ''))) add(key);
      break;
    }
    case 'BinaryExpression':
      if (node.operator === '+') {
        const key = concatKey(node);
        if (key && CYR.test(key) && /\{\d+\}/.test(key)) add(key);
      }
      break;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'type' || k === 'start' || k === 'end') continue;
    // Ключи объектов ({ 'русский': … }) — не текст для игрока, но вычисляемые ключи и значения — да.
    visit(v, add, node.type === 'Property' && !node.computed ? k : undefined);
  }
}

function srcKeys(root: string, dir: string, add: (key: string, file: string) => void): void {
  for (const file of walkFiles(join(root, dir), '.ts')) {
    const rel = relative(root, file).replaceAll('\\', '/');
    if (SKIP_SRC.some((re) => re.test(rel))) continue;
    const ast = parseAst(readFileSync(file, 'utf8'), { lang: 'ts' }, rel);
    visit(ast, (key) => add(key, rel));
  }
}

function dataKeys(v: unknown, add: (key: string) => void): void {
  if (typeof v === 'string') {
    if (CYR.test(v)) add(v);
  } else if (Array.isArray(v)) v.forEach((x) => dataKeys(x, add));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!k.startsWith('$')) dataKeys(x, add);
}

/** Корзина для файла data/: data-<папка> или data-<имя файла без .json>. */
export function dataBucket(rel: string): string {
  const parts = rel.split('/');
  const name = parts.length > 2 ? parts[1] : parts[1].replace(/\.json$/, '');
  return `data-${name.replaceAll('_', '-')}`;
}

/** Все ключи: ключ → { корзина, первый файл }. Порядок — ui, core, data (стабильный). */
export function collectKeys(root: string): Map<string, { bucket: string; file: string }> {
  const keys = new Map<string, { bucket: string; file: string }>();
  const put = (bucket: string) => (key: string, file: string) => {
    if (!keys.has(key)) keys.set(key, { bucket, file });
  };
  srcKeys(root, 'src/game', put('ui'));
  srcKeys(root, 'src/core', put('core'));
  for (const file of walkFiles(join(root, 'data'), '.json')) {
    const rel = relative(root, file).replaceAll('\\', '/');
    if (rel.startsWith('data/schema/')) continue;
    dataKeys(JSON.parse(readFileSync(file, 'utf8')), (key) => put(dataBucket(rel))(key, rel));
  }
  return keys;
}

/** Все переводы из locales/en/*.json (ключ → перевод), без служебных файлов «_…». */
export function loadTranslations(root: string): Map<string, string> {
  const out = new Map<string, string>();
  let files: string[] = [];
  try {
    files = readdirSync(join(root, 'locales/en')).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();
  } catch {
    return out;
  }
  for (const f of files) {
    const d = JSON.parse(readFileSync(join(root, 'locales/en', f), 'utf8')) as Record<string, string>;
    for (const [k, v] of Object.entries(d)) if (!out.get(k)) out.set(k, v);
  }
  return out;
}

/** Вставки {0}…{n} и {hero}… в ключе и переводе должны совпадать (порядок в переводе может быть любым). */
export function placeholdersOf(s: string): string {
  return [...new Set([...s.matchAll(/\{([0-9]+|[a-z][a-z0-9_]*)\}/g)].map((m) => m[1]))].sort().join(',');
}
