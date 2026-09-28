import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { achievementStatus, newGame, trackAchievement, withFeatures, withMeta } from '../src/core';
import {
  claimableAchievements,
  countdownText,
  durationText,
  expectedLootText,
  metaRewardsText,
  nextPresetName,
  presetMatches,
  sortAchievements,
} from '../src/game/flow';
import { loadGameContext, ROOT } from '../scripts/lib/content-node';

const json = (f: string) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
const ctx = withMeta(withFeatures(loadGameContext(), json('data/progression.json'), json('data/quests.json')), json('data/expeditions.json'), json('data/achievements.json'));
const DAY = '2026-09-26';


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

  it('expectedLootText: золото и опыт точно, находки — списком', () => {
    expect(expectedLootText({ gold: 1000, jobExp: 50, gems: 0.4, heroCards: 0.2, scrolls: 0, items: 0.1 })).toEqual({
      base: '1 000 зол. · 50 опыта',
      finds: 'Находки: гемы ≈1, карты героя, снаряжение',
    });
    expect(expectedLootText({ gold: 1, jobExp: 1, gems: 0, heroCards: 0, scrolls: 0, items: 0 }).finds).toBe('');
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
