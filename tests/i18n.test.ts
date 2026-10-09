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

  it('именованные вставки data/ ({hero}) и формы по роду «[м|ж]»', () => {
    const d = compileDict({
      Алан: 'Alan',
      Вика: 'Vika',
      '{hero} [нашёл|нашла] сундук': '{hero} found a chest',
      '{hero} и {partner} [ушёл|ушла] вперёд': '{partner} and {hero} went ahead',
    });
    expect(translate('Алан нашёл сундук', d)).toBe('Alan found a chest');
    expect(translate('Вика нашла сундук', d)).toBe('Vika found a chest');
    expect(translate('Вика и Алан ушла вперёд', d)).toBe('Alan and Vika went ahead');
  });

  it('запасные пути: стрелки, кавычки, ЗАГЛАВНЫЕ, заглавная буква, статы по словам, ключ с \\n, название главы', () => {
    const d = compileDict({
      Мечник: 'Swordman',
      Рыцарь: 'Knight',
      'Летопись отряда · глава {0}': 'Squad Chronicle · chapter {0}',
      огонь: 'fire',
      ОЗ: 'HP',
      ЗАЩ: 'DEF',
      'Список короткий.': 'The list is short.',
      '\nВыбор карты': '\nCard choice',
      'Глава 2. Под мостовой': 'Chapter 2. Under the Cobbles',
    });
    expect(translate('Мечник → Рыцарь', d)).toBe('Swordman → Knight');
    expect(translate('«Список короткий.»', d)).toBe('“The list is short.”');
    expect(translate('ЛЕТОПИСЬ ОТРЯДА · ГЛАВА 4', d)).toBe('SQUAD CHRONICLE · CHAPTER 4');
    expect(translate('Огонь', d)).toBe('Fire');
    expect(translate('+150 ОЗ · +4 ЗАЩ', d)).toBe('+150 HP · +4 DEF');
    expect(translate('Выбор карты', d)).toBe('Card choice');
    expect(translate('Под мостовой', d)).toBe('Under the Cobbles');
    const missing: string[] = [];
    expect(translate('ОЗ отряда', d, (s) => missing.push(s))).toBe('ОЗ отряда');
    expect(translate('щ', d, (s) => missing.push(s))).toBe('щ');
    expect(missing).toEqual(['ОЗ отряда']);
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
