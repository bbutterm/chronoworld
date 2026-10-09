import { compileDict, defaultLocale, isLocale, LOCALE_KEY, Translator, type Locale } from './i18n';

/**
 * Язык игры: `?lang=` в адресе → выбор игрока (localStorage) → язык пользователя Telegram (вне Telegram — русский). Смена языка —
 * перезагрузка страницы (тексты экранов собираются заново). Перевод подключается к Phaser.Text: каждая строка с
 * кириллицей проходит словарь при setText (и в конструкторе). Логика словаря — i18n.ts.
 * `?i18n=1` или dev-сборка — непереведённые строки копятся в window.__i18nMissing (для атласа и QA).
 */

function stored(): Locale | null {
  try {
    const v = localStorage.getItem(LOCALE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

function tgLanguage(): string | undefined {
  const tg = (globalThis as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { language_code?: string } } } } }).Telegram;
  return tg?.WebApp?.initDataUnsafe?.user?.language_code;
}

function detect(): Locale {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (isLocale(q)) return q;
  } catch {
    /* нет location — тесты */
  }
  // Вне Telegram (веб-сборка, e2e, атлас) — русский по умолчанию: язык браузера не угадываем.
  return stored() ?? defaultLocale(tgLanguage());
}

export const LOCALE: Locale = detect();

/** Выбрать язык и перезагрузить игру (прогресс в localStorage, ничего не теряется). */
export function setLocale(l: Locale): void {
  try {
    localStorage.setItem(LOCALE_KEY, l);
  } catch {
    /* хранилище недоступно — язык до перезагрузки не сохранится */
  }
  try {
    const url = new URL(location.href);
    url.searchParams.delete('lang');
    location.replace(url.toString());
  } catch {
    location.reload();
  }
}

let translator: Translator | null = null;

/** Перевести строку для DOM, canvas fillText и прочего вне Phaser.Text. */
export function tr(s: string): string {
  return translator ? translator.t(s) : s;
}

/**
 * Загрузить словарь (только для не-русского языка — отдельный чанк) и подключить перевод к Phaser.Text.
 * Вызывается в main.ts до создания игры.
 */
export async function installI18n(): Promise<void> {
  if (LOCALE === 'ru') return;
  const files = import.meta.glob('../../locales/en/*.json', { import: 'default' });
  const parts = await Promise.all(Object.entries(files).filter(([f]) => !f.endsWith('/_meta.json')).map(([, load]) => load() as Promise<Record<string, string>>));
  const entries: Record<string, string> = Object.assign({}, ...parts);
  let collect = import.meta.env.DEV;
  try {
    collect ||= new URLSearchParams(location.search).get('i18n') === '1';
  } catch {
    /* нет location */
  }
  translator = new Translator(compileDict(entries), collect);
  const Phaser = (await import('phaser')).default;
  if (collect) Object.assign(globalThis, { __i18nMissing: translator.missing });
  const proto = Phaser.GameObjects.Text.prototype as unknown as { setText(v: string | string[]): unknown };
  const setText = proto.setText;
  proto.setText = function (this: unknown, value: string | string[]) {
    const v = Array.isArray(value) ? value.map((x) => tr(String(x))) : typeof value === 'string' ? tr(value) : value;
    return setText.call(this, v);
  };
  document.documentElement.lang = LOCALE;
}
