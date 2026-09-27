import type { SaveState } from '../save/schema';
import type { StageInfo } from './schema';
import { addJobExp } from '../progression/exp';
import type { GameContext, ProgressEvent } from '../progression/types';

export interface OfflineRewards {
  /** Засчитанные минуты (с учётом лимита). */
  minutes: number;
  gold: number;
  jobExp: number;
}

const MINUTE = 60_000;

/** Последний пройденный этап (max globalIndex среди cleared); нет пройденных — undefined. */
export function lastClearedStage(save: SaveState, ctx: GameContext): StageInfo | undefined {
  const cleared = new Set(save.campaign.cleared);
  let last: StageInfo | undefined;
  for (const s of ctx.content.stages) if (cleared.has(s.id) && (!last || s.globalIndex > last.globalIndex)) last = s;
  return last;
}

/**
 * Доход «простоя» (сундук, быстрые награды) за minutes минут, пока stage — последний пройденный этап.
 * Золото — offlinePerMinute.gold × minutes. Опыт — offlinePerMinute.jobExp × minutes, а на первых
 * progression.offline.earlyExp.stages этапах кампании ещё и не больше
 * floor(rewards.jobExp × earlyExp.stageRewardsPerHour × minutes / 60) — чтобы быстрые награды в начале главы 1
 * не давали джоб 10 раньше этапа 4 (P9, T1-01). Дальше опыт растёт вместе со ставкой этапа.
 */
export function idleIncome(stage: StageInfo, minutes: number, ctx: GameContext): { gold: number; jobExp: number } {
  let jobExp = stage.offlinePerMinute.jobExp * minutes;
  const early = ctx.progression.offline.earlyExp;
  if (early && stage.globalIndex < early.stages) {
    jobExp = Math.min(jobExp, Math.floor((stage.rewards.jobExp * early.stageRewardsPerHour * minutes) / 60));
  }
  return { gold: stage.offlinePerMinute.gold * minutes, jobExp };
}

/**
 * T-B. Сколько накопилось в сундуке к моменту now (мс).
 * Доход — idleIncome последнего пройденного этапа (max globalIndex среди cleared); нет пройденных — нули.
 * minutes = floor(min(now − lastClaimAt, capHours) в минутах); now < lastClaimAt (часы переведены назад) — нули.
 * Время копится с первой победы в кампании (P9, T1-15: playStage с now ставит lastClaimAt = now при первой победе).
 */
export function offlineRewards(save: SaveState, now: number, ctx: GameContext): OfflineRewards {
  const zero: OfflineRewards = { minutes: 0, gold: 0, jobExp: 0 };
  const last = lastClearedStage(save, ctx);
  const elapsed = now - save.offline.lastClaimAt;
  if (!last || !(elapsed > 0)) return zero;
  const minutes = Math.floor(Math.min(elapsed, ctx.progression.offline.capHours * 60 * MINUTE) / MINUTE);
  return { minutes, ...idleIncome(last, minutes, ctx) };
}

/**
 * T-B. Забрать сундук: золото в ресурсы, jobExp каждому герою из save.heroes (через addJobExp),
 * lastClaimAt = now (и при переводе часов назад тоже). Чистая функция.
 */
export function claimOffline(save: SaveState, now: number, ctx: GameContext): { save: SaveState; rewards: OfflineRewards; events: ProgressEvent[] } {
  const rewards = offlineRewards(save, now, ctx);
  const events: ProgressEvent[] = [];
  const next: SaveState = {
    ...save,
    resources: { ...save.resources, gold: save.resources.gold + rewards.gold },
    offline: { ...save.offline, lastClaimAt: now },
  };
  if (rewards.gold > 0 || rewards.jobExp > 0) {
    events.push({ type: 'rewards', gold: rewards.gold, jobExp: rewards.jobExp, heroIds: save.heroes.map((h) => h.id) });
  }
  if (rewards.jobExp > 0) {
    next.heroes = save.heroes.map((h) => {
      const r = addJobExp(h, rewards.jobExp, ctx);
      events.push(...r.events);
      return r.hero;
    });
  }
  return { save: next, rewards, events };
}
