import { describe, expect, it } from 'vitest';
import { addHeroCard, addHeroExp, ascendRequirement, autoFodder, levelUpInfo, newGame, type SaveState } from '../src/core';
import {
  ascendPreview,
  ascendReadyWith,
  browseNeighbours,
  collectionCount,
  collectionHeroes,
  fodderSlotLabel,
  fodderSlots,
  levelShortage,
  matchesFilter,
  missingTemplates,
  nextLevelDelta,
  placeFodder,
  copySources,
  skillRarityGate,
  sortHeroes,
  valuableFodder,
} from '../src/game/heroesView';
import { loadGameContext } from '../scripts/lib/content-node';

const ctx = loadGameContext();

function rich(): SaveState {
  let s = newGame(ctx, 1_700_000_000_000);
  const add = (t: string, r: 'green' | 'blue' | 'purple' | 'gold' | 'red', level: number) => {
    s = addHeroCard(s, t, r, { level }).save;
  };
  add('iris', 'green', 12);
  add('iris', 'green', 1);
  add('iris', 'green', 3);
  add('kai', 'blue', 25);
  add('meilin', 'purple', 44);
  add('lira', 'red', 90);
  return { ...s, resources: { ...s.resources, gold: 1_000_000 } };
}

describe('H4 «Герои»: коллекция', () => {
  it('фильтр по линии, роли и редкости', () => {
    const s = rich();
    const by = (f: Parameters<typeof matchesFilter>[1]) => s.heroes.filter((h) => matchesFilter(h, f, ctx)).map((h) => h.templateId);
    expect(by({ line: 'swordman', role: null, rarity: null }).sort()).toEqual(['alan', 'iris', 'iris', 'iris']);
    expect(by({ line: null, role: 'tank', rarity: null })).toEqual(['alan']);
    expect(by({ line: null, role: null, rarity: 'red' })).toEqual(['lira']);
    expect(by({ line: 'archer', role: 'damage', rarity: 'green' })).toEqual(['bran']);
  });

  it('сортировка: по выбранному ключу по убыванию, дальше — редкость, уровень, имя', () => {
    const s = rich();
    const lvl = sortHeroes(s.heroes, 'level', ctx, () => 0).map((h) => h.level);
    expect(lvl).toEqual([...lvl].sort((a, b) => b - a));
    const rar = sortHeroes(s.heroes, 'rarity', ctx, () => 0).map((h) => h.templateId);
    expect(rar[0]).toBe('lira');
    expect(rar[1]).toBe('meilin');
    const pow = sortHeroes(s.heroes, 'power', ctx, (h) => (h.templateId === 'kai' ? 1e9 : h.level));
    expect(pow[0].templateId).toBe('kai');
    // Детерминированно: одинаковые ключи — стабильный порядок по имени и id.
    expect(sortHeroes(s.heroes, 'power', ctx, () => 1).map((h) => h.id)).toEqual(sortHeroes([...s.heroes].reverse(), 'power', ctx, () => 1).map((h) => h.id));
  });

  it('коллекция: неполученные шаблоны — сначала сюжетные по порядку, счётчик', () => {
    const s = rich();
    const miss = missingTemplates(s, { line: null, role: null, rarity: null }, ctx);
    expect(miss).not.toContain('iris');
    expect(miss[0]).toBe('greta');
    expect(miss).toContain('dorn');
    const c = collectionCount(s, ctx);
    expect(c.total).toBe(Object.keys(ctx.content.heroes).length);
    expect(c.owned).toBe(new Set(s.heroes.map((h) => h.templateId)).size);
    expect(collectionHeroes(s, { line: null, role: null, rarity: null }, 'power', ctx, () => 0)).toHaveLength(s.heroes.length);
  });

  it('листание по кругу и пропуск удалённых карточек', () => {
    const alive = (id: string) => id !== 'x';
    expect(browseNeighbours(['a', 'b', 'c'], 'a', alive)).toEqual({ prev: 'c', next: 'b' });
    expect(browseNeighbours(['a', 'x', 'c'], 'c', alive)).toEqual({ prev: 'a', next: 'a' });
    expect(browseNeighbours(['a'], 'a', alive)).toEqual({ prev: null, next: null });
    expect(browseNeighbours(['a', 'b'], 'z', alive)).toEqual({ prev: null, next: null });
  });
});

describe('H4 «Герой»: уровень и навыки', () => {
  it('прибавка статов за уровень; на пределе — null', () => {
    const s = rich();
    const iris = s.heroes.find((h) => h.templateId === 'iris' && h.level === 12)!;
    const d = nextLevelDelta(iris, ctx)!;
    expect(d.hp).toBeGreaterThan(0);
    expect(d.atk).toBeGreaterThanOrEqual(0);
    expect(nextLevelDelta({ ...iris, level: 20 }, ctx)).toBeNull();
  });

  it('«до апа не хватает N»: опыта / золота / предел', () => {
    const s = newGame(ctx, 0);
    const h = s.heroes[0];
    const poor = { ...s, resources: { ...s.resources, heroExp: 0 } };
    expect(levelShortage(levelUpInfo(poor, h.id, ctx))).toMatch(/^до апа не хватает \d+ опыта$/);
    const noGold = { ...addHeroExp(s, 10_000), resources: { ...addHeroExp(s, 10_000).resources, gold: 0 } };
    expect(levelShortage(levelUpInfo(noGold, h.id, ctx))).toMatch(/золота$/);
    const ok = { ...addHeroExp(s, 10_000), resources: { ...addHeroExp(s, 10_000).resources, gold: 10_000 } };
    expect(levelShortage(levelUpInfo(ok, h.id, ctx))).toBeNull();
    const capped = { ...s, heroes: s.heroes.map((x, i) => (i === 0 ? { ...x, level: 20 } : x)) };
    expect(levelShortage(levelUpInfo(capped, h.id, ctx))).toBe('Предел редкости — вознесите героя');
  });

  it('навык выше предела редкости — «нужен Синий»', () => {
    expect(skillRarityGate(10, 'green', ctx)).toBeNull();
    expect(skillRarityGate(30, 'green', ctx)?.rarity).toBe('blue');
    expect(skillRarityGate(50, 'green', ctx)?.rarity).toBe('purple');
    expect(skillRarityGate(50, 'purple', ctx)).toBeNull();
  });
});

describe('H4 «Вознесение»', () => {
  it('превью: предел, статы, ветка второй профессии (V1 — первая ветка героя)', () => {
    const s = newGame(ctx, 0);
    const alan = { ...s.heroes.find((h) => h.templateId === 'alan')!, rarity: 'blue' as const, level: 40 };
    const p = ascendPreview(alan, ctx)!;
    expect(p.to).toBe('purple');
    expect(p.maxLevel).toEqual({ from: 40, to: 60 });
    expect(p.newJob).toBe('knight');
    expect(p.stats.to.hp).toBeGreaterThan(p.stats.from.hp);
    expect(p.newSkills.some((x) => x.now)).toBe(true);
    const iris = rich().heroes.find((h) => h.templateId === 'iris')!;
    const q = ascendPreview(iris, ctx)!;
    expect(q.newJob).toBeUndefined();
    expect(q.newSkills.every((x) => !x.now && x.level > 20 && x.level <= 40)).toBe(true);
    expect(ascendPreview({ ...iris, rarity: 'red' }, ctx)).toBeNull();
  });

  it('слоты корма: раскладка выбора и готовность', () => {
    const s = rich();
    const target = s.heroes.find((h) => h.templateId === 'iris' && h.level === 12)!;
    const req = ascendRequirement(s, target.id, ctx)!;
    expect(fodderSlots(req)).toHaveLength(2);
    expect(placeFodder(req, [])).toEqual([null, null]);
    const auto = autoFodder(s, target.id, ctx)!;
    expect(placeFodder(req, auto).every(Boolean)).toBe(true);
    expect(ascendReadyWith(s, target.id, auto, ctx)).toBe(true);
    expect(ascendReadyWith(s, target.id, auto.slice(0, 1), ctx)).toBe(false);
    expect(fodderSlotLabel(req.fodder[0], target, ctx)).toBe('Ирис · Зелёный');
    expect(valuableFodder(s, auto)).toEqual([]);
  });

  it('откуда копии: Таверна, карты героя из наград', () => {
    const s = newGame(ctx, 0);
    const lines = copySources(s, 'alan', ctx);
    expect(lines.some((l) => l.includes('Таверна'))).toBe(true);
    expect(lines.some((l) => l.includes('Карты героя'))).toBe(true);
  });

  it('у каждой ветки есть строка возвышения для показа выбора и вознесения', () => {
    for (const t of Object.values(ctx.content.heroes)) {
      for (const b of t.branches) expect(b.promotion, `${t.id} → ${b.job}`).toBeTruthy();
    }
  });
});
