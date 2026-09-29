import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newGame, questStatus, recordActivity, withEquipment, withFeatures, type SaveState } from '../src/core';
import {
  claimableCount,
  describeEvents,
  diffText,
  equipBlocker,
  formatNumber,
  inventoryRows,
  itemStatsText,
  powerTone,
  questDestination,
  statDiff,
  statsLine,
  STAT_LABELS,
  untilReset,
} from '../src/game/flow';
import { FS, TOUCH } from '../src/game/theme';
import { loadEquipmentFiles, loadGameContext, ROOT } from '../scripts/lib/content-node';

const json = (f: string) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
const base = loadGameContext();
const ctx = withEquipment(withFeatures(base, json('data/progression.json'), json('data/quests.json')), loadEquipmentFiles(), json('data/drops.json'));
const DAY = '2026-09-26';

function withItems(items: SaveState['inventory']['items']): SaveState {
  const s = newGame(ctx, 0, DAY);
  return { ...s, inventory: { items } };
}

describe('помощники экранов K1–K7', () => {
  it('powerTone: не слабее — ahead, до 20% слабее — close, иначе behind', () => {
    expect(powerTone(100, 100)).toBe('ahead');
    expect(powerTone(150, 100)).toBe('ahead');
    expect(powerTone(80, 100)).toBe('close');
    expect(powerTone(79, 100)).toBe('behind');
    expect(powerTone(0, 0)).toBe('ahead');
  });

  // LT-13: разряды — неразрывным пробелом (U+00A0), чтобы перенос строки не рвал число.
  it('formatNumber разбивает разряды неразрывным пробелом', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(12345)).toBe('12\u00a0345');
    expect(formatNumber(1234567.4)).toBe('1\u00a0234\u00a0567');
  });

  it('P: короткие русские подписи статов одни на все экраны', () => {
    expect(STAT_LABELS).toEqual({ hp: 'ОЗ', atk: 'АТК', def: 'ЗАЩ', spd: 'СКР' });
    expect(statsLine({ hp: 450, atk: 40, def: 12, spd: 95 })).toBe('ОЗ 450 · АТК 40 · ЗАЩ 12 · СКР 95');
    expect(statsLine({ hp: 450, atk: 40 }, '\n', ['hp', 'atk'])).toBe('ОЗ 450\nАТК 40');
  });

  it('P: токены темы — шрифт не меньше 30, цель нажатия не меньше 96', () => {
    for (const size of Object.values(FS)) expect(size).toBeGreaterThanOrEqual(30);
    expect(TOUCH).toBeGreaterThanOrEqual(96);
  });

  it('itemStatsText / statDiff / diffText', () => {
    expect(itemStatsText({ atk: 18, spd: 3 })).toBe('+18 АТК · +3 СКР');
    expect(itemStatsText({})).toBe('без статов');
    const d = statDiff({ atk: 18, spd: 3 }, { atk: 22, hp: 10 });
    expect(d).toEqual([
      { stat: 'ОЗ', delta: 10 },
      { stat: 'АТК', delta: 4 },
      { stat: 'СКР', delta: -3 },
    ]);
    expect(diffText(d)).toBe('+10 ОЗ  +4 АТК  −3 СКР');
    expect(diffText(statDiff(undefined, {}))).toBe('без изменений');
  });

  it('inventoryRows: фильтр по слоту, эпические первыми, кто носит, неизвестные в конце', () => {
    const save = withItems([
      { id: 'it1', itemId: 'knife', equippedBy: null },
      { id: 'it2', itemId: 'crown', equippedBy: 'h1' },
      { id: 'it3', itemId: 'gone_item', equippedBy: null },
      { id: 'it4', itemId: 'gladius', equippedBy: null },
    ]);
    const all = inventoryRows(save, ctx);
    expect(all.map((r) => r.instance.id)).toEqual(['it2', 'it4', 'it1', 'it3']);
    expect(all[0].wornBy).toBe('Алан');
    expect(all[3].def).toBeUndefined();
    expect(inventoryRows(save, ctx, 'weapon').map((r) => r.instance.id)).toEqual(['it4', 'it1']);
  });

  it('equipBlocker: ограничение по профессии и пропавший предмет', () => {
    const save = withItems([
      { id: 'it1', itemId: 'bow', equippedBy: null },
      { id: 'it2', itemId: 'knife', equippedBy: null },
      { id: 'it3', itemId: 'gone_item', equippedBy: null },
    ]);
    const rows = inventoryRows(save, ctx);
    // Алан (Мечник) лук не носит; Сесиль (Охотница, ветка лучника) — носит.
    const alan = save.heroes[0];
    const hunter = { ...alan, templateId: 'meilin', rarity: 'purple' as const, branch: 'hunter' };
    const bow = rows.find((r) => r.instance.id === 'it1')!;
    expect(equipBlocker(bow, alan, ctx)).toMatch(/^только для: /);
    expect(equipBlocker(bow, hunter, ctx)).toBeNull();
    expect(equipBlocker(rows.find((r) => r.instance.id === 'it2')!, alan, ctx)).toBeNull();
    expect(equipBlocker(rows.find((r) => r.instance.id === 'it3')!, alan, ctx)).not.toBeNull();
  });

  it('claimableCount: выполненные задания + достигнутые пороги', () => {
    let save = newGame(ctx, 0, DAY);
    expect(claimableCount(questStatus(save, ctx, DAY))).toBe(0);
    save = recordActivity(save, DAY, 'offline_claim');
    save = recordActivity(save, DAY, 'fast_rewards');
    expect(claimableCount(questStatus(save, ctx, DAY))).toBe(2);
    save = { ...save, daily: { ...save.daily, claimedQuests: ['offline_chest'] } };
    // Задание забрано (20 очков) → открылся порог 20.
    expect(claimableCount(questStatus(save, ctx, DAY))).toBe(2);
  });

  it('untilReset — время до локальной полуночи', () => {
    expect(untilReset(new Date(2026, 8, 26, 22, 30))).toBe('1 ч 30 мин');
    expect(untilReset(new Date(2026, 8, 26, 0, 0))).toBe('24 ч 0 мин');
  });

  it('questDestination ведёт на экран, где задание выполняется', () => {
    expect(questDestination('stage_win')).toBe('Campaign');
    // Навигация AFK: сундук и быстрые награды — на странице «Кампания», призыв — Таверна.
    expect(questDestination('fast_rewards')).toBe('Campaign');
    expect(questDestination('offline_claim')).toBe('Campaign');
    expect(questDestination('hero_level_up')).toBe('Heroes');
    expect(questDestination('hero_ascend')).toBe('Heroes');
    expect(questDestination('summon')).toBe('Tavern');
    expect(questDestination('tower_attempt')).toBe('Tower');
  });

  it('describeEvents понимает гемы и события башни', () => {
    const save = newGame(ctx, 0, DAY);
    const lines = describeEvents(
      [
        { type: 'gems', amount: 20 },
        { type: 'towerFloorCleared', floor: 5, boss: true },
      ],
      save,
      ctx,
    );
    expect(lines).toEqual(['Гемы +20']);
  });
});
