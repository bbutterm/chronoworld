import { describe, expect, it } from 'vitest';
import {
  actLevelUp, addHeroCard, addItems, chooseBranch, equip, heroResetInfo, serialize, setHeroFocus,
  setSquad,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { NIGHT_MODEL, NightPlayer } from '../scripts/lib/night-player';

const ctx = loadFullContext();

/** Тестовый ресурсный/копийный fixture; он не включается в отчёты реального прохождения. */
function trainedCopies(enabled: boolean): { player: NightPlayer; targetId: string; donorId: string } {
  const player = new NightPlayer(ctx, NIGHT_MODEL, false, enabled);
  const targetId = player.save.heroes[0].id;
  player.save = {
    ...player.save,
    resources: { ...player.save.resources, gold: 1_000_000, heroExp: 1_000_000 },
    heroes: player.save.heroes.map((hero) => hero.id === targetId ? { ...hero, rarity: 'blue' } : hero),
  };
  const copy = addHeroCard(player.save, 'alan', 'gold');
  player.save = copy.save;
  const donorId = copy.hero.id;
  for (let i = 0; i < 19; i++) player.save = actLevelUp(player.save, player.day, targetId, ctx).save;
  for (let i = 0; i < 29; i++) player.save = actLevelUp(player.save, player.day, donorId, ctx).save;
  player.save = chooseBranch(player.save, donorId, 'knight', ctx).save;
  player.save = setHeroFocus(player.save, targetId, 'resolve', ctx);
  player.save = setHeroFocus(player.save, donorId, 'precision', ctx);
  player.save = setSquad(player.save, player.save.squad.map((id) => id === targetId ? donorId : id));
  const def = Object.values(ctx.equipment.items).find((item) => item.slot === 'weapon' && !item.jobs)!;
  player.save = addItems(player.save, [def.id]).save;
  player.save = equip(player.save, donorId, player.save.inventory.items[0].id, ctx);
  return { player, targetId, donorId };
}

describe('Отдельный профиль с сохранением исходных спутников', () => {
  it('возвращает оплату копии и меняет редкость, сохраняя собственный id, обучение и путь оригинала', () => {
    const { player, targetId, donorId } = trainedCopies(true);
    const before = player.save;
    const target = before.heroes.find((hero) => hero.id === targetId)!;
    const refund = heroResetInfo(before, donorId, ctx).refund;
    player.preserveCompanionCopies();
    const original = player.save.heroes.find((hero) => hero.id === targetId)!;
    const donor = player.save.heroes.find((hero) => hero.id === donorId)!;
    expect(original).toEqual({ ...target, rarity: 'gold' });
    expect(player.save.squad).toContain(targetId);
    expect(player.save.squad).not.toContain(donorId);
    expect(player.save.heroes).toHaveLength(before.heroes.length);
    expect(donor.rarity).toBe('blue');
    expect(donor.level).toBe(1);
    expect(donor.journey?.focus).toBeUndefined();
    expect(donor.journey?.peakLevel).toBe(30);
    expect(player.save.inventory.items.every((item) => item.equippedBy === null)).toBe(true);
    expect(player.save.resources.gold).toBe(before.resources.gold + refund.gold);
    expect(player.save.resources.heroExp).toBe(before.resources.heroExp + refund.exp);
    expect(player.save.currency).toEqual(before.currency);
    expect(player.actions.filter((action) => action.kind === 'copy_rarity_upgrade')).toHaveLength(1);
  });

  it('не меняет baseline-профиль или защищённую копию, включая её оплаченное обучение', () => {
    const disabled = trainedCopies(false).player;
    const untouched = serialize(disabled.save);
    disabled.preserveCompanionCopies();
    expect(serialize(disabled.save)).toBe(untouched);
    const { player, donorId } = trainedCopies(true);
    player.save = { ...player.save, heroes: player.save.heroes.map((hero) => hero.id === donorId ? { ...hero, locked: true } : hero) };
    const locked = serialize(player.save);
    player.preserveCompanionCopies();
    expect(serialize(player.save)).toBe(locked);
    expect(player.actions).toEqual([]);
  });
});
