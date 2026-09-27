import { describe, expect, it } from 'vitest';
import { simulateBattle, type BattleEvent } from '../src/core';
import { cfg, content, unitDef } from './helpers';

const of = <T extends BattleEvent['type']>(log: BattleEvent[], type: T) =>
  log.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);

describe('радиус тела цели', () => {
  const fighter = unitDef('m', { skills: { basic: 'hit', passives: [] } }, { hp: 100_000, atk: 1 });
  const dummy = (kind: string) => unitDef(`d_${kind}`, { kind, skills: { basic: 'shot', passives: [] } }, { hp: 100_000, atk: 1 });

  const stopDistance = (kind: string) => {
    const c = content([fighter, dummy(kind)]);
    const r = simulateBattle(c, ['m'], [null, null, `d_${kind}`], 1);
    const move = of(r.log, 'move').find((e) => e.unit === 'A0')!;
    const t = r.units.find((u) => u.uid === 'B2')!;
    return Math.hypot(move.to[0] - t.x, move.to[1] - t.y);
  };

  it('к боссу ближний боец встаёт дальше на радиус его тела', () => {
    const toMonster = stopDistance('monster');
    const toBoss = stopDistance('boss');
    const bossBody = cfg.movement.bodyRadius?.boss ?? 0;
    expect(bossBody).toBeGreaterThan(0);
    expect(toBoss - toMonster).toBeCloseTo(bossBody * 0.9, 0);
  });

  it('bodyRadius в юните перекрывает значение по виду', () => {
    const c = content([fighter, { ...dummy('monster'), bodyRadius: 50 }]);
    const r = simulateBattle(c, ['m'], [null, null, 'd_monster'], 1);
    const move = of(r.log, 'move').find((e) => e.unit === 'A0')!;
    const t = r.units.find((u) => u.uid === 'B2')!;
    expect(Math.hypot(move.to[0] - t.x, move.to[1] - t.y)).toBeCloseTo((cfg.movement.meleeRange + 50) * 0.9, 0);
  });
});
