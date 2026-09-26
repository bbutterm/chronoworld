import type { SaveState } from '../save/schema';
import { NotImplementedError, type GameContext, type ProgressEvent } from '../progression/types';

export interface OfflineRewards {
  /** Засчитанные минуты (с учётом лимита). */
  minutes: number;
  gold: number;
  jobExp: number;
}

/**
 * T-B. Сколько накопилось в сундуке к моменту now (мс).
 * Доход — offlinePerMinute последнего пройденного этапа (max globalIndex среди cleared); нет пройденных — нули.
 * minutes = floor(min(now − lastClaimAt, capHours) в минутах); now < lastClaimAt (часы переведены назад) — нули.
 */
export function offlineRewards(save: SaveState, now: number, ctx: GameContext): OfflineRewards {
  void save;
  void now;
  void ctx;
  throw new NotImplementedError('offlineRewards — T-B');
}

/**
 * T-B. Забрать сундук: золото в ресурсы, jobExp каждому герою из save.heroes (через addJobExp),
 * lastClaimAt = now (и при переводе часов назад тоже). Чистая функция.
 */
export function claimOffline(save: SaveState, now: number, ctx: GameContext): { save: SaveState; rewards: OfflineRewards; events: ProgressEvent[] } {
  void save;
  void now;
  void ctx;
  throw new NotImplementedError('claimOffline — T-B');
}
