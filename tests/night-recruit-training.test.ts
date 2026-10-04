import { describe, expect, it } from 'vitest';
import {
  addHeroCard, deserialize, heroResetInfo, levelRangeCost, levelUpHero,
  newGame, playStage, resetHeroLevel, serialize, type GameContext, type SaveState,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();

function beforeGretaRecruit(grantedLevel = 1): { save: SaveState; heroId: string; paid: { exp: number; gold: number } } {
  const start = newGame(ctx, 1000);
  const ready: SaveState = {
    ...start,
    resources: { gold: 1_000_000, heroExp: 1_000_000 },
    campaign: { cleared: ctx.content.stages.slice(0, ctx.content.stages.findIndex((s) => s.id === 'ch1_s10')).map((s) => s.id) },
  };
  // Only the heroes in the squad are raised; the existing Greta stays on the bench until her recruitment.
  let save = ready;
  for (const id of ready.squad) if (id) save = levelUpHero(save, id, ctx, 14).save;
  const added = addHeroCard(save, 'greta', 'green', { level: grantedLevel, granted: grantedLevel > 1 });
  const trained = levelUpHero(added.save, added.hero.id, ctx, 6 - grantedLevel);
  return { save: trained.save, heroId: added.hero.id, paid: trained.spent };
}

function recruit(save: SaveState, context: GameContext = ctx): SaveState {
  const outcome = playStage(save, 'ch1_s10', 1, context);
  expect(outcome.result.winner).toBe('A');
  expect(outcome.events).toContainEqual(expect.objectContaining({ type: 'heroJoined', templateId: 'greta', copy: true, caughtUp: true }));
  return outcome.save;
}

describe('сюжетный догоняющий подарок сохраняет реальные оплаты тренировки', () => {
  it.each([1, 3])('legacy save без ledger: подарок сохраняет оплату от подаренного уровня %i', (grantedLevel) => {
    const setup = beforeGretaRecruit(grantedLevel);
    const old: SaveState = {
      ...setup.save,
      heroes: setup.save.heroes.map((h) => {
        if (h.id !== setup.heroId) return h;
        const { training: _training, ...legacy } = h;
        return legacy;
      }),
    };
    const save = deserialize(serialize(old));
    const untouched = structuredClone(save);
    expect(heroResetInfo(save, setup.heroId, ctx).refund).toEqual(setup.paid);
    const gifted = recruit(save);
    expect(save).toEqual(untouched);
    expect(heroResetInfo(gifted, setup.heroId, ctx).refund).toEqual(setup.paid);
    expect(gifted.heroes.find((h) => h.id === setup.heroId)).toMatchObject({ level: 15, grantedLevel: 15, training: setup.paid });
    const reset = resetHeroLevel(gifted, setup.heroId, ctx);
    expect(reset.level).toBe(15);
    expect(reset.refund).toEqual(levelRangeCost(grantedLevel, 6, ctx));
    expect(reset.save.resources).toEqual({ gold: gifted.resources.gold + setup.paid.gold, heroExp: gifted.resources.heroExp + setup.paid.exp });
    expect(heroResetInfo(reset.save, setup.heroId, ctx).canReset).toBe(false);
    expect(() => resetHeroLevel(reset.save, setup.heroId, ctx)).toThrow(/нет оплаченных/);
    const trainedAgain = levelUpHero(reset.save, setup.heroId, ctx, 2);
    expect(trainedAgain.spent).toEqual(levelRangeCost(15, 17, ctx));
    expect(resetHeroLevel(trainedAgain.save, setup.heroId, ctx).save.resources).toEqual(reset.save.resources);
  });

  it('новый ledger сохраняет точную оплату и после изменения цены перед сюжетной встречей', () => {
    const setup = beforeGretaRecruit();
    const changedPrices: GameContext = {
      ...ctx,
      cards: { ...ctx.cards, level: { exp: { ...ctx.cards.level.exp, base: 300 }, gold: { ...ctx.cards.level.gold, base: 45 } } },
    };
    expect(levelRangeCost(1, 6, changedPrices)).not.toEqual(setup.paid);
    const gifted = recruit(setup.save, changedPrices);
    const reset = resetHeroLevel(gifted, setup.heroId, changedPrices);
    expect(reset.refund).toEqual(setup.paid);
    expect(reset.level).toBe(15);
    expect(heroResetInfo(reset.save, setup.heroId, changedPrices).canReset).toBe(false);
  });
});
