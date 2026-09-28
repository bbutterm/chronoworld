import { idleIncome, lastClearedStage } from '../campaign/offline';
import { chestTicks, EMPTY_LOOT, fastLootSeed, grantChestLoot, rollChestLoot, type ChestLoot, type ChestLootGrant } from '../equipment/chest';
import type { EquipmentConfig } from '../equipment/load';
import { addHeroExp } from '../heroes/level';
import type { SaveState } from '../save/schema';
import type { FeatureContext, FeatureEvent } from './config';
import { rollDay } from './daily';
import { FeatureError } from './errors';

export interface FastRewards {
  /** Засчитанные минуты дохода (hours × 60). */
  minutes: number;
  gold: number;
  /** Опыт в общий пул героев. */
  jobExp: number;
}

/**
 * K1. Что дадут быстрые награды сейчас: idleIncome последнего пройденного этапа за fastRewards.hours × 60 минут
 * (опыт в начале кампании ограничен — P9, T1-01).
 * Лимит сундука (offline.capHours) не применяется. Нет пройденных этапов — нули. Время сундука не трогается.
 */
export function fastRewardsPreview(save: SaveState, ctx: FeatureContext): FastRewards {
  const minutes = Math.floor(ctx.features.fastRewards.hours * 60);
  const last = lastClearedStage(save, ctx);
  if (!last) return { minutes: 0, gold: 0, jobExp: 0 };
  return { minutes, ...idleIncome(last, minutes, ctx) };
}

/** FeatureContext + (необязательно) экипировка: с ней быстрые награды дают и трофеи сундука. */
type FastContext = FeatureContext & { equipment?: EquipmentConfig };

/**
 * Трофеи следующих быстрых наград на день day — те же, что у сундука (equipment/chest.ts), за fastRewards.hours
 * часов (тиков = минуты / chest.tickMinutes), по главе последнего пройденного этапа. seed — от сохранения, дня и
 * номера использования за день (fastLootSeed): превью совпадает с тем, что даст useFastRewards в тот же день.
 */
export function fastRewardsLoot(save: SaveState, day: string, ctx: FastContext): ChestLoot {
  const s = rollDay(save, day);
  const last = lastClearedStage(s, ctx);
  if (!last) return { ...EMPTY_LOOT, items: [] };
  const minutes = Math.floor(ctx.features.fastRewards.hours * 60);
  return rollChestLoot(last.chapter, chestTicks(minutes, ctx), fastLootSeed(s, day), ctx);
}

export interface FastRewardsStatus {
  /** Использовано сегодня (всего). */
  used: number;
  /** Осталось бесплатных. */
  freeLeft: number;
  /** Осталось использований всего (бесплатные + платные). */
  usesLeft: number;
  /** Цена следующего использования в гемах: 0 — бесплатно, null — на сегодня всё. */
  nextCost: number | null;
}

/** K1. Сколько осталось попыток и сколько стоит следующая (с учётом смены дня). */
export function fastRewardsStatus(save: SaveState, day: string, ctx: FeatureContext): FastRewardsStatus {
  const { freePerDay, gemCosts } = ctx.features.fastRewards;
  const used = rollDay(save, day).daily.fastRewardsUsed;
  const total = freePerDay + gemCosts.length;
  const nextCost = used < freePerDay ? 0 : used - freePerDay < gemCosts.length ? gemCosts[used - freePerDay] : null;
  return { used, freeLeft: Math.max(0, freePerDay - used), usesLeft: Math.max(0, total - used), nextCost };
}

/**
 * K1. Взять быстрые награды. Чистая функция.
 * rollDay → сначала бесплатные (fastRewards.freePerDay), потом за гемы по gemCosts по порядку.
 * Золото в resources, jobExp — в общий пул опыта героев (как у сундука), fastRewardsUsed + 1,
 * трофеи — fastRewardsLoot (предметы, карты героя, гемы, свитки, как у сундука за те же часы),
 * offline.lastClaimAt не меняется (сундук копится дальше).
 * FeatureError: fast_rewards_limit — попытки на сегодня кончились; not_enough_gems; no_income — нет
 * пройденных этапов (попытка не тратится).
 */
export function useFastRewards(
  save: SaveState,
  day: string,
  ctx: FastContext,
): { save: SaveState; rewards: FastRewards; loot: ChestLootGrant; events: FeatureEvent[] } {
  const s = rollDay(save, day);
  const status = fastRewardsStatus(s, day, ctx);
  if (status.nextCost === null) throw new FeatureError('fast_rewards_limit', 'Быстрые награды на сегодня закончились');
  const rewards = fastRewardsPreview(s, ctx);
  if (rewards.gold <= 0 && rewards.jobExp <= 0) throw new FeatureError('no_income', 'Пройдите хотя бы один этап кампании, чтобы получать быстрые награды');
  const cost = status.nextCost;
  if (s.currency.gems < cost) throw new FeatureError('not_enough_gems', `Нужно ${cost} гемов, есть ${s.currency.gems}`);

  const rolled = fastRewardsLoot(s, day, ctx);
  const withIncome: SaveState = addHeroExp({
    ...s,
    resources: { ...s.resources, gold: s.resources.gold + rewards.gold },
    currency: { ...s.currency, gems: s.currency.gems - cost },
    daily: { ...s.daily, fastRewardsUsed: s.daily.fastRewardsUsed + 1 },
  }, rewards.jobExp);
  const { save: next, grant: loot } = grantChestLoot(withIncome, rolled, ctx);
  const events: FeatureEvent[] = [
    { type: 'fastRewardsUsed', gemCost: cost, hours: ctx.features.fastRewards.hours },
    { type: 'rewards', gold: rewards.gold, heroExp: rewards.jobExp },
  ];
  events.push(...loot.heroEvents);
  return { save: next, rewards, loot, events };
}
