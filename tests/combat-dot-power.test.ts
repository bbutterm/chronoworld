import { describe, expect, it } from 'vitest';
import { simulateBattle, type BattleEvent } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { content, skill, unitDef } from './helpers';

const ctx = loadFullContext();
const cfg = { ...ctx.combat, timeLimitSeconds: 7, enrage: undefined, damage: { ...ctx.combat.damage, varianceMin: 1, varianceMax: 1 } };
const dots = (r: { log: BattleEvent[] }) => r.log.filter(e => e.type === 'damage' && e.dot && e.source === 'A0');

describe('сила навыков и периодический урон', () => {
  it.each([[1, 190], [1.3, 246], [1.5, 284]])('Кислотная коррозия сохраняет силу навыка ×%s на всех трёх тиках', (power, directAmount) => {
    const signature = ctx.content.skills.ro_creator_acid_demonstration;
    const c = content([
      unitDef('creator', { skillPower: power, skills: { basic: 'shot', actives: [signature.id], passives: [] } }, { hp: 100_000, atk: 100 }),
      unitDef('dummy', {}, { hp: 100_000, atk: 0, spd: 1 }),
    ], [signature]);
    const r = simulateBattle(c, ['creator'], ['dummy'], 23, { combat: cfg });
    const k = signature.effects.find(e => e.type === 'status')!.status.dot!.k;
    const direct = r.log.find(e => e.type === 'damage' && !e.dot && e.source === 'A0')!;
    // Прямой урон по прежней формуле округляется вниз; исправление DoT его не меняет.
    expect(direct).toMatchObject({ amount: directAmount });
    expect(dots(r).map(e => e.type === 'damage' ? e.amount : 0)).toEqual(Array(3).fill(Math.floor(100 * power * k)));
  });

  it('сила навыков не усиливает периодический урон обычной атаки', () => {
    const basic = skill('venom', { effects: [{ type: 'status', status: { id: 'basic_poison', name: 'Яд', turns: 3, dot: { k: 0.2 } } }] });
    const c = content([
      unitDef('venom', { skillPower: 1.5, skills: { basic: 'venom', passives: [] } }, { hp: 100_000, atk: 100, spd: 50 }),
      unitDef('dummy', {}, { hp: 100_000, atk: 0, spd: 1 }),
    ], [basic]);
    const r = simulateBattle(c, ['venom'], ['dummy'], 23, { combat: cfg });
    expect(dots(r).length).toBeGreaterThan(0);
    expect(dots(r).every(e => e.type === 'damage' && e.amount === 20)).toBe(true);
  });
});
