/**
 * Карты MVP (RO, docs/design/mvp-hunt.md): выпадают с MVP охоты (hunt/hunt.ts) в запас save.hunt.cards и вставляются в
 * предмет своего слота — у каждого предмета один слот карты, вставка навсегда (как в RO: карту не вынуть; предмет сломан
 * заточкой — карта пропала вместе с ним). Бонус карты — доли базовых статов героя (без снаряжения), пока предмет надет.
 * Описания карт — data/hunt.json → cards; контекст без hunt (часть скриптов) карт не знает — бонус 0.
 */
import { buildUnit, type StatBonus } from '../heroes/card';
import type { GameContext } from '../progression/types';
import type { HeroState, ItemInstance, SaveState } from '../save/schema';
import { EquipmentError } from './errors';
import type { EquipmentContext } from './load';
import type { CardDef, ItemDef } from './schema';

/** Часть контекста с описаниями карт (data/hunt.json → cards). */
export interface CardsLookup {
  hunt?: { cards?: readonly CardDef[] };
}

/** Описание карты по id (нет — undefined). */
export function cardDef(ctx: CardsLookup, cardId: string): CardDef | undefined {
  return ctx.hunt?.cards?.find((c) => c.id === cardId);
}

/** Все описания карт. */
export function cardDefs(ctx: CardsLookup): readonly CardDef[] {
  return ctx.hunt?.cards ?? [];
}

/** Невставленные карты игрока: id → штук (только > 0). */
export function ownedCards(save: SaveState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, n] of Object.entries(save.hunt?.cards ?? {})) if (n > 0) out[id] = n;
  return out;
}

/** Карты из запаса, подходящие к предмету def (тот же слот). */
export function cardsForItem(save: SaveState, def: ItemDef, ctx: CardsLookup): CardDef[] {
  const own = ownedCards(save);
  return cardDefs(ctx).filter((c) => c.slot === def.slot && (own[c.id] ?? 0) > 0);
}

/** Прибавка карт cards к базовым статам героя base (округление до целых). */
export function mvpCardStats(cards: readonly CardDef[], base: StatBonus): StatBonus {
  const sum: StatBonus = { hp: 0, atk: 0, def: 0, spd: 0 };
  for (const c of cards) {
    sum.hp += Math.round(base.hp * (c.bonus.hp ?? 0));
    sum.atk += Math.round(base.atk * (c.bonus.atk ?? 0));
    sum.def += Math.round(base.def * (c.bonus.def ?? 0));
    sum.spd += Math.round(base.spd * (c.bonus.spd ?? 0));
  }
  return sum;
}

/** Прибавка карт, вставленных в надетые предметы героя (0, если карт нет). */
export function heroCardStats(hero: HeroState, equipped: readonly ItemInstance[], ctx: GameContext & CardsLookup): StatBonus {
  const cards = equipped.map((i) => (i.card ? cardDef(ctx, i.card) : undefined)).filter((c): c is CardDef => !!c);
  if (!cards.length) return { hp: 0, atk: 0, def: 0, spd: 0 };
  const s = buildUnit(hero, ctx, { hp: 0, atk: 0, def: 0, spd: 0 }).stats;
  return mvpCardStats(cards, { hp: s.hp, atk: s.atk, def: s.def, spd: s.spd });
}

/**
 * Вставить карту cardId из запаса в предмет itemInstanceId. Чистая функция. Ошибки EquipmentError: unknown_item,
 * unknown_item_def, card_unknown (нет такой карты или её нет в запасе), card_slot (слот карты другой), card_taken (в предмете уже карта).
 */
export function insertCard(save: SaveState, itemInstanceId: string, cardId: string, ctx: EquipmentContext & CardsLookup): SaveState {
  const item = save.inventory.items.find((i) => i.id === itemInstanceId);
  if (!item) throw new EquipmentError('unknown_item', `Предмет ${itemInstanceId} не найден в инвентаре`);
  const def = ctx.equipment.items[item.itemId];
  if (!def) throw new EquipmentError('unknown_item_def', `Неизвестный предмет: ${item.itemId}`);
  const card = cardDef(ctx, cardId);
  const have = save.hunt?.cards?.[cardId] ?? 0;
  if (!card || have <= 0 || !save.hunt) throw new EquipmentError('card_unknown', 'Такой карты нет в запасе');
  if (item.card) throw new EquipmentError('card_taken', `В предмете «${def.name}» уже есть карта`);
  if (card.slot !== def.slot) throw new EquipmentError('card_slot', `${card.name} вставляется в другой слот`);
  const items = save.inventory.items.map((i) => (i.id === item.id ? { ...i, card: cardId } : i));
  const cards = { ...save.hunt.cards, [cardId]: have - 1 };
  return { ...save, inventory: { ...save.inventory, items }, hunt: { ...save.hunt, cards } };
}
