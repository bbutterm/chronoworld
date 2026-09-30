/**
 * Ведущее обучение главы 1 (hints.ts, TUTORIAL_CHAIN): состояние сохранения → вход pickHomeHint. Один источник для
 * страниц «Кампания» (указатель на кнопку или вкладку) и «Город» (указатель на плитку Таверны / Заданий).
 */
import type { SaveState } from '../core';
import { fastRewardsPreview, fastRewardsStatus, needsBranch, towerStatus } from '../core';
import { GAME } from './content';
import { ascendReady, levelUpReady, squadGearUpgrades } from './flow';
import { hintDone, setHintObsolete, type HintId, type HomeHintInput } from './hints';
import { session, today } from './session';
import { isUnlocked } from './unlockBanner';

export function homeHintInput(save: SaveState, chestHasIncome: boolean): HomeHintInput {
  const fast = fastRewardsStatus(save, today(), GAME);
  const preview = fastRewardsPreview(save, GAME);
  return {
    cleared: save.campaign.cleared.length,
    chestHasIncome,
    levelUpReady: levelUpReady(save, GAME).length > 0,
    towerUnlocked: towerStatus(save, GAME).unlocked,
    // RN-10: только отряд — вещи для запасных в бою не помогут.
    gearUpgrade: squadGearUpgrades(save, GAME).length > 0,
    tavernReady: isUnlocked('tavern') && !save.summon.firstTenDone,
    ascendReady: ascendReady(save, GAME).length > 0,
    fastRewardsFree: isUnlocked('fast_rewards') && fast.nextCost === 0 && (preview.gold > 0 || preview.jobExp > 0),
    questsUnlocked: isUnlocked('quests'),
    branchPending: save.squad.some((id) => {
      const h = id ? save.heroes.find((x) => x.id === id) : undefined;
      return !!h && needsBranch(h, GAME);
    }),
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

/**
 * Обучение по прогрессу сохранения (LT-12, MT-07): подсказки новичка не нужны тому, кто уже прошёл главу 1 (новое
 * устройство, чистый браузер, Telegram на втором телефоне); «Башня открыта» — тому, кто в Башне уже был.
 * Трофеи (equip_gear) — подсказка по событию, её оставляем: касание плашки её скрывает.
 */
export function hintObsoleteFor(save: SaveState, id: HintId): boolean {
  if (id === 'equip_gear' || id === 'branch_pick') return false;
  if (id === 'tower_open') return save.tower.floor > 0;
  if (id === 'tavern_summon' && save.summon.firstTenDone) return true;
  const first = GAME.content.chapters[0]?.id;
  const ch1 = GAME.content.stages.filter((st) => st.chapter === first);
  return ch1.length > 0 && ch1.every((st) => save.campaign.cleared.includes(st.id));
}

setHintObsolete((id) => hintObsoleteFor(session.save, id));
