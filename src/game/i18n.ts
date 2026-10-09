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

const HAS_PLACEHOLDER = /\{\d+\}/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Ключи со вставками {0}…{n}: литералы без кириллицы шаблоном не считаются (их части переводятся по отдельности). */
export function compileDict(entries: Record<string, string>): Dict {
  const exact = new Map<string, string>();
  const templates: Template[] = [];
  for (const [ru, en] of Object.entries(entries)) {
    if (!en) continue;
    if (!HAS_PLACEHOLDER.test(ru)) {
      exact.set(ru, en);
      continue;
    }
    const parts = ru.split(/\{\d+\}/);
    const order = [...ru.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
    const literal = parts.join('');
    if (!hasCyrillic(literal)) continue;
    // Вставки — по порядку {0},{1}…; в выходе переставляем по номерам.
    const src = parts.map(escapeRe).join('([\\s\\S]+?)');
    const re = new RegExp(`^${src}$`);
    let out = en;
    // Номер в ключе может не совпадать с порядком появления — в выходе используем номер группы по порядку.
    order.forEach((n, i) => {
      out = out.replaceAll(`{${n}}`, `\u0000${i}\u0000`);
    });
    templates.push({ parts, re, out, anchor: parts.reduce((a, b) => (b.length > a.length ? b : a), ''), weight: literal.length });
  }
  templates.sort((a, b) => b.weight - a.weight);
  return { exact, templates };
}

const SEPARATORS = ['\n', ' · ', ' — ', ': ', ' • ', ' / ', ', '];

/**
 * Перевести строку. Без кириллицы — как есть. depth ограничивает рекурсию (вставки и части).
 * onMissing получает строку, которую перевести не удалось (для отчёта QA), — один раз на целую строку.
 */
export function translate(s: string, d: Dict, onMissing?: (s: string) => void, depth = 0): string {
  if (!s || !hasCyrillic(s)) return s;
  const hit = d.exact.get(s);
  if (hit !== undefined) return hit;
  // Пробелы по краям — не часть ключа.
  const trimmed = s.trim();
  if (trimmed !== s) {
    const lead = s.slice(0, s.indexOf(trimmed));
    const tail = s.slice(lead.length + trimmed.length);
    const t = translate(trimmed, d, undefined, depth + 1);
    if (t !== trimmed) return lead + t + tail;
  }
  if (depth < 4) {
    for (const tpl of d.templates) {
      if (tpl.anchor && !s.includes(tpl.anchor)) continue;
      const m = tpl.re.exec(s);
      if (!m) continue;
      let out = tpl.out;
      for (let i = 1; i < m.length; i++) out = out.replaceAll(`\u0000${i - 1}\u0000`, translate(m[i], d, undefined, depth + 1));
      return out;
    }
    for (const sep of SEPARATORS) {
      if (!s.includes(sep)) continue;
      const pieces = s.split(sep);
      const done = pieces.map((p) => translate(p, d, undefined, depth + 1));
      if (done.some((p, i) => p !== pieces[i])) {
        const joined = done.join(sep);
        if (!hasCyrillic(joined) || depth > 0) return joined;
        onMissing?.(s);
        return joined;
      }
    }
  }
  if (depth === 0) onMissing?.(s);
  return s;
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
