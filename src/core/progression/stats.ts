import type { Stats } from '../content/schema';
import type { JobDef } from './schema';
import { GameRuleError, type GameContext } from './types';

/**
 * Профессии (data/jobs) — классы карточек героев: обычная атака, кривая статов линии, вид. Сам герой игрока —
 * карточка (heroes/card.ts: heroStats, heroSkills, buildUnit — реэкспорт ниже для старых импортов).
 */
export { buildUnit, heroSkills, type GearLookup, type HeroSkills, type StatBonus } from '../heroes/card';

export function getJob(ctx: Pick<GameContext, 'content'>, jobId: string): JobDef {
  const job = ctx.content.jobs[jobId];
  if (!job) throw new GameRuleError('unknown_job', `Неизвестная профессия: ${jobId}`);
  return job;
}

/** Статы профессии на уровне: base + growth × (level − 1), округление до целых (без множителей карточки). */
export function statsAt(job: JobDef, level: number): Stats {
  const k = Math.max(0, level - 1);
  const b = job.baseStats;
  return {
    hp: Math.round(b.hp + job.growth.hp * k),
    atk: Math.round(b.atk + job.growth.atk * k),
    def: Math.round(b.def + job.growth.def * k),
    spd: Math.round(b.spd + job.growth.spd * k),
    ...(b.moveSpeed ? { moveSpeed: b.moveSpeed } : {}),
  };
}
