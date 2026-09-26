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

/** K6. Плоская прибавка экипировки к статам героя (сумма статов надетых предметов). */
export interface StatBonus {
  hp: number;
  atk: number;
  def: number;
  spd: number;
}

/**
 * K6. Необязательная часть контекста: прибавки экипировки по id героя. Заполняет equipment/withGear(ctx, save),
 * чтобы playStage/skipStage (они вызывают buildUnit(hero, ctx)) учитывали экипировку без знания о save.inventory.
 */
export interface GearLookup {
  heroGear?: Readonly<Record<string, StatBonus>>;
}

/**
 * Герой игрока → юнит боя. id юнита = id героя.
 * K6: к статам профессии прибавляется экипировка — явный gear, иначе ctx.heroGear[hero.id], иначе ничего.
 */
export function buildUnit(hero: HeroState, ctx: GameContext & GearLookup, gear?: StatBonus): UnitDef {
  const job = getJob(ctx, hero.job);
  const skills = heroSkills(hero, ctx);
  const base = statsAt(job, hero.jobLevel);
  const g = gear ?? ctx.heroGear?.[hero.id];
  const stats: Stats = g ? { ...base, hp: base.hp + g.hp, atk: base.atk + g.atk, def: base.def + g.def, spd: base.spd + g.spd } : base;
  return {
    id: hero.id,
    name: hero.name,
    kind: 'hero',
    role: job.role,
    stats,
    skills: { basic: skills.basic, ult: skills.actives[skills.actives.length - 1], passives: skills.passives },
    visual: job.visual,
  };
}
