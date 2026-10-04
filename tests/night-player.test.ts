import { describe, expect, it } from 'vitest';
import { actClaimOffline, actPlayStage, newGame, serialize } from '../src/core';
import { runNightCampaign } from '../scripts/night-playthrough';
import { NIGHT_MODEL, NightPlayer } from '../scripts/lib/night-player';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();

describe('Ускоренный QA-игрок без подмены ресурсов', () => {
  it('создаёт обычный новый аккаунт и воспроизводит честную первую главу', () => {
    const player = new NightPlayer(ctx);
    expect(serialize(player.save)).toBe(serialize(newGame(ctx, player.startAt, player.day)));
    expect(player.save.campaign.cleared).toEqual([]);
    const a = runNightCampaign(ctx, { maxStages: 18, maxWaits: 0 });
    const b = runNightCampaign(ctx, { maxStages: 18, maxWaits: 0 });
    expect(serialize(a.save)).toBe(serialize(b.save));
    expect(a.attempts).toEqual(b.attempts);
    expect(a.cleared).toBe(18);
    expect(a.status).toBe('stage_limit');
    expect(a.totalWaits).toBe(0);
    expect(new Set(a.attempts.filter((attempt) => attempt.winner === 'A').map((attempt) => attempt.stage))).toEqual(new Set(a.save.campaign.cleared));
  });

  it('на ожидании двигает часы ровно на12ч, начисляет награды через обычный сундук и меняет сутки', () => {
    const player = new NightPlayer(ctx, { ...NIGHT_MODEL, seedBase: 1 });
    player.save = actPlayStage(player.save, player.day, 'ch1_s1', 1, ctx, player.now).save;
    player.claimRewards();
    player.prepare();
    const before = player.now;
    const activeBefore = player.activeMs;
    const goldBefore = player.income.offline.gold;
    const expBefore = player.income.offline.exp;
    const normal = actClaimOffline(player.save, player.now + 43_200_000, player.day, ctx);
    player.advanceTwelveHours();
    expect(player.now - before - (player.activeMs - activeBefore)).toBe(43_200_000);
    expect(player.income.offline.gold - goldBefore).toBe(normal.rewards.gold);
    expect(player.income.offline.exp - expBefore).toBe(normal.rewards.jobExp);
    player.advanceTwelveHours();
    expect(player.day).toBe('2026-10-06');
    expect(player.save.daily.day).toBe(player.day);
    expect(player.save.campaign.cleared).toEqual(['ch1_s1']);
  });

  it('завершает ограниченный прогон честной стеной и не отмечает непройденные этапы', () => {
    const result = runNightCampaign(ctx, { maxWaits: 0 });
    expect(result.status).toBe('wait_limit');
    expect(result.totalWaits).toBe(0);
    expect(result.cleared).toBeLessThan(180);
    const last = result.walls.at(-1)!;
    expect(result.save.campaign.cleared).not.toContain(last.stage);
    expect(result.attempts.filter((attempt) => attempt.stage === last.stage).every((attempt) => attempt.winner !== 'A')).toBe(true);
    expect(result.actions.some((action) => action.kind === 'arena_round')).toBe(true);
    expect(result.actions.some((action) => action.kind === 'replay')).toBe(true);
    expect(result.save.resources.gold).toBeGreaterThanOrEqual(0);
    expect(result.save.resources.heroExp).toBeGreaterThanOrEqual(0);
    expect(result.save.currency.gems).toBeGreaterThanOrEqual(0);
  });
});
