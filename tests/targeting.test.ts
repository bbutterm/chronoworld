import { describe, expect, it } from 'vitest';
import { Rng, lowestHp, neighbor, pickBasicTarget, randomAlive } from '../src/core';
import { cfg, hero, unit } from './helpers';

const enemies = () => [0, 1, 2, 3, 4].map((s) => unit('B', s));

describe('pickBasicTarget', () => {
  it('ближний бой бьёт ближайшего по линии героя фронта', () => {
    // линии: слот0=1, слот1=3, слот2=0, слот3=2, слот4=4
    expect(pickBasicTarget(unit('A', 0), [], enemies(), cfg)?.target.uid).toBe('B0');
    expect(pickBasicTarget(unit('A', 1), [], enemies(), cfg)?.target.uid).toBe('B1');
    expect(pickBasicTarget(unit('A', 4), [], enemies(), cfg)?.target.uid).toBe('B1');
    expect(pickBasicTarget(unit('A', 2), [], enemies(), cfg)?.target.uid).toBe('B0');
  });

  it('равенство расстояний — меньший слот', () => {
    // слот 3 (линия 2) равноудалён от B0 (1) и B1 (3)
    expect(pickBasicTarget(unit('A', 3), [], enemies(), cfg)?.target.uid).toBe('B0');
  });

  it('если фронт пуст — бьёт тыл', () => {
    const e = enemies();
    e[0].alive = false;
    e[1].alive = false;
    expect(pickBasicTarget(unit('A', 1), [], e, cfg)?.target.uid).toBe('B3');
  });

  it('дальний бой по умолчанию бьёт фронт, с правилом «тыл» — тыл', () => {
    const ranged = hero({ attack: 'ranged' });
    const sniper = hero({ attack: 'ranged', targetRule: 'back' });
    expect(pickBasicTarget(unit('A', 4, {}, ranged), [], enemies(), cfg)?.target.uid).toBe('B1');
    expect(pickBasicTarget(unit('A', 4, {}, sniper), [], enemies(), cfg)?.target.uid).toBe('B4');
  });

  it('лекарь лечит союзника с наименьшим процентом HP', () => {
    const healer = unit('A', 4, {}, hero({ attack: 'healer' }));
    const allies = [unit('A', 0, { hp: 900, maxHp: 1800 }), unit('A', 1, { hp: 400, maxHp: 1000 }), healer];
    const pick = pickBasicTarget(healer, allies, enemies(), cfg);
    expect(pick).toMatchObject({ heal: true });
    expect(pick?.target.uid).toBe('A1');
  });

  it('лекарь без раненых союзников атакует', () => {
    const healer = unit('A', 4, {}, hero({ attack: 'healer' }));
    const pick = pickBasicTarget(healer, [healer], enemies(), cfg);
    expect(pick).toMatchObject({ heal: false });
    expect(pick?.target.side).toBe('B');
  });

  it('нет живых врагов — нет цели', () => {
    const e = enemies().map((u) => ({ ...u, alive: false }));
    expect(pickBasicTarget(unit('A', 0), [], e, cfg)).toBeUndefined();
  });
});

describe('цели ульт', () => {
  it('наименьший HP, равенство — меньший слот', () => {
    const e = enemies();
    e[3].hp = 100;
    e[4].hp = 100;
    expect(lowestHp(e)?.uid).toBe('B3');
  });

  it('случайная цель — только живые и по seed', () => {
    const e = enemies();
    e[0].alive = false;
    const r1 = new Rng(3);
    const r2 = new Rng(3);
    for (let i = 0; i < 50; i++) {
      const a = randomAlive(e, r1);
      expect(a?.alive).toBe(true);
      expect(a?.uid).toBe(randomAlive(e, r2)?.uid);
    }
  });

  it('сосед — ближайший союзник по линии', () => {
    const allies = [unit('A', 0), unit('A', 1), unit('A', 2)];
    expect(neighbor(allies[0], allies, cfg)?.uid).toBe('A2');
  });
});
