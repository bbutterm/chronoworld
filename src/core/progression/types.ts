import type { CombatConfig, Content } from '../types';
import type { ProgressionConfig } from './schema';

/** Всё, что нужно функциям прогрессии и кампании. */
export interface GameContext {
  content: Content;
  progression: ProgressionConfig;
  combat: CombatConfig;
}

/** События прогрессии — для UI (всплывашки, итоги) и тестов. */
export type ProgressEvent =
  | { type: 'levelUp'; heroId: string; jobLevel: number }
  | { type: 'skillUnlocked'; heroId: string; job: string; skill: string; jobLevel: number }
  | { type: 'jobChangeAvailable'; heroId: string; jobs: string[] }
  | { type: 'jobChanged'; heroId: string; from: string; to: string }
  | { type: 'stageCleared'; stageId: string; firstTime: boolean }
  | { type: 'stageUnlocked'; stageId: string }
  | { type: 'rewards'; gold: number; jobExp: number; heroIds: string[] }
  | { type: 'heroJoined'; heroId: string; name: string };

/** Нарушение правил игры (нельзя сменить профессию, этап закрыт и т. п.). */
export class GameRuleError extends Error {
  constructor(
    public code: 'stage_locked' | 'unknown_stage' | 'empty_squad' | 'job_change_not_allowed' | 'unknown_job' | 'unknown_hero',
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
