import type { FeatureEvent } from '../features/config';
import { addHeroExp } from '../heroes/level';
import { addShards, shardTarget } from '../heroes/shards';
import type { GameContext } from '../progression/types';
import type { SaveState } from '../save/schema';
import { ACHIEVEMENT_COUNTERS, type AchievementCounter, type AchievementDef, type MetaContext, type MetaRewards } from './config';
import { MetaError } from './errors';

/**
 * K10. Изменить счётчик достижений. Чистая функция.
 * mode 'add' — counters[key] += value; 'max' — counters[key] = max(старое, value). Без mode — режим счётчика
 * по умолчанию (ACHIEVEMENT_COUNTERS). value округляется вниз; add с value ≤ 0 и max, не превышающий старое, —
 * тот же объект save. MetaError('invalid_counter') — неизвестный ключ или value не число.
 */
export function trackAchievement(save: SaveState, key: AchievementCounter, value: number, mode: 'add' | 'max' = ACHIEVEMENT_COUNTERS[key]): SaveState {
  if (!(key in ACHIEVEMENT_COUNTERS)) throw new MetaError('invalid_counter', `Неизвестный счётчик достижений: ${key}`);
  if (!Number.isFinite(value)) throw new MetaError('invalid_counter', `Счётчик ${key}: значение ${value} — не число`);
  const n = Math.floor(value);
  const old = save.achievements.counters[key] ?? 0;
  const next = mode === 'add' ? old + Math.max(0, n) : Math.max(old, n);
  if (next === old) return save;
  return { ...save, achievements: { ...save.achievements, counters: { ...save.achievements.counters, [key]: next } } };
}

/** Наибольший уровень карточки героя. */
export function maxHeroLevel(save: SaveState): number {
  return save.heroes.reduce((max, h) => Math.max(max, h.level), 0);
}

/**
 * K10. Обновить счётчики-«максимумы», которые видны из самого сохранения:
 * stages_cleared (число пройденных этапов), tower_floor, hero_max_level. Вызывается обёртками act*.
 */
export function syncAchievementCounters(save: SaveState): SaveState {
  let s = trackAchievement(save, 'stages_cleared', new Set(save.campaign.cleared).size, 'max');
  s = trackAchievement(s, 'tower_floor', save.tower.floor, 'max');
  return trackAchievement(s, 'hero_max_level', maxHeroLevel(save), 'max');
}

/**
 * Выдать награду K9/K10 (золото, гемы, опыт в пул, осколки «отстающему» сюжетному герою) — общая часть
 * claimAchievement и claimBounty. События rewards / gems / shards.
 */
export function grantMetaRewards(save: SaveState, r: MetaRewards, ctx: GameContext, events: MetaEvent[]): SaveState {
  let next: SaveState = addHeroExp(
    {
      ...save,
      resources: { ...save.resources, gold: save.resources.gold + r.gold },
      currency: { ...save.currency, gems: save.currency.gems + r.gems },
    },
    r.jobExp,
  );
  if (r.gold > 0 || r.jobExp > 0) events.push({ type: 'rewards', gold: r.gold, heroExp: r.jobExp });
  if (r.gems > 0) events.push({ type: 'gems', amount: r.gems });
  const target = r.shards > 0 ? shardTarget(next, ctx) : null;
  if (target) {
    next = addShards(next, target, r.shards);
    events.push({ type: 'shards', templateId: target, count: r.shards });
  }
  return next;
}

export interface AchievementView extends AchievementDef {
  /** Значение счётчика, не больше target. */
  progress: number;
  done: boolean;
  claimed: boolean;
}

/** K10. Список достижений для экрана (порядок как в data/achievements.json). */
export function achievementStatus(save: SaveState, ctx: MetaContext): AchievementView[] {
  const claimed = new Set(save.achievements.claimed);
  return ctx.meta.achievements.achievements.map((a) => {
    const raw = save.achievements.counters[a.counter] ?? 0;
    return { ...a, progress: Math.min(raw, a.target), done: raw >= a.target, claimed: claimed.has(a.id) };
  });
}

export type MetaEvent = FeatureEvent | { type: 'achievementClaimed'; achievementId: string } | { type: 'bountyDone'; bountyId: string; heroIds: string[] };

/**
 * K10. Получить награду достижения (одноразово). Золото и гемы — в ресурсы, jobExp — в общий пул опыта,
 * shards — осколки «отстающему» сюжетному герою.
 * MetaError: unknown_achievement, achievement_not_done, achievement_already_claimed.
 */
export function claimAchievement(save: SaveState, id: string, ctx: MetaContext): { save: SaveState; rewards: MetaRewards; events: MetaEvent[] } {
  const a = ctx.meta.achievements.achievements.find((x) => x.id === id);
  if (!a) throw new MetaError('unknown_achievement', `Неизвестное достижение: ${id}`);
  if (save.achievements.claimed.includes(a.id)) throw new MetaError('achievement_already_claimed', `Награда за достижение «${a.name}» уже получена`);
  const value = save.achievements.counters[a.counter] ?? 0;
  if (value < a.target) throw new MetaError('achievement_not_done', `Достижение «${a.name}» ещё не выполнено (${value}/${a.target})`);
  const events: MetaEvent[] = [{ type: 'achievementClaimed', achievementId: a.id }];
  const next = grantMetaRewards({ ...save, achievements: { ...save.achievements, claimed: [...save.achievements.claimed, a.id] } }, a.rewards, ctx, events);
  return { save: syncAchievementCounters(next), rewards: { ...a.rewards }, events };
}

/**
 * «Забрать всё»: claimAchievement для каждого выполненного и не полученного достижения (порядок data/achievements.json).
 * Награда может поднять счётчик-максимум и выполнить следующее достижение — такие тоже забираются (повторный проход).
 * rewards — сумма, claimed — id. Нечего забрать — тот же save.
 */
export function claimAllAchievements(save: SaveState, ctx: MetaContext): { save: SaveState; rewards: MetaRewards; events: MetaEvent[]; claimed: string[] } {
  let next = save;
  const rewards: MetaRewards = { gold: 0, gems: 0, jobExp: 0, shards: 0 };
  const events: MetaEvent[] = [];
  const claimed: string[] = [];
  for (;;) {
    const ready = achievementStatus(next, ctx).filter((a) => a.done && !a.claimed);
    if (!ready.length) break;
    for (const a of ready) {
      const r = claimAchievement(next, a.id, ctx);
      next = r.save;
      rewards.gold += r.rewards.gold;
      rewards.gems += r.rewards.gems;
      rewards.jobExp += r.rewards.jobExp;
      rewards.shards += r.rewards.shards;
      events.push(...r.events);
      claimed.push(a.id);
    }
  }
  return { save: next, rewards, events, claimed };
}
