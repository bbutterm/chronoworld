import { cardRng, grantHeroCards, randomHero, type DroppedCard } from '../heroes/cardDrops';
import type { ProgressEvent } from '../progression/types';
import type { GameContext } from '../progression/types';
import { Rng } from '../rng';
import type { ItemInstance, SaveState } from '../save/schema';
import { addItems } from './equipment';
import { chapterNumber } from './gates';
import type { EquipmentConfig } from './load';
import { RARITIES, type ChestRoll, type ChestRule, type Rarity, type RarityWeights } from './schema';

/**
 * Трофеи сундука простоя и быстрых наград (как в AFK): за каждый полный тик накопленного времени
 * (data/drops.json → chest.tickMinutes) бросаются предмет, карта случайного героя (синяя/фиолетовая), гемы и свитки
 * по правилу главы последнего пройденного этапа (chest.rules). Детерминированно: у каждого тика свой поток Rng
 * от seed и номера тика, поэтому первые N тиков не меняются, пока копятся следующие (превью на главной не «прыгает»).
 * Время и seed передаёт вызывающий (offline.ts, fastRewards.ts) — здесь нет ни Date, ни Math.random.
 */

/** Верхние границы ожидаемого дохода сундука за сутки непрерывного простоя (проверяются в validateEquipment). */
export const CHEST_LIMITS = { gemsPerDay: 60, scrollsPerDay: 1 } as const;

export interface ChestLoot {
  /** Полных тиков, за которые брошены трофеи. */
  ticks: number;
  /** id описаний предметов (data/items), по порядку тиков. */
  items: string[];
  /** Карты героя: случайный герой, синяя или фиолетовая (решено при броске, по порядку тиков). */
  cards: DroppedCard[];
  gems: number;
  scrolls: number;
}

export const EMPTY_LOOT: ChestLoot = Object.freeze({ ticks: 0, items: [], cards: [], gems: 0, scrolls: 0 }) as ChestLoot;

/** Что реально получено при сборе: экземпляры предметов и события heroCard (новые экземпляры героев). */
export interface ChestLootGrant extends ChestLoot {
  added: ItemInstance[];
  heroEvents: ProgressEvent[];
}

type ChestCtx = GameContext & { equipment?: EquipmentConfig };

/** Правило трофеев главы: своё, иначе первое без chapter; нет chest в data/drops.json — undefined. */
export function chestRule(chapter: string, ctx: ChestCtx): ChestRule | undefined {
  const rules = ctx.equipment?.drops.chest?.rules;
  if (!rules) return undefined;
  return rules.find((r) => r.chapter === chapter) ?? rules.find((r) => !r.chapter);
}

/** Полных тиков в minutes минутах (нет трофеев в конфиге — 0). */
export function chestTicks(minutes: number, ctx: ChestCtx): number {
  const tick = ctx.equipment?.drops.chest?.tickMinutes;
  return tick && minutes > 0 ? Math.floor(minutes / tick) : 0;
}

/**
 * Предметы, которые могут выпасть (drop ≠ false) в главе chapter (номер с 1: minChapter ≤ chapter), по редкостям;
 * внутри — по id. Без chapter — все главы (для проверок «есть ли вообще предметы редкости»).
 */
export function itemPools(items: EquipmentConfig['items'], chapter = Infinity): Record<Rarity, string[]> {
  const pools: Record<Rarity, string[]> = { common: [], rare: [], epic: [] };
  for (const def of Object.values(items)) if (def.drop && (def.minChapter ?? 1) <= chapter) pools[def.rarity].push(def.id);
  for (const r of RARITIES) pools[r].sort();
  return pools;
}

/** Редкость по весам среди редкостей, где есть предметы; нет таких — null. */
export function pickRarity(rng: Rng, weights: RarityWeights, pools: Record<Rarity, string[]>): Rarity | null {
  const options = RARITIES.filter((r) => (weights[r] ?? 0) > 0 && pools[r].length > 0);
  const total = options.reduce((s, r) => s + (weights[r] ?? 0), 0);
  if (total <= 0) return null;
  let x = rng.next() * total;
  for (const r of options) {
    x -= weights[r] ?? 0;
    if (x < 0) return r;
  }
  return options[options.length - 1];
}

/** Перемешать 32-битное число (murmur3 finalizer). */
function mix(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** seed по набору чисел и строк (FNV-1a по строке + перемешивание). */
export function lootSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join('#')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return mix(h);
}

/** seed сундука простоя: сохранение (createdAt) + якорь сундука lastClaimAt. Сбор сдвигает якорь — новый seed. */
export function chestSeed(save: Pick<SaveState, 'createdAt' | 'offline'>): number {
  return lootSeed('chest', save.createdAt, save.offline.lastClaimAt);
}

/** seed быстрых наград: сохранение, день и номер использования за день. */
export function fastLootSeed(save: Pick<SaveState, 'createdAt' | 'daily'>, day: string): number {
  return lootSeed('fast', save.createdAt, day, save.daily.fastRewardsUsed);
}

function roll(rng: Rng, r: ChestRoll | undefined): number {
  // Бросок тратится всегда (даже без правила) — число бросков за тик постоянно.
  const x = rng.next();
  return r && r.chance > 0 && x < r.chance ? r.count : 0;
}

/**
 * Трофеи за ticks тиков главы chapter. Тик i — свой Rng(mix(seed + i)): предмет (шанс item, редкость по весам —
 * rarityWeights правила сундука, иначе правила выпадения главы, предмет — равновероятно среди этой редкости),
 * затем карта героя (один бросок: синяя или фиолетовая; герой — из своего потока тика), гемы, свитки. Предметы — только открытые в главе chapter (minChapter). Нет правила или предметов — пусто.
 */
export function rollChestLoot(chapter: string, ticks: number, seed: number, ctx: ChestCtx): ChestLoot {
  const rule = chestRule(chapter, ctx);
  if (!rule || !ctx.equipment || !(ticks > 0)) return { ...EMPTY_LOOT, items: [], cards: [] };
  const drops = ctx.equipment.drops.rules;
  const weights = rule.rarityWeights ?? (drops.find((r) => r.chapter === chapter) ?? drops.find((r) => !r.chapter))?.rarityWeights ?? { common: 1 };
  const pools = itemPools(ctx.equipment.items, chapterNumber(chapter, ctx));
  const loot: ChestLoot = { ticks, items: [], cards: [], gems: 0, scrolls: 0 };
  for (let i = 0; i < ticks; i++) {
    const rng = new Rng(mix((seed + Math.imul(i + 1, 0x9e3779b9)) >>> 0));
    const hit = rng.next() < rule.item;
    const rarity = pickRarity(rng, weights, pools);
    const pick = rng.next();
    if (hit && rarity) loot.items.push(pools[rarity][Math.floor(pick * pools[rarity].length)]);
    // Одна карта за тик: бросок тратится всегда (число бросков за тик постоянно).
    const c = rng.next();
    const pb = rule.heroCards?.blue ?? 0;
    const pp = rule.heroCards?.purple ?? 0;
    const cardRarity = c < pb ? 'blue' : c < pb + pp ? 'purple' : null;
    if (cardRarity) {
      const templateId = randomHero(cardRarity, cardRng((seed + Math.imul(i + 1, 0x9e3779b9)) >>> 0), ctx);
      if (templateId) loot.cards.push({ templateId, rarity: cardRarity });
    }
    loot.gems += roll(rng, rule.gems);
    loot.scrolls += roll(rng, rule.scrolls);
  }
  return loot;
}

/** Выдать трофеи: предметы в инвентарь, гемы и свитки — в валюту, карты героя — новыми экземплярами. */
export function grantChestLoot(save: SaveState, loot: ChestLoot, ctx: GameContext): { save: SaveState; grant: ChestLootGrant } {
  const r = addItems(save, loot.items);
  let next = r.save;
  if (loot.gems > 0 || loot.scrolls > 0) {
    next = { ...next, currency: { ...next.currency, gems: next.currency.gems + loot.gems, scrolls: next.currency.scrolls + loot.scrolls } };
  }
  const cards = grantHeroCards(next, loot.cards, ctx);
  return { save: cards.save, grant: { ...loot, added: r.added, heroEvents: cards.events } };
}

/** Ожидаемые трофеи правила за сутки непрерывного простоя (для проверок и баланса). */
export function chestDailyExpectation(rule: ChestRule, tickMinutes: number): { items: number; cardBlue: number; cardPurple: number; gems: number; scrolls: number } {
  const ticks = (24 * 60) / tickMinutes;
  const e = (r: ChestRoll | undefined) => (r ? r.chance * r.count * ticks : 0);
  return { items: rule.item * ticks, cardBlue: (rule.heroCards?.blue ?? 0) * ticks, cardPurple: (rule.heroCards?.purple ?? 0) * ticks, gems: e(rule.gems), scrolls: e(rule.scrolls) };
}

/** Трофеи пусты? */
export function lootEmpty(loot: Pick<ChestLoot, 'items' | 'cards' | 'gems' | 'scrolls'>): boolean {
  return loot.items.length === 0 && loot.cards.length === 0 && loot.gems === 0 && loot.scrolls === 0;
}
