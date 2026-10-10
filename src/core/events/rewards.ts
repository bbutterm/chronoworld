import type { FeatureEvent } from '../features/config';
import { addHeroExp } from '../heroes/level';
import { addHeroCard } from '../heroes/roster';
import { cardRng, cardSeed, grantHeroCards, rollHeroCards } from '../heroes/cardDrops';
import { newHeroId } from '../heroes/card';
import type { CardRarity } from '../heroes/schema';
import type { GameContext } from '../progression/types';
import type { RewardBundle, SaveState } from '../save/schema';

/** Коды ошибок событий и почты. message — русский текст для игрока. */
export type EventErrorCode =
  | 'invalid_config'
  | 'invalid_day'
  | 'unknown_login_day'
  | 'login_locked'
  | 'login_claimed'
  | 'login_expired'
  | 'event_over'
  | 'unknown_task'
  | 'task_locked'
  | 'task_not_done'
  | 'task_claimed'
  | 'unknown_milestone'
  | 'milestone_not_reached'
  | 'milestone_claimed'
  | 'unknown_letter'
  | 'letter_claimed'
  | 'letter_empty';

export class EventError extends Error {
  override name = 'EventError';
  constructor(
    public code: EventErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** События наград для UI: события K-функций (в т. ч. heroCard — новый экземпляр героя) + свитки и «Контракт героя». */
export type EventRewardEvent =
  | FeatureEvent
  | { type: 'scrolls'; amount: number }
  /** v6. «Контракт героя» отложен в save.pendingPicks (выбор героя и ветки — claimHeroPick). */
  | { type: 'heroPick'; rarity: CardRarity; source: string };

/** Награда пустая (нечего забирать). */
export function isEmptyRewards(r: RewardBundle): boolean {
  return !r.gold && !r.gems && !r.jobExp && !r.scrolls && !(r.heroes && r.heroes.length) && !(r.heroPicks && r.heroPicks.length) && !r.heroCards?.blue && !r.heroCards?.purple;
}

/** Сложить наборы наград (для «Забрать всё»). */
export function sumRewards(list: readonly RewardBundle[]): RewardBundle {
  const out: RewardBundle = {};
  const heroes: string[] = [];
  const picks: NonNullable<RewardBundle['heroPicks']> = [];
  let blue = 0;
  let purple = 0;
  for (const r of list) {
    for (const k of ['gold', 'gems', 'jobExp', 'scrolls'] as const) if (r[k]) out[k] = (out[k] ?? 0) + (r[k] ?? 0);
    if (r.heroes) heroes.push(...r.heroes);
    if (r.heroPicks) picks.push(...r.heroPicks);
    blue += r.heroCards?.blue ?? 0;
    purple += r.heroCards?.purple ?? 0;
  }
  if (heroes.length) out.heroes = heroes;
  if (blue || purple) out.heroCards = { ...(blue ? { blue } : {}), ...(purple ? { purple } : {}) };
  if (picks.length) out.heroPicks = picks;
  return out;
}

/**
 * Выдать набор наград: золото, гемы, свитки, опыт в общий пул, карточки героев (baseRarity шаблона, значок «Новый!»),
 * карты случайных героев (heroCards; seed — от сохранения и номера следующего экземпляра), «Контракты героя»
 * (heroPicks → save.pendingPicks с подписью source). Шаблона карточки больше нет в игре — карточка пропускается
 * (сохранения переживают удаление контента). Чистая функция; events — для итогов на экране.
 */
export function grantRewards(save: SaveState, r: RewardBundle, ctx: GameContext, source = 'reward'): { save: SaveState; events: EventRewardEvent[] } {
  const events: EventRewardEvent[] = [];
  const gold = r.gold ?? 0;
  const gems = r.gems ?? 0;
  const scrolls = r.scrolls ?? 0;
  const jobExp = r.jobExp ?? 0;
  let next: SaveState = addHeroExp(
    {
      ...save,
      resources: { ...save.resources, gold: save.resources.gold + gold },
      currency: { ...save.currency, gems: save.currency.gems + gems, scrolls: save.currency.scrolls + scrolls },
    },
    jobExp,
  );
  if (gold > 0 || jobExp > 0) events.push({ type: 'rewards', gold, heroExp: jobExp });
  if (gems > 0) events.push({ type: 'gems', amount: gems });
  if (scrolls > 0) events.push({ type: 'scrolls', amount: scrolls });
  for (const templateId of r.heroes ?? []) {
    const t = ctx.content.heroes[templateId];
    if (!t) continue;
    const added = addHeroCard(next, templateId, t.baseRarity, { isNew: true });
    next = added.save;
    events.push({ type: 'heroCard', heroId: added.hero.id, templateId, rarity: t.baseRarity, name: t.name });
  }
  if (r.heroCards?.blue || r.heroCards?.purple) {
    const cards = rollHeroCards(r.heroCards, cardRng(cardSeed('reward', next.createdAt, source, newHeroId(next.heroes))), ctx);
    const g = grantHeroCards(next, cards, ctx);
    next = g.save;
    events.push(...g.events);
  }
  if (r.heroPicks?.length) {
    next = { ...next, pendingPicks: [...(next.pendingPicks ?? []), ...r.heroPicks.map((p) => ({ rarity: p.rarity, source }))] };
    for (const p of r.heroPicks) events.push({ type: 'heroPick', rarity: p.rarity, source });
  }
  return { save: next, events };
}
