/**
 * Локализация (русский — исходный язык, английский — перевод). Ключ перевода — сама русская строка, как в gettext:
 * код и data/ пишутся по-русски, а перевод подставляется при выводе текста (Phaser Text.setText, installI18n).
 * Нет перевода — остаётся русский текст, игра не ломается.
 *
 * Словарь — locales/en/*.json: { "русская строка": "English" }. Ключи с подстановками — шаблоны: «Глава {0}»,
 * «{0} получил ур. {1}» ({0}, {1} — по порядку вставок `${…}` в исходнике). Собирает ключи `npm run i18n:extract`
 * (scripts/i18n-extract.ts): литералы src/game, src/core и все строки data/. Порядок поиска перевода:
 * 1) точное совпадение; 2) шаблон (вставки переводятся рекурсивно — имена из data/ тоже); 3) разбор по частям
 * через разделители (перевод строки, « · », « — », «: »). Модуль без Phaser — тестируется в vitest (tests/i18n.test.ts).
 */

export type Locale = 'ru' | 'en';
export const LOCALES: readonly Locale[] = ['ru', 'en'];
/** Подпись языка в настройках — на своём языке. */
export const LOCALE_NAMES: Record<Locale, string> = { ru: 'Русский', en: 'English' };
export const LOCALE_KEY = 'chronoworld.locale';

const CYR = /[А-Яа-яЁё]/;
export const hasCyrillic = (s: string): boolean => CYR.test(s);

/** Язык по умолчанию: из языка Telegram/браузера — русский для ru/uk/be/kk, иначе английский. */
export function defaultLocale(languageCode: string | undefined | null): Locale {
  const code = (languageCode ?? '').toLowerCase().slice(0, 2);
  if (!code) return 'ru';
  return ['ru', 'uk', 'be', 'kk'].includes(code) ? 'ru' : 'en';
}

export const isLocale = (v: unknown): v is Locale => v === 'ru' || v === 'en';

interface Template {
  /** Литеральные части между вставками: parts.length = slots + 1. */
  parts: string[];
  re: RegExp;
  out: string;
  /** Самая длинная литеральная часть — быстрый отсев (s.includes(anchor)). */
  anchor: string;
  /** Длина литералов — сначала пробуем более конкретные шаблоны. */
  weight: number;
}

export interface Dict {
  exact: Map<string, string>;
  templates: Template[];
}

/** Вставки: {0}…{n} из кода и именованные {hero}, {partner}… из data/ (их подставляет игра до вывода). */
const SLOT = /\{([0-9]+|[a-z][a-z0-9_]*)\}/g;
const HAS_SLOT = /\{(?:[0-9]+|[a-z][a-z0-9_]*)\}/;
/** Формы по роду из data/ (expedition-events: «[пошёл|пошла]») — игра выбирает одну до вывода. */
const GENDER = /\[([^|\]]*)\|([^\]]*)\]/g;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** «[м|ж]» → два варианта ключа (и перевода, если в нём тоже есть «[…|…]»). */
function genderVariants(ru: string, en: string): [string, string][] {
  GENDER.lastIndex = 0;
  if (!GENDER.test(ru)) return [[ru, en]];
  const pick = (s: string, i: 1 | 2) => s.replace(GENDER, (_m, a: string, b: string) => (i === 1 ? a : b));
  return [
    [pick(ru, 1), pick(en, 1)],
    [pick(ru, 2), pick(en, 2)],
  ];
}

/** Ключи со вставками — шаблоны; литералы шаблона без кириллицы не в счёт (их части переводятся по отдельности). */
export function compileDict(entries: Record<string, string>): Dict {
  const exact = new Map<string, string>();
  const templates: Template[] = [];
  for (const [ru0, en0] of Object.entries(entries)) {
    if (!en0) continue;
    for (const [ru, en] of genderVariants(ru0, en0)) {
      if (!HAS_SLOT.test(ru)) {
        exact.set(ru, en);
        // Ключ «\nВыбор карты» из сцепки в коде — строка на экране делится по переводу строки и приходит без него.
        const bare = ru.trim();
        if (bare !== ru && !entries[bare]) exact.set(bare, en.trim());
        // «Глава 2. Под мостовой» — экраны показывают и одно название главы («Под мостовой»).
        const ch = /^Глава\s*\d+\.\s*(.+)$/s.exec(ru);
        const chEn = /^Chapter\s*\d+\.\s*(.+)$/s.exec(en);
        if (ch && chEn && !entries[ch[1]]) exact.set(ch[1], chEn[1]);
        continue;
      }
      const parts = ru.split(/\{(?:[0-9]+|[a-z][a-z0-9_]*)\}/);
      const names = [...ru.matchAll(SLOT)].map((m) => m[1]);
      const literal = parts.join('');
      if (!hasCyrillic(literal)) continue;
      const src = parts.map(escapeRe).join('([\\s\\S]+?)');
      const re = new RegExp(`^${src}$`);
      // В выходе вставка — по номеру группы её первого появления в ключе (порядок в переводе любой).
      let out = en;
      [...new Set(names)].forEach((name) => {
        out = out.replaceAll(`{${name}}`, `\u0000${names.indexOf(name)}\u0000`);
      });
      templates.push({ parts, re, out, anchor: parts.reduce((a, b) => (b.length > a.length ? b : a), ''), weight: literal.length });
    }
  }
  templates.sort((a, b) => b.weight - a.weight);
  return { exact, templates };
}

const SEPARATORS = ['\n', ' · ', ' • ', ' — ', ' → ', ' / ', ': ', ', '];

/** Кавычки и скобки, которыми код обрамляет строку из data/ («реплика», (пометка)). */
const WRAP = /^([«"„“(])([\s\S]+)([»"“”)])$/;
const QUOTES_EN: Record<string, string> = { '«': '“', '„': '“', '»': '”', '“': '”' };
/** Слово кириллицей (для перевода по словам коротких строк из сокращений: «+150 ОЗ · +4 ЗАЩ»). */
const WORD = /[А-Яа-яЁё][А-Яа-яЁё-]*/g;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Перевести строку. Без кириллицы — как есть. Если в итоге осталась кириллица (перевод частичный или его нет),
 * onMissing получает исходную строку (для отчёта QA).
 */
export function translate(s: string, d: Dict, onMissing?: (s: string) => void): string {
  const out = tr(s, d, 0);
  if (onMissing && hasCyrillic(out) && s.trim().length > 1) onMissing(s);
  return out;
}

/** Полный перевод лучше частичного: частичный запоминаем и пробуем следующий путь. */
function tr(s: string, d: Dict, depth: number): string {
  if (!s || !hasCyrillic(s)) return s;
  const hit = d.exact.get(s);
  if (hit !== undefined) return hit;
  let partial: string | undefined;
  const take = (t: string | undefined): string | undefined => {
    if (t === undefined || t === s) return undefined;
    if (!hasCyrillic(t)) return t;
    partial ??= t;
    return undefined;
  };
  // Пробелы по краям — не часть ключа.
  const trimmed = s.trim();
  if (trimmed !== s) {
    const lead = s.slice(0, s.indexOf(trimmed));
    const tail = s.slice(lead.length + trimmed.length);
    const t = tr(trimmed, d, depth + 1);
    if (t !== trimmed) return lead + t + tail;
  }
  if (depth < 4) {
    for (const tpl of d.templates) {
      if (tpl.anchor && !s.includes(tpl.anchor)) continue;
      const m = tpl.re.exec(s);
      if (!m) continue;
      let out = tpl.out;
      for (let i = 1; i < m.length; i++) out = out.replaceAll(`\u0000${i - 1}\u0000`, tr(m[i], d, depth + 1));
      const r = take(out);
      if (r !== undefined) return r;
    }
    const alt = take(fallback(s, d, depth));
    if (alt !== undefined) return alt;
    for (const sep of SEPARATORS) {
      if (!s.includes(sep)) continue;
      const pieces = s.split(sep);
      const r = take(pieces.map((p) => tr(p, d, depth + 1)).join(sep));
      if (r !== undefined) return r;
    }
    const words = take(byWords(s, d));
    if (words !== undefined) return words;
  }
  return partial ?? s;
}

/** Запасные пути до разбора по частям: кавычки вокруг строки, регистр (ЗАГЛАВНЫЕ, «Огонь» из «огонь»). */
function fallback(s: string, d: Dict, depth: number): string | undefined {
  const sub = (x: string) => tr(x, d, depth + 1);
  const w = WRAP.exec(s);
  if (w) {
    const inner = sub(w[2]);
    if (inner !== w[2]) return (QUOTES_EN[w[1]] ?? w[1]) + inner + (QUOTES_EN[w[3]] ?? w[3]);
  }
  // Тире или маркер в начале строки («— находок главы собрано: 4 из 4»).
  const lead = /^([—–•·-] )([\s\S]+)$/.exec(s);
  if (lead) {
    const t = sub(lead[2]);
    if (t !== lead[2]) return lead[1] + t;
  }
  const lower = s.toLowerCase();
  if (s === s.toUpperCase() && s !== lower) {
    // «ЛЕТОПИСЬ ОТРЯДА» — ключ «Летопись отряда» или «летопись отряда».
    for (const v of [capitalize(lower), lower]) {
      const t = sub(v);
      if (t !== v && !hasCyrillic(t)) return t.toUpperCase();
    }
  } else if (s.charAt(0) !== s.charAt(0).toLowerCase()) {
    const v = s.charAt(0).toLowerCase() + s.slice(1);
    const t = sub(v);
    if (t !== v && !hasCyrillic(t)) return capitalize(t);
  }
  return undefined;
}

/** Последний путь: по словам. */
function byWords(s: string, d: Dict): string | undefined {
  // По словам — только если переведено каждое слово и слов немного (сокращения статов, а не фразы).
  const words = s.match(WORD) ?? [];
  if (words.length && words.length <= 4) {
    let ok = true;
    const out = s.replace(WORD, (word) => {
      const t = d.exact.get(word) ?? d.exact.get(word.toLowerCase());
      if (t === undefined) ok = false;
      return t ?? word;
    });
    if (ok) return out;
  }
  return undefined;
}

/** Кэш переводов строк, которые экран выводит снова и снова (таймеры, счётчики с русскими словами). */
export class Translator {
  private cache = new Map<string, string>();
  readonly missing = new Set<string>();
  constructor(private dict: Dict, private collect = false) {}
  t(s: string): string {
    if (!s || !hasCyrillic(s)) return s;
    const hit = this.cache.get(s);
    if (hit !== undefined) return hit;
    const out = translate(s, this.dict, this.collect ? (m) => this.missing.add(m) : undefined);
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(s, out);
    return out;
  }
}
