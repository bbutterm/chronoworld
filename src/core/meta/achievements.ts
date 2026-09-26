import type { FeatureEvent } from '../features/config';
import { addJobExp } from '../progression/exp';
import type { HeroState, SaveState } from '../save/schema';
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

/** Наибольший джоб-уровень среди героев (с учётом пройденных профессий в jobHistory). */
export function maxHeroJobLevel(save: SaveState): number {
  let max = 0;
  for (const h of save.heroes) {
    max = Math.max(max, h.jobLevel);
    for (const j of h.jobHistory) max = Math.max(max, j.jobLevel);
  }
  return max;
}

/**
 * K10. Обновить счётчики-«максимумы», которые видны из самого сохранения:
 * stages_cleared (число пройденных этапов), tower_floor, hero_max_job_level. Вызывается обёртками act*.
 */
export function syncAchievementCounters(save: SaveState): SaveState {
  let s = trackAchievement(save, 'stages_cleared', new Set(save.campaign.cleared).size, 'max');
  s = trackAchievement(s, 'tower_floor', save.tower.floor, 'max');
  return trackAchievement(s, 'hero_max_job_level', maxHeroJobLevel(save), 'max');
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
 * K10. Получить награду достижения (одноразово). Золото и гемы — в ресурсы, jobExp — каждому герою (addJobExp).
 * MetaError: unknown_achievement, achievement_not_done, achievement_already_claimed.
 */
export function claimAchievement(save: SaveState, id: string, ctx: MetaContext): { save: SaveState; rewards: MetaRewards; events: MetaEvent[] } {
  const a = ctx.meta.achievements.achievements.find((x) => x.id === id);
  if (!a) throw new MetaError('unknown_achievement', `Неизвестное достижение: ${id}`);
  if (save.achievements.claimed.includes(a.id)) throw new MetaError('achievement_already_claimed', `Награда за достижение «${a.name}» уже получена`);
  const value = save.achievements.counters[a.counter] ?? 0;
  if (value < a.target) throw new MetaError('achievement_not_done', `Достижение «${a.name}» ещё не выполнено (${value}/${a.target})`);
  const { gold, gems, jobExp } = a.rewards;
  const next: SaveState = {
    ...save,
    resources: { ...save.resources, gold: save.resources.gold + gold },
    currency: { ...save.currency, gems: save.currency.gems + gems },
    achievements: { ...save.achievements, claimed: [...save.achievements.claimed, a.id] },
  };
  const events: MetaEvent[] = [{ type: 'achievementClaimed', achievementId: a.id }];
  if (gold > 0 || jobExp > 0) events.push({ type: 'rewards', gold, jobExp, heroIds: save.heroes.map((h) => h.id) });
  if (gems > 0) events.push({ type: 'gems', amount: gems });
  if (jobExp > 0) {
    next.heroes = save.heroes.map((h): HeroState => {
      const r = addJobExp(h, jobExp, ctx);
      events.push(...r.events);
      return r.hero;
    });
  }
  return { save: syncAchievementCounters(next), rewards: { gold, gems, jobExp }, events };
}
