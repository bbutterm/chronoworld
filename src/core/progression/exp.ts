import type { HeroState } from '../save/schema';
import { availableJobChanges } from './jobChange';
import type { ProgressionConfig } from './schema';
import { getJob } from './stats';
import type { GameContext, ProgressEvent } from './types';

/** Опыт от уровня level до level + 1: floor(base × level^power); tier — тир профессии (своя кривая из exp.byTier). */
export function expToNext(level: number, cfg: ProgressionConfig, tier?: number): number {
  const c = (tier !== undefined && cfg.exp.byTier?.[String(tier)]) || cfg.exp;
  return Math.max(1, Math.floor(c.base * Math.pow(level, c.power)));
}

/**
 * Начисляет джоб-опыт: повышает уровни, открывает навыки, сообщает о доступной смене профессии.
 * На максимальном уровне опыт не копится. Исходный hero не меняется.
 */
export function addJobExp(hero: HeroState, amount: number, ctx: GameContext): { hero: HeroState; events: ProgressEvent[] } {
  const job = getJob(ctx, hero.job);
  const events: ProgressEvent[] = [];
  const next: HeroState = { ...hero };
  const canChangeBefore = availableJobChanges(hero, ctx).length > 0;

  if (next.jobLevel >= job.maxJobLevel || amount <= 0) {
    next.jobExp = next.jobLevel >= job.maxJobLevel ? 0 : next.jobExp;
    return { hero: next, events };
  }
  next.jobExp += Math.floor(amount);
  while (next.jobLevel < job.maxJobLevel && next.jobExp >= expToNext(next.jobLevel, ctx.progression, job.tier)) {
    next.jobExp -= expToNext(next.jobLevel, ctx.progression, job.tier);
    next.jobLevel++;
    events.push({ type: 'levelUp', heroId: hero.id, jobLevel: next.jobLevel });
    for (const s of job.skills) {
      if (s.jobLevel === next.jobLevel) events.push({ type: 'skillUnlocked', heroId: hero.id, job: job.id, skill: s.skill, jobLevel: s.jobLevel });
    }
  }
  if (next.jobLevel >= job.maxJobLevel) next.jobExp = 0;

  const jobs = availableJobChanges(next, ctx);
  if (!canChangeBefore && jobs.length > 0) events.push({ type: 'jobChangeAvailable', heroId: hero.id, jobs });
  return { hero: next, events };
}
