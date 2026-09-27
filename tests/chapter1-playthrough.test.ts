import { describe, expect, it } from 'vitest';
import { availableJobChanges, changeJob, newGame, playStage, type SaveState } from '../src/core';
import { loadGameContext } from '../scripts/lib/content-node';

const ctx = loadGameContext();
const FIRST_JOBS = ['swordman', 'archer', 'acolyte', 'mage', 'thief'];

describe('глава 1 играбельна с нуля', () => {
  it('Новички проходят главу, к середине все берут первую профессию (≤ 3 попытки на этап, босс — ≤ 6: ~⅔ побед)', () => {
    let save: SaveState = newGame(ctx, 0);
    const stages = ctx.content.stages.filter((s) => s.chapter === ctx.content.chapters[0].id);
    let seed = 1;
    let jobChangeAt = -1;
    stages.forEach((s, i) => {
      let won = false;
      for (let t = 0; t < (s.boss ? 6 : 3) && !won; t++) {
        const out = playStage(save, s.id, seed++, ctx);
        save = out.save;
        won = out.result.winner === 'A';
      }
      expect(won, `${s.id} ${s.name}`).toBe(true);
      save = {
        ...save,
        heroes: save.heroes.map((h, k) => {
          const jobs = availableJobChanges(h, ctx);
          if (!jobs.length) return h;
          if (jobChangeAt < 0) jobChangeAt = i;
          return changeJob(h, jobs.includes(FIRST_JOBS[k]) ? FIRST_JOBS[k] : jobs[0], ctx).hero;
        }),
      };
    });
    // Первая профессия — после нескольких боёв, но не с первого.
    expect(jobChangeAt).toBeGreaterThanOrEqual(2);
    expect(jobChangeAt).toBeLessThanOrEqual(5);
    const start = ctx.progression.heroes.count;
    expect(save.heroes.slice(0, start).every((h) => ctx.content.jobs[h.job].tier === 1)).toBe(true);
    // После босса главы приходит новый герой (Новичок) и встаёт в отряд.
    const joined = save.heroes.slice(start);
    expect(joined.map((h) => h.name)).toEqual(ctx.progression.heroes.recruits.filter((r) => stages.some((s) => s.id === r.afterStage)).map((r) => r.name));
    for (const h of joined) expect(save.squad).toContain(h.id);
  });
});
