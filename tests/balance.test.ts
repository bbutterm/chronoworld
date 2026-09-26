import { describe, expect, it } from 'vitest';
import { loadGameContext } from '../scripts/lib/content-node';
import { CSV_COLUMNS, findWalls, PLAYER_MODEL, runBalance, toCsv } from '../scripts/lib/player-model';

const CTX = loadGameContext();

describe('инструмент баланса', () => {
  it('детерминирован: один день дважды — одинаковый CSV', () => {
    expect(toCsv(runBalance(CTX, 1).rows)).toBe(toCsv(runBalance(CTX, 1).rows));
  });

  it('заголовок CSV и число строк', () => {
    const csv = toCsv(runBalance(CTX, 1).rows);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(
      'day,session,time_h,stage_reached,cleared_count,attempts,wins,losses,gold,squad_power,next_stage_power,avg_job_level,jobs',
    );
    expect(lines).toHaveLength(1 + PLAYER_MODEL.sessionsPerDay);
    for (const l of lines.slice(1)) expect(l.split(',')).toHaveLength(CSV_COLUMNS.length);
  });

  it('за первый день игрок проходит хотя бы один этап', () => {
    const res = runBalance(CTX, 1);
    expect(res.save.campaign.cleared.length).toBeGreaterThanOrEqual(1);
    expect(res.rows[res.rows.length - 1].cleared_count).toBeGreaterThanOrEqual(1);
    expect(res.firstClears[0]).toMatchObject({ day: 1 });
    expect(findWalls(res, CTX).length).toBeGreaterThan(0);
  });

  it('seed боёв различаются: battleSeq растёт на каждый бой', () => {
    const res = runBalance(CTX, 1);
    const fights = res.rows.reduce((a, r) => a + r.attempts, 0);
    expect(res.save.battleSeq).toBe(fights);
  });
});
