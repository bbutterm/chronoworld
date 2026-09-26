import { describe, expect, it } from 'vitest';
import { buildContent, buildUnit, ContentError, newGame, simulateBattle, type JobDef } from '../src/core';
import { loadGameContext } from '../scripts/lib/content-node';
import { skill } from './helpers';

const ctx = loadGameContext();
const jobs = ctx.content.jobs;
const DEFAULT_SQUAD = ['guard', 'warrior', 'archer', 'mage', 'priest'];

const TIER1 = ['swordman', 'acolyte', 'mage', 'archer', 'thief', 'merchant'];
const TIER2 = ['knight', 'crusader', 'priest', 'monk', 'wizard', 'sage', 'hunter', 'bard', 'assassin', 'rogue', 'blacksmith', 'alchemist'];

/** Цепочка профессий от Новичка до jobId (по первому from). */
function path(jobId: string): JobDef[] {
  const out: JobDef[] = [];
  for (let j: JobDef | undefined = jobs[jobId]; j; j = j.from[0] ? jobs[j.from[0]] : undefined) out.unshift(j);
  return out;
}

describe('профессии', () => {
  it('загружаются все 19 профессий с нужными tier', () => {
    expect(Object.keys(jobs).sort()).toEqual(['novice', ...TIER1, ...TIER2].sort());
    expect(jobs.novice.tier).toBe(0);
    for (const id of TIER1) expect(jobs[id]).toMatchObject({ tier: 1, from: ['novice'] });
    for (const id of TIER2) expect(jobs[id].tier).toBe(2);
  });

  it.each([...TIER1, ...TIER2])('%s: ≥ 5 навыков, есть активный и пассивный', (id) => {
    const skills = jobs[id].skills.map((s) => ctx.content.skills[s.skill]);
    expect(skills.length).toBeGreaterThanOrEqual(5);
    expect(skills.some((s) => !s.trigger)).toBe(true);
    expect(skills.some((s) => !!s.trigger)).toBe(true);
  });

  it.each(Object.keys(jobs))('%s достижима от Новичка', (id) => {
    const p = path(id);
    expect(p[0].id).toBe('novice');
    p.forEach((j, i) => expect(j.tier).toBe(i));
  });

  it.each(Object.keys(jobs))('%s: герой на максимальном уровне собирается и воюет', (id) => {
    const chain = path(id);
    const base = newGame(ctx, 0).heroes[0];
    const heroes = [1, 2, 3, 4, 5].map((n) => ({
      ...base,
      id: `h${n}`,
      job: id,
      jobLevel: jobs[id].maxJobLevel,
      jobHistory: chain.slice(0, -1).map((j) => ({ job: j.id, jobLevel: j.maxJobLevel })),
    }));
    const squad = heroes.map((h) => buildUnit(h, ctx));
    expect(squad[0].skills.ult).toBeDefined();
    const a = simulateBattle(ctx.content, squad, DEFAULT_SQUAD, 7, { log: false });
    const b = simulateBattle(ctx.content, DEFAULT_SQUAD, squad, 8, { log: false });
    expect(['A', 'B']).toContain(a.winner);
    expect(['A', 'B']).toContain(b.winner);
  });
});

describe('проверки профессий', () => {
  const job = (id: string, tier: number, from: string[], patch: object = {}) => ({
    id,
    name: id,
    tier,
    from,
    maxJobLevel: 10,
    role: 'damage',
    baseStats: { hp: 100, atk: 10, def: 0, spd: 100 },
    growth: { hp: 1, atk: 1, def: 0, spd: 0 },
    basic: 'shot',
    skills: [],
    visual: { sprite: id },
    ...patch,
  });
  const problems = (list: object[]): string[] => {
    try {
      buildContent({
        units: [],
        skills: [{ file: 'shot.json', data: skill('shot') }, { file: 'buff.json', data: skill('buff', { trigger: 'battleStart' }) }],
        jobs: list.map((data, i) => ({ file: `job${i}.json`, data })),
      });
    } catch (e) {
      if (e instanceof ContentError) return e.problems;
      throw e;
    }
    return [];
  };

  it('правильное дерево проходит', () => {
    expect(problems([job('novice', 0, []), job('a', 1, ['novice']), job('b', 2, ['a'])])).toEqual([]);
  });

  it('источник from с тем же или большим tier', () => {
    const p = problems([job('novice', 0, []), job('a', 1, ['novice']), job('b', 1, ['a'])]).join('\n');
    expect(p).toMatch(/профессия b: from a \(tier 1\)/);
  });

  it('недостижимая профессия и tier ≥ 1 без from', () => {
    const p = problems([job('novice', 0, []), job('lonely', 1, []), job('orphan', 2, ['lonely'])]).join('\n');
    expect(p).toMatch(/профессия lonely: у профессии tier 1 должен быть непустой from/);
    expect(p).toMatch(/профессия orphan: недостижима/);
  });

  it('цикл без Новичка недостижим', () => {
    const p = problems([job('novice', 0, []), job('x', 2, ['y']), job('y', 1, ['x'])]).join('\n');
    expect(p).toMatch(/профессия x: недостижима/);
    expect(p).toMatch(/профессия y: недостижима/);
  });

  it('tier 0 с from, несуществующий from, повтор уровня навыка', () => {
    const p = problems([
      job('novice', 0, ['ghost']),
      job('a', 1, ['novice', 'nope'], { skills: [{ jobLevel: 5, skill: 'shot' }, { jobLevel: 5, skill: 'buff' }, { jobLevel: 11, skill: 'shot' }] }),
    ]).join('\n');
    expect(p).toMatch(/профессия novice: у профессии tier 0 не должно быть from/);
    expect(p).toMatch(/профессия a: from ссылается на несуществующую профессию nope/);
    expect(p).toMatch(/профессия a: на джоб-уровне 5 открывается больше одного навыка/);
    expect(p).toMatch(/профессия a: навык shot открывается на 11 > maxJobLevel 10/);
  });
});
