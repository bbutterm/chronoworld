import { describe, expect, it } from 'vitest';
import { simulateBattle, type BattleEvent } from '../src/core';
import { loadContent } from '../scripts/lib/content-node';
import { cfg, content, skill, unitDef } from './helpers';

const GAME = loadContent();
const SQUAD = ['guard', 'warrior', 'archer', 'mage', 'priest'];
const of = <T extends BattleEvent['type']>(log: BattleEvent[], type: T) =>
  log.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
const noUlt = { skills: { basic: 'shot', passives: [] } };

describe('детерминизм и конец боя', () => {
  it('один seed — одинаковый лог, разные seed — разные', () => {
    expect(simulateBattle(GAME, SQUAD, SQUAD, 123).log).toEqual(simulateBattle(GAME, SQUAD, SQUAD, 123).log);
    expect(simulateBattle(GAME, SQUAD, SQUAD, 1).log).not.toEqual(simulateBattle(GAME, SQUAD, SQUAD, 2).log);
  });

  it('бой заканчивается событием end, у проигравшей стороны никого нет', () => {
    const r = simulateBattle(GAME, SQUAD, ['warrior', null, null, null, null], 7);
    expect(r.winner).toBe('A');
    expect(r.log[r.log.length - 1]).toMatchObject({ type: 'end', winner: 'A', reason: 'wipe' });
    expect(of(r.log, 'death').map((e) => e.unit)).toContain('B0');
  });

  it('по истечении лимита времени атакующий проигрывает', () => {
    const c = content([unitDef('wall', noUlt, { hp: 1_000_000, atk: 1, def: 1000 })]);
    const r = simulateBattle(c, ['wall'], ['wall'], 1);
    expect(r).toMatchObject({ reason: 'timeout', winner: 'B', duration: cfg.timeLimitSeconds });
  });

  it('мёртвые не ходят и не получают урон', () => {
    const r = simulateBattle(GAME, SQUAD, SQUAD, 3);
    const dead = new Set<string>();
    for (const e of r.log) {
      if (e.type === 'death') dead.add(e.unit);
      if (e.type === 'turn' || e.type === 'move') expect(dead.has(e.unit)).toBe(false);
      if (e.type === 'damage' || e.type === 'heal') expect(dead.has(e.target)).toBe(false);
    }
  });

  it('зеркальный бой не даёт преимущества стороне (порядок обработки не важен)', () => {
    let winsA = 0;
    for (let s = 1; s <= 300; s++) if (simulateBattle(GAME, SQUAD, SQUAD, s, { log: false }).winner === 'A') winsA++;
    expect(winsA / 300).toBeGreaterThan(0.35);
    expect(winsA / 300).toBeLessThan(0.65);
  });
});

describe('шкала действий и энергия', () => {
  it('SPD 100 при пороге 1000 — ход раз в 10 тиков', () => {
    const c = content([unitDef('h', noUlt, { hp: 100_000, atk: 1 })]);
    const turns = of(simulateBattle(c, ['h'], ['h'], 1).log, 'turn').filter((e) => e.unit === 'A0');
    const step = (cfg.actionThreshold / 100) * cfg.tickSeconds;
    expect(turns[0].t).toBeCloseTo(step);
    expect(turns[1].t - turns[0].t).toBeCloseTo(step);
  });

  it('при равенстве шкалы порядок решает seed', () => {
    const c = content([unitDef('h', noUlt, { hp: 100_000, atk: 1 })]);
    const first = new Set<string>();
    for (let s = 1; s <= 40; s++) first.add(of(simulateBattle(c, ['h'], ['h'], s).log, 'turn')[0].unit);
    expect(first).toEqual(new Set(['A0', 'B0']));
  });

  it('+18 за обычную атаку, +5 за полученный удар, ульта на 100 и сброс', () => {
    const c = content(
      [
        unitDef('h', { skills: { basic: 'shot', ult: 'boom', passives: [] } }, { hp: 1_000_000, atk: 10 }),
        unitDef('slow', noUlt, { hp: 1_000_000, atk: 10, spd: 99 }),
      ],
      [skill('boom', { target: { side: 'enemy', pick: 'all' } })],
    );
    const r = simulateBattle(c, ['h'], ['slow'], 1);
    expect(of(r.log, 'attack').filter((e) => e.unit === 'A0').slice(0, 3).map((e) => e.energy)).toEqual([18, 41, 64]);
    expect(of(r.log, 'damage').find((e) => e.target === 'A0')?.energy).toBe(23);
    const ult = of(r.log, 'ult').find((e) => e.unit === 'A0');
    expect(ult).toMatchObject({ skill: 'boom', targets: ['B0'] });
  });
});

describe('движение', () => {
  const melee = unitDef('m', { skills: { basic: 'hit', passives: [] } }, { hp: 100_000, atk: 1 });
  const archer = unitDef('r', noUlt, { hp: 100_000, atk: 1 });

  it('ближний боец идёт к цели и бьёт только вплотную', () => {
    const r = simulateBattle(content([melee, archer]), ['m'], ['r'], 1);
    const move = of(r.log, 'move').find((e) => e.unit === 'A0')!;
    expect(move.kind).toBe('walk');
    const firstHit = of(r.log, 'attack').find((e) => e.unit === 'A0')!;
    expect(firstHit.t).toBeGreaterThanOrEqual(move.t + move.duration - cfg.tickSeconds);
    const target = r.units.find((u) => u.uid === 'B0')!;
    expect(Math.hypot(move.to[0] - target.x, move.to[1] - target.y)).toBeLessThanOrEqual(cfg.movement.meleeRange);
  });

  it('дальний бой не двигается', () => {
    const r = simulateBattle(content([melee, archer]), ['m'], ['r'], 1);
    expect(of(r.log, 'move').some((e) => e.unit === 'B0')).toBe(false);
  });

  it('два ближних бойца идут навстречу и встречаются посередине', () => {
    const r = simulateBattle(content([melee]), ['m'], ['m'], 1);
    const [ma, mb] = ['A0', 'B0'].map((u) => of(r.log, 'move').find((e) => e.unit === u)!);
    expect(ma.t).toBe(mb.t);
    expect(ma.to[0]).toBeLessThan(mb.to[0]);
    expect(mb.to[0] - ma.to[0]).toBeLessThanOrEqual(cfg.movement.meleeRange);
    expect(ma.to[0] + mb.to[0]).toBeCloseTo(cfg.field.width, 0);
  });

  it('рывок (dash) ставит бойца вплотную к цели', () => {
    const c = content(
      [unitDef('jumper', { skills: { basic: 'shot', ult: 'leap', passives: [] } }, { hp: 100_000, atk: 1 }), archer],
      [skill('leap', { target: { side: 'enemy', pick: 'lowestHp' }, effects: [{ type: 'dash' }, { type: 'damage', k: 1 }] })],
    );
    const r = simulateBattle(c, ['jumper'], [null, null, 'r'], 1);
    const dash = of(r.log, 'move').find((e) => e.kind === 'dash')!;
    const target = r.units.find((u) => u.uid === 'B2')!;
    expect(Math.hypot(dash.to[0] - target.x, dash.to[1] - target.y)).toBeLessThanOrEqual(cfg.movement.meleeRange);
  });
});

describe('навыки из данных', () => {
  it('fallback: лекарю некого лечить — атакует', () => {
    const c = content(
      [unitDef('healer', { skills: { basic: 'mend', passives: [] } }, { hp: 100_000 }), unitDef('dummy', noUlt, { hp: 100_000, atk: 1, spd: 50 })],
      [skill('mend', { target: { side: 'ally', pick: 'lowestHpPct', includeSelf: true, onlyWounded: true }, effects: [{ type: 'heal', k: 1 }], fallback: 'shot' })],
    );
    const first = of(simulateBattle(c, ['healer'], ['dummy'], 1).log, 'attack').find((e) => e.unit === 'A0')!;
    expect(first).toMatchObject({ skill: 'shot', kind: 'ranged' });
  });

  it('щит поглощает урон раньше HP', () => {
    const r = simulateBattle(GAME, SQUAD, SQUAD, 11);
    expect(of(r.log, 'buff').length).toBeGreaterThan(0);
    expect(of(r.log, 'damage').some((e) => e.absorbed > 0)).toBe(true);
  });

  it('лечение не поднимает HP выше максимума', () => {
    const r = simulateBattle(GAME, SQUAD, SQUAD, 5);
    const maxHp = Object.fromEntries(r.units.map((u) => [u.uid, u.maxHp]));
    for (const e of of(r.log, 'heal')) expect(e.hp).toBeLessThanOrEqual(maxHp[e.target]);
  });

  it('hits: pick=random выбирает цель на каждый удар', () => {
    const c = content(
      [unitDef('volley', { skills: { basic: 'multi', passives: [] } }, { atk: 1 }), unitDef('d', noUlt, { hp: 100_000, atk: 1 })],
      [skill('multi', { target: { side: 'enemy', pick: 'random' }, hits: 3 })],
    );
    const r = simulateBattle(c, ['volley'], ['d', 'd', 'd'], 1);
    const firstT = of(r.log, 'attack').find((e) => e.unit === 'A0')!.t;
    // Снаряды долетают через projectileSeconds — все три удара одного залпа приходят вместе.
    const land = Math.round((firstT + (cfg.projectileSeconds ?? 0)) * 100) / 100;
    expect(of(r.log, 'damage').filter((e) => e.source === 'A0' && e.t === land)).toHaveLength(3);
  });
});

describe('статусы', () => {
  const statusSkill = (status: Record<string, unknown>) => skill('curse', { effects: [{ type: 'status', status }] });

  it('оглушение пропускает ход, статус истекает', () => {
    // Оглушение на 1 «ход» (statusTurnSeconds): оглушающий медленнее, чтобы статус успевал истечь до обновления.
    const c = content(
      [unitDef('stunner', { skills: { basic: 'curse', passives: [] } }, { hp: 100_000, spd: 60 }), unitDef('d', noUlt, { hp: 100_000 })],
      [statusSkill({ id: 'stun', name: 'Оглушение', turns: 1, stun: true })],
    );
    const r = simulateBattle(c, ['stunner'], ['d'], 1);
    expect(of(r.log, 'skip').some((e) => e.unit === 'B0')).toBe(true);
    expect(of(r.log, 'status').some((e) => e.target === 'B0' && e.action === 'expire')).toBe(true);
    // Оглушённый не атаковал в тот ход, когда пропустил.
    const skipT = of(r.log, 'skip').find((e) => e.unit === 'B0')!.t;
    expect(of(r.log, 'attack').some((e) => e.unit === 'B0' && e.t === skipT)).toBe(false);
  });

  it('яд наносит урон в начале хода носителя', () => {
    const c = content(
      [unitDef('poisoner', { skills: { basic: 'curse', passives: [] } }, { hp: 100_000, spd: 200 }), unitDef('d', noUlt, { hp: 100_000, atk: 1 })],
      [statusSkill({ id: 'poison', name: 'Яд', turns: 3, dot: { k: 0.5 } })],
    );
    const dots = of(simulateBattle(c, ['poisoner'], ['d'], 1).log, 'damage').filter((e) => e.dot);
    expect(dots.length).toBeGreaterThan(0);
    expect(dots[0]).toMatchObject({ target: 'B0', source: 'A0', amount: 50 });
  });

  it('модификатор ATK меняет урон', () => {
    const c = content(
      [
        unitDef('weak', { skills: { basic: 'curse', passives: [] } }, { hp: 100_000, spd: 300 }),
        unitDef('d', noUlt, { hp: 100_000, atk: 100, spd: 100 }),
      ],
      [statusSkill({ id: 'weaken', name: 'Слабость', turns: 5, stats: { atk: -0.5 } })],
    );
    const hits = of(simulateBattle(c, ['weak'], ['d'], 1).log, 'damage').filter((e) => e.source === 'B0');
    expect(hits[0].amount).toBeLessThanOrEqual(53);
  });
});

describe('пассивки', () => {
  it('battleStart и hit срабатывают, пассивка не запускает пассивки', () => {
    const c = content(
      [
        unitDef('p', { skills: { basic: 'shot', passives: ['rally', 'thorns'] } }, { hp: 100_000, atk: 1 }),
        unitDef('d', noUlt, { hp: 100_000, atk: 1 }),
      ],
      [
        skill('rally', { trigger: 'battleStart', target: { side: 'ally', pick: 'self' }, effects: [{ type: 'shield', pctMaxHp: 0.1 }] }),
        skill('thorns', { trigger: 'hit', target: { side: 'enemy', pick: 'nearest' }, effects: [{ type: 'damage', k: 0.1 }] }),
      ],
    );
    const r = simulateBattle(c, ['p'], ['p'], 1);
    const passives = of(r.log, 'passive');
    expect(passives.filter((e) => e.skill === 'rally').map((e) => e.t)).toEqual([0, 0]);
    expect(passives.some((e) => e.skill === 'thorns')).toBe(true);
    // Шипы от шипов не срабатывают: после каждой пассивки thorns сразу идёт не ещё одна thorns того же юнита.
    for (let i = 1; i < r.log.length; i++) {
      const prev = r.log[i - 1];
      const cur = r.log[i];
      if (prev.type === 'passive' && prev.skill === 'thorns' && cur.type === 'damage') {
        const next = r.log[i + 1];
        expect(next?.type === 'passive' && next.skill === 'thorns' && next.unit === cur.target).toBe(false);
      }
    }
  });
});

describe('щит (LT-01)', () => {
  it('щиты складываются только до потолка — доли макс. ОЗ носителя', () => {
    const c = content(
      [
        unitDef('turtle', { skills: { basic: 'shot', passives: ['bark'] } }, { hp: 10_000, atk: 1, def: 1000 }),
        unitDef('hitter', noUlt, { hp: 100_000, atk: 50 }),
      ],
      [skill('bark', { trigger: 'hit', target: { side: 'ally', pick: 'self' }, effects: [{ type: 'shield', pctMaxHp: 0.2 }] })],
    );
    const r = simulateBattle(c, ['hitter', 'hitter', 'hitter'], ['turtle'], 1);
    const cap = Math.floor(10_000 * (cfg.shieldCapPctMaxHp ?? 0.5));
    const shields = of(r.log, 'buff').filter((e) => e.target === 'B0' && e.kind === 'shield');
    expect(shields.length).toBeGreaterThan(5);
    for (const e of shields) {
      expect(e.shield ?? 0).toBeLessThanOrEqual(cap);
      expect(e.amount).toBeGreaterThanOrEqual(0);
    }
    expect(Math.max(...shields.map((e) => e.shield ?? 0))).toBe(cap);
  });
});
