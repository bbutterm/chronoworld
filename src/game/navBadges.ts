import {
  achievementStatus,
  eventsBadges,
  fastRewardsPreview,
  fastRewardsStatus,
  featureUnlocked,
  huntStatus,
  letterClaimable,
  mailStatus,
  offlineFullInMs,
  pendingPicks,
  questStatus,
  summonStatus,
  type SaveState,
} from '../core';
import { GAME } from './content';
import { claimableAchievements, claimableCount, expeditionsBadgeCount, towerBadgeCount } from './flow';
import { tavernBadge } from './tavern';

/**
 * Красные кружки на вкладках нижней навигации — сумма значков плиток и иконок своей страницы (как в AFK Arena):
 * игрок видит «там что-то есть», не заходя на страницу. Без Phaser; экран (screen.ts) передаёт now и day.
 */

/** «Кампания»: сундук полон, бесплатные быстрые награды не взяты. */
export function campaignBadge(save: SaveState, now: number, day: string): number {
  let n = 0;
  const full = offlineFullInMs(save, now, GAME);
  if (full !== null && full <= 0) n++;
  if (featureUnlocked(save, 'fast_rewards', GAME)) {
    const preview = fastRewardsPreview(save, GAME);
    if (fastRewardsStatus(save, day, GAME).nextCost === 0 && (preview.gold > 0 || preview.jobExp > 0)) n++;
  }
  return n;
}

/** «Город»: Таверна (бесплатный призыв, подарок), задания, достижения, события, почта, контракт героя. */
export function cityBadge(save: SaveState, day: string): number {
  const st = summonStatus(save, day, GAME);
  let n = st.unlocked ? tavernBadge(st, save.summon.welcomeGiven) : 0;
  if (featureUnlocked(save, 'quests', GAME)) n += claimableCount(questStatus(save, GAME, day));
  if (featureUnlocked(save, 'achievements', GAME)) n += claimableAchievements(achievementStatus(save, GAME));
  const ev = eventsBadges(save, day, GAME);
  n += ev.login + ev.newbie;
  n += mailCount(save);
  n += pendingPicks(save).length;
  return n;
}

/** Сколько писем ждут внимания: непрочитанные или с незабранным вложением. */
export function mailCount(save: SaveState): number {
  return mailStatus(save).letters.filter((l) => !l.read || letterClaimable(l)).length;
}

/** «Приключения»: экспедиции (вернулись / можно отправить), Башня (этаж по силам), попытки охоты на босса. */
export function adventureBadge(save: SaveState, now: number, day: string): number {
  let n = 0;
  if (featureUnlocked(save, 'bounties', GAME)) n += expeditionsBadgeCount(save, now, GAME);
  if (featureUnlocked(save, 'tower', GAME)) n += towerBadgeCount(save, GAME);
  const hunt = huntStatus(save, day, GAME);
  if (hunt.unlocked) n += hunt.attemptsLeft;
  return n;
}
