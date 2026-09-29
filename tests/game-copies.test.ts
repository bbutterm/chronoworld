/**
 * Копии героев в интерфейсе: подписи итогов призыва («Новый герой!» / «копия · теперь ×N») и вкладка Инвентаря
 * «Карты героев» (каждый экземпляр — своя карта, сортировка и сводка).
 */
import { describe, expect, it } from 'vitest';
import { addHeroCard, newGame, type CardRarity, type SaveState } from '../src/core';
import { copyTags } from '../src/game/tavern';
import { heroCardsList, heroCardsSummary, heroCardsTable } from '../src/game/heroesView';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();

describe('copyTags (итог призыва)', () => {
  it('был до призыва — копия с числом экземпляров; новый — «Новый герой!»; второй новый в серии — копия', () => {
    const before = [{ templateId: 'alan' }, { templateId: 'bran' }];
    const results = [{ templateId: 'alan' }, { templateId: 'iris' }, { templateId: 'iris' }];
    const now = [...before, ...results];
    expect(copyTags(results, now, true)).toEqual([
      { text: 'копия · теперь ×2', kind: 'copy', total: 2 },
      { text: 'Новый герой!', kind: 'new', total: 2 },
      { text: 'копия · теперь ×2', kind: 'copy', total: 2 },
    ]);
    // Сетка ×10 — коротко.
    expect(copyTags(results, now, false).map((t) => t.text)).toEqual(['копия ×2', 'Новый!', 'копия ×2']);
  });

  it('NB-12 / LT-15: у копий одного героя в серии — свой номер по порядку, а не общий итог', () => {
    const before = [{ templateId: 'bran' }, { templateId: 'bran' }, { templateId: 'bran' }];
    const results = [{ templateId: 'bran' }, { templateId: 'alan' }, { templateId: 'bran' }, { templateId: 'bran' }, { templateId: 'bran' }];
    const now = [...before, ...results];
    expect(copyTags(results, now, false).map((t) => t.text)).toEqual(['копия ×4', 'Новый!', 'копия ×5', 'копия ×6', 'копия ×7']);
  });
});

describe('Инвентарь → «Карты героев»', () => {
  function withCards(cards: [string, CardRarity, number?][]): SaveState {
    let s: SaveState = newGame(ctx, 0);
    for (const [t, r, l] of cards) s = addHeroCard(s, t, r, { level: l ?? 1 }).save;
    return s;
  }

  it('каждый экземпляр отдельно: редкость ↓, имя героя, уровень ↓; фильтры редкости и героя', () => {
    const s = withCards([['iris', 'green', 3], ['iris', 'blue'], ['iris', 'green', 7], ['otto', 'purple']]);
    const list = heroCardsList(s, ctx);
    expect(list).toHaveLength(s.heroes.length);
    const key = list.map((h) => h.rarity);
    expect(key.slice(0, 2)).toEqual(['purple', 'blue']);
    const greenIris = list.filter((h) => h.templateId === 'iris' && h.rarity === 'green').map((h) => h.level);
    expect(greenIris).toEqual([7, 3]);
    expect(heroCardsList(s, ctx, 'green').every((h) => h.rarity === 'green')).toBe(true);
    expect(heroCardsList(s, ctx, null, 'iris')).toHaveLength(3);
    expect(heroCardsSummary(s, ctx)).toBe('Всего карт: 7 · зелёных 5 · синих 1 · фиолетовых 1');
  });

  it('таблица: строка на каждого героя, счёт по редкостям, итоги по столбцам, без карт — внизу, фильтр редкости', () => {
    const s = withCards([['iris', 'green'], ['iris', 'green'], ['iris', 'blue'], ['otto', 'purple']]);
    const t = heroCardsTable(s, ctx);
    expect(t.rows).toHaveLength(Object.keys(ctx.content.heroes).length);
    expect(t.total).toBe(heroCardsList(s, ctx).length);
    const sum = (r: CardRarity) => t.rows.reduce((n, row) => n + row.counts[r], 0);
    for (const r of ['green', 'blue', 'purple', 'gold', 'red'] as CardRarity[]) expect(sum(r)).toBe(t.totals[r]);
    const iris = t.rows.find((r) => r.templateId === 'iris')!;
    expect(iris.counts.blue).toBeGreaterThanOrEqual(1);
    expect(iris.best).toBe('blue');
    expect(iris.name).toBe(ctx.content.heroes.iris.name);
    expect(iris.line).toBe(ctx.content.heroes.iris.line);
    // Порядок: лучшая редкость ↓ — у Отто фиолетовая, он выше Ирис; герои без карт — в конце.
    const idx = (id: string) => t.rows.findIndex((r) => r.templateId === id);
    expect(idx('otto')).toBeLessThan(idx('iris'));
    const firstEmpty = t.rows.findIndex((r) => r.total === 0);
    if (firstEmpty >= 0) expect(t.rows.slice(firstEmpty).every((r) => r.total === 0 && r.best === null)).toBe(true);
    // Фильтр: только у кого есть карты этой редкости; итоги те же.
    const f = heroCardsTable(s, ctx, 'purple');
    expect(f.rows.every((r) => r.counts.purple > 0)).toBe(true);
    expect(f.rows.map((r) => r.templateId)).toContain('otto');
    expect(f.totals).toEqual(t.totals);
  });

  it('таблица: «можно вознести», когда копий хватает', () => {
    const none = heroCardsTable(withCards([]), ctx);
    const lone = withCards([['kai', 'red']]);
    expect(heroCardsTable(lone, ctx).rows.find((r) => r.templateId === 'kai')!.ascendable).toBe(false);
    const many = withCards(Array.from({ length: 6 }, () => ['bran', 'green'] as [string, CardRarity]));
    expect(heroCardsTable(many, ctx).rows.find((r) => r.templateId === 'bran')!.ascendable).toBe(true);
    expect(none.rows.length).toBe(Object.keys(ctx.content.heroes).length);
  });
});
