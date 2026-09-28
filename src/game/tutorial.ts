/**
 * Ведущее обучение главы 1 (hints.ts, TUTORIAL_CHAIN): состояние сохранения → вход pickHomeHint. Один источник для
 * страниц «Кампания» (указатель на кнопку или вкладку) и «Город» (указатель на плитку Таверны / Заданий).
 */
import type { SaveState } from '../core';
import { fastRewardsPreview, fastRewardsStatus, heroesWithGearUpgrades, towerStatus } from '../core';
import { GAME } from './content';
import { ascendReady, levelUpReady } from './flow';
import { hintDone, type HintId, type HomeHintInput } from './hints';
import { today } from './session';
import { isUnlocked } from './unlockBanner';

export function homeHintInput(save: SaveState, chestHasIncome: boolean): HomeHintInput {
  const fast = fastRewardsStatus(save, today(), GAME);
  const preview = fastRewardsPreview(save, GAME);
  return {
    cleared: save.campaign.cleared.length,
    chestHasIncome,
    levelUpReady: levelUpReady(save, GAME).length > 0,
    towerUnlocked: towerStatus(save, GAME).unlocked,
    gearUpgrade: heroesWithGearUpgrades(save, GAME).length > 0,
    tavernReady: isUnlocked('tavern') && !save.summon.firstTenDone,
    ascendReady: ascendReady(save, GAME).length > 0,
    fastRewardsFree: isUnlocked('fast_rewards') && fast.nextCost === 0 && (preview.gold > 0 || preview.jobExp > 0),
    questsUnlocked: isUnlocked('quests'),
  };
}

/**
 * Подсказка страницы «Город»: шаги цепочки, цель которых — плитка Города (Таверна ×10, затем Задания). Игрок уже
 * пришёл в Город — шаги других страниц (сундук, «Улучшить») их не задерживают.
 */
export function cityHint(save: SaveState, isDone: (id: HintId) => boolean = hintDone): HintId | null {
  const s = homeHintInput(save, false);
  if (s.tavernReady && !isDone('tavern_summon')) return 'tavern_summon';
  if (s.questsUnlocked && !isDone('quests_open')) return 'quests_open';
  return null;
}
