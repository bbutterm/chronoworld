import { describe, expect, it } from 'vitest';
import { CSV_COLUMNS, findWalls, loadFullContext, perDay, PLAYER_MODEL, runBalance, signals, toCsv, total } from '../scripts/lib/player-model';

const CTX = loadFullContext();
const RES2 = runBalance(CTX, 2);

describe('инструмент баланса v2', () => {
  it('детерминирован: два дня дважды — одинаковый CSV и итоговое сохранение', () => {
    const again = runBalance(CTX, 2);
    expect(toCsv(again.rows)).toBe(toCsv(RES2.rows));
    expect(again.save).toEqual(RES2.save);
  });

  it('заголовок CSV и число строк', () => {
    const lines = toCsv(RES2.rows).trim().split('\n');
    expect(lines[0]).toBe(
      'day,date,session,time_h,chapter,stage_reached,cleared_count,attempts,wins,losses,tower_floor,tower_attempts,' +
        'gold,gems,items,squad_power,next_stage_power,avg_job_level,jobs,quests_claimed,bounties_done',
    );
    expect(lines).toHaveLength(1 + 2 * PLAYER_MODEL.sessionsPerDay);
    for (const l of lines.slice(1)) expect(l.split(',')).toHaveLength(CSV_COLUMNS.length);
    expect(RES2.rows[0].date).toBe(PLAYER_MODEL.startDate);
    expect(RES2.rows[RES2.rows.length - 1].date).toBe('2026-01-02');
  });

  it('за два дня игрок проходит этапы кампании и этажи башни', () => {
    const last = RES2.rows[RES2.rows.length - 1];
    const unlockIdx = CTX.content.stages.findIndex((s) => s.id === CTX.tower.unlockAfterStage);
    expect(last.cleared_count).toBeGreaterThan(unlockIdx);
    expect(last.tower_floor).toBeGreaterThan(0);
    expect(RES2.firstClears[0]).toMatchObject({ day: 1 });
    expect(perDay(RES2).map((d) => d.day)).toEqual([1, 2]);
    expect(findWalls(RES2, CTX).length).toBeGreaterThan(0);
  });

  it('полный цикл: задания, поручения, экипировка, мощь из ядра', () => {
    const last = RES2.rows[RES2.rows.length - 1];
    expect(last.quests_claimed).toBeGreaterThan(0);
    expect(last.bounties_done).toBeGreaterThan(0);
    expect(RES2.equips).toBeGreaterThan(0);
    expect(last.squad_power).toBeGreaterThan(RES2.rows[0].squad_power);
    expect(total(RES2.income).gold - total(RES2.spend).gold).toBe(RES2.save.resources.gold);
    expect(total(RES2.income).gems - total(RES2.spend).gems).toBe(RES2.save.currency.gems);
    expect(signals(RES2, CTX).length).toBeGreaterThan(0);
  });

  it('seed боёв различаются: battleSeq растёт на каждый бой (кампания + башня)', () => {
    const fights = RES2.rows.reduce((a, r) => a + r.attempts + r.tower_attempts, 0);
    expect(RES2.save.battleSeq).toBe(fights);
  });

  it('быстрые награды: по умолчанию только бесплатные, платные — лишь при fastRewardsPerDay > freePerDay', () => {
    expect(total(RES2.spend).gems).toBe(0);
    const paid = runBalance(CTX, 2, { ...PLAYER_MODEL, fastRewardsPerDay: 1 + CTX.features.fastRewards.freePerDay });
    expect(paid.spend.fast_rewards.gems).toBe(total(paid.spend).gems);
  });
});
