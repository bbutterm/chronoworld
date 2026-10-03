import { describe, expect, it } from 'vitest';
import { buildUnit, enemySquad, newGame, simulateBattle, type BattleEvent, type BattleResult } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { chargeFacts, encounterThreat, tacticalDefeat, tacticalSuccess } from '../src/game/tactics';
import { STAGE_LAYOUT } from '../src/game/stageLayout';
import { LEADING, T } from '../src/game/theme';
import { defeatAdvice } from '../src/game/flow';
const ctx = loadFullContext();
const save = newGame(ctx, 0);
const allies = save.squad.filter((id): id is string => !!id).map((id) => buildUnit(save.heroes.find((h) => h.id === id)!, ctx));
const enemies = enemySquad('ch1_s4', ctx);
const actual = simulateBattle(ctx.content, allies, enemies, 7, { combat: ctx.combat });
const defs = Object.fromEntries([...allies, ...enemies.filter((u) => !!u)].map((u) => [u!.id, u!]));
const result = (log: BattleEvent[], extra: Partial<BattleResult> = {}): BattleResult => ({ ...actual, winner: 'B', log, ...extra });
const charge = { t: 1, type: 'cast', unit: 'B0', skill: 'charge', name: 'Заряд', duration: 3, action: 'start', charge: true } as const;

describe('разведка и факты боя', () => {
  it('полоса угрозы не перехватывает касания поля и кнопок расстановки', () => {
    const { field, threat, rosterHeadY } = STAGE_LAYOUT;
    const rosterButtonTop = rosterHeadY - 96 / 2; // BTN.m — стандартные кнопки «Авто»/«Пресеты».
    expect(threat.zoneY - threat.zoneH / 2).toBeGreaterThan(field.bottom);
    expect(threat.zoneY + threat.zoneH / 2).toBeLessThan(rosterButtonTop);
    expect(threat.titleY - T.caption * LEADING.caption / 2).toBeGreaterThan(field.bottom);
    expect(threat.titleY + T.caption * LEADING.caption / 2).toBeLessThan(threat.adviceY - (T.caption - 6) * LEADING.caption / 2);
    expect(threat.adviceY + (T.caption - 6) * LEADING.caption / 2).toBeLessThan(rosterButtonTop);
    expect(T.caption - 6).toBeGreaterThanOrEqual(28);
  });
  it('пятый бой учит угрозе тыла без обещания недоступного стартеру перехвата', () => {
    const threat = encounterThreat(enemies, allies, ctx);
    expect(threat?.text).toContain('Люнатик');
    expect(threat?.text).toContain('тыл');
    expect(threat?.advice).toContain('Алан');
    expect(threat?.advice).toContain('Без «Авто» в бою');
    expect(threat?.advice).not.toContain('перехватывает');
  });
  it('срыв каста не выдаётся за оглушение прыгуна', () => {
    const kai = buildUnit({ id: 'kai_only', templateId: 'kai', rarity: 'green', level: 1 }, ctx);
    expect(encounterThreat(enemies, [kai], ctx)?.advice).not.toContain('оглушает');
  });
  it('босс: предлагает только имеющуюся в отряде ульту', () => {
    const boss = enemySquad('ch1_s10', ctx);
    expect(boss.some((u) => u?.charge)).toBe(true);
    expect(encounterThreat(boss, allies, ctx)?.advice).toContain('Алан');
    expect(encounterThreat(boss, allies, ctx)?.advice).toContain('В бою можно выключить «Авто»');
    expect(encounterThreat(boss, [], ctx)?.advice).not.toContain('Алан');
  });
  it('начало заряда не означает удар; отмена без цели и смерть не считаются успешным контролем', () => {
    expect(chargeFacts(result([charge]))).toEqual({ released: 0, interrupted: 0 });
    expect(chargeFacts(result([charge, { ...charge, t: 2, action: 'interrupt', reason: 'noTarget' }]))).toEqual({ released: 0, interrupted: 0 });
    expect(chargeFacts(result([charge, { t: 2, type: 'death', unit: 'B0', killer: 'A0' }]))).toEqual({ released: 0, interrupted: 0 });
  });
  it('сопоставляет завершённую атаку, игнорирует посторонние навыки и союзные заряды', () => {
    const attack: Extract<BattleEvent, { type: 'attack' }> = { t: 4, type: 'attack', unit: 'B0', skill: 'charge', targets: ['A0'], kind: 'melee', energy: 0 };
    expect(chargeFacts(result([charge, { ...attack, skill: 'other' }, attack, attack]))).toEqual({ released: 1, interrupted: 0 });
    expect(chargeFacts(result([{ ...charge, unit: 'A0' }, { ...attack, unit: 'A0' }]))).toEqual({ released: 0, interrupted: 0 });
  });
  it('не выдаёт автоконтроль за ручной и не выдумывает предотвращённый урон', () => {
    const r = result([charge, { ...charge, t: 2, action: 'interrupt', reason: 'stun' }]);
    expect(tacticalSuccess(r)).toBe('Заряды врага сбиты: 1');
    expect(tacticalDefeat(r, defs, ctx)).toBeNull();
  });
  it('совет поражения использует факт заряженной атаки и сохраняет прежний вызов без журнала', () => {
    const r = result([charge, { t: 4, type: 'attack', unit: 'B0', skill: 'charge', targets: ['A0'], kind: 'melee', energy: 0 }]);
    expect(defeatAdvice(save, ctx, { result: r, defs })).toMatchObject({ action: 'Squad' });
    expect(defeatAdvice(save, ctx, { result: r, defs }).text).toContain('заряженных атак: 1');
    expect(defeatAdvice(save, ctx).text).toBeTruthy();
    expect(tacticalDefeat({ ...r, winner: 'A' }, defs, ctx)).toBeNull();
  });
  it('сообщает перехват только от своего отряда', () => {
    const move = { t: 1, type: 'move', unit: 'A0', from: [0, 0], to: [1, 1], duration: 0.2, kind: 'dash', reason: 'intercept' } as BattleEvent;
    expect(tacticalSuccess(result([move]))).toBe('Защита тыла: перехватов 1');
    expect(tacticalSuccess(result([{ ...move, unit: 'B0' } as BattleEvent]))).toBeNull();
  });
  it('лекарь первым: называет только подтверждённого убийцу-прыгуна', () => {
    const healer = actual.units.find((u) => u.side === 'A' && defs[u.unitId]?.role === 'healer')!;
    const diver = actual.units.find((u) => u.side === 'B' && defs[u.unitId]?.name === 'Люнатик')!;
    const other = actual.units.find((u) => u.side === 'A' && u.uid !== healer.uid)!;
    expect(healer).toBeTruthy();
    expect(diver).toBeTruthy();
    const death: BattleEvent = { t: 1, type: 'death', unit: healer.uid, killer: diver.uid };
    expect(tacticalDefeat(result([death]), defs, ctx)?.text).toContain('Последний удар: Люнатик');
    expect(tacticalDefeat(result([{ ...death, killer: null }]), defs, ctx)).toBeNull();
    expect(tacticalDefeat(result([{ ...death, unit: other.uid }, death]), defs, ctx)).toBeNull();
    expect(tacticalDefeat(result([{ ...death, killer: other.uid }]), defs, ctx)).toBeNull();
  });
  it('таймаут: лечение врага — факт, а не доказанная причина; лечение союзника не учитывается', () => {
    const report = Object.fromEntries(Object.entries(actual.report).map(([id, r]) => [id, { ...r, healingDone: 0 }]));
    report.A0.healingDone = 100;
    expect(tacticalDefeat(result([], { reason: 'timeout', report }), defs, ctx)).toBeNull();
    report.B0.healingDone = 50;
    expect(tacticalDefeat(result([], { reason: 'timeout', report }), defs, ctx)?.text).toBe('Время вышло. Противник восстановил 50 ОЗ.');
    expect(tacticalDefeat(result([], { reason: 'wipe', report }), defs, ctx)).toBeNull();
  });

});
