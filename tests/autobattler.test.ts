import { describe, expect, it } from 'vitest';
import data from '../data/autobattler.json';
import { loadFullContext } from '../scripts/lib/content-node';
import { newGame } from '../src/core';
import { abandonAutobattlerRun, autobattlerBattle, autobattlerConfig, autobattlerHeroState, autobattlerRoundSeed, autobattlerSaleValue, autobattlerStars, AutobattlerError, AutobattlerSaveSchema, buyAutobattlerOffer, fightAutobattlerRound, parseAutobattlerConfig, rerollAutobattlerShop, sanitizeAutobattlerSave, sellAutobattlerHero, setAutobattlerBranch, setAutobattlerSquad, startAutobattlerRun, trainAutobattlerRun, validateAutobattlerConfig, type AutobattlerContext, type AutobattlerSave } from '../src/core/autobattler';

const base = loadFullContext();
const ctx: AutobattlerContext = { ...base, autobattler: parseAutobattlerConfig(data) };
const cfg = autobattlerConfig(ctx);
const DAY = '2026-10-04';
const easy: AutobattlerContext = { ...ctx, autobattler: { ...cfg, difficulty: cfg.difficulty.map((r) => ({ ...r, level: 1, mult: 0.1 })) } };
const hard: AutobattlerContext = { ...ctx, autobattler: { ...cfg, difficulty: cfg.difficulty.map((r) => ({ ...r, count: 5, level: 65, mult: 2 })) } };

function player(seed = 1): AutobattlerSave {
  const s = newGame(base, 1000 + seed, DAY);
  return { ...s, campaign: { ...s.campaign, cleared: [cfg.unlockAfterStage!] } };
}
const start = (seed = 1, c = ctx) => startAutobattlerRun(player(seed), DAY, c);
const runOf = (s: AutobattlerSave) => s.autobattler!.run!;
const code = (fn: () => unknown, expected: AutobattlerError['code']) => {
  try { fn(); } catch (e) { expect(e).toBeInstanceOf(AutobattlerError); expect((e as AutobattlerError).code).toBe(expected); return; }
  throw new Error(`Expected ${expected}`);
};

function finish(s: AutobattlerSave, c = easy, max = cfg.rounds) {
  let last;
  for (let i = 0; i < max && s.autobattler?.run; i++) { last = fightAutobattlerRound(s, DAY, c); s = last.save; }
  return { save: s, outcome: last! };
}

describe('Арена товарищей: контент и независимый матч', () => {
  it('validates every template, branch, stage and synergy; rejects malformed tuning', () => {
    const problems: string[] = [];
    validateAutobattlerConfig(cfg, ctx, problems);
    expect(problems).toEqual([]);
    expect(() => parseAutobattlerConfig({ ...data, difficulty: [] })).toThrow(/раунда/);
    expect(() => parseAutobattlerConfig({ ...data, training: [{ cost: 1, level: 35, capacity: 3, rarity: 'blue' }, data.training[1]] })).toThrow(/бесплатна/);
    const broken = { ...cfg, opponents: [{ ...cfg.opponents[0], branches: { alan: 'wizard' } }, ...cfg.opponents.slice(1)] };
    validateAutobattlerConfig(broken, ctx, problems);
    expect(problems.some((p) => p.includes('alan/wizard'))).toBe(true);
  });

  it('does not start before unlock, without data or twice, but old save starts a full playable team', () => {
    code(() => startAutobattlerRun(newGame(base, 123, DAY), DAY, ctx), 'locked');
    code(() => startAutobattlerRun(player(), DAY, { ...base, autobattler: undefined }), 'disabled');
    const s = start();
    expect(runOf(s).squad.filter(Boolean)).toHaveLength(3);
    expect(runOf(s).heroes.map((h) => h.templateId)).toEqual(cfg.startingTeam);
    expect(runOf(s).heroes.every((h) => h.paidCopies === 0)).toBe(true);
    code(() => startAutobattlerRun(s, DAY, ctx), 'run_active');
    expect(s.heroes).toEqual(player().heroes);
    expect(s.resources).toEqual(player().resources);
  });

  it('campaign level, rarity, gear and resources cannot buy normalized combat strength', () => {
    const ordinary = start();
    const p = player();
    const rich = startAutobattlerRun({ ...p, resources: { gold: 1e9, heroExp: 1e9 }, currency: { ...p.currency, gems: 1e9 }, heroes: p.heroes.map((h) => ({ ...h, level: 100, rarity: 'red' })), inventory: { items: [{ id: 'item1', itemId: Object.keys(base.equipment.items)[0], equippedBy: p.heroes[0].id, refine: 10 }] } }, DAY, ctx);
    expect(autobattlerBattle(rich, ctx)).toEqual(autobattlerBattle(ordinary, ctx));
    const normalized = autobattlerHeroState(runOf(rich).heroes[0], runOf(rich), ctx);
    expect(normalized.level).toBe(35);
    expect(normalized.rarity).toBe('blue');
  });

  it('discovered identities enlarge the draft pool; branches are a stable personal snapshot', () => {
    const p = player();
    const s = startAutobattlerRun({ ...p, summon: { ...p.summon, discovered: ['greta', 'missing'] }, heroes: [...p.heroes, { id: 'lira1', templateId: 'lira', level: 60, rarity: 'purple', branch: 'sage' }] }, DAY, ctx);
    expect(runOf(s).pool).toContain('greta');
    expect(runOf(s).pool).toContain('lira');
    expect(runOf(s).pool).not.toContain('missing');
    expect(runOf(s).branchChoices.lira).toBe('sage');
  });

  it('serializes the entire preparation and resumes exactly the same offers and battle', () => {
    let s = start();
    s = buyAutobattlerOffer(s, 0, ctx);
    s = rerollAutobattlerShop(s, ctx);
    const restored = { ...s, autobattler: AutobattlerSaveSchema.parse(JSON.parse(JSON.stringify(s.autobattler))) };
    expect(restored.autobattler).toEqual(s.autobattler);
    expect(autobattlerBattle(restored, ctx)).toEqual(autobattlerBattle(s, ctx));
    expect(fightAutobattlerRound(restored, DAY, ctx)).toEqual(fightAutobattlerRound(s, DAY, ctx));
  });
});

describe('Арена товарищей: решения в лавке и строю', () => {
  it('spends match coins only, reserves one-use offers and prevents empty/invalid purchases', () => {
    const s = start();
    const bought = buyAutobattlerOffer(s, 0, ctx);
    expect(runOf(bought).gold).toBe(cfg.startingGold - cfg.heroCost);
    expect(bought.resources).toEqual(s.resources);
    expect(bought.currency).toEqual(s.currency);
    expect(runOf(bought).shop[0]).toBeNull();
    code(() => buyAutobattlerOffer(bought, 0, ctx), 'invalid_choice');
    for (const index of [-1, 0.5, 3, NaN]) code(() => buyAutobattlerOffer(s, index, ctx), 'invalid_choice');
    code(() => buyAutobattlerOffer({ ...s, autobattler: { ...s.autobattler!, run: { ...runOf(s), gold: 0 } } }, 0, ctx), 'not_enough_gold');
  });

  it('three copies are a stronger named hero; duplicate offers cannot bypass the three-star cap', () => {
    let s = start();
    const first = runOf(s).heroes[0];
    s = { ...s, autobattler: { ...s.autobattler!, run: { ...runOf(s), gold: 100, shop: [first.templateId, first.templateId, first.templateId] } } };
    const before = autobattlerBattle(s, ctx).squad[0]!;
    s = buyAutobattlerOffer(buyAutobattlerOffer(s, 0, ctx), 1, ctx);
    const hero = runOf(s).heroes.find((h) => h.id === first.id)!;
    expect(hero.copies).toBe(3);
    expect(autobattlerStars(hero)).toBe(2);
    expect(runOf(s).heroes.filter((h) => h.templateId === first.templateId)).toHaveLength(1);
    expect(autobattlerBattle(s, ctx).squad[0]!.stats.hp).toBeGreaterThan(before.stats.hp * 1.25);
    const maxed = { ...s, autobattler: { ...s.autobattler!, run: { ...runOf(s), heroes: runOf(s).heroes.map((h) => h.id === first.id ? { ...h, copies: 9 } : h) } } };
    code(() => buyAutobattlerOffer(maxed, 2, ctx), 'max_stars');
  });

  it('training opens one extra place, increases the common level, and enables freely chosen professions', () => {
    let s = start();
    s = trainAutobattlerRun(s, ctx);
    expect(runOf(s).training).toBe(1);
    expect(autobattlerHeroState(runOf(s).heroes[0], runOf(s), ctx).level).toBe(41);
    const vika = runOf(s).heroes.find((h) => h.templateId === 'vika')!;
    s = { ...s, autobattler: { ...s.autobattler!, run: { ...runOf(s), gold: 100 } } };
    s = setAutobattlerBranch(trainAutobattlerRun(s, ctx), vika.id, 'monk', ctx);
    expect(autobattlerBattle(s, ctx).squad[2]!.role).toBe('tank');
    expect(s.heroes).toEqual(player().heroes);
    code(() => setAutobattlerBranch(s, vika.id, 'wizard', ctx), 'invalid_choice');
    s = trainAutobattlerRun(s, ctx);
    code(() => trainAutobattlerRun(s, ctx), 'max_training');
  });

  it('does not allow duplicate identities or more active heroes than training permits', () => {
    const s = start();
    const h = runOf(s).heroes[0].id;
    code(() => setAutobattlerSquad(s, [h, h, null, null, null], ctx), 'invalid_choice');
    code(() => setAutobattlerSquad(s, [h, null, null], ctx), 'invalid_choice');
    code(() => setAutobattlerSquad(s, ['h_campaign', null, null, null, null], ctx), 'invalid_choice');
    const bench = setAutobattlerSquad(s, [null, null, null, null, null], ctx);
    code(() => fightAutobattlerRound(bench, DAY, ctx), 'empty_squad');
  });

  it('selling starter companions produces no coins; paid copies refund only part of their cost', () => {
    let s = start();
    const h = runOf(s).heroes[0];
    expect(autobattlerSaleValue(h, cfg)).toBe(0);
    const sold = sellAutobattlerHero(s, h.id, ctx);
    expect(runOf(sold).gold).toBe(runOf(s).gold);
    expect(runOf(sold).squad).not.toContain(h.id);
    s = { ...s, autobattler: { ...s.autobattler!, run: { ...runOf(s), shop: [h.templateId, null, null] } } };
    const bought = buyAutobattlerOffer(s, 0, ctx);
    const resold = sellAutobattlerHero(bought, h.id, ctx);
    expect(runOf(resold).gold).toBeLessThan(runOf(s).gold);
  });

  it('a unique role composition activates a real synergy; reserves do not grant bonuses', () => {
    const s = start();
    const preview = autobattlerBattle(s, ctx);
    expect(preview.synergies.find((x) => x.id === 'companions')?.active).toBe(true);
    const vika = runOf(s).heroes.find((h) => h.templateId === 'vika')!;
    const bench = setAutobattlerSquad(s, runOf(s).squad.map((id) => id === vika.id ? null : id), ctx);
    expect(autobattlerBattle(bench, ctx).synergies.find((x) => x.id === 'companions')?.active).toBe(false);
  });

  it('rerolls spend coins and advance only the shop random stream', () => {
    const s = start();
    const before = autobattlerBattle(s, ctx);
    const rerolled = rerollAutobattlerShop(s, ctx);
    const after = autobattlerBattle(rerolled, ctx);
    expect(runOf(rerolled).shopSeq).toBe(runOf(s).shopSeq + 1);
    expect(runOf(rerolled).gold).toBe(runOf(s).gold - cfg.rerollCost);
    expect(after.enemies).toEqual(before.enemies);
    expect(after.seed).toBe(before.seed);
    expect(after.cohort).toEqual(before.cohort);
  });
});

describe('Арена товарищей: полный матч, жизнь и награды', () => {
  it('all seven battles play and end once; intermediate wins never mint campaign currency', () => {
    let s = start(1, easy);
    const original = s;
    for (let round = 1; round <= cfg.rounds; round++) {
      const before = structuredClone(s);
      const o = fightAutobattlerRound(s, DAY, easy);
      expect(s).toEqual(before);
      expect(o.round).toBe(round);
      expect(o.won).toBe(true);
      expect(o.result.log.some((e) => e.type === 'attack')).toBe(true);
      expect(o.result.log.at(-1)?.type).toBe('end');
      if (round < cfg.rounds) { expect(o.rewards).toEqual({ gold: 0, heroExp: 0, gems: 0 }); expect(o.save.resources).toEqual(original.resources); expect(o.income).toBeGreaterThanOrEqual(cfg.income); }
      s = o.save;
    }
    expect(s.autobattler!.run).toBeUndefined();
    expect(s.autobattler!.last!.wins).toBe(7);
    expect(s.autobattler!.bestWins).toBe(7);
    expect(s.currency.gems - original.currency.gems).toBe(cfg.rewards.gems);
    expect(s.battleSeq - original.battleSeq).toBe(7);
    code(() => fightAutobattlerRound(s, DAY, easy), 'no_run');
  });

  it('three defeats end the series without rewards; every loss consumes one life and still gives match income', () => {
    let s = start(1, hard);
    for (let i = 0; i < cfg.lives; i++) {
      const o = fightAutobattlerRound(s, DAY, hard);
      expect(o.won).toBe(false);
      expect(o.lives).toBe(cfg.lives - i - 1);
      if (!o.ended) expect(o.income).toBeGreaterThanOrEqual(cfg.income);
      s = o.save;
    }
    expect(s.autobattler!.run).toBeUndefined();
    expect(s.autobattler!.last!.reason).toBe('defeated');
    expect(s.resources).toEqual(player().resources);
    expect(s.currency).toEqual(player().currency);
  });

  it('abandoning never pays and cannot replay the same seed or restart a completed battle', () => {
    let s = start(1, easy);
    const seed = runOf(s).seed;
    const seq = s.battleSeq;
    s = fightAutobattlerRound(s, DAY, easy).save;
    s = abandonAutobattlerRun(s, easy);
    expect(s.autobattler!.last!.rewards).toEqual({ gold: 0, heroExp: 0, gems: 0 });
    expect(s.autobattler!.rewardDay).toBeUndefined();
    expect(s.battleSeq).toBe(seq + 1);
    const next = startAutobattlerRun(s, DAY, easy);
    expect(runOf(next).seed).not.toBe(seed);
    expect(runOf(next).id).toBe(2);
  });

  it('a dozen restarts and repeat perfect runs cannot exceed one full daily campaign reward', () => {
    let s = player();
    for (let i = 0; i < 12; i++) s = abandonAutobattlerRun(startAutobattlerRun(s, DAY, easy), easy);
    const original = s;
    for (let i = 0; i < 3; i++) s = finish(startAutobattlerRun(s, DAY, easy)).save;
    expect(s.currency.gems - original.currency.gems).toBe(cfg.rewards.gems);
    expect(s.resources.gold - original.resources.gold).toBe(cfg.rewards.gold);
    expect(s.resources.heroExp - original.resources.heroExp).toBe(cfg.rewards.heroExp);
    expect(s.autobattler!.completed).toBe(3);
  });

  it('a better finish only grants the delta, cross-midnight resume uses the start day and old days cannot reset it', () => {
    let s = player();
    s.autobattler = { seq: 1, bestWins: 3, completed: 1, rewardDay: DAY, rewardWins: 3 };
    const before = s;
    const won = finish(startAutobattlerRun(s, DAY, easy));
    s = won.save;
    expect(s.currency.gems - before.currency.gems).toBe(cfg.rewards.gems - Math.floor(cfg.rewards.gems * 3 / cfg.rounds));
    const nextDay = '2026-10-05';
    const run = startAutobattlerRun(s, nextDay, easy);
    const resumed = { ...run, autobattler: AutobattlerSaveSchema.parse(JSON.parse(JSON.stringify(run.autobattler))) };
    let resumedState: AutobattlerSave = resumed;
    for (let i = 0; i < cfg.rounds; i++) resumedState = fightAutobattlerRound(resumedState, '2026-10-06', easy).save;
    expect(resumedState.autobattler!.rewardDay).toBe(nextDay);
    const old = finish(startAutobattlerRun(resumedState, DAY, easy)).save;
    expect(old.currency).toEqual(resumedState.currency);
    expect(old.autobattler!.rewardDay).toBe(nextDay);
  });

  it('battle logs and manual replay are deterministic from the persisted round contract', () => {
    const s = start(42);
    const preview = autobattlerBattle(s, ctx);
    expect(preview.seed).toBe(autobattlerRoundSeed(runOf(s)));
    const auto = fightAutobattlerRound(s, DAY, ctx, { manualUlt: false, inputs: [] });
    expect(fightAutobattlerRound(s, DAY, ctx, { manualUlt: false, inputs: [] })).toEqual(auto);
    const manual = fightAutobattlerRound(s, DAY, ctx, { manualUlt: true, inputs: [] });
    expect(manual.result.log.filter((e) => e.type === 'ult' && e.unit.startsWith('A'))).toHaveLength(0);
    expect(manual.save.autobattler!.run?.round ?? 2).toBe(2);
    expect(s.battleSeq).toBe(player(42).battleSeq);
  });
});

describe('Арена товарищей: обновление игры и повреждённый матч', () => {
  it('valid resumable state keeps object identity and exact deterministic contract', () => {
    const s = start();
    const repaired = sanitizeAutobattlerSave(s, ctx);
    expect(repaired.save).toBe(s);
    expect(repaired.warnings).toEqual([]);
    expect(autobattlerBattle(repaired.save, ctx)).toEqual(autobattlerBattle(s, ctx));
  });

  it('unknown content drops only the match, preserving campaign, resources, daily ledger and seed sequence', () => {
    const s = start();
    const broken: AutobattlerSave = { ...s, autobattler: { ...s.autobattler!, rewardDay: DAY, rewardWins: 4, run: { ...runOf(s), heroes: runOf(s).heroes.map((h, i) => i === 0 ? { ...h, templateId: 'removed_hero' } : h) } } };
    const repaired = sanitizeAutobattlerSave(broken, ctx);
    expect(repaired.warnings).toHaveLength(1);
    expect(repaired.save.autobattler!.run).toBeUndefined();
    expect(repaired.save.autobattler!.seq).toBe(broken.autobattler!.seq);
    expect(repaired.save.autobattler!.rewardDay).toBe(DAY);
    expect(repaired.save.autobattler!.rewardWins).toBe(4);
    expect(repaired.save.campaign).toBe(broken.campaign);
    expect(repaired.save.resources).toBe(broken.resources);
    expect(repaired.save.heroes).toBe(broken.heroes);
    const next = startAutobattlerRun(repaired.save, DAY, ctx);
    expect(runOf(next).id).toBe(2);
    expect(runOf(next).seed).not.toBe(runOf(s).seed);
  });

  it('invalid copies and duplicate formation never reset a valid daily payout ledger', () => {
    const s = start();
    const broken: AutobattlerSave = { ...s, autobattler: { ...s.autobattler!, rewardDay: DAY, rewardWins: 7, run: { ...runOf(s), heroes: runOf(s).heroes.map((h) => ({ ...h, copies: 1, paidCopies: 9 })), squad: Array(5).fill(runOf(s).heroes[0].id) } } };
    const repaired = sanitizeAutobattlerSave(broken, ctx);
    expect(repaired.warnings).toHaveLength(1);
    expect(repaired.save.autobattler!.run).toBeUndefined();
    expect(repaired.save.autobattler!.rewardWins).toBe(7);
    const repeat = finish(startAutobattlerRun(repaired.save, DAY, easy)).save;
    expect(repeat.currency).toEqual(broken.currency);
    expect(repeat.resources).toEqual(broken.resources);
  });

  it('configuration changes cannot leave an unplayable run or mutate campaign progression', () => {
    const s = start();
    const obsolete = { ...s, autobattler: { ...s.autobattler!, run: { ...runOf(s), training: 3 } } };
    const changed = { ...ctx, autobattler: { ...cfg, training: cfg.training.slice(0, 2) } };
    const repaired = sanitizeAutobattlerSave(obsolete, changed);
    expect(repaired.warnings).toHaveLength(1);
    expect(repaired.save.autobattler!.run).toBeUndefined();
    expect(repaired.save.campaign).toBe(obsolete.campaign);
    expect(sanitizeAutobattlerSave(s, { ...base, autobattler: undefined }).save.autobattler!.run).toBeUndefined();
  });
});

describe('Арена товарищей: решения меняют результат на настоящем контенте', () => {
  it('investment and saving allow a full series across varied seeds; untouched starter team cannot beat the field', () => {
    const seeds = [1, 2, 3, 4, 9, 13, 17, 24];
    const drafted: number[] = [];
    const idle: number[] = [];
    for (const seed of seeds) {
      idle.push(finish(start(seed), ctx).save.autobattler!.last!.wins);
      let s = start(seed);
      while (s.autobattler!.run) {
        let run = runOf(s);
        const upgrade = cfg.training[run.training + 1];
        if (upgrade && run.gold >= upgrade.cost) s = trainAutobattlerRun(s, ctx);
        for (let decisions = 0; decisions < cfg.shopSize; decisions++) {
          run = runOf(s);
          if (run.gold < cfg.heroCost) break;
          const capacity = cfg.training[run.training].capacity;
          let index = run.shop.findIndex((t) => t && !run.heroes.some((h) => h.templateId === t) && run.squad.filter(Boolean).length < capacity);
          const nextTraining = cfg.training[run.training + 1];
          if (index < 0 && (!nextTraining || run.gold - nextTraining.cost >= cfg.heroCost * 2)) index = run.shop.findIndex((t) => t && run.heroes.some((h) => h.templateId === t && h.copies < 3));
          if (index < 0) break;
          s = buyAutobattlerOffer(s, index, ctx);
        }
        s = fightAutobattlerRound(s, DAY, ctx).save;
      }
      drafted.push(s.autobattler!.last!.wins);
      expect(s.autobattler!.last!.rounds).toBe(cfg.rounds);
    }
    const average = (ns: number[]) => ns.reduce((a, b) => a + b, 0) / ns.length;
    expect(average(drafted)).toBeGreaterThan(average(idle) + 2);
    expect(drafted.some((wins) => wins === cfg.rounds)).toBe(true);
    expect(drafted.some((wins) => wins < cfg.rounds)).toBe(true);
    expect(idle.every((wins) => wins < cfg.rounds - cfg.lives)).toBe(true);
  });
});
