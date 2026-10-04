import type { AutobattlerConfig, AutobattlerHero, AutobattlerRun, AutobattlerSave } from '../core/autobattler';
import { autobattlerStars } from '../core/autobattler';

export const AUTOBATTLER_LAYOUT = {
  status: 232,
  opponent: 324,
  opponentPortraits: 392,
  front: 510,
  back: 734,
  synergies: 914,
  shopTitle: 1018,
  shopPortrait: 1110,
  shopName: 1190,
  shopBuy: 1344,
  economy: 1496,
  go: 1650,
} as const;

export function autobattlerCopiesLabel(hero: AutobattlerHero): string {
  const stars = autobattlerStars(hero);
  return stars === 3 ? '★★★' : `${'★'.repeat(stars)} · ${hero.copies}/${stars === 1 ? 3 : 9}`;
}

/** The UI shows the exact available reward; backwards clocks never present a fresh budget. */
export function autobattlerDailyReward(save: AutobattlerSave, day: string, cfg: AutobattlerConfig): { earned: number; maximum: number; canImprove: boolean } {
  const state = save.autobattler;
  const wins = state?.rewardDay && day <= state.rewardDay ? state.rewardWins ?? 0 : 0;
  const earned = wins >= cfg.rewards.minWins ? Math.floor(cfg.rewards.gems * Math.min(wins, cfg.rounds) / cfg.rounds) : 0;
  return { earned, maximum: cfg.rewards.gems, canImprove: !(state?.rewardDay && day < state.rewardDay) && wins < cfg.rounds };
}

export function autobattlerTrainingLabel(run: AutobattlerRun, cfg: AutobattlerConfig): string {
  const next = cfg.training[run.training + 1];
  return next ? `Подготовка · ${next.cost}` : 'Подготовка: максимум';
}
