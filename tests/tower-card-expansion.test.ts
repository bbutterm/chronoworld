import { describe, expect, it, vi } from 'vitest';
import { blessingBattle, deserialize, pickTowerBlessing, runEffects, serialize, type BattleHookApi } from '../src/core';
import { cfg, ctx, offer } from './tower-draft-fixture';
import { unit } from './helpers';

const ORIGINAL = ['poring', 'pupa', 'hunter_fly', 'orc_warrior', 'mandragora', 'mantis', 'fabre', 'rocker', 'drops', 'marin', 'poporing', 'thief_bug', 'chonchon', 'high_orc', 'angeling', 'archangeling', 'baphomet_jr', 'deviruchi', 'wolf', 'whisper', 'moonlight', 'rideword', 'osiris', 'baphomet', 'mistress', 'dark_lord', 'orc_hero', 'golden_bug', 'drake'];
const ADDED = ['side_winder', 'marse', 'sohee'];

function fixture(random = 0) {
  const def = ctx.content.units.maze_side_winder;
  const front = unit('A', 0, 0, 0, { def, unitId: 'front' });
  const back = unit('A', 2, 0, 0, { def, unitId: 'back' });
  const enemy = unit('B', 0, 0, 0, { def, unitId: 'enemy' });
  const api: BattleHookApi = {
    t: 5, a: [front, back], b: [enemy], combat: ctx.combat,
    random: () => random, emit: vi.fn(), damage: vi.fn(), heal: vi.fn(), shield: vi.fn(), status: vi.fn(), ultOf: () => undefined,
  };
  return { api, front, back, enemy };
}

const hooks = (...ids: string[]) => blessingBattle(runEffects(ids, cfg))!.hooks;

describe('три карты Башни для разных сборок', () => {
  it('сохраняет все старые id и добавляет только две обычные и одну редкую карту', () => {
    expect(cfg.blessings.map(b => b.id).filter(id => !ADDED.includes(id))).toEqual(ORIGINAL);
    expect(cfg.blessings.filter(b => ADDED.includes(b.id)).map(b => b.rarity)).toEqual(['common', 'common', 'rare']);
    expect(new Set(cfg.blessings.map(b => b.id)).size).toBe(32);
    expect(cfg.newRunDraftRules?.blessingEvery).toBe(5);
    expect(cfg.newRunDraftRules?.legendaryCap).toBe(3);
    expect(cfg.blessingEvery).toBe(3); // Legacy runs keep their saved policy.
  });

  it('Сайдвиндер: ровно 15% двойных обычных атак, навыки и враги без бонуса', () => {
    const basic = ctx.content.skills.basic_melee;
    const skill = ctx.content.skills.maze_side_winder_venom;
    let total = 0;
    for (let i = 0; i < 100; i++) {
      const { api, front, enemy } = fixture(i / 100);
      const h = hooks('side_winder');
      total += h.damage!(api, front, enemy, 100, basic);
      expect(h.damage!(api, front, enemy, 100, skill)).toBe(100);
      expect(h.damage!(api, enemy, front, 100, basic)).toBe(100);
    }
    expect(total).toBe(11_500);
    const { api, front, enemy } = fixture(0.29);
    expect(hooks('side_winder', 'rocker').damage!(api, front, enemy, 100, basic)).toBe(200);
    expect(hooks('side_winder').damage!(api, front, enemy, 100, basic)).toBe(100);
  });

  it('Марс защищает только задний ряд; с Марин закрывает оба ряда разной силой', () => {
    const { api, front, back, enemy } = fixture();
    const h = hooks('marse');
    expect(h.damage!(api, enemy, back, 100, undefined)).toBe(85);
    expect(h.damage!(api, enemy, front, 100, undefined)).toBe(100);
    expect(h.damage!(api, back, enemy, 100, undefined)).toBe(100);
    const paired = hooks('marse', 'marin');
    expect(paired.damage!(api, enemy, front, 100, undefined)).toBe(75);
    expect(paired.damage!(api, enemy, back, 100, undefined)).toBe(85);
  });

  it('Сохи: лечение ×1.25, щит Пупы 18.75%, регенерация Фабра 5%, цена −10% ATK', () => {
    const { api, front, back, enemy } = fixture();
    front.hp = back.hp = 500;
    const h = hooks('sohee', 'pupa', 'fabre');
    h.start!(api);
    expect(front.base.atk).toBe(90);
    expect(back.base.atk).toBe(90);
    expect(enemy.base.atk).toBe(100);
    expect(api.shield).toHaveBeenCalledWith(front, front, 187.5);
    expect(h.heal!(api, back, front, 100)).toBe(125);
    expect(h.heal!(api, enemy, enemy, 100)).toBe(100);
    h.tick!(api);
    expect(api.heal).toHaveBeenCalledWith(front, front, 50);
    expect(cfg.blessings.find(b => b.id === 'sohee')?.cost).toBe(true);
  });

  it.each(ADDED)('карта %s выбирается и переживает сериализацию рядом со старыми картами', id => {
    const save = offer(['poring', 'pupa'], [id]);
    const picked = pickTowerBlessing(save, id, ctx).save;
    const restored = deserialize(serialize(picked));
    expect(restored.tower.run!.cards).toEqual(['poring', 'pupa', id]);
    expect(restored.tower.run!.draftRules).toEqual(save.tower.run!.draftRules);
    expect(runEffects(restored.tower.run!.cards, cfg).some(e => e.card === id)).toBe(true);
  });
});
