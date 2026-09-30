import type { CardsConfig, CardRarity, SummonConfig } from '../heroes/schema';
import type { CombatConfig, Content } from '../types';
import type { UnlocksConfig } from '../unlocks/schema';
import type { ProgressionConfig } from './schema';

/** Всё, что нужно функциям прогрессии и кампании. */
export interface GameContext {
  content: Content;
  progression: ProgressionConfig;
  combat: CombatConfig;
  /** data/cards.json — редкости, стоимость уровня, вознесение, смена ветки, общие карты за этапы. */
  cards: CardsConfig;
  /** data/summon.json — Таверна. */
  summon: SummonConfig;
  /**
   * data/unlocks.json — этапы открытия функций (Таверна, Башня, экспедиции…). Нет — всё открыто сразу, а Таверна и
   * Башня берут этап из своих файлов (старый формат; так собирают контекст некоторые тесты).
   */
  unlocks?: UnlocksConfig;
}

/** События прогрессии — для UI (всплывашки, итоги) и тестов. */
export type ProgressEvent =
  | { type: 'levelUp'; heroId: string; level: number }
  | { type: 'skillUnlocked'; heroId: string; skill: string; level: number }
  /** Карточка вознесена: новая редкость; job — класс после вознесения (у сюжетных на фиолетовом — вторая профессия). */
  | { type: 'ascended'; heroId: string; from: CardRarity; to: CardRarity; job: string; jobChanged: boolean }
  /** v6. Выбрана (changed: false) или сменена ветка второй профессии; gems — сколько заплачено. */
  | { type: 'branchChosen'; heroId: string; branch: string; changed: boolean; gems: number }
  | { type: 'stageCleared'; stageId: string; firstTime: boolean }
  | { type: 'stageUnlocked'; stageId: string }
  /** Награда: золото и опыт в общий пул героев (heroExp). */
  | { type: 'rewards'; gold: number; heroExp: number }
  /** v6. Карта героя (новый экземпляр) из награды: этап, сундук, охота, поручение, событие… */
  | { type: 'heroCard'; heroId: string; templateId: string; rarity: CardRarity; name: string }
  /** Герой присоединился по сюжету; copy — он уже был у игрока (пришла его зелёная копия). */
  | {
      type: 'heroJoined';
      /** Новый экземпляр; при copy — сильнейший экземпляр героя (его зовут «Взять в отряд»), а копия ур. 1 ушла в коллекцию. */
      heroId: string;
      templateId: string;
      name: string;
      copy?: boolean;
      level?: number;
      benched?: boolean;
      /** RR-01: сильнейший экземпляр подтянут до догоняющего уровня (copy). */
      caughtUp?: boolean;
    }
  /** Открылась Таверна: подарок гемов и свитков. */
  | { type: 'tavernUnlocked'; gems: number; scrolls: number }
  /** «Благословенная руда» с босса (заточка без риска поломки): первая победа над боссом главы, этаж-босс Башни. */
  | { type: 'blessedOre'; count: number };

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
