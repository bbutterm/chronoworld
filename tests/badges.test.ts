import { beforeEach, describe, expect, it } from 'vitest';
import { huntStatus, newGame, type SaveState } from '../src/core';
import { BADGE_SEEN_MAX, badgeSeen, markBadgesSeen, resetBadgesSeen } from '../src/game/badgeSeen';
import { GAME } from '../src/game/content';
import { heroAlerts, heroCardMark, heroesBadgeCount, heroesNavBadge } from '../src/game/flow';
import { adventureBadge } from '../src/game/navBadges';

/**
 * Дисциплина красных точек (docs/design/ui-polish-research.md §2.4, §3 п. 8): точка — «можно сделать выгодное сейчас»,
 * число — только у писем и наград, вкладка — точка, один значок на карточке героя, «уже видел» гасит повод.
 */

const D1 = '2026-10-01';
const T0 = Date.UTC(2026, 9, 1, 9);
const fresh = (): SaveState => newGame(GAME, T0, D1);
const clearAll = (s: SaveState): SaveState => ({ ...s, campaign: { ...s.campaign, cleared: GAME.content.stages.map((st) => st.id) } });

beforeEach(() => resetBadgesSeen());

describe('значок карточки героя — один, по приоритету', () => {
  it('вознести > ветка > улучшить > вещь > история > новый', () => {
    const all = { canAscend: true, needsBranch: true, canLevel: true, gearUpgrade: true, storyNew: true, isNew: true };
    expect(heroCardMark(all)).toBe('ascend');
    expect(heroCardMark({ ...all, canAscend: false })).toBe('branch');
    expect(heroCardMark({ ...all, canAscend: false, needsBranch: false })).toBe('level');
    expect(heroCardMark({ gearUpgrade: true, storyNew: true, isNew: true })).toBe('gear');
    expect(heroCardMark({ storyNew: true, isNew: true })).toBe('story');
    expect(heroCardMark({ isNew: true })).toBe('new');
    expect(heroCardMark({})).toBeNull();
  });
});

describe('«уже видел» (badgeSeen.ts)', () => {
  it('помнит ключи, без повторов, с пределом длины', () => {
    expect(badgeSeen('lvl:h1:5')).toBe(false);
    markBadgesSeen(['lvl:h1:5', 'lvl:h1:5']);
    expect(badgeSeen('lvl:h1:5')).toBe(true);
    markBadgesSeen(Array.from({ length: BADGE_SEEN_MAX + 10 }, (_, i) => `k${i}`));
    expect(badgeSeen('lvl:h1:5')).toBe(false);
    expect(badgeSeen(`k${BADGE_SEEN_MAX + 9}`)).toBe(true);
  });

  it('вкладка «Герои» по умолчанию учитывает увиденное', () => {
    const s = fresh();
    const rich: SaveState = { ...s, resources: { ...s.resources, heroExp: 1_000_000, gold: 1_000_000 } };
    expect(heroesNavBadge(rich, GAME)?.kind).toBe('count');
    markBadgesSeen(heroAlerts(rich, GAME).map((a) => a.key));
    expect(heroesNavBadge(rich, GAME)).toBeNull();
    expect(heroesBadgeCount(rich, GAME)).toBe(heroAlerts(rich, GAME).length);
  });

  it('контракт героя гаснет только делом, а не взглядом', () => {
    const s: SaveState = { ...fresh(), pendingPicks: [{ rarity: 'purple' }] } as SaveState;
    const keys = heroAlerts(s, GAME).map((a) => a.key);
    expect(heroAlerts(s, GAME)[0].kind).toBe('pick');
    expect(heroesBadgeCount(s, GAME, (k) => keys.includes(k))).toBe(1);
  });
});

describe('вкладки: постоянные состояния — не повод', () => {
  it('«Приключения»: попытки охоты, свободные экспедиции и добыча Башни точку не зажигают', () => {
    const s = clearAll(fresh());
    expect(huntStatus(s, D1, GAME).attemptsLeft).toBeGreaterThan(0);
    expect(adventureBadge(s, T0, D1)).toBe(0);
  });
});
