import { simulateBattle } from '../battle';
import type { UnitDef } from '../content/schema';
import { withGear } from '../equipment/equipment';
import type { EquipmentConfig } from '../equipment/load';
import { grantBlessedOre } from '../equipment/refine';
import { buildUnit } from '../heroes/card';
import { addHeroExp } from '../heroes/level';
import { duplicateCardsInSquad } from '../heroes/roster';
import { CARD_RARITIES } from '../heroes/schema';
import { Rng } from '../rng';
import type { HeroState, SaveState } from '../save/schema';
import type { BattleResult, PlayerControl } from '../types';
import { blessingBattle, blessingById, familyStates, runEffects, type FamilyState } from './blessings';
import {
  BLESSING_RARITIES,
  type Blessing,
  type BlessingRarity,
  type EventOutcome,
  type TowerEventDef,
  type TowerNodeKind,
  type TowerRun,
  type TowerRunConfig,
  type TowerRunSummary,
  type TowerSave,
  type TowerUpgrade,
  TowerSaveSchema,
} from './runSchema';
import type { TowerConfig } from './schema';
import { TowerError, towerUnlocked, type TowerContext } from './tower';

/**
 * Башня-рогалик (docs/design/tower-roguelite.md): забег отрядом по этажам подряд, раны переходят с этажа на этаж, павший
 * выбывает до конца забега; развилки из двух путей, карты-благословения, события, отдых, боссы; осколки башни →
 * постоянные улучшения. Всё детерминировано: забег = seed + выборы игрока. Чистые функции: save не меняется.
 */

/** Конфиг забега; нет в tower.json — TowerError('invalid_config'). */
export function runConfig(ctx: { tower: TowerConfig }): TowerRunConfig {
  const r = ctx.tower.run;
  if (!r) throw new TowerError('invalid_config', 'data/tower.json: нет раздела run (забег)');
  return r;
}

/** Смешать числа в seed (FNV-1a по строке). */
export function runSeed(...parts: (number | string)[]): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join('#')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const rngOf = (run: Pick<TowerRun, 'seed'>, floor: number, salt: string) => new Rng(runSeed(run.seed, floor, salt));

const BATTLE_KINDS: ReadonlySet<TowerNodeKind> = new Set(['battle', 'elite', 'boss']);
export const isBattleNode = (k: TowerNodeKind) => BATTLE_KINDS.has(k);

/** Названия типов этажей для игрока. */
export const NODE_NAMES: Record<TowerNodeKind, string> = {
  battle: 'Бой',
  elite: 'Элита',
  event: 'Событие',
  rest: 'Отдых',
  boss: 'Босс',
};

// ---------- постоянные улучшения ----------

export function upgradeLevel(save: SaveState, id: string): number {
  return save.tower.upgrades?.[id] ?? 0;
}

/** Суммарная сила улучшений вида effect (уровень × value). */
export function upgradeValue(save: SaveState, cfg: TowerRunConfig, effect: TowerUpgrade['effect']): number {
  return cfg.upgrades.filter((u) => u.effect === effect).reduce((s, u) => s + Math.min(upgradeLevel(save, u.id), u.costs.length) * u.value, 0);
}

/** Купить следующий уровень улучшения за осколки башни. */
export function buyTowerUpgrade(save: SaveState, id: string, ctx: TowerContext): SaveState {
  const cfg = runConfig(ctx);
  const up = cfg.upgrades.find((u) => u.id === id);
  if (!up) throw new TowerError('bad_choice', `Нет улучшения ${id}`);
  const level = upgradeLevel(save, id);
  if (level >= up.costs.length) throw new TowerError('max_level', `«${up.name}» уже на максимуме`);
  const cost = up.costs[level];
  const shards = save.tower.shards ?? 0;
  if (shards < cost) throw new TowerError('not_enough_shards', `Нужно ${cost} осколков башни`);
  return { ...save, tower: normTower({ ...save.tower, shards: shards - cost, upgrades: { ...save.tower.upgrades, [id]: level + 1 } }) };
}

// ---------- ступень и этажи ----------

/** Последний пройденный этап кампании (по порядку кампании). */
function frontierStage(save: SaveState, ctx: TowerContext) {
  let last = null as (typeof ctx.content.stages)[number] | null;
  for (const s of ctx.content.stages) if (save.campaign.cleared.includes(s.id)) last = s;
  return last;
}

/** Ступень игрока для силы врагов забега: номер главы последнего пройденного этапа (1 — ничего не пройдено). */
export function towerTier(save: SaveState, ctx: TowerContext): number {
  const st = frontierStage(save, ctx);
  if (!st) return 1;
  return ctx.content.chapters.find((c) => c.id === st.chapter)?.order ?? 1;
}

function bandIndex(cfg: TowerConfig, floor: number): number {
  let idx = 0;
  cfg.bands.forEach((b, i) => {
    if (b.fromFloor <= floor) idx = i;
  });
  return idx;
}

/** Множитель силы врагов от карт с ценой (greed). */
function enemyGreed(run: TowerRun, cfg: TowerRunConfig): number {
  return runEffects(run.cards, cfg).reduce((s, x) => s + (x.effect.kind === 'greed' ? x.effect.enemies : 0), 0);
}

/**
 * Враги этажа n забега: состав полосы data/tower.json (случайный от seed забега и этажа), сила = mult слота × tierMult
 * ступени × (1 + growthPerFloor)^(n − 1) × элита/босс × (1 + greed). id — `trun_f<n>_<слот>`.
 */
export function runFloorEnemies(run: Pick<TowerRun, 'seed' | 'tier' | 'cards'>, n: number, kind: TowerNodeKind, ctx: TowerContext): (UnitDef | null)[] {
  const cfg = runConfig(ctx);
  const band = ctx.tower.bands[bandIndex(ctx.tower, n)];
  const boss = kind === 'boss';
  const pool = boss ? band.bossLayouts : band.layouts;
  const layout = pool[rngOf(run, n, 'layout').int(pool.length)];
  const tier = cfg.tierMult[Math.min(run.tier, cfg.tierMult.length) - 1];
  const greed = enemyGreed(run as TowerRun, cfg);
  const k0 = tier * Math.pow(1 + cfg.growthPerFloor, n - 1) * (kind === 'elite' ? cfg.eliteMult : boss ? cfg.bossMult : 1) * (1 + greed);
  return layout.map((e, slot): UnitDef | null => {
    if (!e) return null;
    const base = ctx.content.units[e.unit];
    if (!base) throw new TowerError('invalid_config', `Башня, этаж ${n}: враг ${e.unit} не найден`);
    const k = e.mult * k0;
    return {
      ...base,
      id: `trun_f${n}_${slot}`,
      stats: { ...base.stats, hp: Math.max(1, Math.round(base.stats.hp * k)), atk: Math.round(base.stats.atk * k), def: Math.round(base.stats.def * k) },
    };
  });
}

/** Развилка к этажу n: босс-этаж — один путь; первый этаж — бой; перед боссом — отдых и ещё один путь; иначе два разных. */
function genPaths(run: Pick<TowerRun, 'seed'>, n: number, cfg: TowerRunConfig): TowerNodeKind[] {
  if (n % cfg.bossEvery === 0) return ['boss'];
  if (n === 1) return ['battle'];
  const r = rngOf(run, n, 'path');
  const kinds = (['battle', 'elite', 'event', 'rest'] as const).filter((k) => (cfg.paths.minFloor[k] ?? 1) <= n && (cfg.paths.weights[k] ?? 0) > 0);
  const pick = (from: TowerNodeKind[]): TowerNodeKind => {
    const total = from.reduce((s, k) => s + (cfg.paths.weights[k] ?? 0), 0);
    let x = r.next() * total;
    for (const k of from) {
      x -= cfg.paths.weights[k] ?? 0;
      if (x < 0) return k;
    }
    return from[from.length - 1];
  };
  const preBoss = (n + 1) % cfg.bossEvery === 0 && kinds.includes('rest');
  const a: TowerNodeKind = preBoss ? 'rest' : pick([...kinds]);
  const rest = kinds.filter((k) => k !== a);
  return rest.length ? [a, pick(rest)] : [a];
}

// ---------- карты ----------

/** Карту можно предложить: не взята, условие requires выполнено. */
function offerable(b: Blessing, run: TowerRun, save: SaveState): boolean {
  if (run.cards.includes(b.id)) return false;
  if (b.requires === 'fallen') return run.fallen.length > 0;
  if (b.requires === 'slot') return run.squad.some((x) => x === null) && reserveHeroes(save, run).length > 0;
  return true;
}

/** Герои запаса: есть в ростере, не были в забеге (ни в отряде, ни павшими), без второй копии карточки в отряде. */
function reserveHeroes(save: SaveState, run: TowerRun): HeroState[] {
  const used = new Set([...run.squad.filter((x): x is string => !!x), ...run.fallen, ...Object.keys(run.hp)]);
  const inSquadTemplates = new Set(run.squad.map((id) => save.heroes.find((h) => h.id === id)?.templateId).filter(Boolean));
  return save.heroes
    .filter((h) => !used.has(h.id) && !inSquadTemplates.has(h.templateId))
    .sort((x, y) => CARD_RARITIES.indexOf(y.rarity) - CARD_RARITIES.indexOf(x.rarity) || y.level - x.level || (x.id < y.id ? -1 : 1));
}

/** Сколько вариантов при выборе карты. */
export function choiceCount(save: SaveState, cfg: TowerRunConfig): number {
  return cfg.choices + Math.floor(upgradeValue(save, cfg, 'extraChoice'));
}

type Source = NonNullable<TowerRun['pending']> extends infer P ? (P extends { kind: 'blessing'; source: infer S } ? S : never) : never;

/** Варианты карт: редкость по весам источника (не ниже min), без повторов. */
function rollOptions(save: SaveState, run: TowerRun, source: Source, key: number, rolls: number, cfg: TowerRunConfig, min: BlessingRarity = 'common'): string[] {
  const r = rngOf(run, key, `bless:${source}:${rolls}`);
  const weights = cfg.rarity[source === 'upgrade' ? 'start' : source];
  const minIdx = BLESSING_RARITIES.indexOf(min);
  let pool = cfg.blessings.filter((b) => offerable(b, run, save) && BLESSING_RARITIES.indexOf(b.rarity) >= minIdx);
  const out: string[] = [];
  const n = choiceCount(save, cfg);
  while (out.length < n && pool.length) {
    const rars = BLESSING_RARITIES.filter((x) => BLESSING_RARITIES.indexOf(x) >= minIdx && pool.some((b) => b.rarity === x) && (weights[x] ?? 0) > 0);
    let rarity: BlessingRarity | undefined;
    if (rars.length) {
      const total = rars.reduce((s, x) => s + (weights[x] ?? 0), 0);
      let x = r.next() * total;
      for (const q of rars) {
        x -= weights[q] ?? 0;
        if (x < 0) {
          rarity = q;
          break;
        }
      }
      rarity ??= rars[rars.length - 1];
    }
    const from = rarity ? pool.filter((b) => b.rarity === rarity) : pool;
    const pick = from[r.int(from.length)];
    out.push(pick.id);
    pool = pool.filter((b) => b !== pick);
  }
  return out;
}

function setBlessing(save: SaveState, run: TowerRun, source: Source, cfg: TowerRunConfig, min?: BlessingRarity): TowerRun {
  const options = rollOptions(save, run, source, run.floor, 0, cfg, min);
  if (!options.length) return run;
  return { ...run, pending: { kind: 'blessing', options, source, rolls: 0 } };
}

// ---------- статус для экрана ----------

export interface TowerRunHero {
  id: string;
  /** ОЗ в тысячных (0 — пал). */
  hp: number;
  fallen: boolean;
  slot: number | null;
}

export interface TowerRunView {
  unlocked: boolean;
  unlockAfterStage: string | null;
  /** Лучший этаж (рекорд). */
  best: number;
  shards: number;
  runs: number;
  /** Этажей, за которые сегодня уже дана добыча (новые этажи выше — с добычей). */
  lootFloorToday: number;
  last?: TowerRunSummary;
  run: TowerRun | null;
  heroes: TowerRunHero[];
  cards: Blessing[];
  families: FamilyState[];
  /** Следующий этаж забега. */
  next: number;
  maxFloor: number;
}

export function towerRunStatus(save: SaveState, ctx: TowerContext, day?: string): TowerRunView {
  const cfg = runConfig(ctx);
  const t: TowerSave = save.tower;
  const run = t.run ?? null;
  const heroes: TowerRunHero[] = [];
  if (run) {
    run.squad.forEach((id, slot) => {
      if (id) heroes.push({ id, hp: run.hp[id] ?? 1000, fallen: false, slot });
    });
    for (const id of run.fallen) heroes.push({ id, hp: 0, fallen: true, slot: null });
  }
  return {
    unlocked: towerUnlocked(save, ctx),
    unlockAfterStage: ctx.tower.unlockAfterStage,
    best: t.floor,
    shards: t.shards ?? 0,
    runs: t.runs ?? 0,
    lootFloorToday: day && t.lootDay === day ? (t.lootFloor ?? 0) : 0,
    ...(t.last ? { last: t.last } : {}),
    run,
    heroes,
    cards: run ? run.cards.map((id) => blessingById(cfg, id)).filter((b): b is Blessing => !!b) : [],
    families: familyStates(run?.cards ?? [], cfg),
    next: (run?.floor ?? 0) + 1,
    maxFloor: ctx.tower.maxFloor,
  };
}

/** Событие этажа забега (выбранный путь «Событие»). */
export function towerEventDef(save: SaveState, ctx: TowerContext): TowerEventDef | null {
  const p = save.tower.run?.pending;
  if (p?.kind !== 'event') return null;
  return runConfig(ctx).events.find((e) => e.id === p.event) ?? null;
}

// ---------- ход забега ----------

export type TowerRunEvent =
  | { type: 'towerRecord'; floor: number; gems: number }
  | { type: 'blessedOre'; count: number }
  | { type: 'towerFallen'; heroes: string[] }
  | { type: 'towerRevived'; heroes: string[] }
  | { type: 'towerRunEnded'; summary: TowerRunSummary };

function need(save: SaveState): TowerRun {
  const r = save.tower.run;
  if (!r) throw new TowerError('no_run', 'Забег не начат');
  return r;
}

/** save.tower в порядке ключей схемы (serialize(deserialize(x)) === serialize(x)); undefined-поля убираются. */
function normTower(t: TowerSave): TowerSave {
  return TowerSaveSchema.parse(JSON.parse(JSON.stringify(t)));
}

const withRun = (save: SaveState, run: TowerRun | undefined, patch: Partial<TowerSave> = {}): SaveState => {
  const tower: TowerSave = { ...save.tower, ...patch };
  if (run) tower.run = run;
  else delete tower.run;
  return { ...save, tower: normTower(tower) };
};

/**
 * Начать забег отрядом heroIds (5 слотов, как save.squad). Башня открыта, забега нет, отряд не пуст, без второй копии
 * карточки. Раны 0, карт нет (или выбор стартовой карты — улучшение «Дар Башни»), первый этаж — бой.
 */
export function startTowerRun(save: SaveState, heroIds: readonly (string | null)[], ctx: TowerContext): SaveState {
  const cfg = runConfig(ctx);
  if (!towerUnlocked(save, ctx)) throw new TowerError('tower_locked', 'Башня ещё закрыта');
  if (save.tower.run) throw new TowerError('run_active', 'Забег уже идёт');
  const squad = [0, 1, 2, 3, 4].map((i) => heroIds[i] ?? null);
  const ids = squad.filter((x): x is string => !!x);
  if (!ids.length) throw new TowerError('bad_choice', 'В отряде нет героев');
  if (new Set(ids).size !== ids.length || ids.some((id) => !save.heroes.some((h) => h.id === id))) throw new TowerError('bad_choice', 'Неизвестный или повторный герой');
  if (duplicateCardsInSquad(save, squad).length) throw new TowerError('bad_choice', 'В отряде может быть только одна копия каждой карточки');
  const runs = save.tower.runs ?? 0;
  const st = frontierStage(save, ctx);
  const lootBase = st?.rewards ?? { gold: 0, jobExp: 0 };
  let run: TowerRun = {
    seed: runSeed('tower', save.createdAt, save.battleSeq, runs),
    tier: towerTier(save, ctx),
    floor: 0,
    squad,
    hp: Object.fromEntries(ids.map((id) => [id, 1000])),
    fallen: [],
    cards: [],
    paths: genPaths({ seed: 0 }, 1, cfg),
    shards: 0,
    rerolls: Math.floor(upgradeValue(save, cfg, 'reroll')),
    lives: Math.floor(upgradeValue(save, cfg, 'secondWind')),
    loot: { gold: Math.floor((lootBase.gold ?? 0) * cfg.lootPerFloor), jobExp: Math.floor((lootBase.jobExp ?? 0) * cfg.lootPerFloor) },
    battles: 0,
    best: save.tower.floor,
    gems: 0,
  };
  const start = upgradeValue(save, cfg, 'startBlessing');
  if (start > 0) run = setBlessing(save, run, start >= 2 ? 'upgrade' : 'start', cfg, start >= 2 ? 'rare' : 'common');
  return withRun(save, run, { runs: runs + 1, last: save.tower.last ? { ...save.tower.last, seen: true } : undefined });
}

/** Этаж пройден (бой, событие, отдых): +1 этаж, осколки, выбор карты (каждые blessingEvery / элита / босс), новая развилка. */
function advance(save: SaveState, run: TowerRun, kind: TowerNodeKind, cfg: TowerRunConfig): TowerRun {
  const floor = run.floor + 1;
  const shards = run.shards + (isBattleNode(kind) ? cfg.shards.floor : 0) + (kind === 'elite' ? cfg.shards.elite : kind === 'boss' ? cfg.shards.boss : 0);
  let next: TowerRun = { ...run, floor, shards, node: undefined, paths: genPaths(run, floor + 1, cfg) };
  if (!next.pending) {
    if (kind === 'boss') next = setBlessing(save, next, 'boss', cfg, 'rare');
    else if (kind === 'elite') next = setBlessing(save, next, 'elite', cfg, 'rare');
    else if (floor % cfg.blessingEvery === 0) next = setBlessing(save, next, 'floor', cfg);
  }
  return next;
}

/** Лечение живых героев забега на pct (доля макс. ОЗ). */
function healRun(run: TowerRun, pct: number): TowerRun {
  if (pct <= 0) return run;
  const hp = { ...run.hp };
  for (const id of run.squad) if (id && hp[id] > 0) hp[id] = Math.min(1000, hp[id] + Math.round(pct * 1000));
  return { ...run, hp };
}

/** Поднять павших (все или первого) с hpPct: в первые свободные слоты. */
function reviveRun(run: TowerRun, hpPct: number, count = Infinity): { run: TowerRun; revived: string[] } {
  const squad = [...run.squad];
  const hp = { ...run.hp };
  const fallen = [...run.fallen];
  const revived: string[] = [];
  while (fallen.length && revived.length < count) {
    const slot = squad.indexOf(null);
    if (slot < 0) break;
    const id = fallen.shift()!;
    squad[slot] = id;
    hp[id] = Math.max(1, Math.round(hpPct * 1000));
    revived.push(id);
  }
  return { run: { ...run, squad, hp, fallen }, revived };
}

/** Выбрать путь развилки (индекс в run.paths). Бой — ждёт штурма; отдых — лечение и этаж; событие — ждёт выбора. */
export function chooseTowerPath(save: SaveState, index: number, ctx: TowerContext): SaveState {
  const cfg = runConfig(ctx);
  const run = need(save);
  if (run.pending) throw new TowerError('bad_choice', 'Сначала завершите выбор');
  const kind = run.paths[index];
  if (!kind) throw new TowerError('bad_choice', 'Нет такого пути');
  if (isBattleNode(kind)) return withRun(save, { ...run, node: kind, note: undefined });
  if (kind === 'rest') {
    const healed = healRun(run, cfg.restHeal + upgradeValue(save, cfg, 'restHeal'));
    return withRun(save, advance(save, { ...healed, note: 'Привал у костра: отряд перевязал раны.' }, 'rest', cfg));
  }
  // BUG-197: событие не повторяется в забеге; «обмен карты» (Писарь) — только когда карты есть.
  const seen = run.seenEvents ?? [];
  const fits = cfg.events.filter((e) => !e.options.some((o) => o.requires?.cards) || run.cards.length > 0);
  const fresh = fits.filter((e) => !seen.includes(e.id));
  const pool = fresh.length ? fresh : fits.length ? fits : cfg.events;
  const ev = pool[rngOf(run, run.floor + 1, 'event').int(pool.length)];
  return withRun(save, { ...run, node: undefined, note: undefined, pending: { kind: 'event', event: ev.id }, seenEvents: [...seen, ev.id] });
}

/** Можно ли выбрать вариант события (требования). */
export function eventOptionAllowed(run: TowerRun, opt: TowerEventDef['options'][number]): boolean {
  const q = opt.requires;
  if (!q) return true;
  if (q.shards && run.shards < q.shards) return false;
  if (q.fallen && run.fallen.length === 0) return false;
  if (q.cards && run.cards.length === 0) return false;
  return true;
}

/** Выбор в событии: исходы по порядку (бросок — от seed забега и этажа). Итог — в run.note. */
export function resolveTowerEvent(save: SaveState, option: number, ctx: TowerContext): { save: SaveState; text: string; events: TowerRunEvent[] } {
  const cfg = runConfig(ctx);
  let run = need(save);
  const ev = towerEventDef(save, ctx);
  if (!ev) throw new TowerError('bad_choice', 'Сейчас нет события');
  const opt = ev.options[option];
  if (!opt || !eventOptionAllowed(run, opt)) throw new TowerError('bad_choice', 'Этот вариант недоступен');
  run = { ...run, pending: undefined };
  const events: TowerRunEvent[] = [];
  let text = opt.result;
  const r = rngOf(run, run.floor + 1, `event:${ev.id}`);
  const apply = (o: EventOutcome) => {
    switch (o.kind) {
      case 'hp': {
        const hp = { ...run.hp };
        for (const id of run.squad) if (id && hp[id] > 0) hp[id] = Math.max(50, Math.min(1000, hp[id] + Math.round(o.pct * 1000)));
        run = { ...run, hp };
        return;
      }
      case 'shards':
        run = { ...run, shards: Math.max(0, run.shards + o.n) };
        return;
      case 'revive': {
        const out = reviveRun(run, o.hpPct, 1);
        run = out.run;
        if (out.revived.length) events.push({ type: 'towerRevived', heroes: out.revived });
        return;
      }
      case 'card':
        run = setBlessing(save, run, 'event', cfg, o.rarity);
        return;
      case 'upgradeCard': {
        const last = run.cards[run.cards.length - 1];
        const b = last ? blessingById(cfg, last) : undefined;
        if (!b) return;
        const idx = Math.min(BLESSING_RARITIES.length - 1, BLESSING_RARITIES.indexOf(b.rarity) + 1);
        run = setBlessing(save, { ...run, cards: run.cards.slice(0, -1) }, 'event', cfg, BLESSING_RARITIES[idx]);
        return;
      }
      case 'gamble': {
        const win = r.next() < o.chance;
        if (!win && opt.resultLose) text = opt.resultLose;
        for (const x of win ? o.win : o.lose) apply(x);
        return;
      }
    }
  };
  for (const o of opt.outcomes) apply(o);
  run = advance(save, { ...run, note: text }, 'event', cfg);
  return { save: withRun(save, run), text, events };
}

/** Выбрать карту из предложенных. Забеговые эффекты (воскрешение, новобранец) — сразу. */
export function pickTowerBlessing(save: SaveState, cardId: string, ctx: TowerContext): { save: SaveState; events: TowerRunEvent[] } {
  const cfg = runConfig(ctx);
  let run = need(save);
  const p = run.pending;
  if (p?.kind !== 'blessing' || !p.options.includes(cardId)) throw new TowerError('bad_choice', 'Этой карты нет в выборе');
  const card = blessingById(cfg, cardId)!;
  run = { ...run, pending: undefined, cards: [...run.cards, cardId] };
  const events: TowerRunEvent[] = [];
  for (const e of card.effects) {
    if (e.kind === 'reviveRun') {
      const out = reviveRun(run, e.hpPct);
      run = out.run;
      if (out.revived.length) events.push({ type: 'towerRevived', heroes: out.revived });
    } else if (e.kind === 'recruit') {
      const slot = run.squad.indexOf(null);
      const hero = reserveHeroes(save, run)[0];
      if (slot >= 0 && hero) {
        const squad = [...run.squad];
        squad[slot] = hero.id;
        run = { ...run, squad, hp: { ...run.hp, [hero.id]: 1000 } };
        events.push({ type: 'towerRevived', heroes: [hero.id] });
      }
    }
  }
  return { save: withRun(save, run), events };
}

/** Перетасовать предложенные карты (улучшение «Перетасовка»: rerolls за забег). */
export function rerollTowerBlessing(save: SaveState, ctx: TowerContext): SaveState {
  const cfg = runConfig(ctx);
  const run = need(save);
  const p = run.pending;
  if (p?.kind !== 'blessing') throw new TowerError('bad_choice', 'Сейчас нет выбора карты');
  if (run.rerolls <= 0) throw new TowerError('bad_choice', 'Перетасовок не осталось');
  const min = p.source === 'elite' || p.source === 'boss' || p.source === 'upgrade' ? 'rare' : 'common';
  const options = rollOptions(save, run, p.source, run.floor, p.rolls + 1, cfg, min);
  return withRun(save, { ...run, rerolls: run.rerolls - 1, pending: { ...p, options: options.length ? options : p.options, rolls: p.rolls + 1 } });
}

/** Описание врагов выбранного боя (превью и сцена боя). */
export function towerRunFloor(save: SaveState, ctx: TowerContext): { floor: number; kind: TowerNodeKind; enemies: (UnitDef | null)[] } {
  const run = need(save);
  const kind = run.node ?? run.paths[0];
  return { floor: run.floor + 1, kind, enemies: runFloorEnemies(run, run.floor + 1, kind, ctx) };
}

/** Превью пути развилки (враги для боёв). */
export function towerPathPreview(save: SaveState, index: number, ctx: TowerContext): { floor: number; kind: TowerNodeKind; enemies: (UnitDef | null)[] | null } {
  const run = need(save);
  const kind = run.paths[index];
  return { floor: run.floor + 1, kind, enemies: isBattleNode(kind) ? runFloorEnemies(run, run.floor + 1, kind, ctx) : null };
}

/** Отряд забега для боя: герои (с экипировкой) по слотам, ОЗ в тысячных. */
export function towerRunSquad(save: SaveState, ctx: TowerContext): { squad: (UnitDef | null)[]; hp: Record<string, number> } {
  const run = need(save);
  const gctx = withGear(ctx, save);
  const hp: Record<string, number> = {};
  const squad = run.squad.map((id) => {
    if (!id) return null;
    const hero = save.heroes.find((h) => h.id === id);
    if (!hero) return null;
    const u = buildUnit(hero, gctx);
    hp[u.id] = run.hp[id] ?? 1000;
    return u;
  });
  return { squad, hp };
}

export interface TowerFightOutcome {
  save: SaveState;
  floor: number;
  kind: TowerNodeKind;
  result: BattleResult;
  enemies: (UnitDef | null)[];
  events: TowerRunEvent[];
  /** Забег окончен этим боем (поражение или вершина). */
  ended?: TowerRunSummary;
}

/** Закончить забег: осколки в копилку, добыча дня за новые этажи, итог в save.tower.last. */
function finishRun(save: SaveState, day: string, won: boolean, ctx: TowerContext, end: NonNullable<TowerRunSummary['end']>): { save: SaveState; summary: TowerRunSummary } {
  const cfg = runConfig(ctx);
  const run = need(save);
  const greedShards = runEffects(run.cards, cfg).reduce((s, x) => s + (x.effect.kind === 'greed' ? x.effect.shards : 0), 0);
  const shards = Math.floor(run.shards * (1 + upgradeValue(save, cfg, 'shards') + greedShards));
  const paid = save.tower.lootDay === day ? (save.tower.lootFloor ?? 0) : 0;
  const floors = Math.max(0, run.floor - paid);
  const gold = floors * run.loot.gold;
  const jobExp = floors * run.loot.jobExp;
  const summary: TowerRunSummary = { floor: run.floor, shards, gold, jobExp, gems: run.gems, record: run.floor > run.best, won, seen: false, end };
  // BUG-196: рекорд — пройденный этаж забега, и событие/отдых тоже (иначе итог «Этаж 3 · Новый рекорд!» при «Лучший этаж 2»).
  // Гемы за рекорд дают только бои (fightTowerFloor), здесь — только сам рекорд.
  let next = withRun(save, undefined, {
    ...(run.floor > save.tower.floor ? { floor: run.floor } : {}),
    shards: (save.tower.shards ?? 0) + shards,
    lootDay: day,
    lootFloor: Math.max(paid, run.floor),
    last: summary,
  });
  if (gold > 0) next = { ...next, resources: { ...next.resources, gold: next.resources.gold + gold } };
  if (jobExp > 0) next = addHeroExp(next, jobExp);
  return { save: next, summary };
}

/** «Сдаться»: забег окончен, награда за пройденные этажи. */
export function abandonTowerRun(save: SaveState, day: string, ctx: TowerContext): { save: SaveState; summary: TowerRunSummary } {
  need(save);
  return finishRun(save, day, false, ctx, 'surrender');
}

/** Итог прошлого забега показан. */
export function markTowerSummarySeen(save: SaveState): SaveState {
  const last = save.tower.last;
  if (!last || last.seen) return save;
  return { ...save, tower: { ...save.tower, last: { ...last, seen: true } } };
}

/** seed боя этажа n забега (одинаков при пересчёте с вводами игрока). */
export const towerFightSeed = (run: Pick<TowerRun, 'seed'>, n: number) => runSeed(run.seed, n, 'fight');

/**
 * Штурм выбранного боя (run.node). Раны — с прошлых этажей, карты — хуками боя. control — ручная ульта (вводы игрока).
 * Победа: раны переходят, павшие выбывают, лечение после боя, этаж, осколки, выбор карты, рекорд (гемы, руда на боссе).
 * Поражение: забег окончен (finishRun). battleSeq + 1 всегда.
 */
export function fightTowerFloor(save: SaveState, day: string, ctx: TowerContext, control?: PlayerControl): TowerFightOutcome {
  const cfg = runConfig(ctx);
  let run = need(save);
  const kind = run.node;
  if (!kind || !isBattleNode(kind)) throw new TowerError('bad_choice', 'Сначала выберите путь');
  const n = run.floor + 1;
  const enemies = runFloorEnemies(run, n, kind, ctx);
  const { squad, hp } = towerRunSquad(save, ctx);
  if (!squad.some(Boolean)) throw new TowerError('bad_choice', 'В отряде забега никого нет');
  const bb = blessingBattle(runEffects(run.cards, cfg), hp)!;
  const seed = towerFightSeed(run, n);
  const result = simulateBattle(ctx.content, squad, enemies, seed, {
    combat: ctx.combat,
    hooks: bb.hooks,
    ...(control ? { manualUlt: control.manualUlt ?? false, inputs: control.inputs ?? [] } : {}),
  });
  let next: SaveState = { ...save, battleSeq: save.battleSeq + 1 };
  run = { ...run, battles: run.battles + 1 };
  const events: TowerRunEvent[] = [];
  if (result.winner !== 'A') {
    const out = finishRun(withRun(next, run), day, false, ctx, 'defeat');
    events.push({ type: 'towerRunEnded', summary: out.summary });
    return { save: out.save, floor: n, kind, result, enemies, events, ended: out.summary };
  }
  // Раны и павшие.
  const end = bb.endHp();
  const newHp = { ...run.hp };
  const squadIds = [...run.squad];
  const fell: string[] = [];
  squadIds.forEach((id, slot) => {
    if (!id) return;
    const v = end[id] ?? newHp[id] ?? 1000;
    if (v <= 0) {
      fell.push(id);
      squadIds[slot] = null;
      delete newHp[id];
    } else newHp[id] = v;
  });
  run = { ...run, hp: newHp, squad: squadIds, fallen: [...run.fallen, ...fell] };
  if (fell.length) events.push({ type: 'towerFallen', heroes: fell });
  // «Второе дыхание»: павший в этом бою встаёт.
  if (fell.length && run.lives > 0) {
    const out = reviveRun({ ...run, fallen: [...fell.slice(0, 1), ...run.fallen.filter((x) => x !== fell[0])] }, 0.3, 1);
    run = { ...out.run, lives: run.lives - 1 };
    if (out.revived.length) events.push({ type: 'towerRevived', heroes: out.revived });
  }
  const afterHeal = runEffects(run.cards, cfg).reduce((s, x) => s + (x.effect.kind === 'afterHeal' ? x.effect.pct : 0), 0);
  run = healRun(run, cfg.afterBattleHeal + upgradeValue(save, cfg, 'afterHeal') + afterHeal);
  run = advance(next, run, kind, cfg);
  // Рекорд: гемы за новый лучший этаж, босс — ещё гемы и «Благословенная руда».
  if (run.floor > next.tower.floor) {
    const gems = cfg.record.gemsPerFloor + (kind === 'boss' ? cfg.record.bossGems : 0);
    run = { ...run, gems: run.gems + gems };
    next = { ...next, currency: { ...next.currency, gems: next.currency.gems + gems } };
    next = withRun(next, run, { floor: run.floor });
    events.push({ type: 'towerRecord', floor: run.floor, gems });
    if (kind === 'boss') {
      const ore = grantBlessedOre(next, seed, ctx as { equipment?: EquipmentConfig });
      next = ore.save;
      if (ore.count) events.push({ type: 'blessedOre', count: ore.count });
    }
  } else next = withRun(next, run);
  if (run.floor >= ctx.tower.maxFloor) {
    const out = finishRun(next, day, true, ctx, 'top');
    events.push({ type: 'towerRunEnded', summary: out.summary });
    return { save: out.save, floor: n, kind, result, enemies, events, ended: out.summary };
  }
  return { save: next, floor: n, kind, result, enemies, events };
}
