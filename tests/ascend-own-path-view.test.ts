import { describe, expect, it } from 'vitest';
import {
  addHeroCard,
  ascendHero,
  autoFodder,
  chooseBranch,
  heroCard,
  heroPower,
  levelUpHero,
  newGame,
  resetHeroLevel,
  upgradeHeroFromCopy,
  type HeroState,
  type SaveState,
} from '../src/core';
import { ascendedBranch, ascendButtonState, ascendPower, ascendPreview, needsBranchPick } from '../src/game/heroesView';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const find = (save: SaveState, id: string) => save.heroes.find(h => h.id === id)!;

/** Только публичные правила: ветеран обучается, возвращает оплату, затем временно становится синей копией. */
function returnedVeteran() {
  let save = newGame(ctx, 0);
  const veteran = addHeroCard(save, 'alan', 'gold');
  const id = veteran.hero.id;
  save = chooseBranch(veteran.save, id, 'knight', ctx).save;
  save = { ...save, resources: { ...save.resources, gold: 100_000_000, heroExp: 100_000_000 } };
  save = levelUpHero(save, id, ctx, 75).save;
  save = resetHeroLevel(save, id, ctx).save;
  const lower = addHeroCard(save, 'alan', 'blue');
  save = upgradeHeroFromCopy(lower.save, lower.hero.id, id, ctx).save;
  for (let n = 0; n < 2; n++) save = addHeroCard(save, 'alan', 'blue').save;
  return { save, id };
}

describe('обычное вознесение после развития копией', () => {
  it('превью и кнопка восстанавливают свою ветку; фактическое вознесение даёт ровно показанную форму', () => {
    const { save, id } = returnedVeteran();
    const hero = find(save, id);
    const fodder = autoFodder(save, id, ctx)!;
    expect(hero.branch).toBeUndefined();
    expect(hero.journey?.lastBranch).toBe('knight');
    expect(needsBranchPick(hero, 'purple', ctx)).toBe(false);
    expect(ascendedBranch(hero, 'purple', ctx, 'crusader')).toBe('knight');
    const preview = ascendPreview(hero, ctx, 'crusader')!;
    expect(preview.newJob).toBe('knight');
    expect(ascendButtonState(save, id, fodder, ctx)).toEqual({ ready: true, reason: null });
    const after = ascendHero(save, id, fodder, ctx).save;
    expect(find(after, id).branch).toBe('knight');
    expect(heroCard(find(after, id), ctx).stats).toEqual(preview.stats.to);
    expect(find(after, id).level).toBe(hero.level);
    expect(find(after, id).branchChanges).toBe(hero.branchChanges);
  });

  it('превью навыков, статов и мощи учитывает освоенный ветеранский ранг после возврата уровня', () => {
    let { save, id } = returnedVeteran();
    save = ascendHero(save, id, autoFodder(save, id, ctx)!, ctx).save;
    for (let n = 0; n < 2; n++) save = addHeroCard(save, 'alan', 'purple').save;
    const hero = find(save, id);
    const preview = ascendPreview(hero, ctx)!;
    const power = ascendPower(hero, ctx, h => heroPower(h, ctx))!;
    const after = find(ascendHero(save, id, autoFodder(save, id, ctx)!, ctx).save, id);
    const card = heroCard(after, ctx);
    expect(after.level).toBe(1);
    expect(card.advanced).toBe(true);
    expect(preview.newJob).toBe(card.job);
    expect(preview.stats.to).toEqual(card.stats);
    expect(power.to).toBe(heroPower(after, ctx));
    expect(preview.newSkills.map(s => s.skill)).toEqual(card.skills.filter(s => s.level <= 80).map(s => s.skill));
  });

  it('старый герой без выбранного пути по-прежнему выбирает впервые бесплатно; чужая память игнорируется', () => {
    const initial = addHeroCard(newGame(ctx, 0), 'alan', 'blue');
    const legacy = initial.hero;
    expect(needsBranchPick(legacy, 'purple', ctx)).toBe(true);
    expect(ascendPreview(legacy, ctx)!.newJob).toBeUndefined();
    expect(ascendPreview(legacy, ctx, 'crusader')!.newJob).toBe('crusader');
    const foreign: HeroState = { ...legacy, journey: { lastBranch: 'wizard' } };
    expect(needsBranchPick(foreign, 'purple', ctx)).toBe(true);
    expect(ascendedBranch(foreign, 'purple', ctx)).toBeUndefined();
    expect(ascendPreview(foreign, ctx, 'crusader')!.newJob).toBe('crusader');
  });

  it('занятость цели объясняется до нехватки копий; после получения наград готовое действие возвращается', () => {
    const { save, id } = returnedVeteran();
    const active: SaveState = { ...save, bounties: { ...save.bounties, active: [{ id: 'e', missionId: 'm', heroIds: [id], start: 0, finish: 100 } as any] } };
    const busy = ascendButtonState(active, id, [], ctx);
    expect(busy.ready).toBe(false);
    expect(busy.reason).toContain('заберите награды');
    expect(ascendButtonState(save, id, autoFodder(save, id, ctx)!, ctx).ready).toBe(true);
  });
});
