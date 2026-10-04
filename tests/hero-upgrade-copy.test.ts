import { describe, expect, it } from 'vitest';
import {
  activeForm, addHeroCard, ascendHero, branchChangeCost, branchStatus, buildUnit, changeBranch, chooseBranch, clearHeroFocus, deserialize, equip, HeroError,
  heroCard,
  heroCopyUpgradeInfo, heroCopyUpgradeOptions, heroResetInfo, levelUpHero, newGame, resetHeroLevel,
  sanitizeSave, serialize, setHeroFocus, setHeroLocked, squadPower, unequip, upgradeHeroFromCopy,
  withGear, type CardRarity, type HeroErrorCode, type SaveState,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();

function setup(rarity: CardRarity = 'purple', grantedLevel = 1): { save: SaveState; copyId: string } {
  const initial: SaveState = { ...newGame(ctx, 1000), resources: { gold: 20_000_000, heroExp: 20_000_000 } };
  const added = addHeroCard(initial, 'alan', rarity, { level: grantedLevel, granted: grantedLevel > 1 });
  return { save: added.save, copyId: added.hero.id };
}

function withExpedition(save: SaveState, heroId: string): SaveState {
  return { ...save, bounties: { ...save.bounties, active: [{
    location: 'road', hours: 2, heroIds: [heroId], power: 100, startedAt: 1, endsAt: 100,
    rewards: { gold: 1, jobExp: 1, gems: 0, heroCards: { blue: 0, purple: 0 }, scrolls: 0, items: [] },
  }] } };
}

function expectBlocked(save: SaveState, copyId: string, code: HeroErrorCode, reason: RegExp): void {
  const original = structuredClone(save);
  expect(heroCopyUpgradeInfo(save, 'h1', copyId, ctx)).toMatchObject({ canUpgrade: false, blocker: expect.stringMatching(reason) });
  try {
    upgradeHeroFromCopy(save, 'h1', copyId, ctx);
    throw new Error('Защищённая копия была использована');
  } catch (error) {
    expect(error).toBeInstanceOf(HeroError);
    expect((error as HeroError).code).toBe(code);
  }
  expect(save).toEqual(original);
}

describe('более редкая копия развивает выбранного героя без замены его личности', () => {
  it('меняет только редкости; сохраняет оплаченные уровни, подарки, историю, замок, строй и пресет цели', () => {
    const start = setup('gold', 4);
    let save = setHeroFocus(levelUpHero(start.save, 'h1', ctx, 9).save, 'h1', 'guard', ctx);
    save = chooseBranch(save, start.copyId, 'crusader', ctx).save;
    save = levelUpHero(save, start.copyId, ctx, 71).save;
    save = resetHeroLevel(save, start.copyId, ctx).save;
    save = setHeroLocked(save, 'h1', true);
    save = { ...save, presets: [{ id: 'main', name: 'Основной', squad: [...save.squad] }], inventory: { items: [{ id: 'it1', itemId: 'sword', equippedBy: 'h1', refine: 3, locked: true }] } };
    const original = structuredClone(save);
    const target = save.heroes.find((h) => h.id === 'h1')!;
    const copy = save.heroes.find((h) => h.id === start.copyId)!;
    const upgraded = upgradeHeroFromCopy(save, 'h1', start.copyId, ctx);
    expect(upgraded.save.heroes.find((h) => h.id === 'h1')).toEqual({ ...target, rarity: 'gold' });
    const afterCopy = upgraded.save.heroes.find((h) => h.id === start.copyId)!;
    expect(afterCopy).toMatchObject({ id: start.copyId, level: 4, grantedLevel: 4, rarity: 'green', training: { exp: 0, gold: 0 }, journey: { peakLevel: 75, branchLevels: { crusader: 75 } } });
    expect(afterCopy.branch).toBeUndefined();
    expect(activeForm(ctx.content.heroes.alan, upgraded.save.heroes[0]).advanced).toBeUndefined();
    expect(upgraded.save.heroes.map((h) => h.id)).toEqual(save.heroes.map((h) => h.id));
    expect(upgraded.save.heroes.map((h) => h.rarity).sort()).toEqual(save.heroes.map((h) => h.rarity).sort());
    expect(upgraded.save.resources).toBe(save.resources);
    expect(upgraded.save.currency).toBe(save.currency);
    expect(upgraded.save.inventory).toBe(save.inventory);
    expect(upgraded.save.squad).toBe(save.squad);
    expect(upgraded.save.presets).toBe(save.presets);
    expect(upgraded.save.heroSeq).toBe(save.heroSeq);
    expect(heroResetInfo(upgraded.save, 'h1', ctx).refund).toEqual(heroResetInfo(save, 'h1', ctx).refund);
    expect(afterCopy.journey).toEqual(copy.journey);
    expect(save).toEqual(original);
    const reloaded = sanitizeSave(deserialize(serialize(upgraded.save)), ctx);
    expect(reloaded.warnings).toEqual([]);
    expect(reloaded.save.heroes).toEqual(upgraded.save.heroes);
    expectBlocked(upgraded.save, start.copyId, 'bad_fodder', /более высокой редкостью/);
  });

  it('сохраняет выбранную ветку цели и не присваивает ей ветерана другой копии', () => {
    let save = setup('gold').save;
    const own = addHeroCard(save, 'iris', 'purple');
    const rare = addHeroCard(own.save, 'iris', 'gold');
    save = chooseBranch(rare.save, own.hero.id, 'knight', ctx).save;
    save = chooseBranch(save, rare.hero.id, 'crusader', ctx).save;
    save = resetHeroLevel(levelUpHero(save, rare.hero.id, ctx, 74).save, rare.hero.id, ctx).save;
    const target = save.heroes.find((h) => h.id === own.hero.id)!;
    const donor = save.heroes.find((h) => h.id === rare.hero.id)!;
    const result = upgradeHeroFromCopy(save, own.hero.id, rare.hero.id, ctx);
    expect(result.save.heroes.find((h) => h.id === own.hero.id)).toEqual({ ...target, rarity: 'gold' });
    expect(result.save.heroes.find((h) => h.id === rare.hero.id)).toEqual({ ...donor, rarity: 'purple' });
    expect(activeForm(ctx.content.heroes.iris, result.save.heroes.find((h) => h.id === own.hero.id)!).job).toBe('knight');
  });

  it('возвращает несовместимую вещь донора целиком; предварительный расчёт сообщает именно этот экземпляр', () => {
    const start = setup();
    const context = { ...ctx, equipment: { ...ctx.equipment, items: { ...ctx.equipment.items, crusader_token: { ...ctx.equipment.items.sword, id: 'crusader_token', jobs: ['crusader'] } } } };
    let save = chooseBranch(start.save, start.copyId, 'crusader', context).save;
    save = { ...save, inventory: { items: [
      { id: 'it1', itemId: 'sword', equippedBy: 'h1', refine: 4 },
      { id: 'it2', itemId: 'crusader_token', equippedBy: start.copyId, refine: 7, card: 'baphomet_card', locked: true },
    ] } };
    expect(heroCopyUpgradeInfo(save, 'h1', start.copyId, context).unequipped).toEqual(['it2']);
    const result = upgradeHeroFromCopy(save, 'h1', start.copyId, context);
    expect(result.unequipped).toEqual(['it2']);
    expect(result.save.inventory.items).toEqual([save.inventory.items[0], { ...save.inventory.items[1], equippedBy: null }]);
  });

  it('после явного возврата, переноса и реинвестирования сохраняет ресурсы и силу прежней развитой копии', () => {
    const start = setup();
    let save = chooseBranch(start.save, start.copyId, 'knight', ctx).save;
    save = setHeroFocus(levelUpHero(save, start.copyId, ctx, 24).save, start.copyId, 'precision', ctx);
    save = { ...save, squad: save.squad.map((id) => id === 'h1' ? start.copyId : id), inventory: { items: [{ id: 'it1', itemId: 'sword', equippedBy: start.copyId, refine: 5 }] } };
    const original = save;
    const oldUnit = buildUnit(save.heroes.find((h) => h.id === start.copyId)!, withGear(ctx, save));
    save = { ...save, squad: save.squad.map((id) => id === start.copyId ? null : id) };
    save = clearHeroFocus(resetHeroLevel(save, start.copyId, ctx).save, start.copyId);
    save = upgradeHeroFromCopy(save, 'h1', start.copyId, ctx).save;
    save = chooseBranch(save, 'h1', 'knight', ctx).save;
    save = setHeroFocus(levelUpHero(save, 'h1', ctx, 24).save, 'h1', 'precision', ctx);
    save = equip(unequip(save, 'it1'), 'h1', 'it1', ctx);
    save = { ...save, squad: original.squad.map((id) => id === start.copyId ? 'h1' : id) };
    expect(save.resources).toEqual(original.resources);
    expect(save.currency).toEqual(original.currency);
    expect(save.heroes.map((h) => h.rarity).sort()).toEqual(original.heroes.map((h) => h.rarity).sort());
    const unit = buildUnit(save.heroes.find((h) => h.id === 'h1')!, withGear(ctx, save));
    expect(unit.stats).toEqual(oldUnit.stats);
    expect(unit.skills).toEqual(oldUnit.skills);
    expect(unit.skills.ult).toEqual(oldUnit.skills.ult);
    expect(squadPower(save, ctx)).toBe(squadPower(original, ctx));
  });
});

describe('защита копии и правдивый предварительный расчёт переноса', () => {
  it.each([
    ['спутник', /спутник/, (s: SaveState, id: string) => ({ ...s, heroes: s.heroes.map((h) => h.id === id ? { ...h, companion: true } : h) })],
    ['замок', /закреплён/, (s: SaveState, id: string) => setHeroLocked(s, id, true)],
    ['отряд', /стоит в отряде/, (s: SaveState, id: string) => ({ ...s, squad: s.squad.map((h) => h === 'h1' ? id : h) })],
    ['пресет', /есть в пресете/, (s: SaveState, id: string) => ({ ...s, presets: [{ id: 'reserve', name: 'Резерв', squad: [id, null, null, null, null] }] })],
    ['экспедиция', /в экспедиции/, withExpedition],
    ['оплаченная тренировка', /верните вложенные ресурсы/, (s: SaveState, id: string) => levelUpHero(s, id, ctx, 1).save],
    ['специализация', /специализацию/, (s: SaveState, id: string) => resetHeroLevel(setHeroFocus(levelUpHero(s, id, ctx, 9).save, id, 'resolve', ctx), id, ctx).save],
  ] as const)('%s копии требует отдельного осознанного действия', (_label, reason, protect) => {
    const start = setup();
    expectBlocked(protect(start.save, start.copyId), start.copyId, 'fodder_busy', reason);
  });

  it('нельзя менять редкость героя в экспедиции', () => {
    const start = setup();
    expectBlocked(withExpedition(start.save, 'h1'), start.copyId, 'hero_busy', /в экспедиции/);
  });

  it('подаренный уровень копии выше новой границы не урезается и не превращается в оплату', () => {
    const start = setup('purple', 25);
    expect(heroResetInfo(start.save, start.copyId, ctx).canReset).toBe(false);
    expectBlocked(start.save, start.copyId, 'bad_fodder', /подаренные уровни нельзя уменьшить/);
  });

  it('нельзя передать другую карточку, себя или не более высокую редкость', () => {
    const start = setup('green');
    expectBlocked(start.save, start.copyId, 'bad_fodder', /другая копия этого героя/);
    expectBlocked(start.save, 'h1', 'bad_fodder', /другая копия этого героя/);
    expectBlocked(start.save, 'h2', 'bad_fodder', /другая копия этого героя/);
  });

  it('показывает занятые сильные копии, но действие заново проверяет даже ранее доступный выбор', () => {
    const first = setup('purple');
    const second = addHeroCard(first.save, 'alan', 'gold');
    const locked = setHeroLocked(second.save, second.hero.id, true);
    const options = heroCopyUpgradeOptions(locked, 'h1', ctx);
    expect(options.map((o) => [o.heroId, o.canUpgrade])).toEqual([[first.copyId, true], [second.hero.id, false]]);
    expect(options[1].blocker).toMatch(/закреплён/);
    expectBlocked(setHeroLocked(locked, first.copyId, true), first.copyId, 'fodder_busy', /закреплён/);
  });
});

describe('личная память профессии закрывает бесплатное переобучение через обмен копиями', () => {
  function twoCopiesWithPaidBranchChanges() {
    const first = setup();
    const second = addHeroCard(first.save, 'alan', 'blue');
    let save: SaveState = { ...second.save, currency: { ...second.save.currency, gems: 1000 } };
    save = chooseBranch(save, first.copyId, 'knight', ctx).save;
    save = changeBranch(save, first.copyId, 'crusader', ctx).save;
    save = changeBranch(save, first.copyId, 'knight', ctx).save;
    expect(save.currency.gems).toBe(700);
    expect(branchChangeCost(save.heroes.find((h) => h.id === first.copyId)!, ctx)).toBe(300);
    return { save, firstId: first.copyId, secondId: second.hero.id };
  }

  it('после двух обменов, reload и sanitize возвращается своя ветка с прежней ценой смены', () => {
    const initial = twoCopiesWithPaidBranchChanges();
    let save = upgradeHeroFromCopy(initial.save, initial.secondId, initial.firstId, ctx).save;
    save = sanitizeSave(deserialize(serialize(save)), ctx).save;
    const benched = save.heroes.find((h) => h.id === initial.firstId)!;
    expect(benched).toMatchObject({ rarity: 'blue', journey: { lastBranch: 'knight' }, branchChanges: 2 });
    expect(benched.branch).toBeUndefined();
    expect(heroCard(benched, ctx).job).toBe('swordman');
    expect(branchStatus(save, initial.firstId, ctx)).toMatchObject({ canChoose: false, canChange: false });
    expect(heroCopyUpgradeInfo(save, initial.firstId, initial.secondId, ctx).targetBranch).toBe('knight');
    save = upgradeHeroFromCopy(save, initial.firstId, initial.secondId, ctx).save;
    save = sanitizeSave(deserialize(serialize(save)), ctx).save;
    expect(save.heroes.find((h) => h.id === initial.firstId)).toMatchObject({ rarity: 'purple', branch: 'knight', branchChanges: 2 });
    expect(() => chooseBranch(save, initial.firstId, 'crusader', ctx)).toThrow(/ветка уже выбрана/);
    const switched = changeBranch(save, initial.firstId, 'crusader', ctx);
    expect(switched.gems).toBe(300);
    expect(switched.save.currency.gems).toBe(400);
    expect(switched.save.heroes.find((h) => h.id === initial.firstId)).toMatchObject({ branchChanges: 3, journey: { lastBranch: 'crusader' } });
  });

  it('обычное вознесение тоже восстанавливает путь, даже если передан другой бесплатный выбор', () => {
    const initial = twoCopiesWithPaidBranchChanges();
    let save = upgradeHeroFromCopy(initial.save, initial.secondId, initial.firstId, ctx).save;
    save = sanitizeSave(deserialize(serialize(save)), ctx).save;
    const one = addHeroCard(save, 'alan', 'blue');
    const two = addHeroCard(one.save, 'alan', 'blue');
    const ascended = ascendHero(two.save, initial.firstId, [one.hero.id, two.hero.id], ctx, { branch: 'crusader' });
    save = sanitizeSave(deserialize(serialize(ascended.save)), ctx).save;
    expect(save.heroes.find((h) => h.id === initial.firstId)).toMatchObject({ rarity: 'purple', branch: 'knight', branchChanges: 2, journey: { lastBranch: 'knight' } });
    expect(() => chooseBranch(save, initial.firstId, 'crusader', ctx)).toThrow(/ветка уже выбрана/);
    expect(changeBranch(save, initial.firstId, 'crusader', ctx).gems).toBe(300);
  });

  it('неизвестная или чужая память профессии очищается, а собственные вехи остаются', () => {
    const initial = setup();
    const saved: SaveState = { ...initial.save, heroes: initial.save.heroes.map((h) => h.id === 'h1' ? { ...h, journey: { peakLevel: 20, branchLevels: { knight: 20 }, lastBranch: 'wizard' } } : h) };
    const back = sanitizeSave(deserialize(serialize(saved)), ctx);
    expect(back.warnings).toContain('Алан: неизвестные профессии в личной истории удалены.');
    expect(back.save.heroes[0].journey).toEqual({ peakLevel: 20, branchLevels: { knight: 20 } });
    expect(heroCopyUpgradeInfo(back.save, 'h1', initial.copyId, ctx).targetBranch).toBeUndefined();
  });

  it('сохранённая собственная ветка восстанавливается и при загрузке фиолетового героя без активной branch', () => {
    const initial = setup();
    const remembered: SaveState = { ...initial.save, heroes: initial.save.heroes.map((h) => h.id === initial.copyId ? { ...h, journey: { lastBranch: 'knight', branchLevels: { knight: 30 } }, branchChanges: 2 } : h) };
    expect(() => chooseBranch(remembered, initial.copyId, 'crusader', ctx)).toThrow(/ветка уже выбрана/);
    const back = sanitizeSave(deserialize(serialize(remembered)), ctx);
    expect(back.warnings).toEqual([]);
    expect(back.save.heroes.find((h) => h.id === initial.copyId)).toMatchObject({ branch: 'knight', branchChanges: 2 });
    expect(branchStatus(back.save, initial.copyId, ctx)).toMatchObject({ branch: 'knight', canChoose: false, canChange: true, changeCost: 300 });
  });
});
