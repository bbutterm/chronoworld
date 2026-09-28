/**
 * Копии героев в интерфейсе: подписи итогов призыва («Новый герой!» / «копия · теперь ×N») и вкладка Инвентаря
 * «Карты героев» (каждый экземпляр — своя карта, сортировка и сводка).
 */
import { describe, expect, it } from 'vitest';
import { addHeroCard, newGame, type CardRarity, type SaveState } from '../src/core';
import { copyTags } from '../src/game/tavern';
import { heroCardsList, heroCardsSummary } from '../src/game/heroesView';
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
});
