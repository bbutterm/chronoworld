import { describe, expect, it } from 'vitest';
import { simulateBattle, type BattleEvent } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { content, skill, unitDef } from './helpers';

const ctx = loadFullContext();
const cfg = { ...ctx.combat, timeLimitSeconds: 4, enrage: undefined, damage: { ...ctx.combat.damage, varianceMin: 1, varianceMax: 1 } };
const of = <T extends BattleEvent['type']>(r: { log: BattleEvent[] }, type: T) =>
  r.log.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);

describe('целостность цели многоударного навыка', () => {
  it.each(['ro_champion_chain_combo', 'ro_lord_knight_spiral_pierce'])('%s не переносит остаток залпа после добивания', (id) => {
    const signature = ctx.content.skills[id];
    const c = content([
      unitDef('hero', { skills: { basic: 'shot', actives: [id], passives: [] } }, { hp: 100_000, atk: 100 }),
      unitDef('fragile', {}, { hp: 1, atk: 0, spd: 1 }),
      unitDef('rear', {}, { hp: 100_000, atk: 0, spd: 1 }),
    ], [signature]);
    const r = simulateBattle(c, ['hero'], ['fragile', null, null, null, 'rear'], 17, { combat: cfg });
    const cast = of(r, 'attack').find(e => e.unit === 'A0' && e.skill === id)!;
    expect(cast.targets).toEqual(['B0']);
    const impacts = of(r, 'damage').filter(e => e.source === 'A0' && e.t === cast.t + cfg.projectileSeconds!);
    expect(impacts.map(e => e.target)).toEqual(['B0']);
    expect(of(r, 'death')).toContainEqual(expect.objectContaining({ unit: 'B0', t: impacts[0].t }));
    expect(simulateBattle(c, ['hero'], ['fragile', null, null, null, 'rear'], 17, { combat: cfg })).toEqual(r);
  });

  it('многоударный залп не ищет новую цель, если первая погибла до прилёта', () => {
    const c = content([
      unitDef('volley', { skills: { basic: 'multi', passives: [] } }, { hp: 100_000, atk: 1, spd: 100 }),
      unitDef('killer', { skills: { basic: 'instant', passives: [] } }, { hp: 100_000, atk: 100, spd: 90 }),
      unitDef('fragile', {}, { hp: 1, atk: 0, spd: 1 }),
      unitDef('rear', {}, { hp: 100_000, atk: 0, spd: 1 }),
    ], [skill('multi', { hits: 3 }), skill('instant', { effects: [{ type: 'dash' }, { type: 'damage', k: 1 }] })]);
    const r = simulateBattle(c, ['volley', 'killer'], ['fragile', null, null, null, 'rear'], 17, { combat: { ...cfg, projectileSeconds: 1 } });
    // Проверяем первый залп: он летит дольше, чем быстрый добивающий удар союзника.
    const first = of(r, 'attack').find(e => e.unit === 'A0')!;
    const impacts = of(r, 'damage').filter(e => e.source === 'A0' && e.t === first.t + 1);
    expect(first.targets).toEqual(['B0']);
    expect(of(r, 'death').find(e => e.unit === 'B0')!.t).toBeLessThan(first.t + 1);
    expect(impacts).toEqual([]);
  });
});
