/**
 * Линт интерфейса (храповик): счётчики нарушений дизайн-системы по файлам экранов (docs/content/ui.md,
 * docs/design/ui-polish-research.md §3). Базовая линия — scripts/ui-lint-baseline.json: ни один счётчик ни в одном
 * файле не может вырасти (tests/ui-lint.test.ts, входит в `npm run check`); уменьшился — `--update` опускает линию.
 *
 *   npm run ui:lint                 — отчёт (итоги, худшие файлы, оставшиеся инструкции в сценах); код 1 при росте
 *   npm run ui:lint -- --update     — опустить базовую линию до текущих чисел (только вниз, рост не записывается)
 *   npm run ui:lint -- --add-new    — вместе с --update: записать счётчики новых файлов (решение при слиянии, не по умолчанию)
 *   npm run ui:lint -- --verbose    — все находки построчно
 *
 * Что считается (строки и комментарии разбираются лексером, поэтому комментарии не считаются):
 *   instr    — «нажмите» / «коснитесь» / «чтобы» в строковых литералах (принцип 3: ноль инструкций в постоянном UI);
 *   color    — '#rrggbb' в строках и 0xRRGGBB в коде вне theme.ts / skin.ts / kitchenDishArt.ts (принцип 7: цвет — только токеном);
 *   fontSize — числовой размер шрифта: `fontSize: 32` / `fontSize: '32px'`, 5-й аргумент text(), 9-й аргумент button()
 *              (принцип 2: только T.*);
 *   primary  — 'ui_btn_primary', variant: 'primary' и вызовы cta( (принцип 1: одна главная кнопка на экран);
 *   toast    — вызовы toast( (политика тостов: только ошибки и невидимые результаты).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const METRICS = ['instr', 'color', 'fontSize', 'primary', 'toast'] as const;
export type Metric = (typeof METRICS)[number];
export type Counts = Record<Metric, number>;

export const METRIC_TITLE: Record<Metric, string> = {
  instr: 'инструкции «Нажмите/Коснитесь/чтобы»',
  color: 'литералы цветов #… / 0x…',
  fontSize: 'числовые размеры шрифта',
  primary: 'главные кнопки (ui_btn_primary, cta)',
  toast: 'вызовы toast()',
};

/** Файлы, где литералы цветов законны: сами токены и скин. */
// theme.ts — токены; skin.ts и kitchenDishArt.ts — процедурный арт (скин, пиксельные блюда Кухни), их палитры — не цвета интерфейса.
const COLOR_ALLOWED = new Set(['src/game/theme.ts', 'src/game/skin.ts', 'src/game/kitchenDishArt.ts']);

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const BASELINE_PATH = join(ROOT, 'scripts/ui-lint-baseline.json');

// ———————————————————————————————— Лексер ————————————————————————————————

export interface StringLit {
  value: string;
  line: number;
}
export interface Lexed {
  /** Исходник, где строки и комментарии заменены пробелами (переводы строк сохранены — номера строк те же). */
  code: string;
  strings: StringLit[];
}

const REGEX_PREV = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const REGEX_KEYWORDS = /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|void|yield|await|delete|new)$/;

/**
 * Минимальный лексер TS: строки '…', "…", шаблоны `…${…}…` (выражения внутри — снова код), комментарии // и /* *\/,
 * литералы регулярных выражений (по предыдущему значимому символу). Этого хватает для подсчёта, полный парсер не нужен.
 */
export function lex(src: string): Lexed {
  const out: string[] = [];
  const strings: StringLit[] = [];
  let line = 1;
  let i = 0;
  // Стек вложенности: 'code' — фигурная скобка кода; 'tpl' — выражение ${…} внутри шаблона.
  const stack: ('code' | 'tpl')[] = [];
  let prev = ''; // последний значимый символ кода

  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  const push = (s: string) => {
    out.push(s);
    for (const ch of s) if (ch === '\n') line++;
  };

  const readTemplatePart = (): void => {
    // i указывает на символ после ` или после } закрывшего ${…}
    const startLine = line;
    let buf = '';
    let raw = '';
    while (i < src.length) {
      const ch = src[i];
      if (ch === '\\') {
        buf += src.slice(i, i + 2);
        raw += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (ch === '`') {
        raw += ch;
        i++;
        strings.push({ value: buf, line: startLine });
        push(blank(raw));
        prev = 'a';
        return;
      }
      if (ch === '$' && src[i + 1] === '{') {
        raw += '${';
        i += 2;
        strings.push({ value: buf, line: startLine });
        push(blank(raw));
        stack.push('tpl');
        prev = '{';
        return;
      }
      buf += ch;
      raw += ch;
      i++;
    }
    strings.push({ value: buf, line: startLine });
    push(blank(raw));
  };

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? src.length : end;
      push(blank(src.slice(i, stop)));
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      push(blank(src.slice(i, stop)));
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const startLine = line;
      let j = i + 1;
      let buf = '';
      while (j < src.length && src[j] !== ch && src[j] !== '\n') {
        if (src[j] === '\\') {
          buf += src.slice(j, j + 2);
          j += 2;
        } else buf += src[j++];
      }
      strings.push({ value: buf, line: startLine });
      push(blank(src.slice(i, j + 1)));
      i = j + 1;
      prev = 'a';
      continue;
    }
    if (ch === '`') {
      push(' ');
      i++;
      readTemplatePart();
      continue;
    }
    if (ch === '/' && (prev === '' || REGEX_PREV.has(prev) || REGEX_KEYWORDS.test(out.slice(-16).join('').slice(-12).trimEnd()))) {
      // литерал регулярного выражения
      let j = i + 1;
      let cls = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        else if (src[j] === '/' && !cls) break;
        j++;
      }
      j++;
      while (j < src.length && /[a-z]/i.test(src[j])) j++;
      push(blank(src.slice(i, j)));
      i = j;
      prev = 'a';
      continue;
    }
    if (ch === '{') stack.push('code');
    if (ch === '}') {
      const top = stack.pop();
      if (top === 'tpl') {
        push(' ');
        i++;
        readTemplatePart();
        continue;
      }
    }
    push(ch);
    i++;
    if (!/\s/.test(ch)) prev = ch;
  }
  return { code: out.join(''), strings };
}

// ———————————————————————————————— Счётчики ————————————————————————————————

export interface Finding {
  metric: Metric;
  line: number;
  text: string;
}

const INSTR = /нажмите|коснитесь|чтобы/i;
const HEX_STR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z])/gi;
const HEX_NUM = /\b0x(?:[0-9a-f]{8}|[0-9a-f]{6})\b/gi;
const FONT_PROP = /\bfontSize\s*[:=]\s*(?:\d|['"`]\s*\d)/g;
const PRIMARY_LIT = /^(?:ui_btn_primary)$/;
const VARIANT_PRIMARY = /\bvariant\s*:\s*$/;

const lineAt = (code: string, idx: number): number => {
  let n = 1;
  for (let k = 0; k < idx; k++) if (code.charCodeAt(k) === 10) n++;
  return n;
};

/** Аргументы вызова, начинающегося с открывающей скобки в позиции open (по коду без строк). */
function callArgs(code: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let cur = '';
  for (let k = open; k < code.length; k++) {
    const ch = code[k];
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      if (depth === 1) continue;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) {
        args.push(cur.trim());
        return args;
      }
    } else if (ch === ',' && depth === 1) {
      args.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  return args;
}

const isNumberLit = (s: string): boolean => /^\d+(?:\.\d+)?$/.test(s);

/** Находки в одном файле. rel — путь от корня (для исключений по цветам). */
export function scanSource(src: string, rel: string): Finding[] {
  const { code, strings } = lex(src);
  const found: Finding[] = [];
  const srcLines = src.split('\n');
  const lineText = (n: number) => (srcLines[n - 1] ?? '').trim().slice(0, 140);

  for (const s of strings) {
    if (INSTR.test(s.value)) found.push({ metric: 'instr', line: s.line, text: s.value.slice(0, 120) });
    if (!COLOR_ALLOWED.has(rel)) for (const m of s.value.matchAll(HEX_STR)) found.push({ metric: 'color', line: s.line, text: m[0] });
  }
  if (!COLOR_ALLOWED.has(rel))
    for (const m of code.matchAll(HEX_NUM)) {
      const ln = lineAt(code, m.index);
      found.push({ metric: 'color', line: ln, text: m[0] });
    }

  // Размер шрифта числом. fontSize: 32 — в коде; fontSize: '32px' — строка вычищена, смотрим исходник в том же месте.
  for (const m of src.matchAll(FONT_PROP)) {
    if (code.slice(m.index, m.index + 8) !== 'fontSize') continue; // внутри строки или комментария
    const ln = lineAt(src, m.index);
    found.push({ metric: 'fontSize', line: ln, text: lineText(ln) });
  }
  for (const m of code.matchAll(/(?<![\w$.])(text|button)\s*\(/g)) {
    if (/function\s+$/.test(code.slice(Math.max(0, m.index - 12), m.index))) continue;
    const args = callArgs(code, m.index + m[0].length - 1);
    const idx = m[1] === 'text' ? 4 : 8;
    if (args.length > idx && isNumberLit(args[idx])) {
      const ln = lineAt(code, m.index);
      found.push({ metric: 'fontSize', line: ln, text: lineText(ln) });
    }
  }

  // Главные кнопки.
  for (const s of strings) if (PRIMARY_LIT.test(s.value)) found.push({ metric: 'primary', line: s.line, text: lineText(s.line) });
  const lines = code.split('\n');
  for (const s of strings) {
    if (s.value !== 'primary') continue;
    const before = (lines[s.line - 1] ?? '').slice(0, Math.max(0, srcLines[s.line - 1]?.indexOf("'primary'") ?? -1));
    if (VARIANT_PRIMARY.test(before)) found.push({ metric: 'primary', line: s.line, text: lineText(s.line) });
  }
  for (const m of code.matchAll(/(?<![\w$.])cta\s*\(/g)) {
    if (/function\s+$/.test(code.slice(Math.max(0, m.index - 12), m.index))) continue;
    const ln = lineAt(code, m.index);
    found.push({ metric: 'primary', line: ln, text: lineText(ln) });
  }

  // Тосты.
  for (const m of code.matchAll(/(?<![\w$.])toast\s*\(/g)) {
    if (/function\s+$/.test(code.slice(Math.max(0, m.index - 12), m.index))) continue;
    const ln = lineAt(code, m.index);
    found.push({ metric: 'toast', line: ln, text: lineText(ln) });
  }
  return found.sort((a, b) => a.line - b.line);
}

export const zero = (): Counts => ({ instr: 0, color: 0, fontSize: 0, primary: 0, toast: 0 });

export function countsOf(findings: Finding[]): Counts {
  const c = zero();
  for (const f of findings) c[f.metric]++;
  return c;
}

/** Файлы под линтом: сцены и помощники экранов верхнего уровня src/game. */
export function lintFiles(root = ROOT): string[] {
  const list = (dir: string) =>
    readdirSync(join(root, dir))
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
      .map((f) => `${dir}/${f}`);
  return [...list('src/game/scenes'), ...list('src/game')].sort();
}

export interface Scan {
  files: Record<string, Counts>;
  findings: Record<string, Finding[]>;
}

export function scanAll(root = ROOT): Scan {
  const files: Record<string, Counts> = {};
  const findings: Record<string, Finding[]> = {};
  for (const rel of lintFiles(root)) {
    const f = scanSource(readFileSync(join(root, rel), 'utf8'), rel);
    findings[rel] = f;
    files[rel] = countsOf(f);
  }
  return { files, findings };
}

// ———————————————————————————————— Базовая линия ————————————————————————————————

export interface Baseline {
  note: string;
  totals: Counts;
  files: Record<string, Partial<Counts>>;
}

export function loadBaseline(path = BASELINE_PATH): Baseline {
  return JSON.parse(readFileSync(path, 'utf8')) as Baseline;
}

export function totalsOf(files: Record<string, Partial<Counts>>): Counts {
  const t = zero();
  for (const c of Object.values(files)) for (const m of METRICS) t[m] += c[m] ?? 0;
  return t;
}

export interface Growth {
  file: string;
  metric: Metric;
  baseline: number;
  now: number;
}

/** Где счётчик вырос относительно базовой линии (файла нет в линии — у него нули). */
export function growths(scan: Scan, base: Baseline): Growth[] {
  const out: Growth[] = [];
  for (const [file, c] of Object.entries(scan.files)) {
    const b = base.files[file] ?? {};
    for (const m of METRICS) if (c[m] > (b[m] ?? 0)) out.push({ file, metric: m, baseline: b[m] ?? 0, now: c[m] });
  }
  return out;
}

/** Новая линия: по каждому файлу min(было, стало); новые файлы — только с addNew; удалённые файлы уходят. */
export function lowered(scan: Scan, base: Baseline, addNew: boolean): Baseline {
  const files: Record<string, Partial<Counts>> = {};
  for (const [file, c] of Object.entries(scan.files)) {
    const b = base.files[file];
    if (!b && !addNew) continue;
    const row: Partial<Counts> = {};
    for (const m of METRICS) {
      const v = b ? Math.min(b[m] ?? 0, c[m]) : c[m];
      if (v > 0) row[m] = v;
    }
    if (Object.keys(row).length) files[file] = row;
  }
  return { note: base.note, totals: totalsOf(files), files };
}

const NOTE =
  'Базовая линия scripts/ui-lint.ts: счётчики по файлам могут только уменьшаться. Опустить — npm run ui:lint -- --update. Руками не повышать.';

export function writeBaseline(b: Baseline, path = BASELINE_PATH): void {
  const files = Object.fromEntries(Object.keys(b.files).sort().map((k) => [k, b.files[k]]));
  writeFileSync(path, `${JSON.stringify({ note: b.note || NOTE, totals: b.totals, files }, null, 2)}\n`);
}

// ———————————————————————————————— CLI ————————————————————————————————

function report(scan: Scan, base: Baseline | null, verbose: boolean): void {
  const totals = totalsOf(scan.files);
  console.log('Линт интерфейса (docs/content/ui.md):');
  for (const m of METRICS) {
    const b = base ? ` (линия ${base.totals[m]})` : '';
    console.log(`  ${METRIC_TITLE[m]}: ${totals[m]}${b}`);
  }
  for (const m of METRICS) {
    const top = Object.entries(scan.files)
      .filter(([, c]) => c[m] > 0)
      .sort((a, b) => b[1][m] - a[1][m])
      .slice(0, 6)
      .map(([f, c]) => `${f.replace('src/game/', '')} ${c[m]}`);
    if (top.length) console.log(`  больше всего — ${m}: ${top.join(', ')}`);
  }
  const instr = Object.entries(scan.findings).flatMap(([f, list]) =>
    list.filter((x) => x.metric === 'instr').map((x) => `    ${f.replace('src/game/', '')}:${x.line} «${x.text}»`),
  );
  if (instr.length) {
    console.log(`  Инструкции в строках (${instr.length}):`);
    for (const l of instr) console.log(l);
  }
  if (verbose)
    for (const [f, list] of Object.entries(scan.findings))
      for (const x of list) console.log(`  ${f}:${x.line} [${x.metric}] ${x.text}`);
}

function main(argv: string[]): number {
  const scan = scanAll();
  const update = argv.includes('--update');
  const addNew = argv.includes('--add-new');
  let base: Baseline | null = null;
  try {
    base = loadBaseline();
  } catch {
    base = null;
  }
  report(scan, base, argv.includes('--verbose'));
  if (!base) {
    if (!update) {
      console.log('Базовой линии нет — создать: npm run ui:lint -- --update');
      return 1;
    }
    const files = Object.fromEntries(Object.entries(scan.files).map(([f, c]) => [f, Object.fromEntries(METRICS.filter((m) => c[m] > 0).map((m) => [m, c[m]]))]));
    writeBaseline({ note: NOTE, totals: totalsOf(files), files });
    console.log(`Записана базовая линия: ${relative(ROOT, BASELINE_PATH)}`);
    return 0;
  }
  const grown = growths(scan, base);
  if (update) {
    const next = lowered(scan, base, addNew);
    writeBaseline(next);
    console.log(`Базовая линия обновлена (только вниз${addNew ? ', новые файлы добавлены' : ''}): ${relative(ROOT, BASELINE_PATH)}`);
  }
  if (grown.length) {
    console.log('\n✗ Выросло относительно базовой линии:');
    for (const g of grown) console.log(`  ${g.file}: ${METRIC_TITLE[g.metric]} ${g.baseline} → ${g.now}`);
    console.log('Уберите новые нарушения (токены theme.ts, компоненты ui.ts/screen.ts). Правила — docs/content/ui.md.');
    return 1;
  }
  console.log('\n✓ Ни один счётчик не вырос.');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
