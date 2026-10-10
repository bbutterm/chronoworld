import {
  achievementStatus,
  eventsBadges,
  fastRewardsPreview,
  fastRewardsStatus,
  kitchenReady,
  type KitchenContext,
  featureUnlocked,
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
 * Красные точки на вкладках нижней навигации (дисциплина §2.4 docs/design/ui-polish-research.md): вкладка — точка без
 * числа, если внутри есть повод «можно сделать выгодное сейчас» (забрать, бесплатно, решить). Постоянные состояния
 * («можно отправить экспедицию», «осталась попытка охоты», «этаж по силам», «есть новая запись Летописи») — не повод.
 * Функции возвращают число поводов (> 0 — точка); экран (screen.ts) передаёт now и day. Без Phaser.
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

/**
 * «Город»: Таверна (бесплатный призыв, подарок), награды заданий и достижений, награды событий, письма, контракт героя.
 * Новые вечера «Двух колоколов» / записи Летописи — не повод для красной точки (это «есть что почитать», не награда).
 */
export function cityBadge(save: SaveState, day: string): number {
  const st = summonStatus(save, day, GAME);
  let n = st.unlocked ? tavernBadge(st, save.summon.welcomeGiven) : 0;
  if (featureUnlocked(save, 'quests', GAME)) n += claimableCount(questStatus(save, GAME, day));
  if (featureUnlocked(save, 'achievements', GAME)) n += claimableAchievements(achievementStatus(save, GAME));
  const ev = eventsBadges(save, day, GAME);
  n += ev.login + ev.newbie;
  n += mailCount(save);
  n += pendingPicks(save).length;
  // Кухня: сегодня не готовили, а на блюдо продуктов хватает — одна точка.
  if (kitchenReady(save, day, GAME as KitchenContext)) n += 1;
  return n;
}

/** Сколько писем ждут внимания: непрочитанные или с незабранным вложением. */
export function mailCount(save: SaveState): number {
  return mailStatus(save).letters.filter((l) => !l.read || letterClaimable(l)).length;
}

/**
 * «Приключения»: экспедиции вернулись или ждут решения в пути, в забеге Башни ждёт выбор. Свободные локации, добыча
 * Башни дня и попытки охоты — постоянное состояние (§2.4 п. 6), точку не зажигают. day — для совместимости вызова.
 */
export function adventureBadge(save: SaveState, now: number, _day?: string): number {
  let n = 0;
  if (featureUnlocked(save, 'bounties', GAME)) n += expeditionsBadgeCount(save, now, GAME);
  if (featureUnlocked(save, 'tower', GAME)) n += towerBadgeCount(save, GAME);
  return n;
}
