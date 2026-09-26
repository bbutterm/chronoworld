import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newGame, type SaveState } from '../src/core';
import { autoNextStage, jobChangeReadyCount } from '../src/game/flow';
import { HINT_KEY, hintDone, markHint, pickHomeHint, reloadHints, resetHints, type HintId } from '../src/game/hints';
import { loadGameContext } from '../scripts/lib/content-node';

const ctx = loadGameContext();
const stages = ctx.content.stages;
const clearedUpTo = (save: SaveState, n: number): SaveState => ({ ...save, campaign: { ...save.campaign, cleared: stages.slice(0, n).map((s) => s.id) } });

describe('R: подсказки первой сессии', () => {
  const none = () => false;
  const base = { cleared: 0, chestHasIncome: false, jobChangeReady: false, towerUnlocked: false };

  it('новичок — «В кампанию»; после первой победы — сундук, смена профессии, башня', () => {
    expect(pickHomeHint(base, none)).toBe('home_campaign');
    expect(pickHomeHint({ ...base, cleared: 1 }, none)).toBeNull();
    expect(pickHomeHint({ ...base, jobChangeReady: true }, (id) => id === 'home_campaign')).toBe('job_change');
    expect(pickHomeHint({ ...base, cleared: 1, chestHasIncome: true }, none)).toBe('chest_claim');
    expect(pickHomeHint({ ...base, cleared: 3, jobChangeReady: true }, none)).toBe('job_change');
    expect(pickHomeHint({ ...base, cleared: 9, towerUnlocked: true }, none)).toBe('tower_open');
  });

  it('выполненная подсказка больше не показывается', () => {
    const done = new Set<HintId>(['home_campaign', 'chest_claim']);
    const isDone = (id: HintId) => done.has(id);
    expect(pickHomeHint(base, isDone)).toBeNull();
    expect(pickHomeHint({ ...base, cleared: 2, chestHasIncome: true, towerUnlocked: true }, isDone)).toBe('tower_open');
  });

  describe('хранение в localStorage (отдельно от сохранения игры)', () => {
    let mem: Map<string, string>;
    beforeEach(() => {
      mem = new Map();
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, v),
        removeItem: (k: string) => void mem.delete(k),
      });
      reloadHints();
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      reloadHints();
    });

    it('markHint запоминается, resetHints сбрасывает', () => {
      expect(hintDone('stage_fight')).toBe(false);
      markHint('stage_fight');
      expect(JSON.parse(mem.get(HINT_KEY)!)).toEqual(['stage_fight']);
      reloadHints();
      expect(hintDone('stage_fight')).toBe(true);
      resetHints();
      expect(hintDone('stage_fight')).toBe(false);
      expect(mem.has(HINT_KEY)).toBe(false);
    });

    it('испорченное или недоступное хранилище — подсказки просто показываются', () => {
      mem.set(HINT_KEY, '{oops');
      reloadHints();
      expect(hintDone('stage_fight')).toBe(false);
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
        removeItem: () => {
          throw new Error('blocked');
        },
      });
      reloadHints();
      expect(() => markHint('tower_open')).not.toThrow();
      expect(hintDone('tower_open')).toBe(true);
      expect(() => resetHints()).not.toThrow();
    });
  });
});

describe('R: авто-прохождение кампании', () => {
  const save = newGame(ctx, 0);

  it('после победы — следующий новый этап той же главы', () => {
    const s = clearedUpTo(save, 1);
    expect(autoNextStage(s, stages[0].id, true, ctx)).toEqual({ next: stages[1], stop: null });
  });

  it('останавливается на поражении, на конце главы и на повторе пройденного', () => {
    expect(autoNextStage(save, stages[0].id, false, ctx).stop).toBe('defeat');
    const lastOfCh1 = stages.filter((s) => s.chapter === stages[0].chapter).at(-1)!;
    if (lastOfCh1.globalIndex + 1 < stages.length) {
      const s = clearedUpTo(save, lastOfCh1.globalIndex + 1);
      const r = autoNextStage(s, lastOfCh1.id, true, ctx);
      expect(r).toEqual({ next: null, stop: 'chapter_end' });
    }
    const replay = clearedUpTo(save, 3);
    expect(autoNextStage(replay, stages[0].id, true, ctx).stop).toBe('replay');
    const last = stages[stages.length - 1];
    expect(autoNextStage(clearedUpTo(save, stages.length), last.id, true, ctx).stop).toBe('no_next');
  });

  it('значок «Герои»: сколько героев могут сменить профессию', () => {
    expect(jobChangeReadyCount(save, ctx)).toBe(0);
    const need = ctx.progression.jobChange.tierLevel['1'];
    const heroes = save.heroes.map((h, i) => (i === 0 ? { ...h, jobLevel: need } : h));
    expect(jobChangeReadyCount({ ...save, heroes }, ctx)).toBe(1);
  });
});
