import { describe, expect, it } from 'vitest';
import { compileDict, defaultLocale, translate, Translator } from '../src/game/i18n';
import { collectKeys, loadTranslations, placeholdersOf } from '../scripts/lib/i18n-keys';

const dict = compileDict({
  Город: 'Town',
  Алан: 'Alan',
  'Глава {0}': 'Chapter {0}',
  '{0} получил ур. {1}': '{0} reached Lv. {1}',
  'Не хватает {0} золота на {1}': 'Need {0} more gold for {1}',
  'Врата пирамиды': 'Pyramid Gate',
  Ржавая: '',
  '{0} {1}': 'should be ignored: no Cyrillic literal',
});

describe('перевод строк (src/game/i18n.ts)', () => {
  it('без кириллицы и точное совпадение', () => {
    expect(translate('01:37', dict)).toBe('01:37');
    expect(translate('Город', dict)).toBe('Town');
  });

  it('шаблон со вставками; вставки переводятся рекурсивно', () => {
    expect(translate('Глава 4', dict)).toBe('Chapter 4');
    expect(translate('Алан получил ур. 5', dict)).toBe('Alan reached Lv. 5');
    expect(translate('Не хватает 1 200 золота на Город', dict)).toBe('Need 1 200 more gold for Town');
  });

  it('разбор по частям: « · », перевод строки, пробелы по краям', () => {
    expect(translate('4-6 · Врата пирамиды', dict)).toBe('4-6 · Pyramid Gate');
    expect(translate('Город\nГлава 2', dict)).toBe('Town\nChapter 2');
    expect(translate('  Город ', dict)).toBe('  Town ');
  });

  it('нет перевода — русский текст и отметка для отчёта; пустой перевод не считается', () => {
    const missing: string[] = [];
    expect(translate('Ржавая сабля', dict, (s) => missing.push(s))).toBe('Ржавая сабля');
    expect(translate('Ржавая', dict)).toBe('Ржавая');
    expect(missing).toEqual(['Ржавая сабля']);
  });

  it('Translator кэширует и собирает непереведённое', () => {
    const t = new Translator(dict, true);
    expect(t.t('Глава 9')).toBe('Chapter 9');
    expect(t.t('Неизвестно')).toBe('Неизвестно');
    expect([...t.missing]).toEqual(['Неизвестно']);
  });

  it('язык по умолчанию: русский для ru/uk/be/kk и без языка, иначе английский', () => {
    expect(defaultLocale('ru')).toBe('ru');
    expect(defaultLocale('uk-UA')).toBe('ru');
    expect(defaultLocale(undefined)).toBe('ru');
    expect(defaultLocale('en-US')).toBe('en');
    expect(defaultLocale('de')).toBe('en');
  });
});

describe('словарь locales/en', () => {
  const keys = collectKeys(process.cwd());
  const done = loadTranslations(process.cwd());

  it('готовые переводы: те же вставки {n}, без кириллицы', () => {
    const bad: string[] = [];
    for (const [ru, en] of done) {
      if (!en) continue;
      if (placeholdersOf(ru) !== placeholdersOf(en)) bad.push(`вставки: ${ru} → ${en}`);
      if (/[А-Яа-яЁё]/.test(en) && ru !== 'Язык / Language') bad.push(`кириллица: ${ru} → ${en}`);
    }
    expect(bad).toEqual([]);
  });

  it('все ключи из кода и data/ есть в словаре (npm run i18n:extract после правок текста)', () => {
    const absent = [...keys.keys()].filter((k) => !done.has(k));
    expect(absent.slice(0, 20)).toEqual([]);
  });
});
