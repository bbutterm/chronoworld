/**
 * «Охота на босса» (аналог гильдейской охоты AFK Arena, одиночная): attemptsPerDay раз в день отряд бьёт огромного
 * босса timeLimitSeconds секунд; награда — по сумме нанесённого урона (пороги data/hunt.json → tiers). Босс падать не
 * должен. «Зачистка» повторяет лучший результат по сегодняшнему боссу без боя. Попытки сбрасываются сменой дня `day`
 * (строка 'YYYY-MM-DD' от UI). Всё детерминировано: seed боя и выпавшего предмета — от сохранения (createdAt), дня и
 * номера попытки. Ни Date, ни Math.random здесь нет.
 */
import type { z } from 'zod';
import { simulateBattle } from '../battle';
import { squadUnits } from '../campaign/campaign';
import type { UnitDef } from '../content/schema';
import { itemPools, lootSeed } from '../equipment/chest';
import { progressChapter } from '../equipment/gates';
import { RARITIES } from '../equipment/schema';
import { dayNumber } from '../events/events';
import { addItems, withGear } from '../equipment/equipment';
import { grantBlessedOre } from '../equipment/refine';
import type { EquipmentConfig } from '../equipment/load';
import { addHeroExp } from '../heroes/level';
import { cardRng, grantHeroCards, rollHeroCards } from '../heroes/cardDrops';
import type { ProgressEvent } from '../progression/types';
import type { GameContext } from '../progression/types';
import { Rng } from '../rng';
import type { HuntState, ItemInstance, SaveState } from '../save/schema';
import type { BattleResult, Content } from '../types';
import { featureUnlocked, lockedText } from '../unlocks/unlocks';
import { HuntConfigSchema, type HuntConfig, type HuntReward, type HuntTier } from './schema';

export type HuntErrorCode = 'invalid_config' | 'hunt_locked' | 'no_attempts' | 'no_sweep';

/** Нарушение правил охоты. message — русский текст для игрока. */
export class HuntError extends Error {
  override name = 'HuntError';
  constructor(
    public code: HuntErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** GameContext + конфиг охоты (+ экипировка — для предметов наград и снаряжения героев). */
export interface HuntContext extends GameContext {
  hunt: HuntConfig;
  equipment?: EquipmentConfig;
}

/** id юнита босса в бою (описание — huntBoss(day).def). */
export const HUNT_BOSS_ID = 'hunt_boss';

export interface HuntBossView {
  /** Индекс в hunt.bosses (ротация по дням). */
  index: number;
  /** id исходного юнита из data/units. */
  unit: string;
  /** Описание босса для боя: статы × множители, id = HUNT_BOSS_ID. */
  def: UnitDef;
  title?: string;
}

/** Выданная награда (что реально получено). */
export interface HuntGrant {
  gold: number;
  jobExp: number;
  gems: number;
  /** Карты случайных героев (бросок по rewards.heroCards порога): события heroCard с id новых экземпляров. */
  heroCards: ProgressEvent[];
  /** Предметы (0 или 1). */
  items: ItemInstance[];
  /** «Благословенная руда»: только первая попытка дня (бой или зачистка) со взятым порогом, 1–3 штуки. */
  ore: number;
}

export interface HuntStatus {
  unlocked: boolean;
  /** «Откроется на этапе 1-8» или ''. */
  lockedText: string;
  boss: HuntBossView;
  attemptsPerDay: number;
  used: number;
  attemptsLeft: number;
  /** Лучший урон по сегодняшнему боссу (за всё время; 0 — ещё не бились). */
  best: number;
  /** Индекс порога лучшего урона (−1 — ни одного). */
  bestTier: number;
  /** Можно ли сейчас «Зачистку». */
  canSweep: boolean;
  tiers: readonly HuntTier[];
}

export interface HuntOutcome {
  save: SaveState;
  /** null — «Зачистка» (боя не было). */
  result: BattleResult | null;
  boss: HuntBossView;
  damage: number;
  /** Индекс достигнутого порога (−1 — ни одного, награды нет). */
  tier: number;
  grant: HuntGrant;
  /** Новый рекорд по этому боссу. */
  record: boolean;
  sweep: boolean;
}

function describe(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.length ? i.path.map(String).join('.') : '(корень)'}: ${i.message}`)
    .join('; ');
}

/** Разобрать data/hunt.json. Ошибка схемы → HuntError('invalid_config'). */
export function parseHuntConfig(json: unknown): HuntConfig {
  const r = HuntConfigSchema.safeParse(json);
  if (!r.success) throw new HuntError('invalid_config', `data/hunt.json: ${describe(r.error)}`);
  return r.data;
}

/** Перекрёстные проверки: боссы существуют и это монстры/боссы. */
export function validateHunt(cfg: HuntConfig, content: Content, problems: string[]): void {
  cfg.bosses.forEach((b, i) => {
    const u = content.units[b.unit];
    if (!u) problems.push(`data/hunt.json: bosses[${i}] — юнит ${b.unit} не найден в data/units`);
    else if (u.kind !== 'boss' && u.kind !== 'monster') problems.push(`data/hunt.json: bosses[${i}] — ${b.unit} не монстр (kind ${u.kind})`);
  });
}

/** GameContext → + hunt: схема и перекрёстные проверки (HuntError('invalid_config') со списком проблем). */
export function withHunt<C extends GameContext>(ctx: C, huntJson: unknown): C & { hunt: HuntConfig } {
  const hunt = parseHuntConfig(huntJson);
  const problems: string[] = [];
  validateHunt(hunt, ctx.content, problems);
  if (problems.length) throw new HuntError('invalid_config', problems.join('; '));
  return { ...ctx, hunt };
}

/** Босс дня: bosses[dayNumber mod длина], статы × множители. */
export function huntBoss(day: string, ctx: HuntContext): HuntBossView {
  const list = ctx.hunt.bosses;
  const n = dayNumber(day);
  const index = ((n % list.length) + list.length) % list.length;
  const b = list[index];
  const base = ctx.content.units[b.unit];
  if (!base) throw new HuntError('invalid_config', `Охота: юнит ${b.unit} не найден`);
  const def: UnitDef = {
    ...base,
    id: HUNT_BOSS_ID,
    ...(b.scale ? { visual: { ...base.visual, scale: b.scale } } : {}),
    stats: {
      ...base.stats,
      hp: Math.max(1, Math.round(base.stats.hp * b.hpMult)),
      atk: Math.round(base.stats.atk * b.atkMult),
      def: Math.round(base.stats.def * b.defMult),
    },
  };
  return { index, unit: b.unit, def, ...(b.title ? { title: b.title } : {}) };
}

/** Индекс высшего порога, которого достиг урон damage (−1 — ни одного). */
export function huntTier(damage: number, cfg: HuntConfig): number {
  let tier = -1;
  cfg.tiers.forEach((t, i) => {
    if (damage >= t.damage) tier = i;
  });
  return tier;
}

/** Награда порога (−1 — пусто). */
export function huntTierReward(tier: number, cfg: HuntConfig): HuntReward {
  return tier >= 0 ? cfg.tiers[tier].rewards : {};
}

/** Урон, нанесённый боссу за бой (урон по щиту — тоже урон). */
export function huntDamage(result: BattleResult): number {
  const boss = result.units.find((u) => u.side === 'B');
  return boss ? (result.report[boss.uid]?.damageTaken ?? 0) : 0;
}

/** Состояние охоты на день day: чужой (прошлый) день — попытки не тронуты. */
function stateOf(save: SaveState, day: string): { used: number; state: HuntState | undefined } {
  const h = save.hunt;
  // День назад (переведены часы) не даёт новых попыток: считаем попытки дня h.day.
  if (!h || day > h.day) return { used: 0, state: h };
  return { used: h.used, state: h };
}

/** Состояние охоты для экрана. */
export function huntStatus(save: SaveState, day: string, ctx: HuntContext): HuntStatus {
  const boss = huntBoss(day, ctx);
  const { used } = stateOf(save, day);
  const best = save.hunt?.best[boss.unit] ?? 0;
  const attemptsLeft = Math.max(0, ctx.hunt.attemptsPerDay - used);
  const unlocked = featureUnlocked(save, 'hunt', ctx);
  return {
    unlocked,
    lockedText: lockedText(save, 'hunt', ctx),
    boss,
    attemptsPerDay: ctx.hunt.attemptsPerDay,
    used,
    attemptsLeft,
    best,
    bestTier: huntTier(best, ctx.hunt),
    canSweep: unlocked && ctx.hunt.sweep && attemptsLeft > 0 && best > 0,
    tiers: ctx.hunt.tiers,
  };
}

/** seed попытки: сохранение, день, номер попытки за день (бой и предмет награды — разные потоки). */
export function huntSeed(save: Pick<SaveState, 'createdAt' | 'hunt'>, day: string, kind: 'battle' | 'loot' = 'battle'): number {
  const used = save.hunt && day <= save.hunt.day ? save.hunt.used : 0;
  return lootSeed('hunt', kind, save.createdAt, day, used);
}

function check(save: SaveState, day: string, ctx: HuntContext): void {
  if (!featureUnlocked(save, 'hunt', ctx)) throw new HuntError('hunt_locked', `Охота на босса: ${lockedText(save, 'hunt', ctx) || 'пока закрыта'}`);
  const { used } = stateOf(save, day);
  if (used >= ctx.hunt.attemptsPerDay) throw new HuntError('no_attempts', 'Попытки охоты на сегодня закончились — босс вернётся завтра');
}

/** Выдать награду порога: золото, гемы, опыт в пул, карты случайных героев (бросок от seed добычи), предмет (случайный этой редкости среди открытых в главе игрока). */
function grant(save: SaveState, reward: HuntReward, lootSeedValue: number, ctx: HuntContext): { save: SaveState; grant: HuntGrant } {
  const gold = reward.gold ?? 0;
  const gems = reward.gems ?? 0;
  const jobExp = reward.jobExp ?? 0;
  let next: SaveState = {
    ...save,
    resources: { ...save.resources, gold: save.resources.gold + gold },
    currency: { ...save.currency, gems: save.currency.gems + gems },
  };
  next = addHeroExp(next, jobExp);
  const cards = grantHeroCards(next, rollHeroCards(reward.heroCards, cardRng(lootSeedValue), ctx), ctx);
  next = cards.save;
  let items: ItemInstance[] = [];
  if (reward.item && ctx.equipment) {
    // Только предметы, открытые в главе игрока (minChapter); нет таких этой редкости — редкостью ниже.
    const pools = itemPools(ctx.equipment.items, progressChapter(save, ctx));
    let r = RARITIES.indexOf(reward.item);
    while (r > 0 && !pools[RARITIES[r]].length) r--;
    const pool = pools[RARITIES[r]];
    if (pool.length) {
      const r = addItems(next, [pool[Math.floor(new Rng(lootSeedValue).next() * pool.length)]]);
      next = r.save;
      items = r.added;
    }
  }
  return { save: next, grant: { gold, gems, jobExp, heroCards: cards.events, items, ore: 0 } };
}

/**
 * «Благословенная руда» с босса охоты: раз в день — первая попытка дня (бой или зачистка), если взят хотя бы первый
 * порог. Бросок от seed добычи этой попытки. Так в день выходит 1–3 руды.
 */
function grantOre(save: SaveState, g: { save: SaveState; grant: HuntGrant }, day: string, tier: number, lootSeedValue: number, ctx: HuntContext): { save: SaveState; grant: HuntGrant } {
  if (tier < 0 || stateOf(save, day).used > 0) return g;
  const ore = grantBlessedOre(g.save, lootSeedValue, ctx);
  return { save: ore.save, grant: { ...g.grant, ore: ore.count } };
}

/** Записать попытку и лучший урон по боссу. */
function spend(save: SaveState, day: string, unit: string, damage: number): SaveState {
  const { used, state } = stateOf(save, day);
  const best = { ...(state?.best ?? {}) };
  if (damage > (best[unit] ?? 0)) best[unit] = damage;
  // День не уходит назад: попытки считаются по самому позднему дню.
  const d = state && state.day > day ? state.day : day;
  return { ...save, hunt: { day: d, used: used + 1, best } };
}

/**
 * Бой с боссом дня отрядом save.squad (с экипировкой): timeLimitSeconds секунд, награда — по нанесённому урону.
 * Чистая функция. HuntError('hunt_locked') / ('no_attempts'); GameRuleError('empty_squad') и др. — как у этапа.
 * seed боя — свой (huntSeed: сохранение, день, номер попытки), battleSeq не трогается; попытка тратится при любом
 * исходе (как в AFK).
 */
export function fightHunt(save: SaveState, day: string, ctx: HuntContext): HuntOutcome {
  check(save, day, ctx);
  const gctx = withGear(ctx, save);
  const boss = huntBoss(day, ctx);
  const { squad } = squadUnits(save, gctx);
  const enemies: (UnitDef | null)[] = [null, null, null, null, null];
  enemies[ctx.hunt.slot] = boss.def;
  const result = simulateBattle(ctx.content, squad, enemies, huntSeed(save, day), {
    combat: { ...ctx.combat, timeLimitSeconds: ctx.hunt.timeLimitSeconds },
  });
  const damage = huntDamage(result);
  const record = damage > (save.hunt?.best[boss.unit] ?? 0);
  const tier = huntTier(damage, ctx.hunt);
  const loot = huntSeed(save, day, 'loot');
  const g = grantOre(save, grant(save, huntTierReward(tier, ctx.hunt), loot, ctx), day, tier, loot, ctx);
  const next = spend(g.save, day, boss.unit, damage);
  return { save: next, result, boss, damage, tier, grant: g.grant, record, sweep: false };
}

/**
 * «Зачистка»: награда за лучший урон по боссу дня без боя, тратит попытку. HuntError('no_sweep') — зачистка выключена
 * или по этому боссу ещё не бились.
 */
export function sweepHunt(save: SaveState, day: string, ctx: HuntContext): HuntOutcome {
  check(save, day, ctx);
  const boss = huntBoss(day, ctx);
  const best = save.hunt?.best[boss.unit] ?? 0;
  if (!ctx.hunt.sweep || best <= 0) throw new HuntError('no_sweep', 'Зачистка откроется после первого боя с этим боссом');
  const tier = huntTier(best, ctx.hunt);
  const loot = huntSeed(save, day, 'loot');
  const g = grantOre(save, grant(save, huntTierReward(tier, ctx.hunt), loot, ctx), day, tier, loot, ctx);
  const next = spend(g.save, day, boss.unit, best);
  return { save: next, result: null, boss, damage: best, tier, grant: g.grant, record: false, sweep: true };
}
