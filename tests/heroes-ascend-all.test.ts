/**
 * «Вознести всех» (экран «Герои»): ascendAll — по кругу возносит всех, кому хватает свободных копий того же героя и
 * золота; ветка на фиолетовом откладывается («Выберите ветку!»); отряд, замок и чужие герои в корм не идут.
 */
import { describe, expect, it } from 'vitest';
import { addHeroCard, ascendAll, ascendAllSummary, ascendHero, HeroError, needsBranch, newGame, type CardRarity, type SaveState } from '../src/core';
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

  it('ascendHero без deferBranch по-прежнему требует ветку', () => {
    const s = withCards([['iris', 'blue'], ['iris', 'blue'], ['iris', 'blue']]);
    expect(() => ascendHero(s, 'h4', ['h5', 'h6'], ctx)).toThrow(HeroError);
    expect(ascendHero(s, 'h4', ['h5', 'h6'], ctx, { deferBranch: true }).save.heroes.find((h) => h.id === 'h4')!.rarity).toBe('purple');
  });
});
