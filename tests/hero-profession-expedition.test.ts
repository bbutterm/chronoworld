import { describe, expect, it } from 'vitest';
import {
  addHeroCard, ascendAll, ascendHero, ascendRequirement, branchStatus, changeBranch, chooseBranch,
  chooseExpeditionEvent, claimExpedition, expeditionEventViews, expeditionStatus, HeroError,
  heroProfessionBlocker, levelUpHero, newGame, startExpedition, type SaveState,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const T0 = 1000;

function ready(chosen: boolean): { save: SaveState; copyIds: string[] } {
  const start = newGame(ctx, T0);
  let save: SaveState = {
    ...start,
    resources: { gold: 10_000_000, heroExp: 10_000_000 },
    campaign: { cleared: ctx.content.stages.slice(0, ctx.content.stages.findIndex((s) => s.id === 'ch1_s8') + 1).map((s) => s.id) },
  };
  // Пересмотр 10.10: зелёный → синий — герой + 1 любой зелёный (было 2 такие же).
  const first = addHeroCard(save, 'alan', 'green');
  save = ascendHero(first.save, 'h1', [first.hero.id], ctx).save;
  const third = addHeroCard(save, 'alan', 'blue');
  const fourth = addHeroCard(third.save, 'alan', 'blue');
  save = ascendHero(fourth.save, 'h1', [third.hero.id, fourth.hero.id], ctx, { deferBranch: true }).save;
  save = levelUpHero(save, 'h1', ctx, 19).save;
  if (chosen) save = chooseBranch(save, 'h1', 'knight', ctx).save;
  const five = addHeroCard(save, 'alan', 'purple');
  const six = addHeroCard(five.save, 'alan', 'purple');
  return { save: six.save, copyIds: [five.hero.id, six.hero.id] };
}

function expectHeroBusy(save: SaveState, action: () => unknown): void {
  const before = structuredClone(save);
  try {
    action();
    throw new Error('Профессия героя изменилась в экспедиции');
  } catch (error) {
    expect(error).toBeInstanceOf(HeroError);
    expect((error as HeroError).code).toBe('hero_busy');
    expect((error as HeroError).message).toMatch(/заберите награды/);
  }
  expect(save).toEqual(before);
}

describe('профессия героя не меняется до получения наград его экспедиции', () => {
  it.each([false, true])('настоящая экспедиция: pending, resolved и законченная без claim сохраняют защиту (branch=%s)', (chosen) => {
    const initial = ready(chosen);
    let save = startExpedition(initial.save, 'ant_hell', 1, T0, ctx, ['h1']);
    const trip = save.bounties.active[0];
    const ev = trip.events![0];
    expect(expeditionEventViews(save, 'ant_hell', ev.at, ctx)[0].pending).toBe(true);
    for (const resolve of [false, true]) {
      if (resolve) {
        const choice = ctx.expeditionEvents!.events.find((e) => e.id === ev.id)!.choices[0].id;
        save = chooseExpeditionEvent(save, 'ant_hell', 0, choice, ev.at, ctx);
        expect(expeditionEventViews(save, 'ant_hell', ev.at, ctx)[0].pending).toBe(false);
      }
      expect(branchStatus(save, 'h1', ctx)).toMatchObject({
        canChoose: !chosen, canChange: chosen, blocker: 'expedition', blockerText: expect.stringMatching(/заберите награды/),
      });
      expect(ascendRequirement(save, 'h1', ctx)!.blockers).toContain(heroProfessionBlocker(save, 'h1'));
      expectHeroBusy(save, () => chooseBranch(save, 'h1', 'crusader', ctx));
      expectHeroBusy(save, () => changeBranch(save, 'h1', 'crusader', ctx));
      expectHeroBusy(save, () => ascendHero(save, 'h1', initial.copyIds, ctx));
    }
    expect(expeditionStatus(save, trip.endsAt, ctx)[0].active!.remainingMs).toBe(0);
    expectHeroBusy(save, () => ascendHero(save, 'h1', initial.copyIds, ctx));
    const claimed = claimExpedition(save, 'ant_hell', trip.endsAt, ctx).save;
    expect(heroProfessionBlocker(claimed, 'h1')).toBeNull();
    expect(branchStatus(claimed, 'h1', ctx)).toMatchObject({ blocker: null, blockerText: null });
    const picked = chosen ? changeBranch(claimed, 'h1', 'crusader', ctx).save : chooseBranch(claimed, 'h1', 'crusader', ctx).save;
    expect(picked.heroes.find((h) => h.id === 'h1')!.branch).toBe('crusader');
    expect(ascendHero(picked, 'h1', initial.copyIds, ctx).save.heroes.find((h) => h.id === 'h1')!.rarity).toBe('gold');
  });

  it('«Вознести всех» пропускает занятую цель и продолжает другие доступные повышения', () => {
    const initial = ready(true);
    let save = initial.save;
    // Пересмотр 10.10: лишние зелёные Ирис ушли бы в слот «любой» зелёным Брану и Вике из отряда, а синяя Ирис после
    // фиолетового забрала бы копии Алана в слоты «любой» — берём 3 фиолетовые Ирис: золотой из своих копий.
    for (let i = 0; i < 3; i++) save = addHeroCard(save, 'iris', 'purple').save;
    save = startExpedition(save, 'ant_hell', 1, T0, ctx, ['h1']);
    const result = ascendAll(save, ctx);
    expect(result.done.map((s) => s.templateId)).toEqual(['iris']);
    expect(result.save.heroes.find((h) => h.id === 'h1')!.rarity).toBe('purple');
    expect(result.save.bounties.active).toEqual(save.bounties.active);
    const claimed = claimExpedition(result.save, 'ant_hell', save.bounties.active[0].endsAt, ctx).save;
    expect(ascendAll(claimed, ctx).done.map((s) => s.heroId)).toContain('h1');
  });

  it('обычное повышение уровня доступно в пути, а устаревший preview не обходит повторную проверку', () => {
    const initial = ready(true);
    expect(branchStatus(initial.save, 'h1', ctx).blocker).toBeNull();
    expect(ascendRequirement(initial.save, 'h1', ctx)!.blockers).toEqual([]);
    const save = startExpedition(initial.save, 'ant_hell', 1, T0, ctx, ['h1']);
    const leveled = levelUpHero(save, 'h1', ctx);
    expect(leveled.levels).toBe(1);
    expect(leveled.save.bounties.active).toEqual(save.bounties.active);
    expectHeroBusy(save, () => changeBranch(save, 'h1', 'crusader', ctx));
    expectHeroBusy(save, () => ascendHero(save, 'h1', initial.copyIds, ctx));
  });
});
