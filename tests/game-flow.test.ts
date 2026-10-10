import { describe, expect, it } from 'vitest';
import { newGame, playStage, type ProgressEvent } from '../src/core';
import { ascendReady, assignSlot, currentStage, describeEvents, keyEventsFirst, levelText, levelUpReady, localDay, nextOpenStage, stageSeed } from '../src/game/flow';
import { loadGameContext } from '../scripts/lib/content-node';

const ctx = loadGameContext();

describe('помощники экранов', () => {
  it('localDay — локальная дата YYYY-MM-DD', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localDay(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('stageSeed детерминирован и меняется с battleSeq', () => {
    const save = newGame(ctx, 1_700_000_000_000);
    expect(stageSeed(save)).toBe(stageSeed({ ...save }));
    expect(stageSeed({ ...save, battleSeq: 1 })).not.toBe(stageSeed(save));
    expect(stageSeed(save)).toBeGreaterThanOrEqual(0);
  });

  it('assignSlot: герой уникален — меняется местами; null убирает', () => {
    const squad = ['h1', 'h2', null, 'h4', 'h5'];
    expect(assignSlot(squad, 2, 'h1')).toEqual([null, 'h2', 'h1', 'h4', 'h5']);
    expect(assignSlot(squad, 0, 'h2')).toEqual(['h2', 'h1', null, 'h4', 'h5']);
    expect(assignSlot(squad, 1, null)).toEqual(['h1', null, null, 'h4', 'h5']);
    expect(squad).toEqual(['h1', 'h2', null, 'h4', 'h5']);
  });

  it('новая игра ведёт на первый этап; после победы открывается следующий', () => {
    const save = newGame(ctx, 0);
    const first = ctx.content.stages[0];
    expect(currentStage(save, ctx)?.id).toBe(first.id);
    expect(nextOpenStage(save, first.id, ctx)).toBeNull();
    const cleared = { ...save, campaign: { cleared: [first.id] } };
    expect(nextOpenStage(cleared, first.id, ctx)?.id).toBe(ctx.content.stages[1].id);
    expect(currentStage(cleared, ctx)?.id).toBe(ctx.content.stages[1].id);
  });

  it('describeEvents: level-up одной строкой, вознесение (со второй профессией), карта героя, ветка, новый герой, Таверна', () => {
    const save = newGame(ctx, 0);
    const events: ProgressEvent[] = [
      { type: 'levelUp', heroId: 'h1', level: 2 },
      { type: 'levelUp', heroId: 'h1', level: 3 },
      { type: 'ascended', heroId: 'h2', from: 'blue', to: 'purple', job: 'hunter', jobChanged: true },
      { type: 'heroCard', heroId: 'h9', templateId: 'vika', rarity: 'blue', name: 'Вика' },
      { type: 'branchChosen', heroId: 'h2', branch: 'hunter', changed: false, gems: 0 },
      { type: 'heroJoined', heroId: 'h4', templateId: 'greta', name: 'Грета' },
      { type: 'tavernUnlocked', gems: 150, scrolls: 1 },
    ];
    const lines = describeEvents(events, save, ctx);
    expect(lines).toContain('Алан: ур. 1 → 3');
    expect(lines).toContain('Бран: Синий → Фиолетовый — теперь Охотник!');
    expect(lines).toContain('Карта героя: Вика (Синий)');
    expect(lines).toContain('Бран: ветка — Охотник');
    expect(describeEvents([{ type: 'heroPick', rarity: 'purple', source: 'login' }], save, ctx)).toEqual(['Контракт героя: фиолетовый герой на выбор — «Герои»']);
    expect(keyEventsFirst(lines).slice(0, 2)).toEqual(['Новый герой в отряде: Грета!', 'Открыта Таверна! Подарок: гемы +150, свитки призыва +1']);
    expect(levelText(4, 20)).toBe('Ур. 4 / 20');
  });

  it('levelUpReady / ascendReady: кого можно «Улучшить» и вознести', () => {
    const save = newGame(ctx, 0);
    expect(levelUpReady(save, ctx)).toEqual([]);
    const rich = { ...save, resources: { gold: 10_000, heroExp: 10_000 } };
    expect(levelUpReady(rich, ctx).map((h) => h.id)).toEqual(['h1', 'h2', 'h3']);
    expect(ascendReady(rich, ctx)).toEqual([]);
    // Пересмотр 10.10: зелёный → синий — герой + 1 любой зелёный. Одна зелёная копия Брана (не в отряде) — корм для любого
    // зелёного героя отряда; сама копия — нет (герои отряда в корм не идут).
    const copies = { ...rich, heroes: [...rich.heroes, { id: 'h4', templateId: 'bran', rarity: 'green' as const, level: 1 }] };
    expect(ascendReady(copies, ctx).map((h) => h.id)).toEqual(['h1', 'h2', 'h3']);
    // Синий → фиолетовый — 2 такие же синие и 30 000 золота: синие копии Брана годятся только Брану, и только при золоте.
    const blues = { ...rich, heroes: [...rich.heroes.map((h) => ({ ...h, rarity: 'blue' as const })), { id: 'h4', templateId: 'bran', rarity: 'blue' as const, level: 1 }, { id: 'h5', templateId: 'bran', rarity: 'blue' as const, level: 1 }] };
    expect(ascendReady(blues, ctx)).toEqual([]);
    expect(ascendReady({ ...blues, resources: { gold: 30_000, heroExp: 0 } }, ctx).map((h) => h.id)).toEqual(['h2']);
  });

  it('бой этапа из сохранения воспроизводим: тот же save → тот же исход', () => {
    const save = newGame(ctx, 12345);
    const stage = ctx.content.stages[0].id;
    const a = playStage(save, stage, stageSeed(save), ctx);
    const b = playStage(save, stage, stageSeed(save), ctx);
    expect(a.result.winner).toBe(b.result.winner);
    expect(a.result.duration).toBe(b.result.duration);
  });
});
