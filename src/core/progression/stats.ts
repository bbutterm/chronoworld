import type { Stats, UnitDef } from '../content/schema';
import type { HeroState } from '../save/schema';
import type { JobDef } from './schema';
import { GameRuleError, type GameContext } from './types';

export function getJob(ctx: GameContext, jobId: string): JobDef {
  const job = ctx.content.jobs[jobId];
  if (!job) throw new GameRuleError('unknown_job', `Неизвестная профессия: ${jobId}`);
  return job;
}

/** Статы профессии на джоб-уровне: base + growth × (level − 1), округление до целых. */
export function statsAt(job: JobDef, jobLevel: number): Stats {
  const k = Math.max(0, jobLevel - 1);
  const b = job.baseStats;
  return {
    hp: Math.round(b.hp + job.growth.hp * k),
    atk: Math.round(b.atk + job.growth.atk * k),
    def: Math.round(b.def + job.growth.def * k),
    spd: Math.round(b.spd + job.growth.spd * k),
    ...(b.moveSpeed ? { moveSpeed: b.moveSpeed } : {}),
  };
}

export interface HeroSkills {
  basic: string;
  /** Активные навыки по порядку открытия; последний — ульта. */
  actives: string[];
  passives: string[];
}

/**
 * Открытые навыки героя: навыки текущей профессии до его джоб-уровня
 * + (если keepSkillsOnJobChange) навыки прошлых профессий до уровня, на котором с них ушли.
 */
export function heroSkills(hero: HeroState, ctx: GameContext): HeroSkills {
  const job = getJob(ctx, hero.job);
  const sources = [
    ...(ctx.progression.keepSkillsOnJobChange ? hero.jobHistory : []).map((h) => ({ job: getJob(ctx, h.job), level: h.jobLevel })),
    { job, level: hero.jobLevel },
  ];
  const order: string[] = [];
  for (const src of sources) {
    for (const s of [...src.job.skills].sort((a, b) => a.jobLevel - b.jobLevel)) {
      if (s.jobLevel > src.level) continue;
      const i = order.indexOf(s.skill);
      if (i >= 0) order.splice(i, 1);
      order.push(s.skill);
    }
  }
  const isPassive = (id: string) => !!ctx.content.skills[id]?.trigger;
  return { basic: job.basic, actives: order.filter((s) => !isPassive(s)), passives: order.filter(isPassive) };
}

/** Герой игрока → юнит боя. id юнита = id героя. */
export function buildUnit(hero: HeroState, ctx: GameContext): UnitDef {
  const job = getJob(ctx, hero.job);
  const skills = heroSkills(hero, ctx);
  return {
    id: hero.id,
    name: hero.name,
    kind: 'hero',
    role: job.role,
    stats: statsAt(job, hero.jobLevel),
    skills: { basic: skills.basic, ult: skills.actives[skills.actives.length - 1], passives: skills.passives },
    visual: job.visual,
  };
}
