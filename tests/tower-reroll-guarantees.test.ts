import { describe, expect, it } from 'vitest';
import {
  deserialize, rerollTowerBlessing, resolveTowerEvent, runConfig, SaveError, serialize, startTowerRun,
  type SaveState, type TowerRun,
} from '../src/core';
import { BLESSING_RARITIES, type BlessingRarity } from '../src/core/tower/runSchema';
import { loadFullContext } from '../scripts/lib/content-node';
import { playerSave, TOWER_SQUADS } from '../scripts/balance-tower';

const ctx = loadFullContext();
const cfg = runConfig(ctx);
type BlessingPending = Extract<NonNullable<TowerRun['pending']>, { kind: 'blessing' }>;

function eventSave(event: string, salt = 1, cards: string[] = []): SaveState {
  const player = playerSave(ctx, 3, TOWER_SQUADS[0], salt);
  const save = startTowerRun(player, player.squad, ctx);
  return {
    ...save,
    tower: { ...save.tower, run: {
      ...save.tower.run!, floor: 3, cards, shards: 10, rerolls: 3,
      pending: { kind: 'event', event },
    } },
  };
}

function pending(save: SaveState): BlessingPending {
  const p = save.tower.run!.pending;
  expect(p?.kind).toBe('blessing');
  if (p?.kind !== 'blessing') throw new Error('Ожидался выбор карты');
  return p;
}

function rarities(save: SaveState) {
  return pending(save).options.map((id) => cfg.blessings.find((b) => b.id === id)!.rarity);
}

function verifyRerolls(save: SaveState, min: BlessingRarity): SaveState {
  for (let roll = 0; roll <= 3; roll++) {
    const p = pending(save);
    expect(p.minRarity).toBe(min);
    expect(p.rolls).toBe(roll);
    expect(p.options.length).toBeGreaterThan(0);
    expect(rarities(save).every((r) => BLESSING_RARITIES.indexOf(r) >= BLESSING_RARITIES.indexOf(min))).toBe(true);
    const restored = deserialize(serialize(save));
    expect(restored.tower).toEqual(save.tower);
    if (roll < 3) {
      const rerolled = rerollTowerBlessing(restored, ctx);
      expect(rerolled).toEqual(rerollTowerBlessing(save, ctx));
      expect(rerolled.tower.run!.rerolls).toBe(2 - roll);
      save = rerolled;
    }
  }
  return save;
}

describe('Башня: гарантированная редкость после перетасовки', () => {
  it('Алтарь: плата 20% ОЗ сохраняет редкую гарантию после загрузки и всех перетасовок', () => {
    const before = eventSave('altar');
    const save = resolveTowerEvent(before, 0, ctx).save;
    for (const [id, hp] of Object.entries(before.tower.run!.hp)) expect(save.tower.run!.hp[id]).toBe(hp - 200);
    verifyRerolls(save, 'rare');
  });

  it('Мимик: выигранные легендарные карты остаются легендарными', () => {
    let wins = 0;
    let losses = 0;
    for (let salt = 1; salt <= 12; salt++) {
      const save = resolveTowerEvent(eventSave('mimic', salt), 0, ctx).save;
      if (save.tower.run!.pending?.kind === 'blessing') {
        wins++;
        verifyRerolls(save, 'legendary');
      } else losses++;
    }
    expect(wins).toBeGreaterThan(0);
    expect(losses).toBeGreaterThan(0);
  });

  it.each([
    ['common', 'rare'], ['rare', 'legendary'], ['legendary', 'legendary'],
  ] as const)('Писарь: обмен %s → %s сохраняет гарантию и списывает ровно последнюю карту', (from, min) => {
    const card = cfg.blessings.find((b) => b.rarity === from)!.id;
    const save = resolveTowerEvent(eventSave('scribe', 1, ['pupa', card]), 0, ctx).save;
    expect(save.tower.run!.cards).toEqual(['pupa']);
    expect(verifyRerolls(save, min).tower.run!.cards).toEqual(['pupa']);
  });

  it('обычная карта Торговки не получает редкую гарантию', () => {
    const save = resolveTowerEvent(eventSave('merchant'), 0, ctx).save;
    expect(pending(save).minRarity).toBe('common');
    const rerolled = rerollTowerBlessing(deserialize(serialize(save)), ctx);
    expect(rarities(rerolled)).toContain('common');
    verifyRerolls(save, 'common');
  });

  it.each(['floor', 'elite', 'boss', 'event', 'start', 'upgrade'] as const)(
    'старое сохранение без minRarity: прежние правила источника %s', (source) => {
      const save = eventSave('altar');
      save.tower.run!.pending = { kind: 'blessing', source, options: ['deviruchi'], rolls: 0 };
      const loaded = deserialize(serialize(save));
      expect(pending(loaded)).not.toHaveProperty('minRarity');
      const rerolled = rerollTowerBlessing(loaded, ctx);
      const hasRareGuarantee = ['elite', 'boss', 'upgrade'].includes(source);
      if (hasRareGuarantee) expect(rarities(rerolled)).not.toContain('common');
      else expect(rarities(rerolled)).toContain('common');
      expect(rerolled.tower.run!.rerolls).toBe(2);
      expect(pending(rerolled).rolls).toBe(1);
    },
  );

  it.each(['mythic', '', null, 2, {}])('повреждённая minRarity %j отклоняется схемой сохранения', (value) => {
    const save = resolveTowerEvent(eventSave('altar'), 0, ctx).save;
    const raw = JSON.parse(serialize(save));
    raw.tower.run.pending.minRarity = value;
    expect(() => deserialize(JSON.stringify(raw))).toThrow(SaveError);
  });
});
