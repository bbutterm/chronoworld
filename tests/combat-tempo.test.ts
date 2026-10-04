import { describe, expect, it } from 'vitest';
import { buildUnit, simulateBattle, type BattleEvent, type CombatConfig } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { content, skill, unitDef } from './helpers';
import { CombatConfigSchema, parseCombatConfig } from '../src/core/combatSchema';

const ctx = loadFullContext();
const cfg: CombatConfig = { ...ctx.combat, enrage: undefined, damage: { ...ctx.combat.damage, varianceMin: 1, varianceMax: 1 } };
const of = <T extends BattleEvent['type']>(r: { log: BattleEvent[] }, type: T) => r.log.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);

const energyDuel = (hits = 1) => content([
  unitDef('hero', { energy: cfg.energy.hero, skills: { basic: 'shot', ult: 'finisher', passives: [] } }, { hp: 100_000, atk: 25 }),
  unitDef('foe', { kind: 'monster', skills: { basic: 'volley', passives: [] } }, { hp: 100_000, atk: 1 }),
], [skill('finisher', { effects: [{ type: 'damage', k: 4 }] }), skill('volley', { hits })]);

describe('спокойный темп и ценность ульт', () => {
  it('SPD 100 дает действие раз в 1.5 с ядра, без изменения скорости показа', () => {
    const c = energyDuel();
    const r = simulateBattle(c, ['hero'], ['foe'], 11, { combat: cfg, manualUlt: true });
    const turns = of(r, 'turn').filter((e) => e.unit === 'A0');
    expect(turns.slice(0, 4).map((e) => e.t)).toEqual([1.5, 3, 4.5, 6]);
    expect(r.duration).toBe(90);
  });

  it('первая ульта после нескольких решений, а не в первые секунды; авто и вводы детерминированы', () => {
    const c = energyDuel();
    const auto = simulateBattle(c, ['hero'], ['foe'], 11, { combat: cfg });
    const held = simulateBattle(c, ['hero'], ['foe'], 11, { combat: cfg, manualUlt: true });
    const ready = of(held, 'ready').find((e) => e.unit === 'A0')!;
    const first = of(auto, 'ult').find((e) => e.unit === 'A0')!;
    expect(ready.t).toBeGreaterThanOrEqual(16);
    expect(first.t).toBeLessThanOrEqual(25);
    expect(first.t).toBeLessThanOrEqual(ready.t + cfg.tickSeconds);
    expect(of(auto, 'attack').filter((e) => e.unit === 'A0' && e.t < first.t).length).toBeGreaterThanOrEqual(10);
    expect(of(held, 'ult')).toHaveLength(0);
    expect(of(held, 'ready').filter((e) => !e.lost)).toHaveLength(1);
    expect(auto.report.A0.damageDealt).toBeGreaterThan(held.report.A0.damageDealt * 1.1);
    const inputs = [{ t: Math.round((ready.t + 1) * 10) / 10, uid: 'A0' }];
    const manual = simulateBattle(c, ['hero'], ['foe'], 11, { combat: cfg, manualUlt: true, inputs });
    expect(of(manual, 'ult')[0].t).toBe(inputs[0].t);
    expect(manual.log.filter((e) => e.t < inputs[0].t)).toEqual(held.log.filter((e) => e.t < inputs[0].t));
    expect(simulateBattle(c, ['hero'], ['foe'], 11, { combat: cfg, manualUlt: true, inputs })).toEqual(manual);
  });

  it('восемь попаданий одного залпа дают один прирост энергии, а следующий залп — следующий', () => {
    const c = energyDuel(8);
    const isolated = { ...c.units.hero, energy: { perSecond: 0, perBasicAction: 0, perHitTaken: 1 } };
    const r = simulateBattle(c, [isolated], ['foe'], 19, { combat: cfg, manualUlt: true });
    const hits = of(r, 'damage').filter((e) => e.target === 'A0');
    expect(hits.slice(0, 8).map((e) => e.t)).toEqual(Array(8).fill(1.8));
    expect(hits.slice(0, 8).map((e) => e.energy)).toEqual(Array(8).fill(1));
    expect(hits.slice(8, 16).map((e) => e.energy)).toEqual(Array(8).fill(2));
  });

  it('первый заряд босса оставляет время накопить и сохранить контрольную ульту', () => {
    const hero = buildUnit({ id: 'alan', templateId: 'alan', level: 15, rarity: 'green' }, ctx);
    const boss = ctx.content.units.mob_mastering;
    const defender = { ...boss, stats: { ...boss.stats, hp: 1_000_000, atk: 1 }, skills: { ...boss.skills, actives: [], passives: [], ult: undefined } };
    const squad = [{ ...hero, stats: { ...hero.stats, hp: 100_000, atk: 1 }, skills: { ...hero.skills, actives: [], passives: [] } }];
    const held = simulateBattle(ctx.content, squad, [defender], 7, { combat: cfg, manualUlt: true });
    const charge = of(held, 'cast').find((e) => e.charge && e.action === 'start')!;
    expect(charge.t).toBeGreaterThanOrEqual(boss.charge!.first + 6);
    const ready = of(held, 'ready').find((e) => e.unit === 'A0')!;
    expect(ready.t).toBeLessThan(charge.t + charge.duration - 0.5);
    const t = Math.round((Math.max(charge.t + 0.5, ready.t + 0.1)) * 10) / 10;
    const answered = simulateBattle(ctx.content, squad, [defender], 7, { combat: cfg, manualUlt: true, inputs: [{ t, uid: 'A0' }] });
    expect(of(answered, 'cast').some((e) => e.reason === 'break' && e.t === t)).toBe(true);
    expect(of(answered, 'attack').some((e) => e.unit === 'B0' && e.skill === charge.skill && e.t < t + charge.duration)).toBe(false);
    expect(answered.log.filter((e) => e.t < t)).toEqual(held.log.filter((e) => e.t < t));
  });
});

describe('регрессии сигнатур адвансов', () => {
  function protection(id: string, poison = false) {
    const signature = ctx.content.skills[id];
    const start = { ...signature, id: `${id}_start`, trigger: 'battleStart', target: { side: 'ally', pick: 'self' } };
    const c = content([
      unitDef('protected', { skills: { basic: 'shot', passives: [start.id, ...(poison ? ['poison_start'] : [])] } }, { hp: 1_000_000, atk: 100, spd: 100 }),
      unitDef('attacker', { skills: { basic: 'shot', passives: [] } }, { hp: 1_000_000, atk: 100, spd: 1000 }),
    ], [start, ...(poison ? [skill('poison_start', { trigger: 'battleStart', target: { side: 'ally', pick: 'self' }, effects: [{ type: 'status', status: { id: 'test_poison', name: 'Яд', turns: 3, dot: { k: 1 } } }] })] : [])]);
    return simulateBattle(c, ['protected'], ['attacker'], 23, { combat: { ...cfg, timeLimitSeconds: 8, projectileSeconds: 0 } });
  }

  it('Высшее Ассумптио уменьшает урон ровно до истечения: в момент 3 с защита уже снята', () => {
    const r = protection('ro_high_priest_assumptio');
    const hits = of(r, 'damage').filter((e) => e.target === 'A0');
    expect(hits.filter((e) => e.t < 3).every((e) => e.amount === 50)).toBe(true);
    expect(hits.find((e) => e.t === 3)?.amount).toBe(100);
    expect(hits.filter((e) => e.t > 3).every((e) => e.amount === 100)).toBe(true);
    expect(of(r, 'status').filter((e) => e.status === 'transcendent_assumptio' && e.action === 'expire')).toMatchObject([{ t: 3 }]);
  });

  it('последний тик яда не получает уже истекшую защиту Ассумптио', () => {
    const r = protection('ro_high_priest_assumptio', true);
    const dots = of(r, 'damage').filter((e) => e.target === 'A0' && e.dot);
    expect(dots.map((e) => [e.t, e.amount])).toEqual([[1, 50], [2, 50], [3, 100]]);
  });

  it('Теневой шаг снимает и ускорение и снижение урона в срок, не дает постоянной защиты', () => {
    const r = protection('ro_stalker_chase_walk');
    const hits = of(r, 'damage').filter((e) => e.target === 'A0');
    expect(hits.filter((e) => e.t < 3).every((e) => e.amount === 60)).toBe(true);
    expect(hits.find((e) => e.t === 3)?.amount).toBe(100);
    const turns = of(r, 'turn').filter((e) => e.unit === 'A0');
    expect(turns.slice(0, 2).map((e) => e.t)).toEqual([1.1, 2.2]);
    const after = turns.filter((e) => e.t >= 3.5);
    expect(after[1].t - after[0].t).toBeCloseTo(1.5);
    expect(of(r, 'status').filter((e) => e.status === 'chase_walk' && e.action === 'expire')).toMatchObject([{ t: 3 }]);
  });

  it('Надлом разума снимает положительные статусы и срывает каст, сохраняя яд и смешанное ослабление', () => {
    const positive = skill('blessing', { trigger: 'battleStart', target: { side: 'ally', pick: 'self' }, effects: [{ type: 'status', status: { id: 'blessing', name: 'Защита', turns: 20, damageReduction: 0.5 } }] });
    const negative = skill('curse', { trigger: 'battleStart', target: { side: 'ally', pick: 'self' }, effects: [{ type: 'status', status: { id: 'curse', name: 'Ослабление', turns: 20, stats: { def: -0.3, atk: 0.1 }, dot: { k: 0.1 } } }] });
    const c = content([
      unitDef('professor', { skills: { basic: 'shot', actives: ['ro_professor_mind_breaker'], passives: [] } }, { hp: 100_000, spd: 100 }),
      unitDef('enemy', { skills: { basic: 'shot', actives: ['long_cast'], passives: ['blessing', 'curse'] } }, { hp: 100_000, spd: 100 }),
    ], [positive, negative, ctx.content.skills.ro_professor_mind_breaker, skill('long_cast', { castTime: 5, cooldown: 20 })]);
    const r = simulateBattle(c, ['professor'], ['enemy'], 13, { combat: { ...cfg, timeLimitSeconds: 8 } });
    expect(of(r, 'status').some((e) => e.target === 'B0' && e.status === 'blessing' && e.action === 'expire' && e.t < 3)).toBe(true);
    expect(of(r, 'status').some((e) => e.target === 'B0' && e.status === 'curse' && e.action === 'expire')).toBe(false);
    expect(of(r, 'damage').some((e) => e.target === 'B0' && e.dot && e.t > 3)).toBe(true);
    expect(of(r, 'cast').some((e) => e.unit === 'B0' && e.reason === 'dispel')).toBe(true);
  });
});


describe('валидация конфигурации боя', () => {
  it('сохраняет авторские блоки и проверенные настройки без небезопасного приведения типа', () => {
    const parsed = parseCombatConfig({ ...ctx.combat, nextMode: { rounds: 6 } });
    expect(parsed.energy.hitIntervalSeconds).toBe(0.5);
    expect(parsed.charge?.firstDelaySeconds).toBe(6);
    expect((parsed as unknown as { nextMode: { rounds: number } }).nextMode.rounds).toBe(6);
    expect(parsed.behaviors?.caster.area?.minCluster).toBe(2);
  });

  it.each([
    ['zero tick', { tickSeconds: 0 }],
    ['infinite speed', { actionThreshold: Infinity }],
    ['negative energy', { energy: { ...ctx.combat.energy, perHitTaken: -1 } }],
    ['negative hit interval', { energy: { ...ctx.combat.energy, hitIntervalSeconds: -1 } }],
    ['negative charge delay', { charge: { stunTurns: 6, firstDelaySeconds: -1 } }],
    ['fractional final tick', { timeLimitSeconds: 90.05 }],
    ['inverted damage variance', { damage: { ...ctx.combat.damage, varianceMin: 2, varianceMax: 1 } }],
    ['duplicate slots', { slots: { count: 5, front: [0, 1], back: [1, 3, 4] } }],
    ['missing slot position', { field: { ...ctx.combat.field, slotsA: ctx.combat.field.slotsA.slice(1) } }],
    ['inverted field', { field: { ...ctx.combat.field, bounds: { minX: 500, maxX: 100, minY: 900, maxY: 1840 } } }],
  ])('отклоняет %s до запуска симулятора', (_, patch) => {
    expect(CombatConfigSchema.safeParse({ ...ctx.combat, ...patch }).success).toBe(false);
  });
});
