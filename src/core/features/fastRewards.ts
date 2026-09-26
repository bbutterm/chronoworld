import type { StageInfo } from '../campaign/schema';
import { addJobExp } from '../progression/exp';
import type { HeroState, SaveState } from '../save/schema';
import type { FeatureContext, FeatureEvent } from './config';
import { rollDay } from './daily';
import { FeatureError } from './errors';

export interface FastRewards {
  /** Засчитанные минуты дохода (hours × 60). */
  minutes: number;
  gold: number;
  jobExp: number;
}

/** Последний пройденный этап (max globalIndex среди cleared) — его ставка задаёт доход, как у сундука. */
function lastCleared(save: SaveState, ctx: FeatureContext): StageInfo | undefined {
  const cleared = new Set(save.campaign.cleared);
  let last: StageInfo | undefined;
  for (const s of ctx.content.stages) if (cleared.has(s.id) && (!last || s.globalIndex > last.globalIndex)) last = s;
  return last;
}

/**
 * K1. Что дадут быстрые награды сейчас: offlinePerMinute последнего пройденного этапа × fastRewards.hours × 60.
 * Лимит сундука (offline.capHours) не применяется. Нет пройденных этапов — нули. Время сундука не трогается.
 */
export function fastRewardsPreview(save: SaveState, ctx: FeatureContext): FastRewards {
  const minutes = Math.floor(ctx.features.fastRewards.hours * 60);
  const last = lastCleared(save, ctx);
  if (!last) return { minutes: 0, gold: 0, jobExp: 0 };
  return { minutes, gold: last.offlinePerMinute.gold * minutes, jobExp: last.offlinePerMinute.jobExp * minutes };
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
 * Золото в resources, jobExp каждому герою из save.heroes (как у сундука), fastRewardsUsed + 1,
 * offline.lastClaimAt не меняется (сундук копится дальше).
 * FeatureError: fast_rewards_limit — попытки на сегодня кончились; not_enough_gems; no_income — нет
 * пройденных этапов (попытка не тратится).
 */
export function useFastRewards(save: SaveState, day: string, ctx: FeatureContext): { save: SaveState; rewards: FastRewards; events: FeatureEvent[] } {
  const s = rollDay(save, day);
  const status = fastRewardsStatus(s, day, ctx);
  if (status.nextCost === null) throw new FeatureError('fast_rewards_limit', 'Быстрые награды на сегодня закончились');
  const rewards = fastRewardsPreview(s, ctx);
  if (rewards.gold <= 0 && rewards.jobExp <= 0) throw new FeatureError('no_income', 'Пройдите хотя бы один этап кампании, чтобы получать быстрые награды');
  const cost = status.nextCost;
  if (s.currency.gems < cost) throw new FeatureError('not_enough_gems', `Нужно ${cost} гемов, есть ${s.currency.gems}`);

  const next: SaveState = {
    ...s,
    resources: { ...s.resources, gold: s.resources.gold + rewards.gold },
    currency: { ...s.currency, gems: s.currency.gems - cost },
    daily: { ...s.daily, fastRewardsUsed: s.daily.fastRewardsUsed + 1 },
  };
  const events: FeatureEvent[] = [
    { type: 'fastRewardsUsed', gemCost: cost, hours: ctx.features.fastRewards.hours },
    { type: 'rewards', gold: rewards.gold, jobExp: rewards.jobExp, heroIds: s.heroes.map((h) => h.id) },
  ];
  if (rewards.jobExp > 0) {
    next.heroes = s.heroes.map((h): HeroState => {
      const r = addJobExp(h, rewards.jobExp, ctx);
      events.push(...r.events);
      return r.hero;
    });
  }
  return { save: next, rewards, events };
}
