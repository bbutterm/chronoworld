import { describe, expect, it, vi } from 'vitest';

// rewardsView.ts тянет Phaser (нужен window/canvas) — для чистых помощников хватает заглушки.
vi.mock('phaser', () => ({ default: { GameObjects: { Events: { DESTROY: 'destroy' } }, BlendModes: { ADD: 1 } } }));

const rv = await import('../src/game/rewardsView');

describe('итог боя: награды по одной (battleRewards)', () => {
  it('порядок: золото, опыт, гемы, трофеи, карты героев, руда; нули не попадают', () => {
    const events = [
      { type: 'stageCleared' },
      { type: 'heroCard', templateId: 'lira', rarity: 'blue' as const, name: 'Лира Вейн' },
      { type: 'rewards', gold: 140, heroExp: 470 },
      { type: 'blessedOre', count: 2 },
      { type: 'gems', amount: 30 },
      { type: 'blessedOre', count: 1 },
    ];
    const out = rv.battleRewards(events, [{ itemId: 'sword' }]);
    expect(out.map((x) => x.kind)).toEqual(['gold', 'exp', 'gems', 'item', 'heroCard', 'ore']);
    expect(out[0]).toEqual({ kind: 'gold', amount: 140 });
    expect(out[5]).toEqual({ kind: 'ore', amount: 3 });
    expect(rv.battleRewards([{ type: 'rewards', gold: 0, heroExp: 0 }])).toEqual([]);
  });

  it('строки событий под наградами: без того, что уже показано чипом, и без «Открыт этап»', () => {
    const lines = ['Новый герой в отряде: Грета!', 'Карта героя: Лира (синяя)', 'Благословенная руда ×1', 'Гемы +30', 'Открыт этап 1-4: Опушка', 'Алан: ур. 4 → 5'];
    expect(rv.resultEventLines(lines)).toEqual(['Новый герой в отряде: Грета!', 'Алан: ур. 4 → 5']);
  });
});

describe('поражение: три плитки «как стать сильнее» (defeatShortcuts)', () => {
  it('всегда три плитки; совет defeatAdvice выделен ровно одной (или ни одной)', () => {
    for (const advice of ['EquipBest', 'Heroes', 'Squad', 'Campaign'] as const) {
      for (const tavern of [true, false]) {
        const tiles = rv.defeatShortcuts(advice, tavern, advice === 'EquipBest');
        expect(tiles).toHaveLength(3);
        expect(tiles.filter((t) => t.advised).length).toBeLessThanOrEqual(1);
        expect(new Set(tiles.map((t) => t.id)).size).toBe(3);
      }
    }
  });

  it('вещи получше — «Надеть лучшее» на плитке снаряжения; Таверна закрыта или совет «Отряд» — плитка «Отряд»', () => {
    expect(rv.defeatShortcuts('EquipBest', true, true).find((t) => t.id === 'gear')).toMatchObject({ sub: 'Надеть лучшее', advised: true });
    expect(rv.defeatShortcuts('Heroes', true, false).map((t) => t.id)).toEqual(['heroes', 'gear', 'tavern']);
    expect(rv.defeatShortcuts('Heroes', false, false).map((t) => t.id)).toEqual(['heroes', 'gear', 'squad']);
    expect(rv.defeatShortcuts('Squad', true, false).find((t) => t.id === 'squad')?.advised).toBe(true);
  });

  it('совет вернуться в кампанию не помечает плитку, ведущую в Герои', () => {
    for (const tavern of [true, false]) expect(rv.defeatShortcuts('Campaign', tavern, false).some((t) => t.advised)).toBe(false);
    const expected = { EquipBest: 'gear', Heroes: 'heroes', Squad: 'squad' } as const;
    for (const advice of ['EquipBest', 'Heroes', 'Squad'] as const) {
      for (const tavern of [true, false]) expect(rv.defeatShortcuts(advice, tavern, false).filter((t) => t.advised).map((t) => t.id)).toEqual([expected[advice]]);
    }
  });
});
