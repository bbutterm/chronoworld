import { describe, expect, it } from 'vitest';
import { addJobExp, availableJobChanges, buildUnit, changeJob, expToNext, GameRuleError, heroSkills, newGame, simulateBattle, statsAt } from '../src/core';
import { loadGameContext } from '../scripts/lib/content-node';

const ctx = loadGameContext();
const hero = () => newGame(ctx, 0).heroes[0];

describe('статы и навыки героя', () => {
  it('статы растут с джоб-уровнем', () => {
    const job = ctx.content.jobs.novice;
    expect(statsAt(job, 1).hp).toBe(job.baseStats.hp);
    expect(statsAt(job, 5).hp).toBe(job.baseStats.hp + job.growth.hp * 4);
  });

  it('навык открывается ровно на своём уровне', () => {
    expect(heroSkills({ ...hero(), jobLevel: 4 }, ctx).actives).toEqual([]);
    expect(heroSkills({ ...hero(), jobLevel: 5 }, ctx).actives).toEqual(['novice_first_aid']);
  });

  it('buildUnit: активные навыки — в actives (без ульты), пассивки отдельно; бой детерминирован', () => {
    const h = { ...hero(), job: 'swordman', jobLevel: 10, jobHistory: [{ job: 'novice', jobLevel: 10 }] };
    const u = buildUnit(h, ctx);
    expect(u.skills).toEqual({ basic: 'basic_melee', actives: ['novice_first_aid', 'swordman_bash'], passives: ['swordman_endure'] });
    const squad = [u, null, null, null, null];
    expect(simulateBattle(ctx.content, squad, ['warrior'], 3).log).toEqual(simulateBattle(ctx.content, squad, ['warrior'], 3).log);
  });
});

describe('опыт и смена профессии', () => {
  it('expToNext по формуле', () => {
    expect(expToNext(1, ctx.progression)).toBe(Math.floor(ctx.progression.exp.base));
  });

  it('уровни, открытие навыка и доступность смены профессии', () => {
    const { hero: h, events } = addJobExp(hero(), 1_000_000, ctx);
    expect(h.jobLevel).toBe(ctx.content.jobs.novice.maxJobLevel);
    expect(h.jobExp).toBe(0);
    expect(events.filter((e) => e.type === 'levelUp')).toHaveLength(9);
    expect(events).toContainEqual({ type: 'skillUnlocked', heroId: 'h1', job: 'novice', skill: 'novice_first_aid', jobLevel: 5 });
    expect(events).toContainEqual({ type: 'jobChangeAvailable', heroId: 'h1', jobs: availableJobChanges(h, ctx) });
  });

  it('смена профессии: порог, история, сброс уровня; чужая ветка запрещена', () => {
    expect(() => changeJob(hero(), 'swordman', ctx)).toThrow(GameRuleError);
    const lvl10 = { ...hero(), jobLevel: 10 };
    const { hero: h } = changeJob(lvl10, 'swordman', ctx);
    expect(h).toMatchObject({ job: 'swordman', jobLevel: 1, jobHistory: [{ job: 'novice', jobLevel: 10 }] });
    expect(heroSkills(h, ctx).actives).toContain('novice_first_aid');
  });

  it('исходный герой не меняется', () => {
    const h = hero();
    addJobExp(h, 500, ctx);
    expect(h.jobLevel).toBe(1);
  });
});
