/**
 * «Вознести всех» (экран «Герои»): ascendAll — по кругу возносит всех, кому хватает свободных копий и золота; ветка на
 * фиолетовом откладывается («Выберите ветку!»); отряд и замок в корм не идут; чужие герои — только в слоты «любой»
 * (после пересмотра 10.10: зелёный → синий и фиолетовый → золотой) и только лишние копии: лучший экземпляр каждого
 * героя остаётся (BUG-168).
 */
import { describe, expect, it } from 'vitest';
import { addHeroCard, ascendAll, keeperIds, ascendAllSummary, ascendHero, HeroError, needsBranch, newGame, resetHeroLevel, type CardRarity, type SaveState } from '../src/core';
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

  it('цепочка: 4 зелёные Ирис → 2 синие → с третьей синей — фиолетовая без ветки', () => {
    // Пересмотр 10.10: зелёный → синий — герой + 1 любой зелёный (было 2 такие же), поэтому зелёных Ирис 4, а не 6.
    const raw = withCards([['iris', 'green', 10], ['iris', 'green'], ['iris', 'green', 5], ['iris', 'green'], ['iris', 'blue', 20]]);
    // Обученные копии защищены: прежде чем использовать, явно возвращаем ресурсы.
    const trained = resetHeroLevel(resetHeroLevel(raw, 'h6', ctx).save, 'h8', ctx).save;
    // Зелёные герои отряда иначе забрали бы лишние зелёные Ирис в слот «любой» — здесь проверяется цепочка одного героя.
    const s: SaveState = { ...trained, heroes: trained.heroes.map((h) => (['h1', 'h2', 'h3'].includes(h.id) ? { ...h, rarity: 'blue' as const } : h)) };
    const r = ascendAll(s, ctx);
    const iris = r.save.heroes.filter((h) => h.templateId === 'iris');
    // Первая Ирис остаётся тем же спутником, даже когда новая копия сильнее.
    expect(iris.map((h) => [h.id, h.rarity, h.level])).toEqual([['h4', 'purple', 10]]);
    expect(needsBranch(iris[0], ctx)).toBe(true);
    // Спутник (h4, ур. 10) — цель, слабые свободные копии — корм.
    expect(r.done.map((d) => [d.heroId, d.from, d.to])).toEqual([
      ['h4', 'green', 'blue'],
      ['h5', 'green', 'blue'],
      ['h4', 'blue', 'purple'],
    ]);
    expect(r.done.at(-1)!.branchPending).toBe(true);
    // В итоге — только выжившие: промежуточные синие съедены.
    expect(ascendAllSummary(r.done)).toEqual([{ heroId: 'h4', name: 'Ирис', from: 'green', to: 'purple', branchPending: true }]);
    // Золото: два перехода зелёный → синий и один синий → фиолетовый; возврат был сделан до вознесения.
    const refund = r.save.resources.gold - (s.resources.gold - mergeGold('green') * 2 - mergeGold('blue'));
    expect(refund).toBe(0);
    expect(r.save.resources.heroExp).toBeGreaterThan(0);
    // Детерминированно.
    expect(ascendAll(s, ctx)).toEqual(r);
  });

  it('герой в отряде — цель, не корм; закреплённые и лучшие экземпляры чужих не едятся', () => {
    // Пересмотр 10.10: зелёный → синий — герой + 1 любой зелёный; Ирис h5 — спутник (лучший экземпляр), h6 закреплена.
    let s = withCards([['alan', 'green'], ['iris', 'green'], ['iris', 'green']]);
    s = { ...s, heroes: s.heroes.map((h) => (h.id === 'h6' ? { ...h, locked: true } : h)) };
    const r = ascendAll(s, ctx);
    expect(r.done.map((d) => [d.heroId, d.consumed])).toEqual([['h1', ['h4']]]);
    expect(r.save.heroes.find((h) => h.id === 'h1')!.rarity).toBe('blue');
    // Бран и Вика (отряд) — не корм; Ирис: спутник h5 + закреплённая h6 — обе на месте.
    expect(r.save.heroes.filter((h) => h.id === 'h2' || h.id === 'h3').map((h) => h.rarity)).toEqual(['green', 'green']);
    expect(r.save.heroes.filter((h) => h.templateId === 'iris')).toHaveLength(2);
    // Слот «любой» зелёного: без своей копии лишняя зелёная Ирис уходит в корм герою отряда, спутник-Ирис остаётся.
    const any = ascendAll(withCards([['iris', 'green'], ['iris', 'green']]), ctx);
    expect(any.done.map((d) => [d.heroId, d.from, d.to, d.consumed])).toEqual([['h1', 'green', 'blue', ['h5']]]);
    expect(any.save.heroes.filter((h) => h.templateId === 'iris').map((h) => h.id)).toEqual(['h4']);
  });

  it('не хватает золота — останавливается', () => {
    const s = withCards([['iris', 'green'], ['iris', 'green'], ['iris', 'green'], ['otto', 'green'], ['otto', 'green'], ['otto', 'green']], mergeGold('green'));
    const r = ascendAll(s, ctx);
    expect(r.done).toHaveLength(1);
    expect(r.save.resources.gold).toBe(0);
  });

  // Пересмотр 10.10: слоты «любой» — у фиолетового → золотого (2 любые фиолетовые), золотой → красный — 2 такие же
  // фиолетовые. Прежние сценарии BUG-168 перенесены на фиолетовый → золотой.
  it('фиолетовый → золотой: слоты «любой» закрываются лишними фиолетовыми копиями других героев (BUG-168)', () => {
    // h1 Алан (в отряде) — фиолетовый; Ирис h4/h5 и Отто h6/h7 — по две фиолетовые
    // (h4 и h6 — первые копии, спутники и лучшие экземпляры своих героев, их не едим).
    let s = withCards([['iris', 'purple', 40], ['iris', 'purple', 1], ['otto', 'purple', 40], ['otto', 'purple', 1]]);
    s = { ...s, heroes: s.heroes.map((h) => (h.id === 'h1' ? { ...h, rarity: 'purple', level: 60, branch: 'knight' } : h)) };
    expect([...keeperIds(s)].filter((id) => ['h4', 'h5', 'h6', 'h7'].includes(id)).sort()).toEqual(['h4', 'h6']);
    const r = ascendAll(s, ctx);
    expect(r.done.map((d) => [d.heroId, d.from, d.to])).toEqual([['h1', 'purple', 'gold']]);
    expect(r.done[0].consumed.sort()).toEqual(['h5', 'h7']);
    expect(r.save.heroes.find((h) => h.id === 'h1')!.rarity).toBe('gold');
    // Лучшие Ирис и Отто на месте.
    expect(r.save.heroes.filter((h) => h.templateId === 'iris' || h.templateId === 'otto').map((h) => h.id).sort()).toEqual(['h4', 'h6']);
  });

  it('фиолетовый → золотой: единственный (лучший) экземпляр другого героя в корм не идёт — вознесения нет', () => {
    const toPurple = (x: SaveState): SaveState => ({ ...x, heroes: x.heroes.map((h) => (h.id === 'h1' ? { ...h, rarity: 'purple' as const, level: 60, branch: 'knight' } : h)) });
    const s = toPurple(withCards([['iris', 'purple'], ['otto', 'purple'], ['kai', 'purple']]));
    const r = ascendAll(s, ctx);
    expect(r.done).toEqual([]);
    expect(r.save).toBe(s);
    // Сначала лишняя копия того же героя, затем лишняя копия другого: фиолетовая копия Алана + одна лишняя Ирис.
    const r2 = ascendAll(toPurple(withCards([['alan', 'purple'], ['iris', 'purple', 30], ['iris', 'purple']])), ctx);
    expect(r2.done.map((d) => [d.heroId, d.to])).toEqual([['h1', 'gold']]);
    expect(r2.done[0].consumed.sort()).toEqual(['h4', 'h6']);
  });

  it('золотой → красный: только 2 такие же фиолетовые копии; копии других героев не подходят', () => {
    const toGold = (x: SaveState): SaveState => ({ ...x, heroes: x.heroes.map((h) => (h.id === 'h1' ? { ...h, rarity: 'gold' as const, level: 80, branch: 'knight' } : h)) });
    const r = ascendAll(toGold(withCards([['alan', 'purple'], ['alan', 'purple']])), ctx);
    expect(r.done.map((d) => [d.heroId, d.from, d.to, d.consumed.sort()])).toEqual([['h1', 'gold', 'red', ['h4', 'h5']]]);
    // Одна своя + лишние фиолетовые другого героя — вознесения нет.
    const s = toGold(withCards([['alan', 'purple'], ['iris', 'purple'], ['iris', 'purple'], ['iris', 'purple']]));
    expect(ascendAll(s, ctx).done.filter((d) => d.heroId === 'h1')).toEqual([]);
  });

  it('ascendHero без deferBranch по-прежнему требует ветку', () => {
    const s = withCards([['iris', 'blue'], ['iris', 'blue'], ['iris', 'blue']]);
    expect(() => ascendHero(s, 'h4', ['h5', 'h6'], ctx)).toThrow(HeroError);
    expect(ascendHero(s, 'h4', ['h5', 'h6'], ctx, { deferBranch: true }).save.heroes.find((h) => h.id === 'h4')!.rarity).toBe('purple');
  });
});
