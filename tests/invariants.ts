/**
 * Q: общие инварианты для фазз-тестов (tests/fuzz-*.test.ts).
 * Функции возвращают список нарушений (пустой — всё хорошо), чтобы тест мог напечатать их вместе с seed.
 */
import {
  deserialize,
  CARD_RARITIES,
  duplicateCardsInSquad,
  EquipmentError,
  FeatureError,
  GameRuleError,
  HeroError,
  MetaError,
  SaveStateSchema,
  serialize,
  TowerError,
  type BattleEvent,
  type BattleResult,
  type CombatConfig,
  type FullContext,
  type SaveState,
} from '../src/core';

/** Все числа в объекте (рекурсивно) с путями. */
function numbers(v: unknown, path: string, out: [string, number][]): void {
  if (typeof v === 'number') out.push([path, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => numbers(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) numbers(x, `${path}.${k}`, out);
}

/** Действия, которые может совершить только живой юнит (поле unit — сам действующий). */
const ACTOR_EVENTS = new Set<BattleEvent['type']>(['turn', 'skip', 'move', 'attack', 'ult', 'passive']);

/**
 * Инварианты лога боя:
 * - ровно одно событие end, и оно последнее; winner/reason/duration совпадают с результатом;
 * - время событий не убывает и не больше лимита, duration ≤ timeLimitSeconds;
 * - ни одного NaN/Infinity ни в одном числовом поле (события, отчёт, снимки);
 * - hp в damage/heal в [0; maxHp], щит ≥ 0, энергия в [0; energy.max];
 * - мёртвый юнит не действует, не двигается, не получает урон/лечение/щит/статусы и не умирает повторно;
 *   его статусы с уроном за ход (dot) могут доигрывать — источник dot-урона может быть мёртв;
 * - wipe — у проигравших все мертвы, у победителя кто-то жив; hp в death = 0.
 */
export function battleProblems(r: BattleResult, cfg: CombatConfig): string[] {
  const p: string[] = [];
  const ends = r.log.filter((e) => e.type === 'end');
  if (ends.length !== 1) p.push(`событий end: ${ends.length}`);
  const last = r.log[r.log.length - 1];
  if (last?.type !== 'end') p.push(`последнее событие не end: ${last?.type}`);
  else {
    if (last.winner !== r.winner || last.reason !== r.reason) p.push('end не совпадает с winner/reason результата');
    if (last.t !== r.duration) p.push(`end.t ${last.t} ≠ duration ${r.duration}`);
  }
  if (!(r.duration >= 0 && r.duration <= cfg.timeLimitSeconds + 1e-9)) p.push(`duration ${r.duration} вне [0; ${cfg.timeLimitSeconds}]`);

  const nums: [string, number][] = [];
  numbers(r.log, 'log', nums);
  numbers(r.report, 'report', nums);
  numbers(r.units, 'units', nums);
  for (const [path, n] of nums) if (!Number.isFinite(n)) p.push(`${path} = ${n}`);

  const maxHp = new Map(r.units.map((u) => [u.uid, u.maxHp]));
  const side = new Map(r.units.map((u) => [u.uid, u.side]));
  const dead = new Set<string>();
  const known = (uid: string, e: BattleEvent) => {
    if (!maxHp.has(uid)) p.push(`#${r.log.indexOf(e)} ${e.type}: неизвестный юнит ${uid}`);
  };
  const energyOk = (v: number) => v >= 0 && v <= cfg.energy.max;
  let lastT = 0;
  r.log.forEach((e, i) => {
    const at = `#${i} t=${e.t} ${e.type}`;
    if (e.t < lastT) p.push(`${at}: время убывает (${lastT} → ${e.t})`);
    if (e.t > cfg.timeLimitSeconds + 1e-9) p.push(`${at}: позже лимита`);
    lastT = e.t;
    if (i > 0 && r.log[i - 1].type === 'end') p.push(`${at}: событие после end`);
    if ('unit' in e) known(e.unit, e);
    if ('target' in e) known(e.target, e);
    if ('unit' in e && ACTOR_EVENTS.has(e.type) && dead.has(e.unit)) p.push(`${at}: мёртвый ${e.unit} действует`);
    switch (e.type) {
      case 'damage': {
        const mx = maxHp.get(e.target) ?? Infinity;
        if (e.hp < 0 || e.hp > mx) p.push(`${at}: hp ${e.hp} вне [0; ${mx}] у ${e.target}`);
        if (e.shield < 0) p.push(`${at}: щит ${e.shield} < 0`);
        if (e.amount < 0 || e.absorbed < 0 || e.absorbed > e.amount) p.push(`${at}: amount ${e.amount}, absorbed ${e.absorbed}`);
        if (!energyOk(e.energy)) p.push(`${at}: энергия ${e.energy}`);
        if (dead.has(e.target)) p.push(`${at}: урон по мёртвому ${e.target}`);
        if (!e.dot && dead.has(e.source)) p.push(`${at}: мёртвый ${e.source} наносит урон`);
        break;
      }
      case 'heal': {
        const mx = maxHp.get(e.target) ?? Infinity;
        if (e.hp < 0 || e.hp > mx) p.push(`${at}: hp ${e.hp} вне [0; ${mx}] у ${e.target}`);
        if (e.amount < 0) p.push(`${at}: лечение ${e.amount} < 0`);
        if (dead.has(e.target)) p.push(`${at}: лечение мёртвого ${e.target}`);
        if (dead.has(e.source)) p.push(`${at}: мёртвый ${e.source} лечит`);
        break;
      }
      case 'buff':
        if (e.amount < 0 || e.shield < 0) p.push(`${at}: щит ${e.amount}/${e.shield}`);
        if (dead.has(e.target) || dead.has(e.source)) p.push(`${at}: щит с участием мёртвого`);
        break;
      case 'status':
        if (e.action === 'apply' && (dead.has(e.target) || dead.has(e.source))) p.push(`${at}: статус с участием мёртвого`);
        if (e.action === 'expire' && dead.has(e.target)) p.push(`${at}: статус истёк у мёртвого`);
        break;
      case 'energy':
        if (!energyOk(e.energy)) p.push(`${at}: энергия ${e.energy}`);
        if (dead.has(e.unit)) p.push(`${at}: энергия мёртвому`);
        break;
      case 'attack':
        if (!energyOk(e.energy)) p.push(`${at}: энергия ${e.energy}`);
        for (const t of e.targets) if (dead.has(t)) p.push(`${at}: цель ${t} мертва`);
        break;
      case 'ult':
        for (const t of e.targets) if (dead.has(t)) p.push(`${at}: цель ${t} мертва`);
        break;
      case 'move':
        if (!(e.duration >= 0)) p.push(`${at}: длительность ${e.duration}`);
        break;
      case 'death': {
        if (dead.has(e.unit)) p.push(`${at}: ${e.unit} умирает повторно`);
        dead.add(e.unit);
        break;
      }
    }
  });

  if (r.reason === 'wipe') {
    const loser = r.winner === 'A' ? 'B' : 'A';
    for (const u of r.units) {
      if (u.side === loser && !dead.has(u.uid)) p.push(`wipe: ${u.uid} проигравшей стороны жив`);
    }
    const winnerAlive = r.units.some((u) => u.side === r.winner && !dead.has(u.uid));
    // Обе стороны пустые/мёртвые на старте — победитель без живых допустим только без юнитов вообще.
    if (!winnerAlive && r.units.some((u) => u.side === r.winner)) p.push('wipe: у победителя никого в живых');
  }
  for (const u of r.units) {
    const rep = r.report[u.uid];
    if (!rep) p.push(`нет отчёта для ${u.uid}`);
    else if (rep.alive === dead.has(u.uid)) p.push(`отчёт ${u.uid}: alive=${rep.alive}, а в логе ${dead.has(u.uid) ? 'умер' : 'жив'}`);
    if (!(u.maxHp > 0)) p.push(`${u.uid}: maxHp ${u.maxHp}`);
    if (!side.has(u.uid)) p.push(`${u.uid}: нет стороны`);
  }
  return p;
}

/** Классы ошибок, которые действия игрока бросают по правилам игры. Любое другое исключение — баг. */
export const RULE_ERRORS = [GameRuleError, FeatureError, EquipmentError, TowerError, MetaError, HeroError] as const;

export function isRuleError(e: unknown): boolean {
  return RULE_ERRORS.some((C) => e instanceof C);
}

/**
 * Инварианты сохранения:
 * - SaveStateSchema.parse проходит; serialize → deserialize даёт то же самое;
 * - ресурсы — неотрицательные целые; отряд — 5 слотов, существующие и неповторяющиеся герои;
 * - id героев уникальны, шаблоны карточек существуют, редкость в [baseRarity; maxRarity], уровень ≤ предела редкости;
 *   одна копия карточки в отряде; осколки, пул опыта и свитки — неотрицательные целые;
 * - предметы: id экземпляров уникальны, описания существуют, equippedBy — существующий герой,
 *   на герое не больше одного предмета в слоте;
 * - кампания: пройденные этапы существуют и не повторяются; башня не выше maxFloor;
 * - поручения: герои существуют и заняты не больше чем одним поручением; id на доске/в работе уникальны;
 * - пресеты: не больше лимита, id уникальны; полученные задания/пороги/достижения не повторяются.
 */
export function saveProblems(save: SaveState, ctx: FullContext): string[] {
  const p: string[] = [];
  const parsed = SaveStateSchema.safeParse(save);
  if (!parsed.success) p.push(`SaveStateSchema: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  try {
    const back = deserialize(serialize(save));
    if (serialize(back) !== serialize(save)) p.push('serialize/deserialize: данные изменились');
  } catch (e) {
    p.push(`deserialize: ${e instanceof Error ? e.message : String(e)}`);
  }

  const nonNegInt = (v: number, what: string) => {
    if (!(Number.isInteger(v) && v >= 0)) p.push(`${what} = ${v}`);
  };
  nonNegInt(save.resources.gold, 'gold');
  nonNegInt(save.currency.gems, 'gems');
  nonNegInt(save.currency.scrolls, 'scrolls');
  nonNegInt(save.resources.heroExp, 'heroExp');
  for (const [t, n] of Object.entries(save.shards)) nonNegInt(n, `shards.${t}`);
  nonNegInt(save.battleSeq, 'battleSeq');
  nonNegInt(save.tower.floor, 'tower.floor');
  if (save.tower.floor > ctx.tower.maxFloor) p.push(`tower.floor ${save.tower.floor} > maxFloor`);

  const dup = <T>(arr: readonly T[], what: string) => {
    const seen = new Set<T>();
    for (const x of arr) {
      if (seen.has(x)) p.push(`${what}: повтор ${String(x)}`);
      seen.add(x);
    }
  };

  const heroIds = new Set(save.heroes.map((h) => h.id));
  dup(save.heroes.map((h) => h.id), 'heroes');
  const ri = (r: string) => CARD_RARITIES.indexOf(r as (typeof CARD_RARITIES)[number]);
  for (const h of save.heroes) {
    const t = ctx.content.heroes[h.templateId];
    if (!t) {
      p.push(`герой ${h.id}: неизвестная карточка ${h.templateId}`);
      continue;
    }
    if (ri(h.rarity) < ri(t.baseRarity) || ri(h.rarity) > ri(t.maxRarity)) p.push(`герой ${h.id}: редкость ${h.rarity} вне ${t.baseRarity}…${t.maxRarity}`);
    const cap = ctx.cards.rarities[ri(h.rarity)]?.maxLevel ?? 0;
    if (h.level > cap) p.push(`герой ${h.id}: уровень ${h.level} > предела ${cap}`);
  }
  const story = [...ctx.progression.heroes.start, ...ctx.progression.heroes.recruits.map((r) => r.template)];
  for (const t of story) if (save.heroes.filter((h) => h.templateId === t).length > 1) p.push(`сюжетная карточка ${t} дважды`);
  if (duplicateCardsInSquad(save, save.squad).length) p.push('в отряде две копии одной карточки');

  if (save.squad.length !== 5) p.push(`в отряде ${save.squad.length} слотов`);
  for (const id of save.squad) if (id !== null && !heroIds.has(id)) p.push(`в отряде неизвестный герой ${id}`);
  dup(save.squad.filter((x): x is string => x !== null), 'squad');

  dup(save.inventory.items.map((i) => i.id), 'inventory');
  const slotOwner = new Set<string>();
  for (const it of save.inventory.items) {
    const def = ctx.equipment.items[it.itemId];
    if (!def) p.push(`предмет ${it.id}: неизвестное описание ${it.itemId}`);
    if (it.equippedBy === null) continue;
    if (!heroIds.has(it.equippedBy)) p.push(`предмет ${it.id} надет на несуществующего ${it.equippedBy}`);
    if (def) {
      const key = `${it.equippedBy}/${def.slot}`;
      if (slotOwner.has(key)) p.push(`на ${it.equippedBy} два предмета в слоте ${def.slot}`);
      slotOwner.add(key);
    }
  }

  const stageIds = new Set(ctx.content.stages.map((s) => s.id));
  dup(save.campaign.cleared, 'campaign.cleared');
  for (const s of save.campaign.cleared) if (!stageIds.has(s)) p.push(`пройден неизвестный этап ${s}`);

  dup(save.bounties.board.map((b) => b.id), 'bounties.board');
  dup(save.bounties.active.map((b) => b.id), 'bounties.active');
  dup(save.bounties.active.flatMap((b) => b.heroIds), 'герои на поручениях');
  for (const b of save.bounties.active) {
    for (const id of b.heroIds) if (!heroIds.has(id)) p.push(`поручение ${b.id}: неизвестный герой ${id}`);
    if (b.heroIds.length !== b.heroCount) p.push(`поручение ${b.id}: героев ${b.heroIds.length}, нужно ${b.heroCount}`);
  }
  if (save.bounties.refreshesUsed > ctx.meta.bounties.dailyRefreshes) p.push(`refreshesUsed ${save.bounties.refreshesUsed} > лимита`);

  if (save.presets.length > ctx.meta.bounties.presets.max) p.push(`пресетов ${save.presets.length} > лимита`);
  dup(save.presets.map((x) => x.id), 'presets');
  dup(save.daily.claimedQuests, 'daily.claimedQuests');
  dup(save.daily.activityClaimed, 'daily.activityClaimed');
  dup(save.achievements.claimed, 'achievements.claimed');
  const { freePerDay, gemCosts } = ctx.features.fastRewards;
  if (save.daily.fastRewardsUsed > freePerDay + gemCosts.length) p.push(`fastRewardsUsed ${save.daily.fastRewardsUsed} > лимита`);
  return p;
}

/** Глубокая заморозка: чистые функции не должны менять входной save (иначе TypeError в strict-режиме). */
export function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
}

/** Базовый seed фазз-тестов: FUZZ_SEED из окружения (воспроизведение) или фиксированный. */
export function fuzzSeeds(defaultStart: number, count: number): number[] {
  const env = process.env.FUZZ_SEED;
  if (env !== undefined && env !== '') return env.split(',').map((s) => Number(s.trim()) >>> 0);
  const n = Number(process.env.FUZZ_RUNS ?? '') || count;
  return Array.from({ length: n }, (_, i) => (defaultStart + i) >>> 0);
}
