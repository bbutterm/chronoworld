/**
 * «Вознести всех» (экран «Герои»): ascendAll — по кругу возносит всех, кому хватает свободных копий того же героя и
 * золота; ветка на фиолетовом откладывается («Выберите ветку!»); отряд и замок в корм не идут; чужие герои — только в
 * слоты «любой» (золотой → красный) и только лишние копии: лучший экземпляр каждого героя остаётся (BUG-168).
 */
import { describe, expect, it } from 'vitest';
import { addHeroCard, ascendAll, keeperIds, ascendAllSummary, ascendHero, HeroError, needsBranch, newGame, type CardRarity, type SaveState } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();

/** Новая игра (h1 Алан, h2 Бран, h3 Вика — в отряде) + экземпляры [шаблон, редкость, уровень] (id h4, h5…). */
function withCards(cards: [string, CardRarity, number?][], gold = 1_000_000): SaveState {
  let s: SaveState = { ...newGame(ctx, 0), resources: { gold, heroExp: 0 } };
  for (const [t, r, l] of cards) s = addHeroCard(s, t, r, { level: l ?? 1 }).save;
  return s;
}

const mergeGold = (from: CardRarity) => ctx.cards.merge.find((m) => m.from === from)!.gold;

describe('ascendAll', () => {
  it('нечего возносить — сохранение не меняется', () => {
    const s = withCards([['iris', 'green']]);
    const r = ascendAll(s, ctx);
    expect(r.done).toEqual([]);
    expect(r.save).toBe(s);
  });

  it('цепочка: 6 зелёных Ирис → 2 синие → с третьей синей — фиолетовая без ветки', () => {
    const s = withCards([['iris', 'green', 10], ['iris', 'green'], ['iris', 'green'], ['iris', 'green', 5], ['iris', 'green'], ['iris', 'green'], ['iris', 'blue', 20]]);
    const r = ascendAll(s, ctx);
    const iris = r.save.heroes.filter((h) => h.templateId === 'iris');
    expect(iris.map((h) => [h.id, h.rarity, h.level])).toEqual([['h10', 'purple', 20]]);
    expect(needsBranch(iris[0], ctx)).toBe(true);
    // Сильнейшая зелёная (h4, ур. 10) — цель, слабые — корм; потом h7 (ур. 5).
    expect(r.done.map((d) => [d.heroId, d.from, d.to])).toEqual([
      ['h4', 'green', 'blue'],
      ['h7', 'green', 'blue'],
      ['h10', 'blue', 'purple'],
    ]);
    expect(r.done.at(-1)!.branchPending).toBe(true);
    // В итоге — только выжившие: промежуточные синие съедены.
    expect(ascendAllSummary(r.done)).toEqual([{ heroId: 'h10', name: 'Ирис', from: 'blue', to: 'purple', branchPending: true }]);
    // Золото: два перехода зелёный → синий и один синий → фиолетовый; вложенное в корм (h4, h7) вернулось.
    const refund = r.save.resources.gold - (s.resources.gold - mergeGold('green') * 2 - mergeGold('blue'));
    expect(refund).toBeGreaterThan(0);
    expect(r.save.resources.heroExp).toBeGreaterThan(0);
    // Детерминированно.
    expect(ascendAll(s, ctx)).toEqual(r);
  });

  it('герой в отряде — цель, не корм; закреплённые и чужие не едятся', () => {
    let s = withCards([['alan', 'green'], ['alan', 'green'], ['iris', 'green'], ['iris', 'green']]);
    s = { ...s, heroes: s.heroes.map((h) => (h.id === 'h7' ? { ...h, locked: true } : h)) };
    const r = ascendAll(s, ctx);
    expect(r.done.map((d) => d.heroId)).toEqual(['h1']);
    expect(r.save.heroes.find((h) => h.id === 'h1')!.rarity).toBe('blue');
    // Ирис: h6 + закреплённая h7 — вторую копию взять неоткуда.
    expect(r.save.heroes.filter((h) => h.templateId === 'iris')).toHaveLength(2);
  });

  it('не хватает золота — останавливается', () => {
    const s = withCards([['iris', 'green'], ['iris', 'green'], ['iris', 'green'], ['otto', 'green'], ['otto', 'green'], ['otto', 'green']], mergeGold('green'));
    const r = ascendAll(s, ctx);
    expect(r.done).toHaveLength(1);
    expect(r.save.resources.gold).toBe(0);
  });

  it('золотой → красный: слоты «любой» закрываются лишними фиолетовыми копиями других героев (BUG-168)', () => {
    // h1 Алан (в отряде) — золотой; h4 — фиолетовая копия Алана; Ирис h5/h6 и Отто h7/h8 — по две фиолетовые
    // (h5 и h7 сильнее — лучшие экземпляры своих героев, их не едим).
    let s = withCards([['alan', 'purple', 1], ['iris', 'purple', 40], ['iris', 'purple', 1], ['otto', 'purple', 40], ['otto', 'purple', 1]]);
    s = { ...s, heroes: s.heroes.map((h) => (h.id === 'h1' ? { ...h, rarity: 'gold', level: 80, branch: 'knight' } : h)) };
    expect([...keeperIds(s)].filter((id) => ['h5', 'h6', 'h7', 'h8'].includes(id)).sort()).toEqual(['h5', 'h7']);
    const r = ascendAll(s, ctx);
    expect(r.done.map((d) => [d.heroId, d.from, d.to])).toEqual([['h1', 'gold', 'red']]);
    expect(r.done[0].consumed.sort()).toEqual(['h4', 'h6', 'h8']);
    expect(r.save.heroes.find((h) => h.id === 'h1')!.rarity).toBe('red');
    // Лучшие Ирис и Отто на месте.
    expect(r.save.heroes.filter((h) => h.templateId === 'iris' || h.templateId === 'otto').map((h) => h.id).sort()).toEqual(['h5', 'h7']);
  });

  it('золотой → красный: единственный (лучший) экземпляр другого героя в корм не идёт — вознесения нет', () => {
    let s = withCards([['alan', 'purple'], ['iris', 'purple'], ['otto', 'purple'], ['kai', 'purple']]);
    s = { ...s, heroes: s.heroes.map((h) => (h.id === 'h1' ? { ...h, rarity: 'gold', level: 80, branch: 'knight' } : h)) };
    const r = ascendAll(s, ctx);
    expect(r.done).toEqual([]);
    expect(r.save).toBe(s);
    // Лишняя копия того же героя закрывает и слот «любой»: две фиолетовые копии Алана + одна лишняя Ирис.
    const s2 = withCards([['alan', 'purple'], ['alan', 'purple'], ['iris', 'purple', 30], ['iris', 'purple']]);
    const gold2 = { ...s2, heroes: s2.heroes.map((h) => (h.id === 'h1' ? { ...h, rarity: 'gold' as const, level: 80, branch: 'knight' } : h)) };
    const r2 = ascendAll(gold2, ctx);
    expect(r2.done.map((d) => [d.heroId, d.to])).toEqual([['h1', 'red']]);
    expect(r2.done[0].consumed.sort()).toEqual(['h4', 'h5', 'h7']);
  });

  it('ascendHero без deferBranch по-прежнему требует ветку', () => {
    const s = withCards([['iris', 'blue'], ['iris', 'blue'], ['iris', 'blue']]);
    expect(() => ascendHero(s, 'h4', ['h5', 'h6'], ctx)).toThrow(HeroError);
    expect(ascendHero(s, 'h4', ['h5', 'h6'], ctx, { deferBranch: true }).save.heroes.find((h) => h.id === 'h4')!.rarity).toBe('purple');
  });
});
