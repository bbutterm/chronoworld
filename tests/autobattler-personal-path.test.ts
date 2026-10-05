import { describe, expect, it } from 'vitest';
import { loadFullContext } from '../scripts/lib/content-node';
import { newGame, type HeroState } from '../src/core';
import { autobattlerBattle, autobattlerConfig, autobattlerHeroState, buyAutobattlerOffer, sellAutobattlerHero, setAutobattlerBranch, setAutobattlerSquad, startAutobattlerRun, trainAutobattlerRun, type AutobattlerSave } from '../src/core/autobattler';

const ctx = loadFullContext();
const cfg = autobattlerConfig(ctx);
const DAY = '2026-10-05';
const runOf = (save: AutobattlerSave) => save.autobattler!.run!;

function player(): AutobattlerSave {
  const save = newGame(ctx, 1001, DAY);
  return { ...save, campaign: { ...save.campaign, cleared: [cfg.unlockAfterStage!] } };
}

function withBran(companion: Partial<HeroState>, copies: HeroState[] = []): AutobattlerSave {
  const save = player();
  return { ...save, heroes: [...copies, ...save.heroes.map(h => h.templateId === 'bran' ? { ...h, companion: true, ...companion } : h)] };
}

const spareBran = (branch: string, level = 60): HeroState => ({ id: `spare_${branch}`, templateId: 'bran', rarity: 'purple', level, branch });
const start = (save: AutobattlerSave) => startAutobattlerRun(save, DAY, ctx);

/** Preparation fixtures supply match coins only; campaign resources remain unchanged. */
function prepared(branches: Record<string, string> = {}, training = 2): AutobattlerSave {
  const save = player();
  for (const [templateId, branch] of Object.entries(branches)) {
    const own = save.heroes.find(h => h.templateId === templateId);
    if (own) Object.assign(own, { branch, rarity: 'purple', level: 47, companion: true });
    else save.heroes.push({ id: `campaign_${templateId}`, templateId, rarity: 'purple', level: 47, branch, companion: true });
  }
  let arena = start(save);
  arena = { ...arena, autobattler: { ...arena.autobattler!, run: { ...runOf(arena), gold: 100 } } };
  for (let i = 0; i < training; i++) arena = trainAutobattlerRun(arena, ctx);
  return arena;
}

function buy(save: AutobattlerSave, templateId: string): AutobattlerSave {
  const offer = { ...save, autobattler: { ...save.autobattler!, run: { ...runOf(save), shop: [templateId, null, null] } } };
  return buyAutobattlerOffer(offer, 0, ctx);
}

describe('Arena imports the personal profession, without importing campaign power', () => {
  it('keeps a lower-level companion path even when a stronger spare occurs first', () => {
    const save = withBran({ rarity: 'purple', level: 1, branch: 'bard' }, [spareBran('hunter')]);
    const snapshot = JSON.stringify(save);
    const arena = start(save);
    expect(runOf(arena).branchChoices.bran).toBe('bard');
    expect(runOf(arena).heroes.find(h => h.templateId === 'bran')!.branch).toBe('bard');
    expect(JSON.stringify(save)).toBe(snapshot);
    expect(arena.heroes).toBe(save.heroes);
    expect(arena.resources).toBe(save.resources);
  });

  it.each(['green', 'blue'] as const)('remembers an inactive %s companion path, activating it only at purple preparation', rarity => {
    const save = withBran({ rarity, level: 1, branch: undefined, journey: { lastBranch: 'bard', peakLevel: 60, branchLevels: { bard: 60 } } }, [spareBran('hunter')]);
    let arena = start(save);
    const bran = runOf(arena).heroes.find(h => h.templateId === 'bran')!;
    expect(runOf(arena).branchChoices.bran).toBe('bard');
    expect(autobattlerHeroState(bran, runOf(arena), ctx)).toEqual({ id: bran.id, templateId: 'bran', rarity: 'blue', level: 35, branch: 'bard' });
    expect(autobattlerBattle(arena, ctx).squad.find(u => u?.id === bran.id)!.role).toBe('damage');
    arena = { ...arena, autobattler: { ...arena.autobattler!, run: { ...runOf(arena), gold: 30 } } };
    arena = trainAutobattlerRun(arena, ctx);
    expect(autobattlerBattle(arena, ctx).squad.find(u => u?.id === bran.id)!.role).toBe('damage');
    arena = trainAutobattlerRun(arena, ctx);
    expect(autobattlerBattle(arena, ctx).squad.find(u => u?.id === bran.id)!.role).toBe('support');
  });

  it('a valid current personal branch wins over older personal memory', () => {
    const arena = start(withBran({ branch: 'hunter', journey: { lastBranch: 'bard' } }, [spareBran('bard')]));
    expect(runOf(arena).branchChoices.bran).toBe('hunter');
  });

  it('ignores a foreign current branch but restores valid personal memory', () => {
    const arena = start(withBran({ branch: 'wizard', journey: { lastBranch: 'bard' } }, [spareBran('hunter')]));
    expect(runOf(arena).branchChoices.bran).toBe('bard');
  });

  it.each([
    { branch: 'wizard' },
    { journey: { lastBranch: 'dancer' } },
    { branch: 'missing', journey: { lastBranch: 'wizard' } },
    {},
  ])('without a valid personal path retains the strongest valid copy fallback: %j', personal => {
    const arena = start(withBran({ branch: undefined, ...personal }, [spareBran('hunter', 50), spareBran('wizard', 100), spareBran('bard', 60)]));
    expect(runOf(arena).branchChoices.bran).toBe('bard');
  });

  it('legacy saves without a companion retain stable level and tie ordering', () => {
    const save = withBran({ companion: undefined, branch: undefined }, [spareBran('bard'), spareBran('hunter')]);
    expect(runOf(start(save)).branchChoices.bran).toBe('bard');
    save.heroes.find(h => h.id === 'spare_hunter')!.level = 61;
    expect(runOf(start(save)).branchChoices.bran).toBe('hunter');
    const old = player();
    expect(runOf(start(old)).branchChoices.bran).toBe(ctx.content.heroes.bran.branches[0].job);
  });

  it('remembered veteran levels, focus, rarity, gear and currencies never boost the normalized start', () => {
    const ordinary = withBran({ rarity: 'blue', branch: undefined, journey: { lastBranch: 'bard' } }, [spareBran('hunter')]);
    const rich: AutobattlerSave = {
      ...ordinary,
      resources: { gold: 1e9, heroExp: 1e9 },
      currency: { ...ordinary.currency, gems: 1e9 },
      heroes: ordinary.heroes.map(h => h.companion && h.templateId === 'bran' ? { ...h, rarity: 'red', level: 100, branch: 'bard', journey: { lastBranch: 'bard', branchLevels: { bard: 100 }, peakLevel: 100, focus: 'precision' } } : h),
      inventory: { ...ordinary.inventory, items: [{ id: 'campaign_gear', itemId: Object.keys(ctx.equipment.items)[0], equippedBy: ordinary.heroes.find(h => h.templateId === 'bran' && h.companion)!.id, refine: 10 }] },
    };
    const arena = start(rich);
    expect(autobattlerBattle(arena, ctx)).toEqual(autobattlerBattle(start(ordinary), ctx));
    expect(runOf(arena).branchChoices.bran).toBe('bard');
    expect(arena.heroes).toBe(rich.heroes);
    expect(arena.inventory).toBe(rich.inventory);
    expect(arena.resources).toBe(rich.resources);
    expect(arena.currency).toBe(rich.currency);
  });
});

describe('Arena places only newly active cards, using their actual normalized form', () => {
  it('the start uses blue base roles, even when the campaign Vika is a red monk', () => {
    const save = player();
    Object.assign(save.heroes.find(h => h.templateId === 'vika')!, { branch: 'monk', rarity: 'red', level: 100 });
    const arena = start(save);
    const vika = runOf(arena).heroes.find(h => h.templateId === 'vika')!;
    expect(runOf(arena).squad.indexOf(vika.id)).toBe(2);
    expect(autobattlerBattle(arena, ctx).squad[2]!.role).toBe('healer');
  });

  it('training III places a reserve monk at the free front slot using the new training index', () => {
    let arena = prepared({ vika: 'monk' }, 1);
    const before = runOf(arena);
    const vika = before.heroes.find(h => h.templateId === 'vika')!;
    arena = setAutobattlerSquad(arena, before.squad.map(id => id === vika.id ? null : id), ctx);
    const source = arena;
    const snapshot = JSON.stringify(source);
    const after = trainAutobattlerRun(source, ctx);
    expect(runOf(after).squad.indexOf(vika.id)).toBe(1);
    expect(autobattlerBattle(after, ctx).squad[1]!.role).toBe('tank');
    expect(runOf(after).squad[0]).toBe(before.squad[0]);
    expect(runOf(after).squad[3]).toBe(before.squad[3]);
    expect(runOf(after).heroes).toBe(before.heroes);
    expect(after.heroes).toBe(source.heroes);
    expect(after.squad).toBe(source.squad);
    expect(after.resources).toBe(source.resources);
    expect(after.currency).toBe(source.currency);
    expect(JSON.stringify(source)).toBe(snapshot);
    expect(runOf(after).gold).toBe(runOf(source).gold - cfg.training[2].cost);
  });

  it('a newly bought priest stays behind when a front slot is also free', () => {
    const arena = prepared({ vika: 'priest' });
    const vika = runOf(arena).heroes.find(h => h.templateId === 'vika')!;
    const sold = sellAutobattlerHero(arena, vika.id, ctx);
    const after = buy(sold, 'vika');
    expect(runOf(after).squad.indexOf(vika.id)).toBe(2);
    expect(runOf(after).squad[1]).toBeNull();
    expect(autobattlerBattle(after, ctx).squad[2]!.role).toBe('healer');
  });

  it('a newly bought damage monk uses its melee front role instead of the base support role', () => {
    const arena = prepared({ teo: 'monk' });
    const after = buy(arena, 'teo');
    const teo = runOf(after).heroes.find(h => h.templateId === 'teo')!;
    const unit = autobattlerBattle(after, ctx).squad[1]!;
    expect(runOf(after).squad.indexOf(teo.id)).toBe(1);
    expect(unit.role).toBe('damage');
    expect(ctx.content.skills[unit.skills.basic].range).toBe('melee');
    expect(after.heroes).toBe(arena.heroes);
    expect(after.resources).toBe(arena.resources);
    expect(runOf(after).gold).toBe(runOf(arena).gold - cfg.heroCost);
    expect(teo).toEqual({ id: `ab_${runOf(arena).id}_teo`, templateId: 'teo', branch: 'monk', copies: 1, paidCopies: 1 });
  });

  it('a ranged alchemist uses the rear instead of its base tank role', () => {
    const after = buy(prepared({ otto: 'alchemist' }), 'otto');
    const otto = runOf(after).heroes.find(h => h.templateId === 'otto')!;
    const unit = autobattlerBattle(after, ctx).squad[4]!;
    expect(runOf(after).squad.indexOf(otto.id)).toBe(4);
    expect(runOf(after).squad[1]).toBeNull();
    expect(unit.role).toBe('damage');
    expect(ctx.content.skills[unit.skills.basic].range).toBe('ranged');
  });

  it('when the front is full a new melee card uses a rear vacancy without moving existing cards', () => {
    let arena = prepared({ teo: 'monk' });
    const original = runOf(arena).squad;
    arena = setAutobattlerSquad(arena, [original[0], original[2], null, original[3], null], ctx);
    const before = [...runOf(arena).squad];
    const after = buy(arena, 'teo');
    const teo = runOf(after).heroes.find(h => h.templateId === 'teo')!;
    expect(runOf(after).squad.indexOf(teo.id)).toBe(2);
    expect(runOf(after).squad[0]).toBe(before[0]);
    expect(runOf(after).squad[1]).toBe(before[1]);
    expect(runOf(after).squad[3]).toBe(before[3]);
  });

  it('when the rear is full a ranged card uses a front vacancy without moving existing cards', () => {
    let arena = prepared({ otto: 'alchemist' });
    const original = runOf(arena).squad;
    arena = setAutobattlerSquad(arena, [null, null, original[0], original[2], original[3]], ctx);
    const before = [...runOf(arena).squad];
    const after = buy(arena, 'otto');
    const otto = runOf(after).heroes.find(h => h.templateId === 'otto')!;
    expect(runOf(after).squad.indexOf(otto.id)).toBe(0);
    expect(runOf(after).squad.slice(2)).toEqual(before.slice(2));
  });

  it('a full preparation capacity keeps a newly bought card in reserve', () => {
    const arena = prepared({ teo: 'monk' }, 0);
    const after = buy(arena, 'teo');
    expect(runOf(after).squad).toEqual(runOf(arena).squad);
    expect(runOf(after).heroes.some(h => h.templateId === 'teo')).toBe(true);
  });

  it('a manually placed rear monk stays there through preparation and branch changes', () => {
    let arena = prepared({}, 1);
    const vika = runOf(arena).heroes.find(h => h.templateId === 'vika')!;
    const original = runOf(arena).squad;
    arena = setAutobattlerSquad(arena, [original[0], null, null, original[3], vika.id], ctx);
    arena = setAutobattlerBranch(arena, vika.id, 'monk', ctx);
    const manual = [...runOf(arena).squad];
    arena = trainAutobattlerRun(arena, ctx);
    expect(runOf(arena).squad).toEqual(manual);
    expect(autobattlerBattle(arena, ctx).squad[4]!.role).toBe('tank');
    expect(runOf(setAutobattlerBranch(arena, vika.id, 'priest', ctx)).squad).toEqual(manual);
  });
});
