import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newGame, type SaveState } from '../src/core';
import { autoNextStage, heroesBadgeCount } from '../src/game/flow';
import { HINT_KEY, HINT_MAX, HINT_TEXT, hintDone, hintNagged, hintShown, markHint, markHintShown, NAG_LIMIT, noteHintVisit, pickHomeHint, pickPrepHint, pickResultHint, reloadHints, resetHints, setHintObsolete, TUTORIAL_CHAIN, type HintId } from '../src/game/hints';
import { loadFullContext, loadGameContext } from '../scripts/lib/content-node';
import { placeCallout, sceneObstacles, type SceneNode } from '../src/game/hintLayout';

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

  it('одноразовая подсказка подавлена окном: не расходуется и доступна после закрытия', () => {
    resetHints();
    const state = { ...base, cleared: 9, towerUnlocked: true };
    const done = (id: HintId) => hintDone(id) || hintShown(id);
    expect(pickHomeHint(state, done)).toBe('tower_open');
    markHintShown('tower_open', false);
    expect(hintShown('tower_open')).toBe(false);
    expect(pickHomeHint(state, done)).toBe('tower_open');
    markHintShown('tower_open', true);
    expect(hintShown('tower_open')).toBe(true);
    expect(pickHomeHint(state, done)).toBeNull();
    resetHints();
  });

  it('тексты подсказок: одна строка ≤ HINT_MAX знаков, голосом игры — без «нажмите», «коснитесь», «чтобы»', () => {
    expect(HINT_MAX).toBeLessThanOrEqual(40);
    for (const [id, t] of Object.entries(HINT_TEXT)) {
      expect(t.length, id).toBeLessThanOrEqual(HINT_MAX);
      expect(t, id).not.toMatch(/нажм|коснит|чтобы|\n/i);
    }
    // «Башня открыта!» CampaignScene дополняет указанием на вкладку — вместе тоже одна строка.
    expect(`${HINT_TEXT.tower_open} Загляните в «Приключения»`.length).toBeLessThanOrEqual(HINT_MAX);
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
    expect(seen).toEqual(['chest_claim', 'level_up', 'tavern_summon', 'fast_rewards', 'quests_open', 'ascend']);
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
    expect(pickPrepHint({ first: true, benchStronger: false, summoned: true }, isDone)).toBe('stage_fight');
    expect(pickPrepHint({ first: true, benchStronger: true, summoned: true }, isDone)).toBe('prep_auto');
    // До первого ×10 в Таверне (сильнее — только случайная карта из боя) шаг «Авто» не тратится.
    expect(pickPrepHint({ first: true, benchStronger: true, summoned: false }, isDone)).toBe('stage_fight');
    expect(pickPrepHint({ first: false, benchStronger: true, summoned: false }, isDone)).toBeNull();
    done.add('prep_auto');
    done.add('stage_fight');
    expect(pickPrepHint({ first: true, benchStronger: true, summoned: true }, isDone)).toBeNull();
  });

  it('шаг, ненужный по прогрессу сохранения (новое устройство), считается выполненным; сбой проверки — не выполнен', () => {
    resetHints();
    setHintObsolete((id) => id === 'level_up');
    try {
      expect(hintDone('level_up')).toBe(true);
      expect(hintDone('chest_claim')).toBe(false);
      expect(pickHomeHint({ ...base, cleared: 20, levelUpReady: true, chestHasIncome: true }, (id) => id === 'chest_claim' || hintDone(id))).toBeNull();
      setHintObsolete(() => {
        throw new Error('сохранение ещё не загружено');
      });
      expect(hintDone('level_up')).toBe(false);
    } finally {
      setHintObsolete(() => false);
    }
  });

  it('выполненная подсказка больше не показывается', () => {
    const done = new Set<HintId>(['home_campaign', 'chest_claim']);
    const isDone = (id: HintId) => done.has(id);
    expect(pickHomeHint(base, isDone)).toBeNull();
    expect(pickHomeHint({ ...base, cleared: 2, chestHasIncome: true, towerUnlocked: true }, isDone)).toBe('tower_open');
  });

  it('RN-21: фиолетовый без ветки в отряде — «Выберите ветку» (после вознесения, до Башни)', () => {
    const done = new Set<HintId>(['home_campaign']);
    expect(pickHomeHint({ ...base, cleared: 40, branchPending: true, towerUnlocked: true }, (id) => done.has(id))).toBe('branch_pick');
    expect(HINT_TEXT.branch_pick).toMatch(/ветк/);
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

  it('RN-15: «Башня открыта» на карте — один показ (markHintShown), остальные подсказки не глушит', () => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    });
    reloadHints();
    const base = { cleared: 0, chestHasIncome: false, levelUpReady: false, towerUnlocked: false };
    try {
      expect(hintShown('tower_open')).toBe(false);
      markHintShown('tower_open');
      markHintShown('level_up');
      reloadHints();
      expect(hintShown('tower_open')).toBe(true);
      // Не одноразовые не запоминаются показом.
      expect(hintShown('level_up')).toBe(false);
      const isDone = (id: HintId) => id === 'home_campaign' || hintDone(id) || hintShown(id);
      expect(pickHomeHint({ ...base, cleared: 20, towerUnlocked: true }, isDone)).toBeNull();
      expect(pickHomeHint({ ...base, cleared: 20, towerUnlocked: true, levelUpReady: true }, isDone)).toBe('level_up');
      resetHints();
      expect(hintShown('tower_open')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      reloadHints();
    }
  });

  it('повторяющийся указатель (вкладка «Герои»: трофеи, опыт) — не больше NAG_LIMIT заходов, пока держится состояние', () => {
    resetHints();
    const none = () => false;
    const st = { cleared: 6, chestHasIncome: false, levelUpReady: false, towerUnlocked: false, gearUpgrade: true };
    expect(NAG_LIMIT).toBeLessThanOrEqual(3);
    for (let i = 0; i < NAG_LIMIT; i++) {
      expect(pickHomeHint(st, none)).toBe('equip_gear');
      noteHintVisit('equip_gear', 'Campaign');
    }
    // Заходы исчерпаны — молчит (цепочка идёт дальше: Башня открылась — её шаг).
    expect(pickHomeHint(st, none)).toBeNull();
    expect(pickHomeHint({ ...st, towerUnlocked: true }, none)).toBe('tower_open');
    // На другом экране — свой счёт; не повторяющиеся шаги не считаются.
    expect(hintNagged('equip_gear', 'Heroes')).toBe(false);
    noteHintVisit('home_campaign', 'Campaign');
    expect(hintNagged('home_campaign', 'Campaign')).toBe(false);
    // Состояние сменилось (трофеи надеты) — и снова появилось: опять NAG_LIMIT заходов.
    expect(pickHomeHint({ ...st, gearUpgrade: false }, none)).toBeNull();
    expect(pickHomeHint(st, none)).toBe('equip_gear');
    resetHints();
  });
});

describe('S: помехи плашки — кнопки и данные', () => {
  const box = (x: number, y: number, w: number, h: number) => () => ({ x, y, width: w, height: h });
  it('кнопки и подписи — отдельно; цель, подписи на ней, подписи внутри кнопок и затемнения — не помеха', () => {
    const nodes: SceneNode[] = [
      { type: 'Rectangle', input: { enabled: true }, getBounds: box(0, 0, 1080, 1920) },
      { type: 'Text', text: 'Мощь 12 000', getBounds: box(40, 300, 300, 50) },
      { type: 'Text', text: '   ', getBounds: box(40, 400, 300, 50) },
      { type: 'Text', text: 'Скрыто', visible: false, getBounds: box(40, 500, 300, 50) },
      // Цель (кнопка под точкой) и подпись на ней.
      { type: 'Container', input: { enabled: true }, getBounds: box(400, 900, 280, 120), list: [{ type: 'Text', text: 'В бой', getBounds: box(480, 940, 120, 40) }] },
      { type: 'Text', text: 'В бой', getBounds: box(480, 940, 120, 40) },
      // Другая кнопка с подписью внутри.
      { type: 'Container', input: { enabled: true }, getBounds: box(40, 1200, 200, 100), list: [{ type: 'Text', text: 'Авто', getBounds: box(60, 1230, 100, 40) }] },
      { type: 'Container', name: 'hint', list: [{ type: 'Text', text: 'Подсказка', getBounds: box(0, 600, 500, 60) }] },
      { type: 'Container', visible: false, list: [{ type: 'Text', text: 'Невидимо', getBounds: box(0, 700, 500, 60) }] },
    ];
    const o = sceneObstacles(nodes, { x: 540, y: 960, w: 280, h: 120 }, { w: 1080, h: 1920 });
    expect(o.controls).toEqual([{ x: 40, y: 1200, w: 200, h: 100 }]);
    expect(o.texts).toEqual([{ x: 40, y: 300, w: 300, h: 50 }]);
  });
});
