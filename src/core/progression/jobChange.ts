import type { HeroState } from '../save/schema';
import { addJobExp } from './exp';
import { getJob } from './stats';
import { GameRuleError, type GameContext, type ProgressEvent } from './types';

/** Профессии, в которые герой может перейти прямо сейчас (порог уровня и ветка from). */
export function availableJobChanges(hero: HeroState, ctx: GameContext): string[] {
  const cur = getJob(ctx, hero.job);
  const nextTier = cur.tier + 1;
  if (nextTier > 2) return [];
  const need = ctx.progression.jobChange.tierLevel[String(nextTier) as '1' | '2'];
  if (hero.jobLevel < need) return [];
  return Object.values(ctx.content.jobs)
    .filter((j) => j.tier === nextTier && j.from.includes(cur.id))
    .map((j) => j.id)
    .sort();
}

/**
 * Смена профессии. Бросает GameRuleError, если переход не разрешён. Исходный hero не меняется.
 * Запас опыта hero.bankedExp (P9, T1-02) начисляется новой профессии (события levelUp / skillUnlocked после
 * jobChanged), запас обнуляется.
 */
export function changeJob(hero: HeroState, jobId: string, ctx: GameContext): { hero: HeroState; events: ProgressEvent[] } {
  getJob(ctx, jobId);
  if (!availableJobChanges(hero, ctx).includes(jobId)) {
    throw new GameRuleError('job_change_not_allowed', `${hero.name}: нельзя сменить ${hero.job} → ${jobId} на джобе ${hero.jobLevel}`);
  }
  const { bankedExp, ...rest } = hero;
  const next: HeroState = {
    ...rest,
    job: jobId,
    jobLevel: ctx.progression.jobChange.resetJobLevel ? 1 : hero.jobLevel,
    jobExp: 0,
    jobHistory: [...hero.jobHistory, { job: hero.job, jobLevel: hero.jobLevel }],
  };
  const events: ProgressEvent[] = [{ type: 'jobChanged', heroId: hero.id, from: hero.job, to: jobId }];
  // Навыки новой профессии, открытые уже на стартовом уровне.
  for (const s of getJob(ctx, jobId).skills) {
    if (s.jobLevel <= next.jobLevel) events.push({ type: 'skillUnlocked', heroId: hero.id, job: jobId, skill: s.skill, jobLevel: s.jobLevel });
  }
  if (!bankedExp || bankedExp <= 0) return { hero: next, events };
  const r = addJobExp(next, bankedExp, ctx);
  return { hero: r.hero, events: [...events, ...r.events] };
}
