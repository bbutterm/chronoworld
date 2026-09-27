import { describe, expect, it } from 'vitest';
import { buildUnit, cardStats, heroSkills, heroStats, newGame, simulateBattle, statsAt } from '../src/core';
import { loadGameContext } from '../scripts/lib/content-node';

const ctx = loadGameContext();
const alan = () => newGame(ctx, 0).heroes[0];

describe('статы и навыки карточки героя', () => {
  it('статы профессии растут с уровнем (statsAt — линия карточки)', () => {
    const job = ctx.content.jobs.swordman;
    expect(statsAt(job, 1).hp).toBe(job.baseStats.hp);
    expect(statsAt(job, 5).hp).toBe(job.baseStats.hp + job.growth.hp * 4);
  });

  it('статы карточки = статы линии × statMods × statMult редкости (округление)', () => {
    const t = ctx.content.heroes.alan;
    const line = statsAt(ctx.content.jobs.swordman, 10);
    const s = cardStats(t, 10, 'green', ctx);
    expect(s.hp).toBe(Math.round((ctx.content.jobs.swordman.baseStats.hp + ctx.content.jobs.swordman.growth.hp * 9) * (t.statMods.hp ?? 1)));
    expect(s.atk).toBeLessThan(line.atk); // Алан — танк: atk × 0.9
    expect(s.def).toBeGreaterThan(line.def); // def × 1.15
    const blue = cardStats(t, 10, 'blue', ctx);
    expect(blue.hp).toBe(Math.round((ctx.content.jobs.swordman.baseStats.hp + ctx.content.jobs.swordman.growth.hp * 9) * (t.statMods.hp ?? 1) * ctx.cards.rarities[1].statMult));
    expect(heroStats({ ...alan(), level: 10 }, ctx)).toEqual(s);
  });

  it('навык открывается ровно на своём уровне (у Алана: 1 «Удар», 10 «Стойкость»)', () => {
    expect(heroSkills({ ...alan(), level: 9 }, ctx)).toEqual({ basic: 'basic_melee', actives: ['swordman_bash'], passives: [] });
    expect(heroSkills({ ...alan(), level: 10 }, ctx)).toEqual({ basic: 'basic_melee', actives: ['swordman_bash'], passives: ['swordman_endure'] });
  });

  it('buildUnit: активные навыки — в actives (без ульты), пассивки отдельно; бой детерминирован', () => {
    const u = buildUnit({ ...alan(), level: 10 }, ctx);
    expect(u).toMatchObject({ id: 'h1', name: 'Алан', kind: 'hero', role: 'tank' });
    expect(u.skills).toEqual({ basic: 'basic_melee', actives: ['swordman_bash'], passives: ['swordman_endure'] });
    expect(u.skillPower).toBeUndefined();
    const squad = [u, null, null, null, null];
    expect(simulateBattle(ctx.content, squad, ['warrior'], 3).log).toEqual(simulateBattle(ctx.content, squad, ['warrior'], 3).log);
  });

  it('исходный герой не меняется', () => {
    const h = alan();
    const copy = structuredClone(h);
    buildUnit(h, ctx);
    heroStats(h, ctx);
    expect(h).toEqual(copy);
  });
});
