import { describe, expect, it } from 'vitest';
import { recommendedPower, squadPower, stagePower, stagePowerCheck } from '../src/core';
import { CSV_COLUMNS, findWalls, hookMetrics, loadFullContext, perDay, PLAYER_MODEL, runBalance, signals, timeline, toCsv, total } from '../scripts/lib/player-model';

const CTX = loadFullContext();
const RES2 = runBalance(CTX, 2);

describe('инструмент баланса v3 (карточки, часы сессии)', () => {
  it('детерминирован: два дня дважды — одинаковый CSV и итоговое сохранение', () => {
    const again = runBalance(CTX, 2);
    expect(toCsv(again.rows)).toBe(toCsv(RES2.rows));
    expect(again.save).toEqual(RES2.save);
  });

  it('заголовок CSV и число строк', () => {
    const lines = toCsv(RES2.rows).trim().split('\n');
    expect(lines[0]).toBe(
      'day,date,session,time_h,chapter,stage_reached,cleared_count,attempts,wins,losses,tower_floor,tower_attempts,' +
        'gold,gems,hero_exp,items,squad_power,next_stage_power,recommended_power,power_ratio,avg_level,level_ups,rarities,heroes,' +
        'summons,quests_claimed,bounties_done,active_min',
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
    expect(total(RES2.income).exp - total(RES2.spend).exp).toBe(RES2.save.resources.heroExp);
    expect(signals(RES2, CTX).length).toBeGreaterThan(0);
  });

  it('seed боёв различаются: battleSeq растёт на каждый бой (кампания + башня)', () => {
    const fights = RES2.rows.reduce((a, r) => a + r.attempts + r.tower_attempts, 0);
    expect(RES2.save.battleSeq).toBe(fights);
  });

  it('быстрые награды: по умолчанию только бесплатные, платные — лишь при fastRewardsPerDay > freePerDay', () => {
    expect(RES2.spend.fast_rewards.gems).toBe(0);
    const paid = runBalance(CTX, 2, { ...PLAYER_MODEL, fastRewardsPerDay: 1 + CTX.features.fastRewards.freePerDay });
    expect(paid.spend.fast_rewards.gems).toBeGreaterThan(0);
  });

  it('часы сессии: бои и интерфейс занимают время, первая сессия длиннее; журнал боёв и уровней', () => {
    const first = RES2.rows[0];
    expect(first.active_min).toBeGreaterThan(0);
    expect(first.active_min).toBeLessThanOrEqual(PLAYER_MODEL.firstSessionMinutes + 5);
    for (const r of RES2.rows.slice(1)) expect(r.active_min).toBeLessThanOrEqual(PLAYER_MODEL.sessionMinutes + 5);
    expect(RES2.battles.length).toBe(RES2.save.battleSeq);
    expect(RES2.levels.length).toBe(RES2.rows.reduce((a, r) => a + r.level_ups, 0));
    // Время в журнале не убывает, каждая победа кампании — первое прохождение.
    for (let i = 1; i < RES2.battles.length; i++) expect(RES2.battles[i].t).toBeGreaterThanOrEqual(RES2.battles[i - 1].t);
    expect(RES2.battles.filter((b) => b.kind === 'stage' && b.win).map((b) => b.target)).toEqual(RES2.firstClears.map((f) => f.stageId));
  });

  it('крючки и таблица по часам считаются по журналам', () => {
    const hm = hookMetrics(RES2, CTX);
    expect(hm.chapterActiveMin[0]).not.toBeNull();
    expect(hm.first30.levelUps).toBeGreaterThan(0);
    expect(hm.firstTen).not.toBeNull();
    const tl = timeline(RES2, CTX, [0.25, 1, 24]);
    expect(tl.map((p) => p.h)).toEqual([0.25, 1, 24]);
    for (let i = 1; i < tl.length; i++) expect(tl[i].cleared).toBeGreaterThanOrEqual(tl[i - 1].cleared);
  });
});

describe('рекомендуемая мощь этапа (recommendedPower, stagePowerCheck)', () => {
  it('= мощь врагов × коэффициент (power.recommendedStages → recommended), округлена до 2–3 значащих цифр', () => {
    const k = CTX.features.power;
    for (const s of CTX.content.stages) {
      const f = k.recommendedStages?.[s.id] ?? (s.boss ? (k.recommendedBoss ?? k.recommended) : k.recommended) ?? 1;
      const raw = stagePower(s.id, CTX) * f;
      const rec = recommendedPower(s.id, CTX);
      expect(Math.abs(rec - raw) / raw, s.id).toBeLessThanOrEqual(0.05);
      expect(String(rec).replace(/0+$/, '').length, s.id).toBeLessThanOrEqual(3);
    }
  });

  it('вердикт по доле от рекомендуемой: ≥1.1 easy, ≥0.95 ok, ≥0.85 hard, иначе very_hard', () => {
    const save = RES2.save;
    const c = stagePowerCheck(save, 'ch1_s1', CTX);
    expect(c.squad).toBe(squadPower(save, CTX));
    expect(c.recommended).toBe(recommendedPower('ch1_s1', CTX));
    expect(c.verdict).toBe('easy');
    const last = CTX.content.stages[CTX.content.stages.length - 1].id;
    const hard = stagePowerCheck(save, last, CTX);
    expect(hard.ratio).toBeCloseTo(hard.squad / hard.recommended, 10);
    expect(hard.verdict).toBe(hard.ratio >= 1.1 ? 'easy' : hard.ratio >= 0.95 ? 'ok' : hard.ratio >= 0.85 ? 'hard' : 'very_hard');
  });

  // После учёта лечения в «Авто» seed 1 проходит первые пять дней без поражений.
  // Seed 2 сохраняет реальные проигрыши и проверяет обе стороны порога без ослабления 85%.
  it('модель игрока: поражения и победы кампании — от 85% рекомендуемой', () => {
    const res = runBalance(CTX, 5, { ...PLAYER_MODEL, seedBase: 2 });
    const stage = res.battles.filter((b) => b.kind === 'stage' && b.recommended > 0);
    const losses = stage.filter((b) => !b.win);
    expect(losses.length).toBeGreaterThan(0);
    for (const b of losses) expect(b.squadPower / b.recommended, `${b.target} t=${b.t.toFixed(1)}`).toBeGreaterThanOrEqual(0.85);
    for (const b of stage.filter((x) => x.win)) expect(b.squadPower / b.recommended, b.target).toBeGreaterThanOrEqual(0.85);
  }, 30_000); // лимит времени вызова (модель игрока на 5 дней под нагрузкой контейнера), не порог качества
});
