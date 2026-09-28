/** Коды ошибок карточек героев (уровень, вознесение, ветки, общие карты, Таверна, контракты). message — русский текст для игрока. */
export type HeroErrorCode =
  | 'unknown_hero'
  | 'max_level'
  | 'not_enough_exp'
  | 'not_enough_gold'
  | 'max_rarity'
  | 'branch_required'
  | 'bad_branch'
  | 'branch_locked'
  | 'unknown_pick'
  | 'bad_fodder'
  | 'fodder_busy'
  | 'tavern_locked'
  | 'bad_count'
  | 'not_enough_gems'
  | 'not_enough_scrolls'
  | 'free_used';

export class HeroError extends Error {
  override name = 'HeroError';
  constructor(
    public code: HeroErrorCode,
    message: string,
  ) {
    super(message);
  }
}
