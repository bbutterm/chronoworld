import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newGame, type SaveState } from '../src/core';
import { autoNextStage, heroesBadgeCount } from '../src/game/flow';
import { HINT_KEY, HINT_TEXT, hintDone, markHint, pickHomeHint, pickPrepHint, pickResultHint, reloadHints, resetHints, TUTORIAL_CHAIN, type HintId } from '../src/game/hints';
import { loadFullContext, loadGameContext } from '../scripts/lib/content-node';
import { placeCallout } from '../src/game/hintLayout';

const ctx = loadGameContext();
const stages = ctx.content.stages;
const clearedUpTo = (save: SaveState, n: number): SaveState => ({ ...save, campaign: { ...save.campaign, cleared: stages.slice(0, n).map((s) => s.id) } });

describe('R: подсказки первой сессии', () => {
  const none = () => false;
  const base = { cleared: 0, chestHasIncome: false, levelUpReady: false, towerUnlocked: false };

  it('новичок — «В кампанию»; после первой победы — сундук, «Улучшить», башня', () => {
    expect(pickHomeHint(base, none)).toBe('home_campaign');
    expect(pickHomeHint({ ...base, cleared: 1 }, none)).toBeNull();
    expect(pickHomeHint({ ...base, levelUpReady: true }, (id) => id === 'home_campaign')).toBe('level_up');
    expect(pickHomeHint({ ...base, cleared: 1, chestHasIncome: true }, none)).toBe('chest_claim');
    expect(pickHomeHint({ ...base, cleared: 3, levelUpReady: true }, none)).toBe('level_up');
    expect(pickHomeHint({ ...base, cleared: 9, towerUnlocked: true }, none)).toBe('tower_open');
  });

  it('ведущее обучение главы 1: цепочка по порядку, у каждого шага — русский текст, шаги не повторяются', () => {
    expect(new Set(TUTORIAL_CHAIN).size).toBe(TUTORIAL_CHAIN.length);
    for (const id of TUTORIAL_CHAIN) expect(HINT_TEXT[id]).toMatch(/[а-яё]/i);
    // Страница «Кампания»: всё готово сразу — шаги идут по одному в порядке цепочки, выполненный уходит.
    const all = { cleared: 5, chestHasIncome: true, levelUpReady: true, towerUnlocked: false, tavernReady: true, ascendReady: true, fastRewardsFree: true, questsUnlocked: true };
    const done = new Set<HintId>();
    const seen: HintId[] = [];
    for (let id = pickHomeHint(all, (x) => done.has(x)); id; id = pickHomeHint(all, (x) => done.has(x))) {
      seen.push(id);
      done.add(id);
    }
    expect(seen).toEqual(['chest_claim', 'level_up', 'tavern_summon', 'ascend', 'fast_rewards', 'quests_open']);
    expect(seen).toEqual(TUTORIAL_CHAIN.filter((id) => seen.includes(id)));
  });

  it('итоги боя: сначала «Дальше», потом «К кампании»; расстановка: «Авто» при новых героях, иначе «В бой»', () => {
    const done = new Set<HintId>();
    const isDone = (x: HintId) => done.has(x);
    expect(pickResultHint({ hasNext: true, chestOrLevel: true }, isDone)).toBe('result_next');
    done.add('result_next');
    expect(pickResultHint({ hasNext: true, chestOrLevel: false }, isDone)).toBeNull();
    expect(pickResultHint({ hasNext: true, chestOrLevel: true }, isDone)).toBe('result_home');
    done.add('chest_claim');
    expect(pickResultHint({ hasNext: true, chestOrLevel: true }, isDone)).toBeNull();
    expect(pickPrepHint({ first: true, benchStronger: false }, isDone)).toBe('stage_fight');
    expect(pickPrepHint({ first: true, benchStronger: true }, isDone)).toBe('prep_auto');
    done.add('prep_auto');
    done.add('stage_fight');
    expect(pickPrepHint({ first: true, benchStronger: true }, isDone)).toBeNull();
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

  it('значок «Герои»: сколько героев можно вознести (копий и золота хватает)', () => {
    const full = loadFullContext();
    expect(heroesBadgeCount(save, full)).toBe(0);
    // Две зелёные копии Алана — Алан готов к вознесению (герои v2: копиями, осколков нет).
    const copies = [{ id: 'h90', templateId: 'alan', rarity: 'green' as const, level: 1 }, { id: 'h91', templateId: 'alan', rarity: 'green' as const, level: 1 }];
    const ready = { ...save, heroes: [...save.heroes, ...copies], resources: { ...save.resources, gold: 5000 } };
    expect(heroesBadgeCount(ready, full)).toBe(1);
  });
});

describe('S: плашка подсказки не закрывает другие кнопки (placeCallout)', () => {
  const screen = { top: 158, bottom: 1920, width: 1080 };
  const box = { w: 560, h: 60 };

  it('предпочтительная сторона, если она свободна', () => {
    const p = placeCallout({ x: 540, y: 1390, w: 780, h: 130 }, box, { ...screen, prefer: 'below', avoid: [] });
    expect(p.side).toBe('below');
    expect(p.overlap).toBe(0);
    expect(p.box.y).toBeGreaterThan(1390 + 65);
  });

  it('«В бой» внизу: плашка над кнопкой, «Авто»/«Пресеты» на своём месте не закрыты', () => {
    const fight = { x: 540, y: 1810, w: 640, h: 150 };
    // Старое место ряда (1570) — плашка их задевала; новое (1540) — нет.
    const old = [{ x: 70, y: 1522, w: 440, h: 96 }, { x: 570, y: 1522, w: 440, h: 96 }];
    const now = [{ x: 70, y: 1492, w: 440, h: 96 }, { x: 570, y: 1492, w: 440, h: 96 }];
    const bad = placeCallout(fight, box, { ...screen, prefer: 'above', avoid: old });
    expect(bad.overlap).toBeGreaterThan(0);
    expect(bad.box.y + bad.box.h).toBeLessThanOrEqual(1920); // не за экраном, хоть и с перекрытием
    const ok = placeCallout(fight, box, { ...screen, prefer: 'above', avoid: now });
    expect(ok).toMatchObject({ side: 'above', overlap: 0 });
  });

  it('сдвиг вбок: плашка обходит соседнюю кнопку и всё ещё накрывает стрелку', () => {
    const fastBtn = { x: 700, y: 705, w: 280, h: 110 };
    const p = placeCallout({ x: 540, y: 563, w: 460, h: 96 }, box, { ...screen, prefer: 'below', avoid: [fastBtn] });
    expect(p).toMatchObject({ side: 'below', overlap: 0 });
    expect(p.box.x + p.box.w).toBeLessThanOrEqual(fastBtn.x);
    expect(p.box.x).toBeLessThanOrEqual(540 - 32);
    expect(p.box.x + p.box.w).toBeGreaterThanOrEqual(540 + 32);
  });

  it('итоги: «Дальше» у правого края, слева «Авто: следующий этап» — строка не влезает, узкая плашка в две строки влезает', () => {
    // ResultScene: «Дальше» (890, 1830, 330×130), переключатель «Авто» (280, 1680, 520×96), снизу — край экрана.
    const next = { x: 890, y: 1830, w: 330, h: 130 };
    const avoid = [{ x: 20, y: 1632, w: 520, h: 96 }, { x: 25, y: 1765, w: 330, h: 130 }, { x: 375, y: 1765, w: 330, h: 130 }];
    const wide = placeCallout(next, { w: 700, h: 60 }, { ...screen, prefer: 'above', avoid });
    expect(wide.overlap).toBeGreaterThan(0);
    // hintPointer (ui.ts) переносит строку уже, пока плашка не перестанет закрывать кнопки.
    const narrow = placeCallout(next, { w: 460, h: 100 }, { ...screen, prefer: 'above', avoid });
    expect(narrow).toMatchObject({ side: 'above', overlap: 0 });
  });

  it('предпочтительная сторона занята — выбирается другая', () => {
    const above = { x: 0, y: 820, w: 1080, h: 100 };
    const p = placeCallout({ x: 540, y: 1000, w: 400, h: 100 }, box, { ...screen, prefer: 'above', avoid: [above] });
    expect(p).toMatchObject({ side: 'below', overlap: 0 });
  });
});
