import type { GameContext, ProgressEvent } from '../progression/types';
import { Rng } from '../rng';
import type { SaveState } from '../save/schema';
import { heroName } from './card';
import { summonPool } from './config';
import { HeroError } from './errors';
import { addHeroCard } from './roster';
import { rarityIndex, type CardRarity } from './schema';
import { groupDigits } from '../format';
import { idleIncome, lastClearedStage } from '../campaign/offline';
import { itemPools } from '../equipment/chest';
import { addItems } from '../equipment/equipment';
import { progressChapter } from '../equipment/gates';
import type { EquipmentConfig } from '../equipment/load';
import { addHeroExp } from './level';

/**
 * Таверна (призыв героев, docs/design/heroes-v2.md, раздел 4; числа — data/summon.json). Детерминирована:
 * seed = hash(save.createdAt, save.summon.seq), seq + 1 за вызов — одно сохранение даёт одну выдачу, повторное
 * открытие экрана результат не перебрасывает (он уже в сохранении).
 */

export type SummonPay = 'gems' | 'scroll' | 'free';

export interface SummonResult {
  kind: 'hero';
  /** id нового экземпляра в save.heroes. */
  heroId: string;
  templateId: string;
  name: string;
  rarity: CardRarity;
  /** Такой карточки у игрока раньше не было. */
  isNew: boolean;
  /** Выдана гарантом (pity) или первым ×10. */
  guaranteed: boolean;
}

/** Вид награды-не-героя (data/summon.json → loot). */
export type SummonLootKind = 'gear' | 'heroExp' | 'gold' | 'gems' | 'ore';

/**
 * Вытягивание-награда (не герой): вещь главы, опыт героев, золото, алмазы, Благословенная руда — уже в сохранении.
 * rarity у награды всегда 'green' (без нарастания и момента в показе), рамка — look.
 */
export interface SummonLoot {
  kind: 'loot';
  loot: SummonLootKind;
  /** Сколько (золото, опыт, алмазы; вещь и руда — 1). */
  amount: number;
  /** Вещь: id предмета и выданного экземпляра. */
  itemId?: string;
  instanceId?: string;
  /** Подпись на карте: «Золото», «Опыт героев», имя вещи. */
  name: string;
  /** Цвет рамки карты: вещь — по редкости, руда — фиолетовая, алмазы — синяя, остальное — зелёная. */
  look: CardRarity;
  rarity: 'green';
  isNew: false;
  guaranteed: false;
}

/** Одно вытягивание в Таверне: герой или награда. */
export type SummonDraw = SummonResult | SummonLoot;

/** Таверна открыта: пройден summon.unlockAfterStage. */
export function summonUnlocked(save: Pick<SaveState, 'campaign'>, ctx: GameContext): boolean {
  return save.campaign.cleared.includes(ctx.summon.unlockAfterStage);
}

/** Бесплатных призывов осталось на день day. */
export function freeSummonsLeft(save: Pick<SaveState, 'summon'>, day: string, ctx: GameContext): number {
  const per = ctx.summon.freePerDay;
  const s = save.summon;
  if (!s.freeDay || day > s.freeDay) return per;
  // Тот же день или часы переведены назад — только остаток дня freeDay (переводом часов лишнего не получить).
  return Math.max(0, per - (s.freeUsed ?? 1));
}

export interface SummonStatus {
  unlocked: boolean;
  unlockAfterStage: string;
  gems: number;
  scrolls: number;
  costs: { single: number; ten: number };
  freeLeft: number;
  /** Сколько призывов до первого (младшего) гаранта — синей (1 — следующий гарантирован). */
  untilPity: number;
  pityRarity: CardRarity;
  /** Все гаранты: редкость и сколько призывов до неё («до синей: 3», «до фиолетовой: 41»). */
  pities: { rarity: CardRarity; until: number }[];
  /** Шансы редкостей (для подписи «зелёный 73%, синий 25%, фиолетовый 2%»). */
  rates: { rarity: CardRarity; chance: number }[];
  /** Первый ×10 ещё впереди — в нём будет не меньше firstTenCount карт редкости firstTenRarity. */
  firstTenBonus: boolean;
  firstTenRarity: CardRarity;
  firstTenCount: number;
  total: number;
  /** Можно ли сейчас: ×1 за гемы, ×10 за гемы, ×1 свитком, ×10 свитками, бесплатно. */
  can: { gems1: boolean; gems10: boolean; scroll1: boolean; scroll10: boolean; free: boolean };
}

/** Всё для экрана Таверны. */
export function summonStatus(save: SaveState, day: string, ctx: GameContext): SummonStatus {
  const cfg = ctx.summon;
  const unlocked = summonUnlocked(save, ctx);
  const freeLeft = freeSummonsLeft(save, day, ctx);
  const pities = cfg.pity.map((p) => ({ rarity: p.rarity as CardRarity, until: Math.max(1, p.every - pityCounter(save.summon, p.rarity)) }));
  return {
    unlocked,
    unlockAfterStage: cfg.unlockAfterStage,
    gems: save.currency.gems,
    scrolls: save.currency.scrolls,
    costs: { ...cfg.costs },
    freeLeft,
    untilPity: pities[0].until,
    pityRarity: pities[0].rarity,
    pities,
    rates: cfg.rates.map((r) => ({ rarity: r.rarity, chance: r.chance })),
    firstTenBonus: !save.summon.firstTenDone,
    firstTenRarity: cfg.firstTen.rarity,
    firstTenCount: cfg.firstTen.count,
    total: save.summon.total,
    can: {
      gems1: unlocked && save.currency.gems >= cfg.costs.single,
      gems10: unlocked && save.currency.gems >= cfg.costs.ten,
      scroll1: unlocked && save.currency.scrolls >= 1,
      scroll10: unlocked && save.currency.scrolls >= 10,
      free: unlocked && freeLeft > 0,
    },
  };
}

/** Счётчик гаранта: призывов подряд без редкости rarity или выше. */
function pityCounter(s: SaveState['summon'], rarity: 'blue' | 'purple'): number {
  return rarity === 'purple' ? s.sincePurple : (s.sinceBlue ?? 0);
}

/** seed призыва: FNV-1a от createdAt и номера вызова. */
export function summonSeed(createdAt: number, seq: number): number {
  let h = 0x811c9dc5;
  for (const ch of `summon#${Math.floor(createdAt)}#${seq}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Подарок открытия Таверны (summon.welcome: гемы + свитки) — один раз, когда пройден unlockAfterStage.
 * Уже выдан или Таверна закрыта — тот же save. playStage зовёт при первой победе на этом этапе.
 */
export function grantTavernWelcome(save: SaveState, ctx: GameContext): { save: SaveState; events: ProgressEvent[] } {
  if (save.summon.welcomeGiven || !summonUnlocked(save, ctx)) return { save, events: [] };
  const w = ctx.summon.welcome;
  return {
    save: {
      ...save,
      currency: { ...save.currency, gems: save.currency.gems + w.gems, scrolls: save.currency.scrolls + w.scrolls },
      summon: { ...save.summon, welcomeGiven: true, sincePurple: Math.max(save.summon.sincePurple, w.purplePity ?? 0) },
    },
    events: [{ type: 'tavernUnlocked', gems: w.gems, scrolls: w.scrolls }],
  };
}

type SummonCtx = GameContext & { equipment?: EquipmentConfig };
type LootDef = SummonCtx['summon']['loot'][number];

/** Что выпало: редкость героя или вид награды (шансы rates + loot, сумма 1). */
function rollDraw(rng: Rng, ctx: GameContext): { hero: CardRarity } | { loot: LootDef } {
  let x = rng.next();
  for (const r of ctx.summon.rates) {
    if (x < r.chance) return { hero: r.rarity };
    x -= r.chance;
  }
  for (const l of ctx.summon.loot) {
    if (x < l.chance) return { loot: l };
    x -= l.chance;
  }
  const last = ctx.summon.loot.at(-1);
  return last ? { loot: last } : { hero: ctx.summon.rates[ctx.summon.rates.length - 1].rarity };
}

const ITEM_LOOK: Record<string, CardRarity> = { common: 'green', rare: 'blue', epic: 'purple' };
const LOOT_NAMES: Record<Exclude<SummonLootKind, 'gear'>, string> = { heroExp: 'Опыт героев', gold: 'Золото', gems: 'Алмазы', ore: 'Благословенная руда' };

/** Выдать награду в сохранение. Вещи в главе нет (или нет конфига снаряжения) — вместо неё золото. */
function grantLoot(save: SaveState, def: LootDef, rng: Rng, ctx: SummonCtx): { save: SaveState; loot: SummonLoot } {
  const base = { rarity: 'green' as const, isNew: false as const, guaranteed: false as const };
  const income = (minutes: number) => {
    const stage = lastClearedStage(save, ctx);
    return stage ? idleIncome(stage, minutes, ctx) : { gold: 0, jobExp: 0 };
  };
  if (def.kind === 'gear') {
    const pools = ctx.equipment ? itemPools(ctx.equipment.items, progressChapter(save, ctx)) : null;
    const want = rng.next() < def.blueChance ? 'rare' : 'common';
    const pool = pools ? (pools[want].length ? pools[want] : pools.common.length ? pools.common : pools.rare) : [];
    if (pool.length && ctx.equipment) {
      const itemId = pool[rng.int(pool.length)];
      const r = addItems(save, [itemId]);
      const item = ctx.equipment.items[itemId];
      return { save: r.save, loot: { kind: 'loot', loot: 'gear', amount: 1, itemId, instanceId: r.added[0].id, name: item.name, look: ITEM_LOOK[item.rarity] ?? 'green', ...base } };
    }
    return grantLoot(save, { kind: 'gold', chance: def.chance, minutes: 60 }, rng, ctx);
  }
  if (def.kind === 'gold') {
    const amount = Math.max(1, Math.floor(income(def.minutes).gold));
    return { save: { ...save, resources: { ...save.resources, gold: save.resources.gold + amount } }, loot: { kind: 'loot', loot: 'gold', amount, name: LOOT_NAMES.gold, look: 'green', ...base } };
  }
  if (def.kind === 'heroExp') {
    const amount = Math.max(1, Math.floor(income(def.minutes).jobExp));
    return { save: addHeroExp(save, amount), loot: { kind: 'loot', loot: 'heroExp', amount, name: LOOT_NAMES.heroExp, look: 'green', ...base } };
  }
  if (def.kind === 'gems') {
    const amount = def.min + rng.int(def.max - def.min + 1);
    return { save: { ...save, currency: { ...save.currency, gems: save.currency.gems + amount } }, loot: { kind: 'loot', loot: 'gems', amount, name: LOOT_NAMES.gems, look: 'blue', ...base } };
  }
  return {
    save: { ...save, currency: { ...save.currency, blessedOre: (save.currency.blessedOre ?? 0) + 1 } },
    loot: { kind: 'loot', loot: 'ore', amount: 1, name: LOOT_NAMES.ore, look: 'purple', ...base },
  };
}

/**
 * Призыв count героев (1 или 10). pay: gems — 30/270 гемов; scroll — count свитков; free — бесплатный (только ×1,
 * summon.freePerDay в день по day от UI). Каждая карта: редкость по шансам, гаранты (pity: every-я подряд без
 * этой редкости или выше — она; фиолетовый гарант старше синего), первый ×10 (последние карты добирают firstTen.count
 * карт редкости firstTen.rarity или выше); герой — равновероятно из пула редкости. Фиолетовый из Таверны приходит без ветки («Выберите ветку!»). Новые экземпляры — в save.heroes
 * с «Новый!». HeroError: tavern_locked, bad_count, not_enough_gems, not_enough_scrolls, free_used. Чистая функция.
 */
export function summon(
  save: SaveState,
  ctx: SummonCtx,
  opts: { count: number; pay: SummonPay; day: string },
): { save: SaveState; results: SummonDraw[]; events: ProgressEvent[] } {
  const cfg = ctx.summon;
  const { count, pay, day } = opts;
  if (!summonUnlocked(save, ctx)) {
    const stage = ctx.content.stages.find((s) => s.id === cfg.unlockAfterStage);
    throw new HeroError('tavern_locked', `Таверна откроется после этапа «${stage?.name ?? cfg.unlockAfterStage}»`);
  }
  if (count !== 1 && count !== 10) throw new HeroError('bad_count', 'Призывать можно по 1 или по 10');
  let next: SaveState = { ...save, currency: { ...save.currency }, summon: { ...save.summon } };
  if (pay === 'gems') {
    const cost = count === 10 ? cfg.costs.ten : cfg.costs.single;
    if (save.currency.gems < cost) throw new HeroError('not_enough_gems', `Нужно ${groupDigits(cost)} гемов, есть ${groupDigits(save.currency.gems)}`);
    next.currency.gems -= cost;
  } else if (pay === 'scroll') {
    if (save.currency.scrolls < count) throw new HeroError('not_enough_scrolls', `Нужно свитков: ${count}, есть ${save.currency.scrolls}`);
    next.currency.scrolls -= count;
  } else {
    if (count !== 1) throw new HeroError('bad_count', 'Бесплатно — только один призыв');
    const left = freeSummonsLeft(save, day, ctx);
    if (left <= 0) throw new HeroError('free_used', 'Бесплатный призыв на сегодня уже взят');
    const sameDay = save.summon.freeDay === day || (save.summon.freeDay !== undefined && day < save.summon.freeDay);
    next.summon.freeDay = sameDay ? save.summon.freeDay : day;
    next.summon.freeUsed = sameDay ? (save.summon.freeUsed ?? 1) + 1 : 1;
  }

  const rng = new Rng(summonSeed(save.createdAt, save.summon.seq));
  // Награды (какая вещь, сколько алмазов) — отдельный поток: выпадение героев не зависит от того, что за награды.
  const lootRng = new Rng(summonSeed(save.createdAt, save.summon.seq) ^ 0x5bd1e995);
  next.summon.seq = save.summon.seq + 1;
  const firstTen = count === 10 && !save.summon.firstTenDone;
  const results: SummonDraw[] = [];
  const events: ProgressEvent[] = [];
  const pities = [...cfg.pity].sort((x, y) => rarityIndex(y.rarity) - rarityIndex(x.rarity));
  for (let i = 0; i < count; i++) {
    const draw = rollDraw(rng, ctx);
    let rarity: CardRarity | null = 'hero' in draw ? draw.hero : null;
    let guaranteed = false;
    // Гаранты (героем): старший (фиолетовый) первым; награда тоже уступает гаранту.
    for (const p of pities) {
      if (pityCounter(next.summon, p.rarity) + 1 >= p.every && (rarity === null || rarityIndex(rarity) < rarityIndex(p.rarity))) {
        rarity = p.rarity;
        guaranteed = true;
        break;
      }
    }
    if (firstTen) {
      const heroes = results.filter((r): r is SummonResult => r.kind === 'hero');
      const left = count - i;
      const needRare = cfg.firstTen.count - heroes.filter((r) => rarityIndex(r.rarity) >= rarityIndex(cfg.firstTen.rarity)).length;
      const needHeroes = (cfg.firstTen.heroes ?? 0) - heroes.length;
      if (needRare >= left && (rarity === null || rarityIndex(rarity) < rarityIndex(cfg.firstTen.rarity))) {
        rarity = cfg.firstTen.rarity;
        guaranteed = true;
      } else if (Math.max(needRare, needHeroes) >= left && rarity === null) {
        rarity = cfg.rates[0].rarity;
        guaranteed = true;
      }
    }
    const ri = rarity === null ? -1 : rarityIndex(rarity);
    if (rarity === null && 'loot' in draw) {
      const got = grantLoot(next, draw.loot, lootRng, ctx);
      next = got.save;
      results.push(got.loot);
    } else if (rarity !== null) {
      const pool = summonPool(ctx, rarity);
      const templateId = pool[rng.int(pool.length)];
      const isNew = !next.summon.discovered.includes(templateId);
      const added = addHeroCard(next, templateId, rarity, { isNew: true });
      next = added.save;
      results.push({ kind: 'hero', heroId: added.hero.id, templateId, name: heroName(added.hero, ctx), rarity, isNew, guaranteed });
    }
    next.summon = {
      ...next.summon,
      total: next.summon.total + 1,
      sincePurple: ri >= rarityIndex('purple') ? 0 : next.summon.sincePurple + 1,
      sinceBlue: ri >= rarityIndex('blue') ? 0 : (next.summon.sinceBlue ?? 0) + 1,
    };
  }
  if (count === 10) next.summon = { ...next.summon, firstTenDone: true };
  // Порядок ключей как в схеме — serialize(deserialize(x)) === x.
  const { seq, total, sincePurple, sinceBlue, firstTenDone, freeDay, freeUsed, welcomeGiven, discovered, ...rest } = next.summon;
  next.summon = { seq, total, sincePurple, sinceBlue: sinceBlue ?? 0, firstTenDone, ...(freeDay !== undefined ? { freeDay } : {}), ...(freeUsed !== undefined ? { freeUsed } : {}), welcomeGiven, discovered, ...rest };
  return { save: next, results, events };
}
