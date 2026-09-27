import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { achievementStatus, newGame, trackAchievement, withFeatures, withMeta, type ActiveBounty, type Bounty } from '../src/core';
import {
  bountyPickBlocker,
  claimableAchievements,
  countdownText,
  durationText,
  finishedBounties,
  metaRewardsText,
  nextPresetName,
  presetMatches,
  sortAchievements,
} from '../src/game/flow';
import { loadGameContext, ROOT } from '../scripts/lib/content-node';

const json = (f: string) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
const ctx = withMeta(withFeatures(loadGameContext(), json('data/progression.json'), json('data/quests.json')), json('data/bounties.json'), json('data/achievements.json'));
const DAY = '2026-09-26';

const bounty: Bounty = { id: 'b1', templateId: 'escort', rarity: 'common', durationMinutes: 60, heroCount: 2, role: 'tank', rewards: { gold: 1, jobExp: 0, gems: 0 } };

describe('помощники экранов K8–K10', () => {
  it('nextPresetName: наименьший свободный номер', () => {
    expect(nextPresetName([])).toBe('Отряд 1');
    expect(nextPresetName([{ name: 'Отряд 1' }, { name: 'Отряд 3' }])).toBe('Отряд 2');
    expect(nextPresetName([{ name: 'Мой' }])).toBe('Отряд 1');
  });

  it('presetMatches сравнивает слоты по порядку', () => {
    expect(presetMatches({ squad: ['a', null, null, null, null] }, ['a', null, null, null, null])).toBe(true);
    expect(presetMatches({ squad: ['a', null, null, null, null] }, [null, 'a', null, null, null])).toBe(false);
  });

  it('durationText и countdownText', () => {
    expect(durationText(30)).toBe('30 мин');
    expect(durationText(120)).toBe('2 ч');
    expect(durationText(90)).toBe('1 ч 30 мин');
    expect(countdownText(0)).toBe('готово');
    expect(countdownText(65_000)).toBe('1:05');
    expect(countdownText(3_725_000)).toBe('1:02:05');
    expect(countdownText(500)).toBe('0:01');
  });

  it('metaRewardsText пропускает нули', () => {
    expect(metaRewardsText({ gold: 1500, jobExp: 0, gems: 5 })).toBe('1 500 зол. · 5 гем.');
    expect(metaRewardsText({ gold: 0, jobExp: 50, gems: 0 }, ' каждому')).toBe('50 опыта каждому');
    expect(metaRewardsText({ gold: 0, jobExp: 0, gems: 0 })).toBe('—');
  });

  it('bountyPickBlocker: число героев и роль — как в startBounty', () => {
    const save = newGame(ctx, 0, DAY);
    const [h1, h2] = save.heroes.map((h) => h.id);
    expect(bountyPickBlocker(bounty, [h1], save, ctx)).toMatch('1 / 2');
    expect(bountyPickBlocker(bounty, [h1, h2], save, ctx)).toMatch('Танк');
    expect(bountyPickBlocker({ ...bounty, role: null }, [h1, h2], save, ctx)).toBeNull();
  });

  it('finishedBounties считает завершённые, но не забранные', () => {
    const save = newGame(ctx, 0, DAY);
    const active: ActiveBounty = { ...bounty, heroIds: [save.heroes[0].id], startedAt: 0, endsAt: 1000 };
    const s = { ...save, bounties: { ...save.bounties, active: [active, { ...active, id: 'b2', endsAt: 5000 }] } };
    expect(finishedBounties(s, 999)).toBe(0);
    expect(finishedBounties(s, 1000)).toBe(1);
    expect(finishedBounties(s, 5000)).toBe(2);
  });

  it('sortAchievements: готовые сверху, полученные внизу; claimableAchievements', () => {
    const save = trackAchievement(newGame(ctx, 0, DAY), 'stages_cleared', 1, 'max');
    const views = achievementStatus(save, ctx);
    const first = views.find((a) => a.done)!;
    expect(first).toBeDefined();
    expect(sortAchievements(views)[0].done).toBe(true);
    expect(claimableAchievements(views)).toBe(views.filter((a) => a.done).length);
    const claimed = achievementStatus({ ...save, achievements: { ...save.achievements, claimed: [first.id] } }, ctx);
    const sorted = sortAchievements(claimed);
    expect(sorted[sorted.length - 1].id).toBe(first.id);
    expect(sorted).toHaveLength(views.length);
    expect(claimableAchievements(claimed)).toBe(claimableAchievements(views) - 1);
  });
});
