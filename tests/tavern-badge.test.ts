import { describe, expect, it } from 'vitest';
import { finishEvening, finishPersonalScene, newGame, tavernNewCount, type SaveState } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const T = ctx.story.tavern!;
const fresh = () => newGame(ctx, 1_700_000_000_000);
/** Пройдены все этапы глав до chapterN включительно. */
const through = (save: SaveState, chapterN: number): SaveState => {
  const chapters = ctx.content.chapters.filter((c) => c.order <= chapterN).map((c) => c.id);
  return { ...save, campaign: { cleared: ctx.content.stages.filter((s) => chapters.includes(s.chapter)).map((s) => s.id) } };
};

describe('значок «новый вечер» (tavernNewCount)', () => {
  it('новая игра — 0; глава пройдена — 1; вечер увиден — снова 0', () => {
    expect(tavernNewCount(fresh(), ctx)).toBe(0);
    const s1 = through(fresh(), 1);
    expect(tavernNewCount(s1, ctx)).toBe(1);
    expect(tavernNewCount(through(fresh(), 3), ctx)).toBe(3);
    const s2 = finishEvening(s1, 'tav_ch1', ctx).save;
    expect(tavernNewCount(s2, ctx)).toBe(0);
  });

  it('личная сцена, открытая близостью и не показанная, тоже считается', () => {
    const s = { ...fresh(), tavern: { bond: { vika: T.bond.sceneAt } } } as SaveState;
    expect(tavernNewCount(s, ctx)).toBe(1);
    expect(tavernNewCount(finishPersonalScene(s, T.heroes.vika.scene.id), ctx)).toBe(0);
    // Ниже порога — не считается.
    expect(tavernNewCount({ ...fresh(), tavern: { bond: { vika: T.bond.sceneAt - 1 } } } as SaveState, ctx)).toBe(0);
  });

  it('нет вечеров в данных — 0', () => {
    expect(tavernNewCount(through(fresh(), 2), { ...ctx, story: { ...ctx.story, tavern: undefined } })).toBe(0);
  });
});
