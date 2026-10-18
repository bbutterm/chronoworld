import { describe, expect, it } from 'vitest';
import {
  activeForm, addHeroCard, ascendHero, ascendPlan, bondView, buildUnit, changeBranch, chooseOption, clearHeroFocus,
  deserialize, fightBondQuest, fodderBlocker, heroFocusOptions, heroJourney, heroResetInfo,
  heroSkillList, heroStats, heroStoryPieces, heroStoryUnread, journeyTrustOf, levelRangeCost, levelUpHero,
  newGame, parseLore, resetHeroLevel, serialize, setHeroFocus, tavernNewCount,
  type SaveState,
} from '../src/core';
import { loadFullContext, ROOT } from '../scripts/lib/content-node';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { speakerHero, speakerView } from '../src/game/storyView';

const ctx = loadFullContext();
const lore = parseLore([{ file: 'data/lore/hero_stories.json', data: readFileSync(join(ROOT, 'data/lore/hero_stories.json'), 'utf8') }]).lore;
const rich = (): SaveState => ({ ...newGame(ctx, 1), resources: { gold: 1_000_000, heroExp: 1_000_000 } });

describe('личная тренировка: бесплатный возврат только оплаченного', () => {
  it('сохраняет героя, профессию, вещи, близость и историю; повторный возврат невозможен', () => {
    const initial = rich();
    const trained = levelUpHero(initial, 'h1', ctx, 12).save;
    const before: SaveState = { ...trained, inventory: { items: [{ id: 'it1', itemId: 'knife', equippedBy: 'h1' }] }, tavern: { bond: { alan: 2 } }, heroStoryRead: { alan: [10] } };
    const outcome = resetHeroLevel(before, 'h1', ctx);
    expect(outcome.refund).toEqual(levelRangeCost(1, 13, ctx));
    expect(outcome.save.resources).toEqual(initial.resources);
    expect(outcome.save.heroes.find((h) => h.id === 'h1')).toMatchObject({ templateId: 'alan', rarity: 'green', level: 1, journey: { peakLevel: 13 }, training: { exp: 0, gold: 0 } });
    expect(outcome.save.inventory).toEqual(before.inventory);
    expect(outcome.save.tavern).toEqual(before.tavern);
    expect(outcome.save.heroStoryRead).toEqual(before.heroStoryRead);
    expect(outcome.save.squad).toEqual(before.squad);
    expect(() => resetHeroLevel(outcome.save, 'h1', ctx)).toThrow(/нет оплаченных/);
  });

  it('подаренный догоняющий уровень остаётся; многократная тренировка не создаёт ресурсы', () => {
    const initial = rich();
    const added = addHeroCard(initial, 'iris', 'green', { level: 8, granted: true });
    let save = added.save;
    expect(heroResetInfo(save, added.hero.id, ctx).canReset).toBe(false);
    for (let i = 0; i < 5; i++) {
      save = levelUpHero(save, added.hero.id, ctx, 4).save;
      const reset = resetHeroLevel(save, added.hero.id, ctx);
      expect(reset.level).toBe(8);
      expect(reset.refund).toEqual(levelRangeCost(8, 12, ctx));
      expect(reset.save.resources).toEqual(initial.resources);
      save = reset.save;
    }
    expect(save.heroes.find((h) => h.id === added.hero.id)?.grantedLevel).toBe(8);
  });

  it('старое сохранение без ledger возвращает стоимость выше grantedLevel; новые оплаты остаются точными после изменения цены', () => {
    const initial = rich();
    const legacy: SaveState = { ...initial, heroes: initial.heroes.map((h) => h.id === 'h1' ? { ...h, level: 8, grantedLevel: 5 } : h) };
    expect(resetHeroLevel(legacy, 'h1', ctx).refund).toEqual(levelRangeCost(5, 8, ctx));
    const trained = levelUpHero(initial, 'h1', ctx, 9);
    const newPrices = { ...ctx, cards: { ...ctx.cards, level: { exp: { ...ctx.cards.level.exp, base: 50 }, gold: { ...ctx.cards.level.gold, base: 30 } } } };
    expect(resetHeroLevel(trained.save, 'h1', newPrices).refund).toEqual(trained.spent);
  });

  it('если сюжетный подарок догнал уже обученного героя, его прежние оплаты всё равно можно вернуть один раз', () => {
    const initial = rich();
    const trained = levelUpHero(initial, 'h1', ctx, 5).save;
    const gifted = { ...trained, heroes: trained.heroes.map((h) => h.id === 'h1' ? { ...h, level: 12, grantedLevel: 12 } : h) };
    expect(heroResetInfo(gifted, 'h1', ctx)).toMatchObject({ fromLevel: 12, level: 12, canReset: true });
    const reset = resetHeroLevel(gifted, 'h1', ctx).save;
    expect(reset.resources).toEqual(initial.resources);
    expect(reset.heroes.find((h) => h.id === 'h1')?.level).toBe(12);
    expect(heroResetInfo(reset, 'h1', ctx).canReset).toBe(false);
  });

  it('перезапуск/сохранение не стирают точную оплату и путь', () => {
    const trained = setHeroFocus(levelUpHero(rich(), 'h1', ctx, 10).save, 'h1', 'guard', ctx);
    const back = deserialize(serialize(trained));
    expect(back.heroes.find((h) => h.id === 'h1')?.training).toEqual(trained.heroes.find((h) => h.id === 'h1')?.training);
    expect(back.heroes.find((h) => h.id === 'h1')?.journey).toEqual(trained.heroes.find((h) => h.id === 'h1')?.journey);
    expect(resetHeroLevel(back, 'h1', ctx).save.resources).toEqual(rich().resources);
  });

  it('сброс не меняет характеристики отряда в уже начатой экспедиции', () => {
    const save = levelUpHero(rich(), 'h1', ctx, 10).save;
    const busy: SaveState = { ...save, bounties: { active: [{ location: 'road', hours: 2, heroIds: ['h1'], power: 100, startedAt: 1, endsAt: 100, rewards: { gold: 1, jobExp: 1, gems: 0, heroCards: { blue: 0, purple: 0 }, scrolls: 0, items: [] } }] } };
    expect(heroResetInfo(busy, 'h1', ctx).blocker).toBe('expedition');
    expect(() => resetHeroLevel(busy, 'h1', ctx)).toThrow(/экспедиции/);
    expect(() => setHeroFocus(busy, 'h1', 'guard', ctx)).toThrow(/экспедиции/);
  });

  it('неконечный запрос количества уровней не повреждает героя и ресурсный пул', () => {
    const save = rich();
    for (const times of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => levelUpHero(save, 'h1', ctx, times)).toThrow(/конечным числом/);
    }
    expect(save.heroes[0].level).toBe(1);
    expect(save.resources).toEqual(rich().resources);
  });
});

describe('RPG-выучка: реальные альтернативы, без новой валюты', () => {
  it('все 12 персонажей получают личность, карьерные вехи и конкретную цель', () => {
    let save = rich();
    for (const id of Object.keys(ctx.content.heroes)) if (!save.heroes.some((h) => h.templateId === id)) save = addHeroCard(save, id, 'green').save;
    for (const hero of save.heroes) {
      const journey = heroJourney(save, hero.id, { ...ctx, lore });
      expect(journey.identity.length, hero.templateId).toBeGreaterThan(30);
      expect(journey.milestones.map((m) => m.id)).toEqual(['arrival', 'training', 'profession', 'trust', 'personal', 'link', 'veteran']);
      expect(journey.nextGoal.text).toMatch(/уровня 10/);
      expect(journey.focusOptions).toHaveLength(3);
      expect(journey.companion).toBe(true);
    }
  });

  it('специализация открывается на 10-м уровне, бесплатно меняет только один базовый стат и не накапливается', () => {
    expect(heroFocusOptions(rich().heroes[0], ctx).every((f) => !f.available)).toBe(true);
    expect(() => setHeroFocus(rich(), 'h1', 'guard', ctx)).toThrow(/уровне 10/);
    const save = levelUpHero(rich(), 'h1', ctx, 9).save;
    const hero = save.heroes.find((h) => h.id === 'h1')!;
    const base = heroStats(hero, ctx);
    const guard = setHeroFocus(save, 'h1', 'guard', ctx);
    const guarded = guard.heroes.find((h) => h.id === 'h1')!;
    expect(heroStats(guarded, ctx)).toEqual({ ...base, def: Math.round(base.def * 1.06) });
    expect(buildUnit(guarded, ctx).stats).toEqual(heroStats(guarded, ctx));
    const precise = setHeroFocus(guard, 'h1', 'precision', ctx);
    expect(heroStats(precise.heroes.find((h) => h.id === 'h1')!, ctx)).toEqual({ ...base, atk: Math.round(base.atk * 1.03) });
    expect(precise.resources).toEqual(save.resources);
    expect(precise.currency).toEqual(save.currency);
    expect(setHeroFocus(precise, 'h1', 'precision', ctx)).toBe(precise);
  });

  it('сброс сохраняет выучку; её боевой бонус снова требует текущий уровень', () => {
    const trained = setHeroFocus(levelUpHero(rich(), 'h1', ctx, 10).save, 'h1', 'resolve', ctx);
    const reset = resetHeroLevel(trained, 'h1', ctx).save;
    const hero = reset.heroes.find((h) => h.id === 'h1')!;
    expect(hero.journey?.focus).toBe('resolve');
    expect(heroFocusOptions(hero, ctx).every((f) => f.available)).toBe(true);
    expect(heroStats(hero, ctx)).toEqual(heroStats({ ...hero, journey: undefined }, ctx));
  });

  it('спутник сохраняет id при повышении; автоматический корм не забирает его или обученную копию', () => {
    // Пересмотр 10.10: зелёный → синий — герой + 1 любой зелёный, поэтому копия одна (было две).
    const original = addHeroCard(rich(), 'iris', 'green');
    const copy1 = addHeroCard(original.save, 'iris', 'green');
    // Пересмотр 18.10: спутника можно отдать только вручную — «Авто» для копии его не берёт.
    expect(ascendPlan(copy1.save, copy1.hero.id, ctx)!.complete).toBe(false);
    const plan = ascendPlan(copy1.save, original.hero.id, ctx)!;
    expect(plan.complete).toBe(true);
    expect(plan.fodder).toEqual([copy1.hero.id]);
    const ascended = ascendHero(copy1.save, original.hero.id, plan.fodder, ctx);
    expect(ascended.save.heroes.find((h) => h.templateId === 'iris')).toMatchObject({ id: original.hero.id, rarity: 'blue', companion: true });
    const trained = levelUpHero(copy1.save, copy1.hero.id, ctx, 2).save;
    expect(fodderBlocker(trained, copy1.hero.id, ctx)).toMatch(/обучен/);
    expect(ascendPlan(trained, original.hero.id, ctx)?.complete).toBe(false);
    const reset = resetHeroLevel(trained, copy1.hero.id, ctx).save;
    expect(ascendPlan(reset, original.hero.id, ctx)?.complete).toBe(true);
  });

  it('специализацию копии можно снять явно; путь сохраняется, а случайная трата до этого запрещена', () => {
    const copy = addHeroCard(rich(), 'alan', 'green');
    const focused = setHeroFocus(levelUpHero(copy.save, copy.hero.id, ctx, 9).save, copy.hero.id, 'guard', ctx);
    const reset = resetHeroLevel(focused, copy.hero.id, ctx).save;
    expect(fodderBlocker(reset, copy.hero.id, ctx)).toMatch(/специализацию/);
    const cleared = clearHeroFocus(reset, copy.hero.id);
    expect(cleared.heroes.find((h) => h.id === copy.hero.id)?.journey?.peakLevel).toBe(10);
    expect(fodderBlocker(cleared, copy.hero.id, ctx)).toBeNull();
    expect(cleared.resources).toEqual(reset.resources);
  });

  it('новая копия не наследует id и отношения уже использованной копии после перезапуска', () => {
    const one = addHeroCard(rich(), 'alan', 'green');
    const two = addHeroCard(one.save, 'alan', 'green');
    // Пересмотр 10.10: зелёный → синий — одна копия в корм; вторая остаётся в коллекции.
    const ascended = ascendHero(two.save, 'h1', [one.hero.id], ctx).save;
    const back = deserialize(serialize(ascended));
    const next = addHeroCard(back, 'alan', 'green');
    expect(next.hero.id).toBe('h6');
    expect([one.hero.id, two.hero.id]).not.toContain(next.hero.id);
    expect(next.save.heroSeq).toBe(6);
  });
});

describe('доверие, личные истории и испытания всех героев', () => {
  it('доверие за путь ограничено пятью вехами и не множится копиями, сбросами и повторными выборами', () => {
    const added = addHeroCard(rich(), 'kai', 'gold', { level: 50, granted: true });
    const save: SaveState = { ...added.save, heroes: added.save.heroes.map((h) => h.id === added.hero.id ? { ...h, branch: 'wizard' } : h) };
    expect(journeyTrustOf(save, 'kai', ctx)).toBe(5);
    expect(bondView(save, 'kai', ctx)).toMatchObject({ tavernPoints: 0, journeyPoints: 5, points: 5, scene: { open: true }, quest: { open: true } });
    const copies = addHeroCard(save, 'kai', 'gold', { level: 50, granted: true }).save;
    expect(journeyTrustOf(copies, 'kai', ctx)).toBe(5);
    const capped = { ...save, tavern: { bond: { kai: 9 } } };
    expect(bondView(capped, 'kai', ctx)?.points).toBe(10);
    const choice = chooseOption(save, 'c_bond_kai', 'admit', ctx);
    expect(choice.gains).toEqual({ kai: 2 });
    expect(chooseOption(choice.save, 'c_bond_kai', 'listen', ctx).save).toBe(choice.save);
  });

  it('невстреченные персонажи не создают спойлеров и отметок новых личных сцен', () => {
    const save = { ...rich(), tavern: { bond: { kai: 10 } } };
    expect(bondView(save, 'kai', ctx)?.scene.open).toBe(false);
    expect(bondView(save, 'kai', ctx)?.quest.open).toBe(false);
    expect(tavernNewCount(save, ctx)).toBe(0);
  });

  it('личные спикеры hero_<template> получают настоящее имя и форму только после встречи', () => {
    const added = addHeroCard(rich(), 'iris', 'green');
    const upgraded = addHeroCard(added.save, 'iris', 'purple', { level: 40 }).save;
    const save = { ...upgraded, heroes: upgraded.heroes.map((h) => h.id === upgraded.heroes.at(-1)!.id ? { ...h, branch: 'knight' } : h) };
    expect(speakerHero('hero_iris', rich(), ctx)).toBeUndefined();
    expect(speakerHero('hero_missing', save, ctx)).toBeUndefined();
    expect(speakerHero('hero_iris', save, ctx)?.id).toBe(save.heroes.at(-1)?.id);
    const story = { chapter: 'tavern', speakers: ctx.story.tavern!.speakers, scenes: [] };
    expect(speakerView(story, 'hero_iris', save, ctx)).toMatchObject({ name: 'Ирис', gender: 'f' });
  });

  it('личное испытание каждого нового героя проходимо сильным отрядом и выдаёт награду один раз', () => {
    for (const templateId of ['iris', 'kai', 'lira', 'meilin', 'otto', 'teo', 'zara']) {
      const add = addHeroCard(rich(), templateId, 'red', { level: 100, granted: true });
      let save: SaveState = { ...add.save, campaign: { cleared: ctx.content.stages.map((s) => s.id) }, tavern: { bond: { [templateId]: 5 } } };
      save = { ...save, heroes: save.heroes.map((h) => ({ ...h, level: 100, rarity: 'red', branch: ctx.content.heroes[h.templateId].branches[0].job })), squad: [save.heroes[0].id, save.heroes[1].id, save.heroes[2].id, add.hero.id, null] };
      const outcome = fightBondQuest(save, templateId, 17, ctx);
      expect(outcome.goal, templateId).toBe(true);
      expect(outcome.firstTime, templateId).toBe(true);
      const repeat = fightBondQuest(outcome.save, templateId, 17, ctx);
      expect(repeat.firstTime, templateId).toBe(false);
      expect(repeat.save.currency, templateId).toEqual(outcome.save.currency);
    }
  });

  it('сброс и смена профессии сохраняют открытые непрочитанные записи, но не снимают сюжетный замок', () => {
    const initial = rich();
    const save: SaveState = { ...initial, heroes: initial.heroes.map((h) => h.id === 'h1' ? { ...h, rarity: 'gold', level: 75, branch: 'knight' } : h), campaign: { cleared: ctx.content.stages.map((s) => s.id) } };
    const before = heroStoryPieces(save, 'alan', lore).filter((p) => p.open).map((p) => p.key);
    const reset = resetHeroLevel(save, 'h1', ctx).save;
    expect(heroStoryPieces(reset, 'alan', lore).filter((p) => p.open).map((p) => p.key)).toEqual(before);
    expect(heroStoryUnread(reset, 'alan', lore)).toBe(before.length);
    expect(reset.heroStoryRead).toBeUndefined();
    const switched = changeBranch(save, 'h1', 'crusader', ctx).save;
    expect(heroStoryPieces(switched, 'alan', lore).find((p) => p.key === 'knight:70')).toMatchObject({ open: true, read: false });
    const early = { ...reset, campaign: { cleared: [] } };
    expect(heroStoryPieces(early, 'alan', lore).some((p) => p.unlockAfterStage && p.open)).toBe(false);
  });

  it('освоенная ветеранская профессия остаётся после сброса, новая ветка не наследует её пик', () => {
    const initial = rich();
    const save: SaveState = { ...initial, heroes: initial.heroes.map((h) => h.id === 'h1' ? { ...h, rarity: 'gold', level: 75, branch: 'knight' } : h) };
    const t = ctx.content.heroes.alan;
    const veteran = activeForm(t, save.heroes.find((h) => h.id === 'h1')!);
    expect(veteran.advanced).toBe(true);
    const reset = resetHeroLevel(save, 'h1', ctx).save;
    const hero = reset.heroes.find((h) => h.id === 'h1')!;
    expect(activeForm(t, hero)).toMatchObject({ job: veteran.job, sprite: veteran.sprite, ult: veteran.ult, advanced: true });
    expect(heroSkillList(hero, ctx).filter((s) => s.level > hero.level).every((s) => !s.unlocked)).toBe(true);
    expect(heroStats(hero, ctx).hp).toBeLessThan(heroStats(save.heroes.find((h) => h.id === 'h1')!, ctx).hp);
    const changed = changeBranch(reset, 'h1', 'crusader', ctx).save.heroes.find((h) => h.id === 'h1')!;
    expect(activeForm(t, changed)).toMatchObject({ job: 'crusader' });
    expect(activeForm(t, changed).advanced).toBeUndefined();
    expect(changed.journey?.branchLevels).toMatchObject({ knight: 75, crusader: 1 });
    const noEarnedRare = { ...hero, rarity: 'purple' as const };
    expect(activeForm(t, noEarnedRare).advanced).toBeUndefined();
  });
});
