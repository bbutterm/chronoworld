import { describe, expect, it, vi } from 'vitest';
import type { SaveState } from '../src/core';

vi.mock('phaser', () => ({ default: {
  Scene: class {}, GameObjects: { Events: { DESTROY: 'destroy' } }, BlendModes: { ADD: 1 },
} }));
vi.mock('../src/game/content', async () => ({ GAME: (await import('../scripts/lib/content-node')).loadFullContext() }));

const { modeBannerFooterLayout, towerEntryStatus, expeditionEntryStatus } = await import('../src/game/featureTiles');
const { huntEntryStatus } = await import('../src/game/huntEntry');
const { T, S } = await import('../src/game/theme');

type Run = NonNullable<SaveState['tower']['run']>;
const run = (pending?: Run['pending']) => ({ floor: 11, pending }) as Run;

describe('Adventure action summaries', () => {
  it('prioritizes Tower choices and distinguishes events from blessings', () => {
    expect(towerEntryStatus(run({ kind: 'event', event: 'altar' }), 30).text).toBe('Принять решение');
    expect(towerEntryStatus(run({ kind: 'blessing' } as Run['pending']), 30).text).toBe('Выбрать усиление');
    expect(towerEntryStatus(run(), 30).text).toBe('Продолжить · этаж 12');
    expect(towerEntryStatus(undefined, 30).text).toBe('Начать забег · рекорд 30');
    expect(towerEntryStatus(undefined, 0).text).toBe('Начать забег · этаж 1');
  });
  it('offers rewards, decisions, travel, then expedition selection in that order', () => {
    expect(expeditionEntryStatus(2, 1, 3)).toEqual({ text: 'Забрать награды · отрядов 2', tone: 'positive' });
    expect(expeditionEntryStatus(0, 1, 3).text).toBe('Принять решение');
    expect(expeditionEntryStatus(0, 0, 3).text).toBe('В пути · отрядов 3');
    expect(expeditionEntryStatus(0, 0, 0).text).toBe('Выбрать экспедицию');
  });
  it('shows current Hunt rank and available attempts without advertising an exhausted fight', () => {
    expect(huntEntryStatus({ mvp: true, rank: 4, attemptsLeft: 3 }).text).toBe('Уровень 5 · попыток 3');
    expect(huntEntryStatus({ mvp: true, rank: 4, attemptsLeft: 0 }).text).toBe('Уровень 5 · попытки завтра');
    expect(huntEntryStatus({ mvp: false, rank: 0, attemptsLeft: 2 }).text).toBe('попыток 2');
  });
});

describe('Adventure footer geometry on mobile', () => {
  it.each([[360, 640, 493], [390, 844, 520]])('keeps readable type and separate art/text on %d × %d', (width, height, bannerH) => {
    const scale = Math.min(width / 1080, height / 1920);
    const footer = modeBannerFooterLayout(1080 - 2 * S.l, bannerH);
    expect(footer.top).toBeGreaterThan(bannerH / 2);
    expect(footer.titleY).toBeGreaterThan(footer.top);
    expect(footer.statusY - (footer.titleY + T.title)).toBeGreaterThanOrEqual(S.xs);
    expect(footer.statusY + T.body + S.m).toBe(bannerH);
    expect(footer.textW).toBe(824);
    expect(T.body * scale).toBeGreaterThanOrEqual(13);
    expect(T.title * scale).toBeGreaterThanOrEqual(20);
    expect(bannerH * scale).toBeGreaterThan(44);
  });
});
