import type { SaveState } from '../save/schema';
import { addJobExp } from '../progression/exp';
import type { GameContext, ProgressEvent } from '../progression/types';

export interface OfflineRewards {
  /** Засчитанные минуты (с учётом лимита). */
  minutes: number;
  gold: number;
  jobExp: number;
}

const MINUTE = 60_000;

/**
 * T-B. Сколько накопилось в сундуке к моменту now (мс).
 * Доход — offlinePerMinute последнего пройденного этапа (max globalIndex среди cleared); нет пройденных — нули.
 * minutes = floor(min(now − lastClaimAt, capHours) в минутах); now < lastClaimAt (часы переведены назад) — нули.
 */
export function offlineRewards(save: SaveState, now: number, ctx: GameContext): OfflineRewards {
  const zero: OfflineRewards = { minutes: 0, gold: 0, jobExp: 0 };
  const cleared = new Set(save.campaign.cleared);
  let last: (typeof ctx.content.stages)[number] | undefined;
  for (const s of ctx.content.stages) if (cleared.has(s.id) && (!last || s.globalIndex > last.globalIndex)) last = s;
  const elapsed = now - save.offline.lastClaimAt;
  if (!last || !(elapsed > 0)) return zero;
  const minutes = Math.floor(Math.min(elapsed, ctx.progression.offline.capHours * 60 * MINUTE) / MINUTE);
  return { minutes, gold: last.offlinePerMinute.gold * minutes, jobExp: last.offlinePerMinute.jobExp * minutes };
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
