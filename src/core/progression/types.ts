import type { CardsConfig, CardRarity, SummonConfig } from '../heroes/schema';
import type { CombatConfig, Content } from '../types';
import type { ProgressionConfig } from './schema';

/** Всё, что нужно функциям прогрессии и кампании. */
export interface GameContext {
  content: Content;
  progression: ProgressionConfig;
  combat: CombatConfig;
  /** data/cards.json — редкости, стоимость уровня, вознесение, осколки. */
  cards: CardsConfig;
  /** data/summon.json — Таверна. */
  summon: SummonConfig;
}

/** События прогрессии — для UI (всплывашки, итоги) и тестов. */
export type ProgressEvent =
  | { type: 'levelUp'; heroId: string; level: number }
  | { type: 'skillUnlocked'; heroId: string; skill: string; level: number }
  /** Карточка вознесена: новая редкость; job — класс после вознесения (у сюжетных на фиолетовом — вторая профессия). */
  | { type: 'ascended'; heroId: string; from: CardRarity; to: CardRarity; job: string; jobChanged: boolean }
  | { type: 'stageCleared'; stageId: string; firstTime: boolean }
  | { type: 'stageUnlocked'; stageId: string }
  /** Награда: золото и опыт в общий пул героев (heroExp). */
  | { type: 'rewards'; gold: number; heroExp: number }
  | { type: 'shards'; templateId: string; count: number }
  | { type: 'heroJoined'; heroId: string; templateId: string; name: string }
  /** Открылась Таверна: подарок гемов и свитков. */
  | { type: 'tavernUnlocked'; gems: number; scrolls: number };

/** Нарушение правил игры (этап закрыт, нет героя и т. п.). */
export class GameRuleError extends Error {
  constructor(
    public code: 'stage_locked' | 'unknown_stage' | 'empty_squad' | 'unknown_job' | 'unknown_hero' | 'unknown_template' | 'duplicate_card',
    message: string,
  ) {
    super(message);
  }
}

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`Не реализовано: ${what} (см. docs/TASKS.md)`);
  }
}
