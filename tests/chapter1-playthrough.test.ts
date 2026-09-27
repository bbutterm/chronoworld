import { describe, expect, it } from 'vitest';
import { availableJobChanges, changeJob, newGame, playStage, type SaveState } from '../src/core';
import { loadGameContext } from '../scripts/lib/content-node';

const ctx = loadGameContext();
const FIRST_JOBS = ['swordman', 'thief', 'archer', 'mage', 'acolyte'];

describe('глава 1 играбельна с нуля', () => {
  it('Новички проходят главу, к середине все берут первую профессию (≤ 3 попытки на этап)', () => {
    let save: SaveState = newGame(ctx, 0);
    const stages = ctx.content.stages.filter((s) => s.chapter === ctx.content.chapters[0].id);
    let seed = 1;
    let jobChangeAt = -1;
    stages.forEach((s, i) => {
      let won = false;
      for (let t = 0; t < 3 && !won; t++) {
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
    expect(save.heroes.every((h) => ctx.content.jobs[h.job].tier === 1)).toBe(true);
  });
});
