import { simulateBattle } from '../battle';
import { branchOf, buildUnit } from '../heroes/card';
import { formationRank } from '../meta/formation';
import type { GameContext } from '../progression/types';
import { Rng } from '../rng';
import type { HeroState, SaveState } from '../save/schema';
import type { BattleResult, PlayerControl, UnitDef } from '../types';
import { AutobattlerRunSchema, type AutobattlerConfig, type AutobattlerHero, type AutobattlerRewards, type AutobattlerRun, type AutobattlerState } from './schema';

export type AutobattlerContext = GameContext & { autobattler?: AutobattlerConfig };
/** Structural overlay keeps optional mode compatible with pre-mode saves and narrow campaign contexts. */
export type AutobattlerSave = SaveState & { autobattler?: AutobattlerState };

export class AutobattlerError extends Error {
  constructor(public code: 'disabled' | 'locked' | 'run_active' | 'no_run' | 'invalid_choice' | 'not_enough_gold' | 'reserve_full' | 'max_stars' | 'max_training' | 'empty_squad' | 'invalid_run', message: string) { super(message); }
}

const ZERO: AutobattlerRewards = { gold: 0, heroExp: 0, gems: 0 };
const stateOf = (save: AutobattlerSave): AutobattlerState => save.autobattler ?? { seq: 0, bestWins: 0, completed: 0 };

export function autobattlerConfig(ctx: AutobattlerContext): AutobattlerConfig {
  if (!ctx.autobattler) throw new AutobattlerError('disabled', 'Арена пока недоступна');
  return ctx.autobattler;
}

export function validateAutobattlerConfig(cfg: AutobattlerConfig, ctx: GameContext, problems: string[]): void {
  const problem = (s: string) => problems.push(`data/autobattler.json: ${s}`);
  if (cfg.unlockAfterStage && !ctx.content.stages.some((s) => s.id === cfg.unlockAfterStage)) problem(`этап ${cfg.unlockAfterStage} не найден`);
  const unique = (ids: string[], where: string) => { if (new Set(ids).size !== ids.length) problem(`${where}: повторяющиеся id`); };
  unique(cfg.starterPool, 'starterPool');
  unique(cfg.startingTeam, 'startingTeam');
  unique(cfg.opponents.map((c) => c.id), 'opponents');
  unique(cfg.synergies.map((c) => c.id), 'synergies');
  for (const templateId of [...cfg.starterPool, ...cfg.startingTeam, ...cfg.opponents.flatMap((c) => c.team)]) if (!ctx.content.heroes[templateId]) problem(`герой ${templateId} не найден`);
  for (const templateId of cfg.startingTeam) if (!cfg.starterPool.includes(templateId)) problem(`начальный герой ${templateId} отсутствует в starterPool`);
  for (const cohort of cfg.opponents) {
    unique(cohort.team, `opponents.${cohort.id}.team`);
    for (const [templateId, branch] of Object.entries(cohort.branches ?? {})) {
      if (!cohort.team.includes(templateId) || !ctx.content.heroes[templateId]?.branches.some((b) => b.job === branch)) problem(`${cohort.id}: неверная ветка ${templateId}/${branch}`);
    }
  }
  const lines = new Set(Object.values(ctx.content.heroes).map((h) => h.line));
  for (const synergy of cfg.synergies) for (const line of synergy.lines ?? []) if (!lines.has(line)) problem(`связка ${synergy.id}: линия ${line} не найдена`);
}

export function autobattlerUnlocked(save: AutobattlerSave, ctx: AutobattlerContext): boolean {
  return !!ctx.autobattler && (!ctx.autobattler.unlockAfterStage || save.campaign.cleared.includes(ctx.autobattler.unlockAfterStage));
}

export function autobattlerStatus(save: AutobattlerSave, ctx: AutobattlerContext) {
  const state = stateOf(save);
  return { unlocked: autobattlerUnlocked(save, ctx), run: state.run ?? null, bestWins: state.bestWins, completed: state.completed, last: state.last, unlockAfterStage: ctx.autobattler?.unlockAfterStage ?? null };
}

/** Separate streams mean shop rerolls and manual inputs cannot alter the opponent or battle seed. */
export function autobattlerRoundSeed(run: Pick<AutobattlerRun, 'seed' | 'round'>): number {
  return (run.seed ^ Math.imul(run.round, 0x9e3779b1) ^ 0x41c64e6d) >>> 0;
}

function shopFor(run: AutobattlerRun, cfg: AutobattlerConfig): (string | null)[] {
  const rng = new Rng((run.seed ^ Math.imul(run.shopSeq + 1, 0x85ebca6b) ^ 0x165667b1) >>> 0);
  const available = run.pool.filter((t) => !run.heroes.some((h) => h.templateId === t && h.copies >= 9));
  if (!available.length) return Array(cfg.shopSize).fill(null);
  // Sampling with replacement is intentional: a pair in the shop lets players commit to a star upgrade.
  return Array.from({ length: cfg.shopSize }, () => available[rng.int(available.length)]);
}

function need(save: AutobattlerSave, ctx: AutobattlerContext): { run: AutobattlerRun; cfg: AutobattlerConfig } {
  const cfg = autobattlerConfig(ctx);
  const run = stateOf(save).run;
  if (!run) throw new AutobattlerError('no_run', 'Сначала начните матч');
  if (run.round > cfg.rounds || run.training >= cfg.training.length || run.heroes.some((h) => !ctx.content.heroes[h.templateId]) || run.squad.some((id) => id && !run.heroes.some((h) => h.id === id))) throw new AutobattlerError('invalid_run', 'Правила матча изменились. Завершите матч и начните новый');
  return { run, cfg };
}

function withRun(save: AutobattlerSave, run: AutobattlerRun): AutobattlerSave {
  return { ...save, autobattler: { ...stateOf(save), run } };
}

export function startAutobattlerRun(save: AutobattlerSave, day: string, ctx: AutobattlerContext): AutobattlerSave {
  const cfg = autobattlerConfig(ctx);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new AutobattlerError('invalid_choice', 'Неверный игровой день');
  if (!autobattlerUnlocked(save, ctx)) throw new AutobattlerError('locked', 'Арена откроется после первой главы');
  const state = stateOf(save);
  if (state.run) throw new AutobattlerError('run_active', 'Матч уже идёт');
  const seq = state.seq + 1;
  const pool = [...new Set([...cfg.starterPool, ...save.summon.discovered, ...save.heroes.map((h) => h.templateId)])].filter((id) => !!ctx.content.heroes[id]).sort();
  const branchChoices: Record<string, string> = {};
  for (const templateId of pool) {
    const template = ctx.content.heroes[templateId];
    const companion = save.heroes.find((h) => h.templateId === templateId && h.companion);
    // Carry the personal choice, including an inactive remembered path, without its campaign power.
    const ownBranch = companion && (branchOf(template, companion.branch) ?? branchOf(template, companion.journey?.lastBranch));
    const hero = save.heroes.filter((h) => h.templateId === templateId && branchOf(template, h.branch)).sort((a, b) => b.level - a.level)[0];
    branchChoices[templateId] = ownBranch?.job ?? hero?.branch ?? template.branches[0].job;
  }
  const heroes: AutobattlerHero[] = cfg.startingTeam.map((templateId) => ({ id: `ab_${seq}_${templateId}`, templateId, copies: 1, paidCopies: 0, branch: branchChoices[templateId] }));
  const squad: (string | null)[] = [null, null, null, null, null];
  for (const h of heroes) {
    const order = autoPlacementOrder(h, 0, ctx);
    squad[order.find((i) => squad[i] === null)!] = h.id;
  }
  const run: AutobattlerRun = { version: 1, id: seq, seed: (save.createdAt ^ Math.imul(seq, 0x27d4eb2d)) >>> 0, day, round: 1, wins: 0, lives: cfg.lives, gold: cfg.startingGold, training: 0, shopSeq: 0, shop: [null, null, null], pool, branchChoices, heroes, squad };
  run.shop = shopFor(run, cfg);
  return { ...save, autobattler: { ...state, seq, run } };
}

export function autobattlerStars(hero: Pick<AutobattlerHero, 'copies'>): 1 | 2 | 3 {
  return hero.copies >= 9 ? 3 : hero.copies >= 3 ? 2 : 1;
}

export function buyAutobattlerOffer(save: AutobattlerSave, index: number, ctx: AutobattlerContext): AutobattlerSave {
  const { run, cfg } = need(save, ctx);
  const templateId = Number.isInteger(index) && index >= 0 ? run.shop[index] : null;
  if (!templateId || !run.pool.includes(templateId)) throw new AutobattlerError('invalid_choice', 'Этот герой уже ушёл из лавки');
  if (run.gold < cfg.heroCost) throw new AutobattlerError('not_enough_gold', 'Не хватает монет матча');
  const current = run.heroes.find((h) => h.templateId === templateId);
  if (current?.copies === 9) throw new AutobattlerError('max_stars', 'У героя уже три звезды');
  if (!current && run.heroes.length >= cfg.reserveLimit) throw new AutobattlerError('reserve_full', 'Резерв заполнен: освободите место');
  const hero: AutobattlerHero = current ? { ...current, copies: current.copies + 1, paidCopies: current.paidCopies + 1 } : { id: `ab_${run.id}_${templateId}`, templateId, copies: 1, paidCopies: 1, branch: run.branchChoices[templateId] };
  const heroes = current ? run.heroes.map((h) => h.id === hero.id ? hero : h) : [...run.heroes, hero];
  const squad = [...run.squad];
  if (!current && squad.filter(Boolean).length < cfg.training[run.training].capacity) {
    const order = autoPlacementOrder(hero, run.training, ctx);
    const slot = order.find((i) => squad[i] === null);
    if (slot !== undefined) squad[slot] = hero.id;
  }
  return withRun(save, { ...run, gold: run.gold - cfg.heroCost, heroes, squad, shop: run.shop.map((offer, i) => i === index ? null : offer) });
}

export function rerollAutobattlerShop(save: AutobattlerSave, ctx: AutobattlerContext): AutobattlerSave {
  const { run, cfg } = need(save, ctx);
  if (run.gold < cfg.rerollCost) throw new AutobattlerError('not_enough_gold', 'Не хватает монет для обновления');
  const next = { ...run, gold: run.gold - cfg.rerollCost, shopSeq: run.shopSeq + 1 };
  return withRun(save, { ...next, shop: shopFor(next, cfg) });
}

export function trainAutobattlerRun(save: AutobattlerSave, ctx: AutobattlerContext): AutobattlerSave {
  const { run, cfg } = need(save, ctx);
  const training = cfg.training[run.training + 1];
  if (!training) throw new AutobattlerError('max_training', 'Подготовка достигла предела');
  if (run.gold < training.cost) throw new AutobattlerError('not_enough_gold', 'Не хватает монет для подготовки');
  const squad = [...run.squad];
  for (const h of run.heroes) {
    if (squad.filter(Boolean).length >= training.capacity) break;
    if (squad.includes(h.id)) continue;
    const order = autoPlacementOrder(h, run.training + 1, ctx);
    squad[order.find((i) => squad[i] === null)!] = h.id;
  }
  return withRun(save, { ...run, gold: run.gold - training.cost, training: run.training + 1, squad });
}

export function autobattlerSaleValue(hero: AutobattlerHero, cfg: AutobattlerConfig): number {
  return Math.floor(hero.paidCopies * cfg.heroCost * cfg.sellRefund);
}

export function sellAutobattlerHero(save: AutobattlerSave, heroId: string, ctx: AutobattlerContext): AutobattlerSave {
  const { run, cfg } = need(save, ctx);
  const hero = run.heroes.find((h) => h.id === heroId);
  if (!hero || run.heroes.length <= 1) throw new AutobattlerError('invalid_choice', 'Последнего товарища нельзя отпустить');
  return withRun(save, { ...run, gold: run.gold + autobattlerSaleValue(hero, cfg), heroes: run.heroes.filter((h) => h.id !== heroId), squad: run.squad.map((id) => id === heroId ? null : id) });
}

export function setAutobattlerSquad(save: AutobattlerSave, squad: (string | null)[], ctx: AutobattlerContext): AutobattlerSave {
  const { run, cfg } = need(save, ctx);
  const active = squad.filter((id): id is string => id !== null);
  if (squad.length !== 5 || active.length > cfg.training[run.training].capacity || new Set(active).size !== active.length || active.some((id) => !run.heroes.some((h) => h.id === id))) throw new AutobattlerError('invalid_choice', 'Неверная расстановка товарищей');
  return withRun(save, { ...run, squad: [...squad] });
}

export function setAutobattlerBranch(save: AutobattlerSave, heroId: string, branch: string, ctx: AutobattlerContext): AutobattlerSave {
  const { run } = need(save, ctx);
  const hero = run.heroes.find((h) => h.id === heroId);
  if (!hero || !ctx.content.heroes[hero.templateId].branches.some((b) => b.job === branch)) throw new AutobattlerError('invalid_choice', 'Эта профессия недоступна герою');
  return withRun(save, { ...run, heroes: run.heroes.map((h) => h.id === heroId ? { ...h, branch } : h) });
}

export function autobattlerHeroState(hero: AutobattlerHero, run: Pick<AutobattlerRun, 'training'>, ctx: AutobattlerContext): HeroState {
  const training = autobattlerConfig(ctx).training[run.training];
  return { id: hero.id, templateId: hero.templateId, rarity: training.rarity, level: training.level, ...(hero.branch ? { branch: hero.branch } : {}) };
}

/** Place only a newly active card; existing player positions stay intact. */
function autoPlacementOrder(hero: AutobattlerHero, training: number, ctx: AutobattlerContext): number[] {
  const rank = formationRank(autobattlerHeroState(hero, { training }, ctx), ctx);
  return rank <= 1 ? [0, 1, 2, 3, 4] : [2, 3, 4, 0, 1];
}

function normalizedUnit(hero: HeroState, ctx: AutobattlerContext, multiplier = 1): UnitDef {
  // Explicit zero equipment also excludes accidental heroGear attached to a campaign context.
  const unit = buildUnit(hero, ctx, { hp: 0, atk: 0, def: 0, spd: 0 });
  const template = ctx.content.heroes[hero.templateId];
  const form = hero.rarity === 'purple' ? template.branches.find((b) => b.job === hero.branch) : undefined;
  return { ...unit, visual: { ...unit.visual, sprite: form?.visual.sprite ?? template.visual.sprite ?? unit.visual.sprite }, stats: { ...unit.stats, hp: Math.round(unit.stats.hp * multiplier), atk: Math.round(unit.stats.atk * multiplier), def: Math.round(unit.stats.def * multiplier) } };
}

export interface AutobattlerSynergy { id: string; name: string; count: number; need: number; active: boolean; description: string }

function applySynergies(squad: (UnitDef | null)[], templates: (string | null)[], ctx: AutobattlerContext): { squad: (UnitDef | null)[]; synergies: AutobattlerSynergy[] } {
  const cfg = autobattlerConfig(ctx);
  const members = squad.flatMap((u, i) => u && templates[i] ? [{ unit: u, template: ctx.content.heroes[templates[i]!] }] : []);
  const added = { hp: 0, atk: 0, def: 0, spd: 0 };
  const synergies = cfg.synergies.map((s): AutobattlerSynergy => {
    const matching = members.filter((m) => (!s.lines?.length || s.lines.includes(m.template.line)) && (!s.roles?.length || s.roles.includes(m.unit.role)));
    const count = s.distinctRoles ? new Set(matching.map((m) => m.unit.role)).size : new Set(matching.map((m) => m.template.id)).size;
    const active = count >= s.need;
    if (active) for (const key of ['hp', 'atk', 'def', 'spd'] as const) added[key] += s.bonuses[key] ?? 0;
    return { id: s.id, name: s.name, count, need: s.need, active, description: s.description };
  });
  return { squad: squad.map((u) => u ? { ...u, stats: { ...u.stats, hp: Math.round(u.stats.hp * (1 + added.hp)), atk: Math.round(u.stats.atk * (1 + added.atk)), def: Math.round(u.stats.def * (1 + added.def)), spd: Math.round(u.stats.spd * (1 + added.spd)) } } : null), synergies };
}

export interface AutobattlerBattle { squad: (UnitDef | null)[]; enemies: (UnitDef | null)[]; seed: number; round: number; cohort: AutobattlerConfig['opponents'][number]; synergies: AutobattlerSynergy[]; enemySynergies: AutobattlerSynergy[] }

/** Public deterministic preview/replay contract; no online opponent simulation or hidden campaign modifiers. */
export function autobattlerBattle(save: AutobattlerSave, ctx: AutobattlerContext): AutobattlerBattle {
  const { run, cfg } = need(save, ctx);
  const heroOf = (id: string) => run.heroes.find((h) => h.id === id)!;
  const squad = run.squad.map((id) => id ? normalizedUnit(autobattlerHeroState(heroOf(id), run, ctx), ctx, cfg.starMultiplier[autobattlerStars(heroOf(id)) - 1]) : null);
  const a = applySynergies(squad, run.squad.map((id) => id ? heroOf(id).templateId : null), ctx);
  const seed = autobattlerRoundSeed(run);
  const cohort = cfg.opponents[new Rng(seed ^ 0xa5a5a5a5).int(cfg.opponents.length)];
  const difficulty = cfg.difficulty[run.round - 1];
  // Start with one front + the healer + a damage dealer, then add the second front and back slot.
  const included = [0, 2, 3, 1, 4].slice(0, difficulty.count);
  const templates = cohort.team.map((templateId, slot) => included.includes(slot) ? templateId : null);
  const enemies = templates.map((templateId, slot) => templateId ? normalizedUnit({ id: `ab_enemy_${run.round}_${slot}`, templateId, level: difficulty.level, rarity: difficulty.rarity, branch: cohort.branches?.[templateId] ?? ctx.content.heroes[templateId].branches[0].job }, ctx, difficulty.mult) : null);
  const b = applySynergies(enemies, templates, ctx);
  return { squad: a.squad, enemies: b.squad, seed, round: run.round, cohort, synergies: a.synergies, enemySynergies: b.synergies };
}

function dailyPayout(state: AutobattlerState, run: AutobattlerRun, wins: number, cfg: AutobattlerConfig): { state: AutobattlerState; rewards: AutobattlerRewards } {
  if (wins < cfg.rewards.minWins || (state.rewardDay && run.day < state.rewardDay)) return { state, rewards: { ...ZERO } };
  const previous = state.rewardDay === run.day ? (state.rewardWins ?? 0) : 0;
  if (wins <= previous) return { state, rewards: { ...ZERO } };
  const rewardFor = (amount: number, n: number) => n < cfg.rewards.minWins ? 0 : Math.floor(amount * Math.min(n, cfg.rounds) / cfg.rounds);
  const rewards = { gold: rewardFor(cfg.rewards.gold, wins) - rewardFor(cfg.rewards.gold, previous), heroExp: rewardFor(cfg.rewards.heroExp, wins) - rewardFor(cfg.rewards.heroExp, previous), gems: rewardFor(cfg.rewards.gems, wins) - rewardFor(cfg.rewards.gems, previous) };
  return { state: { ...state, rewardDay: run.day, rewardWins: wins }, rewards };
}

export interface AutobattlerOutcome extends AutobattlerBattle { save: AutobattlerSave; result: BattleResult; won: boolean; wins: number; lives: number; ended: boolean; rewards: AutobattlerRewards; income: number }

export function fightAutobattlerRound(save: AutobattlerSave, _day: string, ctx: AutobattlerContext, control?: PlayerControl): AutobattlerOutcome {
  const { run, cfg } = need(save, ctx);
  if (!run.squad.some(Boolean)) throw new AutobattlerError('empty_squad', 'Поставьте товарищей на поле');
  const preview = autobattlerBattle(save, ctx);
  const result = simulateBattle(ctx.content, preview.squad, preview.enemies, preview.seed, { combat: ctx.combat, ...(control ? { manualUlt: control.manualUlt, inputs: control.inputs } : {}) });
  const won = result.winner === 'A';
  const wins = run.wins + (won ? 1 : 0);
  const lives = run.lives - (won ? 0 : 1);
  const ended = lives <= 0 || run.round >= cfg.rounds;
  let next: AutobattlerSave = { ...save, battleSeq: save.battleSeq + 1 };
  let rewards = { ...ZERO };
  let income = 0;
  if (ended) {
    const state = stateOf(save);
    const payout = dailyPayout(state, run, wins, cfg);
    rewards = payout.rewards;
    const { run: _finished, ...persistent } = payout.state;
    const last: NonNullable<AutobattlerState['last']> = { runId: run.id, rounds: run.round, wins, reason: lives <= 0 ? 'defeated' : 'completed', rewards };
    next = { ...next, resources: { ...save.resources, gold: save.resources.gold + rewards.gold, heroExp: save.resources.heroExp + rewards.heroExp }, currency: { ...save.currency, gems: save.currency.gems + rewards.gems }, autobattler: { ...persistent, bestWins: Math.max(state.bestWins, wins), completed: state.completed + 1, last } };
  } else {
    income = cfg.income + (won ? cfg.winIncome : 0) + Math.min(cfg.interestCap, Math.floor(run.gold / cfg.interestEvery));
    const round = { ...run, round: run.round + 1, wins, lives, gold: run.gold + income, shopSeq: run.shopSeq + 1 };
    next = withRun(next, { ...round, shop: shopFor(round, cfg) });
  }
  return { ...preview, save: next, result, won, wins, lives, ended, rewards, income };
}

export function abandonAutobattlerRun(save: AutobattlerSave, ctx: AutobattlerContext): AutobattlerSave {
  autobattlerConfig(ctx);
  const state = stateOf(save);
  if (!state.run) throw new AutobattlerError('no_run', 'Матч уже завершён');
  const { run, ...persistent } = state;
  return { ...save, autobattler: { ...persistent, last: { runId: run.id, rounds: run.round - 1, wins: run.wins, reason: 'abandoned', rewards: { ...ZERO } } } };
}

/** Optional mode damage must never invalidate the campaign. Run snapshots are checked against current content. */
export function sanitizeAutobattlerSave(save: AutobattlerSave, ctx: AutobattlerContext): { save: AutobattlerSave; warnings: string[] } {
  if (!save.autobattler) return { save, warnings: [] };
  // The save loader owns raw ledger recovery and blocks today's payout if its receipt cannot be trusted.
  // Here the already-parsed persistent ledger is never deleted or reset, even when a run is malformed.
  const state = save.autobattler;
  const run = state.run;
  if (!run) return { save, warnings: [] };
  if (!AutobattlerRunSchema.safeParse(run).success) {
    const { run: _corruptRun, ...ledger } = state;
    const seq = Number.isSafeInteger(run.id) && run.id > state.seq ? run.id : state.seq;
    return { save: { ...save, autobattler: { ...ledger, seq } }, warnings: ['Повреждённый матч Арены завершён. Прогресс кампании и награда дня сохранены.'] };
  }
  const cfg = ctx.autobattler;
  const validTemplate = (id: string) => !!ctx.content.heroes[id];
  const validBranch = (templateId: string, branch: string | undefined) => !branch || !!ctx.content.heroes[templateId]?.branches.some((b) => b.job === branch);
  const active = run.squad.filter((id): id is string => id !== null);
  const valid = cfg && run.id <= state.seq && run.round <= cfg.rounds && run.wins < run.round && run.lives <= cfg.lives && run.training < cfg.training.length && run.heroes.length <= cfg.reserveLimit && run.pool.every(validTemplate) && new Set(run.pool).size === run.pool.length && run.heroes.every((h) => validTemplate(h.templateId) && run.pool.includes(h.templateId) && validBranch(h.templateId, h.branch)) && new Set(run.heroes.map((h) => h.id)).size === run.heroes.length && new Set(run.heroes.map((h) => h.templateId)).size === run.heroes.length && active.length <= cfg.training[run.training].capacity && new Set(active).size === active.length && active.every((id) => run.heroes.some((h) => h.id === id)) && run.shop.every((id) => !id || run.pool.includes(id)) && Object.entries(run.branchChoices).every(([id, branch]) => validTemplate(id) && run.pool.includes(id) && validBranch(id, branch));
  if (valid) return { save, warnings: [] };
  const { run: _invalidRun, ...persistent } = state;
  return {
    save: { ...save, autobattler: { ...persistent, seq: Math.max(state.seq, run.id), last: { runId: run.id, rounds: Math.max(0, run.round - 1), wins: Math.min(run.wins, Math.max(0, run.round - 1)), reason: 'abandoned', rewards: { ...ZERO } } } },
    warnings: ['Состав или правила Арены изменились. Матч завершён; прогресс кампании и награда дня сохранены.'],
  };
}
