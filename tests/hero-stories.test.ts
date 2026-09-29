import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deserialize,
  heroPeakLevel,
  heroStoryLevels,
  heroStoryPieces,
  heroStoryUnread,
  heroStoryUnreadTotal,
  HERO_STORY_MAX,
  LORE_LIMITS,
  markHeroStoryRead,
  newGame,
  newlyOpenedStories,
  parseLore,
  serialize,
  validateLore,
  type HeroState,
  type Lore,
  type SaveState,
} from '../src/core';
import { loadFullContext, ROOT } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const raw = readFileSync(join(ROOT, 'data/lore/hero_stories.json'), 'utf8');
const parsed = parseLore([{ file: 'data/lore/hero_stories.json', data: raw }]);
const lore = parsed.lore;

/** Сохранение, где у героя alan несколько копий с заданными уровнями. */
function withAlan(levels: number[]): SaveState {
  const save = newGame(ctx, 0);
  const base = save.heroes.find((h) => h.templateId === 'alan')!;
  const others = save.heroes.filter((h) => h.templateId !== 'alan');
  const copies: HeroState[] = levels.map((level, i) => ({ ...base, id: i === 0 ? base.id : `${base.id}_c${i}`, level }));
  return { ...save, heroes: [...others, ...copies] };
}

describe('история героя кусочками: данные', () => {
  it('файл читается без ошибок, у каждого из героев все пороги до предела уровня (10 … 100)', () => {
    expect(parsed.problems).toEqual([]);
    const lint = validateLore(lore, { content: ctx.content, items: ctx.equipment.items, cards: ctx.cards });
    expect(lint.errors).toEqual([]);
    for (const t of Object.values(ctx.content.heroes)) {
      const cap = ctx.cards.rarities.find((r) => r.id === t.maxRarity)!.maxLevel;
      expect(lore.heroStories[t.id]?.map((p) => p.level), t.id).toEqual(heroStoryLevels(cap));
    }
    // Красный предел — 100: по 10 кусочков у каждого из 12 героев.
    expect(heroStoryLevels(100)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(heroStoryLevels(250).at(-1)).toBe(HERO_STORY_MAX);
    expect(Object.values(lore.heroStories).flat()).toHaveLength(Object.keys(ctx.content.heroes).length * 10);
  });

  it('заголовок ≤ 60, текст ≤ 500, заголовки героя не повторяются, текст — по-русски', () => {
    for (const [id, list] of Object.entries(lore.heroStories)) {
      const titles = new Set<string>();
      for (const p of list) {
        expect(p.title.length, `${id} ${p.level}`).toBeLessThanOrEqual(LORE_LIMITS.storyTitle);
        expect(p.text.length, `${id} ${p.level}`).toBeLessThanOrEqual(LORE_LIMITS.storyText);
        expect(p.text, `${id} ${p.level}`).toMatch(/[а-яё]/i);
        expect(titles.has(p.title), `${id}: заголовок «${p.title}» повторяется`).toBe(false);
        titles.add(p.title);
      }
    }
  });

  it('без спойлеров раньше времени: имя Ансгара — не раньше ур. 80, «брат — Серый» и Бенедикт-жрец — не раньше 90', () => {
    for (const [id, list] of Object.entries(lore.heroStories)) {
      for (const p of list) {
        if (/Ансгар/.test(p.text)) expect(p.level, `${id} ${p.level}`).toBeGreaterThanOrEqual(80);
        if (/Верховн|Тиль/.test(p.text)) expect(p.level, `${id} ${p.level}`).toBeGreaterThanOrEqual(90);
      }
    }
  });

  it('content:check ловит пропущенный порог, лишний порог и длину сверх предела', () => {
    const broken: Lore = { ...lore, heroStories: { ...lore.heroStories, alan: lore.heroStories.alan.filter((p) => p.level !== 30).concat({ level: 105, title: 'x', text: 'y' }) } };
    const errs = validateLore(broken, { content: ctx.content, items: ctx.equipment.items, cards: ctx.cards }).errors.join('\n');
    expect(errs).toMatch(/alan — нет кусочков истории для уровней 30/);
    expect(errs).toMatch(/alan — лишние пороги 105/);
    const long = JSON.parse(raw);
    long.entries.alan[0].text = 'а'.repeat(501);
    expect(parseLore([{ file: 'data/lore/hero_stories.json', data: long }]).problems.join('\n')).toMatch(/не длиннее 500/);
    // Нет файла — проверки полноты нет (лор необязателен).
    expect(validateLore({ ...lore, heroStories: {} }, { content: ctx.content, items: ctx.equipment.items, cards: ctx.cards }).errors).toEqual([]);
  });
});

describe('история героя кусочками: открытие и прочтение', () => {
  it('кусочек открыт, когда самая высокая копия героя дошла до порога', () => {
    const s = withAlan([9, 25, 3]);
    expect(heroPeakLevel(s, 'alan')).toBe(25);
    const pieces = heroStoryPieces(s, 'alan', lore);
    expect(pieces.filter((p) => p.open).map((p) => p.level)).toEqual([10, 20]);
    expect(pieces.every((p) => !p.read)).toBe(true);
    expect(heroStoryUnread(s, 'alan', lore)).toBe(2);
    // Героя нет — закрыто всё.
    expect(heroStoryPieces({ ...s, heroes: s.heroes.filter((h) => h.templateId !== 'alan') }, 'alan', lore).some((p) => p.open)).toBe(false);
  });

  it('прочтение: помечает все открытые, повторно — тот же объект; счётчик «новое» обнуляется', () => {
    const s = withAlan([20]);
    const read = markHeroStoryRead(s, 'alan', lore);
    expect(read.heroStoryRead).toEqual({ alan: [10, 20] });
    expect(heroStoryUnread(read, 'alan', lore)).toBe(0);
    expect(markHeroStoryRead(read, 'alan', lore)).toBe(read);
    // Новый уровень — новый непрочитанный кусочек, прочитанные остаются.
    const up = { ...read, heroes: read.heroes.map((h) => (h.templateId === 'alan' ? { ...h, level: 34 } : h)) };
    expect(heroStoryUnread(up, 'alan', lore)).toBe(1);
    expect(markHeroStoryRead(up, 'alan', lore).heroStoryRead).toEqual({ alan: [10, 20, 30] });
  });

  it('прочитанный кусочек не закрывается, если копию отдали в корм', () => {
    const read = markHeroStoryRead(withAlan([40, 1]), 'alan', lore);
    const eaten = { ...read, heroes: read.heroes.filter((h) => !(h.templateId === 'alan' && h.level === 40)) };
    expect(heroStoryPieces(eaten, 'alan', lore).filter((p) => p.open).map((p) => p.level)).toEqual([10, 20, 30, 40]);
  });

  it('newlyOpenedStories — кусочки, открытые повышением уровня (для тоста)', () => {
    const before = withAlan([19]);
    const after = withAlan([20]);
    expect(newlyOpenedStories(before, after, 'alan', lore).map((p) => p.level)).toEqual([20]);
    expect(newlyOpenedStories(after, withAlan([21]), 'alan', lore)).toEqual([]);
  });

  it('общий счётчик — по полученным героям; поле сохранения переживает serialize/deserialize', () => {
    const s = withAlan([10]);
    const n = heroStoryUnreadTotal(s, lore);
    expect(n).toBeGreaterThanOrEqual(1);
    const read = markHeroStoryRead(s, 'alan', lore);
    expect(heroStoryUnreadTotal(read, lore)).toBe(n - 1);
    const back = deserialize(serialize(read));
    expect(back.heroStoryRead).toEqual({ alan: [10] });
    // Старое сохранение без поля — читается, ничего не прочитано.
    expect(deserialize(serialize(s)).heroStoryRead).toBeUndefined();
  });
});
