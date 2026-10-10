import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bankOffline, claimOffline, deserialize, newGame, offlineLoot, offlineRewards,
  playStage, sanitizeSave, serialize, syncOfflineClock, type SaveState,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { withReplay } from './helpers';

const ctx = loadFullContext();
const DAY = '2026-10-07';
const T0 = 1_000_000_001;
const HOUR = 3_600_000;
const MINUTE = 60_000;

function win(save: SaveState, stage: string, now: number, context = ctx): SaveState {
  const out = playStage(save, stage, 7, context, now, DAY);
  expect(out.result.winner).toBe('A');
  return out.save;
}
const atFirstStage = () => win(newGame(ctx, T0, DAY), 'ch1_s1', T0);

describe('трофеи заработанного сундука после прогресса кампании', () => {
  it('первая победа нового этапа не забирает заработанную карту из полного сундука', () => {
    const before = atFirstStage();
    const now = T0 + ctx.progression.offline.capHours * HOUR;
    const loot = offlineLoot(before, now, ctx);
    expect(loot.cards).toContainEqual({ templateId: 'otto', rarity: 'blue' });
    const after = win(before, 'ch1_s2', now);
    expect(offlineRewards(after, now, ctx)).toEqual(offlineRewards(before, now, ctx));
    expect(offlineLoot(after, now, ctx)).toEqual(loot);
    expect(offlineLoot(after, now + 100 * HOUR, ctx)).toEqual(loot);
    expect(offlineLoot(deserialize(serialize(after)), now, ctx)).toEqual(loot);
    // A replay grants its own rewards without advancing the chest or its random stream.
    // Выпущенные данные повторы запрещают; при явном replay: true повтор не трогает сундук.
    expect(() => win(after, 'ch1_s1', now + HOUR)).toThrow(expect.objectContaining({ code: 'stage_cleared' }));
    const replay = win(after, 'ch1_s1', now + HOUR, withReplay(ctx));
    expect(replay.offline).toEqual(after.offline);
    expect(offlineLoot(replay, now + HOUR, ctx)).toEqual(loot);
  });

  it('накопление в одной главе даёт тот же поток при нескольких первых победах и банковках', () => {
    const start = atFirstStage();
    let save = win(start, 'ch1_s2', T0 + 2 * HOUR);
    save = bankOffline(save, T0 + 3 * HOUR, ctx);
    save = win(save, ctx.content.stages[2].id, T0 + 4 * HOUR);
    const now = T0 + 6 * HOUR;
    expect(offlineLoot(save, now, ctx)).toEqual(offlineLoot(start, now, ctx));
    expect(offlineLoot(bankOffline(save, now, ctx), now, ctx)).toEqual(offlineLoot(save, now, ctx));
  });

  it('переход главы сохраняет прежние тики, а новые дают предметы и карты новой главы', () => {
    const generous = { ...ctx, equipment: { ...ctx.equipment, drops: { ...ctx.equipment.drops,
      chest: { ...ctx.equipment.drops.chest!, rules: [
        { chapter: 'chapter1', item: 1, itemsFromChapter: 1, rarityWeights: { common: 1 }, heroCards: { blue: 1, purple: 0 }, gems: { chance: 1, count: 1 }, scrolls: { chance: 1, count: 1 } },
        { chapter: 'chapter2', item: 1, itemsFromChapter: 1, rarityWeights: { common: 1 }, heroCards: { blue: 0, purple: 1 }, gems: { chance: 1, count: 2 } },
      ] },
    } } };
    let save = deserialize(readFileSync(new URL('./fixtures/tavern-chapter1-before-win.json', import.meta.url), 'utf8'));
    const started = save.offline.lastClaimAt;
    save = win(save, 'ch1_s10', started + 4 * HOUR, generous);
    const transition = started + 4 * HOUR + MINUTE;
    const earned = offlineLoot(save, transition, generous);
    expect(earned.ticks).toBe(8);
    expect(earned.cards.map(card => card.rarity)).toEqual(Array(8).fill('blue'));
    const after = win(save, 'ch2_s1', transition, generous);
    expect(offlineLoot(after, transition, generous)).toEqual(earned);
    const now = transition + 2 * HOUR;
    const accrued = offlineLoot(deserialize(serialize(after)), now, generous);
    expect(accrued.ticks).toBe(12);
    expect(accrued.items.slice(0, 8)).toEqual(earned.items);
    expect(accrued.items.slice(8)).toHaveLength(4);
    expect(accrued.items.slice(8).every(id => (ctx.equipment.items[id].minChapter ?? 1) <= 2)).toBe(true);
    expect(accrued.cards.slice(0, 8)).toEqual(earned.cards);
    expect(accrued.cards.slice(8).map(card => card.rarity)).toEqual(Array(4).fill('purple'));
    expect(accrued.gems).toBe(earned.gems + 8);
    expect(accrued.scrolls).toBe(earned.scrolls);
    const claimed = claimOffline(after, now, generous);
    expect(claimed.loot.items).toEqual(accrued.items);
    expect(claimed.loot.cards).toEqual(accrued.cards);
    expect(claimed.loot.gems).toBe(accrued.gems);
    expect(claimed.loot.scrolls).toBe(accrued.scrolls);
    expect(claimed.save.offline.bankedLoot).toBeUndefined();
    expect(claimed.save.offline.lootAnchorAt).toBeUndefined();
    expect(claimed.save.offline.lootStateAt).toBeUndefined();
    const again = claimOffline(deserialize(serialize(claimed.save)), now, generous);
    expect(again.loot.ticks).toBe(0);
    expect(again.save.resources).toEqual(claimed.save.resources);
    expect(again.save.currency).toEqual(claimed.save.currency);
    expect(again.save.inventory).toEqual(claimed.save.inventory);
    expect(again.save.heroes).toEqual(claimed.save.heroes);
  });

  it('сдвиг часов назад сохраняет банк, выплачивает долг и не перебрасывает следующие тики', () => {
    const save = win(atFirstStage(), 'ch1_s2', T0 + 4 * HOUR);
    const earned = offlineLoot(save, T0 + 4 * HOUR, ctx);
    const corrected = syncOfflineClock(save, T0 + 3 * HOUR, ctx);
    expect(corrected.offline.debtMs).toBe(HOUR);
    expect(offlineLoot(corrected, T0 + 3 * HOUR, ctx)).toEqual(earned);
    const loaded = deserialize(serialize(corrected));
    expect(offlineLoot(loaded, T0 + 4 * HOUR, ctx)).toEqual(earned);
    const now = T0 + 4 * HOUR + 30 * MINUTE;
    expect(offlineLoot(loaded, now, ctx)).toEqual(offlineLoot(save, now, ctx));
    expect(offlineRewards(loaded, now, ctx)).toEqual(offlineRewards(save, now, ctx));
    const claimed = claimOffline(loaded, now, ctx);
    expect(claimed.loot.items).toEqual(offlineLoot(save, now, ctx).items);
    expect(claimed.save.offline.debtMs).toBeUndefined();
    expect(claimed.save.offline.bankedLoot).toBeUndefined();
    expect(claimed.save.offline.lootAnchorAt).toBeUndefined();
    expect(claimed.save.offline.lootStateAt).toBeUndefined();
  });

  it('поля совместимы с v7 без изменения замороженных миграций и не мутируют исходный save', () => {
    const save = atFirstStage();
    const snapshot = serialize(save);
    expect(deserialize(snapshot).offline).toEqual(save.offline);
    expect(save.offline.bankedLoot).toBeUndefined();
    expect(save.offline.lootAnchorAt).toBeUndefined();
    const banked = bankOffline(save, T0 + 2 * HOUR, ctx);
    expect(serialize(save)).toBe(snapshot);
    expect(serialize(deserialize(serialize(banked)))).toBe(serialize(banked));
    expect(claimOffline(banked, T0 + 2 * HOUR, ctx).save.version).toBe(7);
    expect(bankOffline(save, NaN, ctx)).toBe(save);
    expect(claimOffline(banked, NaN, ctx).save).toBe(banked);
  });

  it('удалённый контент убирается из снимка при загрузке без повторной выдачи его тиков', () => {
    const now = T0 + ctx.progression.offline.capHours * HOUR;
    const save = win(atFirstStage(), 'ch1_s2', now);
    const loot = offlineLoot(save, now, ctx);
    expect(loot.items.length).toBeGreaterThan(0);
    expect(loot.cards.length).toBeGreaterThan(0);
    const retiredItems = new Set(loot.items);
    const retiredHeroes = new Set(loot.cards.map(card => card.templateId));
    const updated = { ...ctx,
      content: { ...ctx.content, heroes: Object.fromEntries(Object.entries(ctx.content.heroes).filter(([id]) => !retiredHeroes.has(id))) },
      equipment: { ...ctx.equipment, items: Object.fromEntries(Object.entries(ctx.equipment.items).filter(([id]) => !retiredItems.has(id))) },
    };
    const fixed = sanitizeSave(deserialize(serialize(save)), updated);
    expect(fixed.warnings.join(' ')).toContain('сундука');
    const current = offlineLoot(fixed.save, now, updated);
    expect(current).toEqual({ ...loot, items: [], cards: [] });
    const claimed = claimOffline(fixed.save, now, updated);
    expect(claimed.loot.items).toEqual([]);
    expect(claimed.loot.cards).toEqual([]);
    expect(fixed.save.offline.bankedLoot?.ticks).toBe(loot.ticks);
    expect(offlineLoot(claimed.save, now, updated).ticks).toBe(0);
  });

  it.each([0, HOUR])('сбор старым клиентом спустя %i мс не позволяет повторно забрать сохранённый снимок', (elapsed) => {
    const now = T0 + ctx.progression.offline.capHours * HOUR;
    const save = win(atFirstStage(), 'ch1_s2', now);
    const { lootAnchorAt, lootStateAt, bankedLoot, ...oldOffline } = save.offline;
    // The older client neither reads these fields nor removes them from settled()'s rest object.
    const paid = claimOffline({ ...save, offline: oldOffline }, now + elapsed, ctx).save;
    const legacy = deserialize(serialize({ ...paid, offline: { ...paid.offline, lootAnchorAt, lootStateAt, bankedLoot } }));
    expect(legacy.offline.banked).toBeUndefined();
    expect(offlineLoot(legacy, now + elapsed, ctx).ticks).toBe(0);
    const again = claimOffline(legacy, now + elapsed, ctx);
    expect(again.save.currency).toEqual(paid.currency);
    expect(again.save.resources).toEqual(paid.resources);
    expect(again.save.inventory).toEqual(paid.inventory);
    expect(again.save.heroes).toEqual(paid.heroes);
    const fixed = sanitizeSave(legacy, ctx);
    expect(fixed.save.offline.bankedLoot).toBeUndefined();
    expect(fixed.save.offline.lootAnchorAt).toBeUndefined();

    const later = now + elapsed + ctx.progression.offline.capHours * HOUR;
    const newBank = bankOffline(paid, later, ctx);
    const { lootAnchorAt: _a, lootStateAt: _s, bankedLoot: _l, ...knownNewBank } = newBank.offline;
    // An additional old-client bank has enough minutes again but must not revive the paid snapshot.
    const legacyBank = { ...newBank, offline: { ...knownNewBank, lootAnchorAt, lootStateAt, bankedLoot } };
    const baseline = { ...newBank, offline: knownNewBank };
    expect(offlineLoot(legacyBank, later, ctx)).toEqual(offlineLoot(baseline, later, ctx));
    const restored = sanitizeSave(deserialize(serialize(legacyBank)), ctx);
    expect(restored.save.offline.bankedLoot).toBeUndefined();
    expect(offlineLoot(restored.save, later, ctx)).toEqual(offlineLoot(baseline, later, ctx));
  });

  it.each(['bankedLoot', 'lootAnchorAt', 'lootStateAt'])('повреждённое optional поле %s не сбрасывает кампанию', (field) => {
    const save = win(atFirstStage(), 'ch1_s2', T0 + 2 * HOUR);
    const raw = JSON.parse(serialize(save));
    raw.offline[field] = 'повреждено';
    const loaded = deserialize(JSON.stringify(raw));
    expect(loaded.campaign).toEqual(save.campaign);
    expect(loaded.resources).toEqual(save.resources);
    expect(loaded.currency).toEqual(save.currency);
    expect(loaded.heroes).toEqual(save.heroes);
    expect(loaded.offline[field as 'bankedLoot' | 'lootAnchorAt' | 'lootStateAt']).toBeUndefined();
  });

  it('не выдаёт число сохранённых тиков сверх минут банка', () => {
    const now = T0 + 2 * HOUR;
    const save = win(atFirstStage(), 'ch1_s2', now);
    const invalid = { ...save, offline: { ...save.offline, bankedLoot: { ...save.offline.bankedLoot!, ticks: 24, gems: 999 } } };
    const baseline = { ...save, offline: { ...save.offline, bankedLoot: undefined } };
    expect(offlineLoot(invalid, now, ctx)).toEqual(offlineLoot(baseline, now, ctx));
    const fixed = sanitizeSave(deserialize(serialize(invalid)), ctx);
    expect(fixed.save.offline.bankedLoot).toBeUndefined();
    expect(fixed.save.resources).toEqual(save.resources);
  });
});
