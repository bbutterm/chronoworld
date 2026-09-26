import { describe, expect, it } from 'vitest';
import { simulateBattle, type BattleEvent, type HeroesConfig } from '../src/core';
import { cfg, hero } from './helpers';

const SQUAD = ['guard', 'warrior', 'archer', 'mage', 'priest'];
const of = <T extends BattleEvent['type']>(log: BattleEvent[], type: T) =>
  log.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);

describe('simulateBattle', () => {
  it('один seed — одинаковый лог', () => {
    const a = simulateBattle(SQUAD, SQUAD, 123);
    const b = simulateBattle(SQUAD, SQUAD, 123);
    expect(a.log).toEqual(b.log);
    expect(a.winner).toBe(b.winner);
  });

  it('разные seed — разные логи', () => {
    const a = simulateBattle(SQUAD, SQUAD, 1);
    const b = simulateBattle(SQUAD, SQUAD, 2);
    expect(a.log).not.toEqual(b.log);
  });

  it('бой заканчивается событием end, у проигравшей стороны никого нет', () => {
    const r = simulateBattle(SQUAD, ['warrior', null, null, null, null], 7);
    expect(r.winner).toBe('A');
    expect(r.reason).toBe('wipe');
    const last = r.log[r.log.length - 1];
    expect(last).toMatchObject({ type: 'end', winner: 'A' });
    expect(of(r.log, 'death').map((e) => e.unit)).toContain('B0');
  });

  it('по истечении лимита времени атакующий проигрывает', () => {
    const heroes: HeroesConfig = {
      wall: hero({ stats: { hp: 1_000_000, atk: 1, def: 1000, spd: 100 }, ult: { name: 'Ничего', effects: [] } }),
    };
    const r = simulateBattle(['wall'], ['wall'], 1, { heroes });
    expect(r.reason).toBe('timeout');
    expect(r.winner).toBe('B');
    expect(r.duration).toBe(cfg.timeLimitSeconds);
  });

  it('шкала действий: при SPD 100 и пороге 1000 ход раз в 10 тиков', () => {
    const heroes: HeroesConfig = {
      h: hero({ stats: { hp: 100_000, atk: 1, def: 0, spd: 100 }, ult: { name: 'Ничего', effects: [] } }),
    };
    const r = simulateBattle(['h'], ['h'], 1, { heroes });
    const turns = of(r.log, 'turn').filter((e) => e.unit === 'A0');
    const step = (cfg.actionThreshold / 100) * cfg.tickSeconds;
    expect(turns[0].t).toBeCloseTo(step);
    expect(turns[1].t - turns[0].t).toBeCloseTo(step);
  });

  it('при равенстве шкалы первым ходит атакующий, затем меньший слот', () => {
    const r = simulateBattle(['warrior', 'warrior'], ['warrior', 'warrior'], 1);
    const first = of(r.log, 'turn').slice(0, 4).map((e) => e.unit);
    expect(first).toEqual(['A0', 'A1', 'B0', 'B1']);
  });

  it('энергия: +25 за обычную атаку, +10 за полученный удар, ульта на 100 и сброс', () => {
    const heroes: HeroesConfig = {
      h: hero({
        stats: { hp: 1_000_000, atk: 10, def: 0, spd: 100 },
        ult: { name: 'Бум', effects: [{ type: 'damage', target: 'enemyAll', k: 1 }] },
      }),
    };
    const r = simulateBattle(['h'], ['h'], 1, { heroes });
    const attacks = of(r.log, 'attack').filter((e) => e.unit === 'A0');
    // A0 бьёт первым: 25; потом получает удар от B0: 35; потом 60, 70; 95, 105→100
    expect(attacks.slice(0, 3).map((e) => e.energy)).toEqual([25, 60, 95]);
    const hitsOnA = of(r.log, 'damage').filter((e) => e.target === 'A0');
    expect(hitsOnA[0].energy).toBe(35);
    const ults = of(r.log, 'ult').filter((e) => e.unit === 'A0');
    expect(ults.length).toBeGreaterThan(0);
    // После ульты следующая атака снова начинается с малой энергии
    const ultIdx = r.log.indexOf(ults[0]);
    const nextAttack = r.log.slice(ultIdx).find((e) => e.type === 'attack' && e.unit === 'A0');
    expect(nextAttack && 'energy' in nextAttack ? nextAttack.energy : -1).toBeLessThanOrEqual(35);
  });

  it('щит поглощает урон раньше HP', () => {
    const r = simulateBattle(SQUAD, SQUAD, 11);
    const shielded = of(r.log, 'damage').find((e) => e.absorbed > 0);
    expect(shielded).toBeDefined();
    expect(of(r.log, 'buff').length).toBeGreaterThan(0);
  });

  it('лечение не поднимает HP выше максимума', () => {
    const r = simulateBattle(SQUAD, SQUAD, 5);
    const maxHp = Object.fromEntries(r.units.map((u) => [u.uid, u.maxHp]));
    for (const e of of(r.log, 'heal')) expect(e.hp).toBeLessThanOrEqual(maxHp[e.target]);
  });

  it('мёртвые не ходят и не получают урон', () => {
    const r = simulateBattle(SQUAD, SQUAD, 3);
    const dead = new Set<string>();
    for (const e of r.log) {
      if (e.type === 'death') dead.add(e.unit);
      if (e.type === 'turn') expect(dead.has(e.unit)).toBe(false);
      if (e.type === 'damage' || e.type === 'heal') expect(dead.has(e.target)).toBe(false);
    }
  });
});
