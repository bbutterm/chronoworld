import { expect, it } from 'vitest';
import { heroCard, rarityDef, type HeroState } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { veteranSkillTiles, skillTileStatus } from '../src/game/heroSkillTiles';

it('gold level 69 knight previews its upcoming Veteran rank while other branches stay locked', () => {
  const ctx = loadFullContext();
  const hero: HeroState = { id: 'alan', templateId: 'alan', branch: 'knight', rarity: 'gold', level: 69 };
  const card = heroCard(hero, ctx);
  expect(card.advanced).toBe(false);
  const current = card.branches.find(b => b.job === card.branch)!;
  const next = current.advanced!;
  const rarity = rarityDef(ctx, next.minRarity).name;
  const tiles = veteranSkillTiles(next, rarity);
  expect(tiles).toHaveLength(5);
  expect(tiles[0]).toMatchObject({ id: 'ult_adv_alan_lord_knight', ult: true, locked: 70 });
  expect(tiles.map(t => t.locked)).toEqual([70, 70, 80, 90, 100]);
  for (const tile of tiles) {
    expect(tile.form).toBeUndefined();
    expect(skillTileStatus(tile)).toBe(`Ветеран · ${rarity} · ур. ${tile.locked}`);
  }
  const other = card.branches.find(b => b.job !== card.branch)!;
  expect(skillTileStatus({ id: other.ult!, ult: true, locked: 1, form: true })).toBe('Ур. 1 · другая ветка');
  expect(heroCard({ ...hero, level: 70 }, ctx).advanced).toBe(true);
});
