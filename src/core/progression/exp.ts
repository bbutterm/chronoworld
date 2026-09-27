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
 * P9 (T1-02). Сколько опыта герой может держать в запасе (hero.bankedExp), пока стоит на максимуме профессии:
 * опыт следующего тира с 1-го уровня до 1 + jobChange.bankLevels. 0 — копить некуда (последний тир,
 * нет перехода или bankLevels = 0).
 */
export function expBankCap(hero: HeroState, ctx: GameContext): number {
  const job = getJob(ctx, hero.job);
  const levels = ctx.progression.jobChange.bankLevels ?? 0;
  if (levels <= 0 || availableJobChanges(hero, ctx).length === 0) return 0;
  let cap = 0;
  for (let l = 1; l <= levels; l++) cap += expToNext(l, ctx.progression, job.tier + 1);
  return cap;
}

/** P9 (T1-02). Данные для UI: «опыт копится — смените профессию». */
export interface ExpBankStatus {
  /** Герой на максимуме профессии, может сменить её, и опыт идёт в запас (а не в уровни). */
  banking: boolean;
  /** Сколько опыта в запасе (перейдёт в новую профессию при смене). */
  banked: number;
  /** Предел запаса (0 — копить некуда). */
  cap: number;
  /** Запас полон — дальнейший опыт пропадает, пока герой не сменит профессию. */
  full: boolean;
}

export function expBankStatus(hero: HeroState, ctx: GameContext): ExpBankStatus {
  const job = getJob(ctx, hero.job);
  const cap = hero.jobLevel >= job.maxJobLevel ? expBankCap(hero, ctx) : 0;
  const banked = Math.min(hero.bankedExp ?? 0, cap);
  return { banking: cap > 0, banked, cap, full: cap > 0 && banked >= cap };
}

/** Кладёт amount в запас героя (до expBankCap); возвращает, сколько легло. */
function bank(next: HeroState, amount: number, ctx: GameContext): number {
  const before = next.bankedExp ?? 0;
  const after = Math.min(expBankCap(next, ctx), before + Math.max(0, Math.floor(amount)));
  if (after > 0 || next.bankedExp !== undefined) next.bankedExp = after;
  return Math.max(0, after - before);
}

/**
 * Начисляет джоб-опыт: повышает уровни, открывает навыки, сообщает о доступной смене профессии.
 * На максимальном уровне опыт идёт в запас hero.bankedExp (P9, T1-02; до expBankCap), если профессию можно
 * сменить, — тогда событие expBanked; иначе (последний тир) не копится. Исходный hero не меняется.
 */
export function addJobExp(hero: HeroState, amount: number, ctx: GameContext): { hero: HeroState; events: ProgressEvent[] } {
  const job = getJob(ctx, hero.job);
  const events: ProgressEvent[] = [];
  const next: HeroState = { ...hero };
  const canChangeBefore = availableJobChanges(hero, ctx).length > 0;

  if (amount <= 0) return { hero: next, events };
  if (next.jobLevel >= job.maxJobLevel) {
    next.jobExp = 0;
    const added = bank(next, amount, ctx);
    if (added > 0) events.push({ type: 'expBanked', heroId: hero.id, amount: added, banked: next.bankedExp ?? 0 });
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
  if (next.jobLevel >= job.maxJobLevel) {
    // Остаток последнего уровня — в запас (если есть куда сменить профессию).
    const rest = next.jobExp;
    next.jobExp = 0;
    const added = bank(next, rest, ctx);
    if (added > 0) events.push({ type: 'expBanked', heroId: hero.id, amount: added, banked: next.bankedExp ?? 0 });
  }

  const jobs = availableJobChanges(next, ctx);
  if (!canChangeBefore && jobs.length > 0) events.push({ type: 'jobChangeAvailable', heroId: hero.id, jobs });
  return { hero: next, events };
}
