import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  const node = () => {
    const n: any = { scene: {}, visible: false, x: 0, y: 0, scaleX: 1, scaleY: 1,
      add: () => n, addAt: () => n, clear: () => n, fillStyle: () => n,
      lineStyle: () => n, fillRoundedRect: () => n, strokeRoundedRect: () => n,
      setStrokeStyle: () => n, setShadow: () => n, setAlpha: () => n,
      setScale(value: number) { n.scaleX = n.scaleY = value; return n; },
      setVisible(value: boolean) { n.visible = value; return n; },
      setPosition(x: number, y: number) { n.x = x; n.y = y; return n; },
      setY(value: number) { n.y = value; return n; },
      destroy() { n.scene = null; },
    };
    return n;
  };
  return { node, save: null as any };
});
vi.mock('phaser', () => ({ default: { Display: { Color: { HexStringToColor: () => ({ color: 1 }) } } } }));
vi.mock('../src/game/audio', () => ({ sfx: vi.fn() }));
vi.mock('../src/game/haptics', () => ({ haptic: vi.fn() }));
vi.mock('../src/game/heroCard', () => ({ rarityColor: () => '#ffffff' }));
vi.mock('../src/game/juice', () => ({ juiceOn: () => false }));
vi.mock('../src/game/numberFont', () => ({}));
vi.mock('../src/game/skin', () => ({}));
vi.mock('../src/game/sprites', () => ({ portraitKey: (key: string) => key }));
vi.mock('../src/game/screen', () => ({ portrait: () => harness.node() }));
vi.mock('../src/game/ui', () => ({ text: () => harness.node() }));
vi.mock('../src/game/viewport', () => ({ worldPoint: (_scene: unknown, p: unknown) => p }));
vi.mock('../src/game/session', () => ({ session: { get save() { return harness.save; } } }));

import { newGame } from '../src/core';
import { GAME } from '../src/game/content';
import { FormationEditor } from '../src/game/squadEditor';
import { formationBodyRows } from '../src/game/prepLayout';
import { S, TOUCH_COMFORT } from '../src/game/theme';

function fixture(body = true) {
  const area: any = {
    offset: 400, locked: false, scrollable: true,
    content: { get y() { return 216 - area.offset; }, getData: () => area.bounds },
    bounds: [216, 1000],
    setBounds: vi.fn((top: number, bottom: number) => { area.bounds = [top, bottom]; }),
  };
  const scene: any = {
    time: { now: 100, delayedCall: (_ms: number, callback: () => void) => ({ callback, remove: vi.fn() }) },
    input: { activePointer: {} },
    add: { circle: harness.node, container: harness.node },
  };
  const editor: any = Object.create(FormationEditor.prototype);
  Object.assign(editor, {
    scene, opts: { field: { top: 298, bottom: 1018 }, roster: { top: 1336, bottom: 1852 }, ...(body ? { scrollBody: { area, origin: 216 } } : {}) },
    locked: false, gesture: null, rosterH: 700, scrollY: 0, selected: null,
    slots: [{ x: 386, y: 740 }, { x: 386, y: 950 }], slotW: 200,
    slotViews: [harness.node(), harness.node()], cardViews: new Map(harness.save.heroes.map((h: any) => [h.id, harness.node()])),
    selFrame: harness.node(), highlight: harness.node(), dragLayer: harness.node(),
    ghost: null, dropHint: null, hover: -1, bodyDragLocked: false,
    apply: vi.fn(), tapSlot: vi.fn(), tapCard: vi.fn(),
  });
  return { editor, area, scene };
}
function point(x: number, y: number, wasTouch = true) { return { x, y, wasTouch, isDown: true, downTime: 100 }; }
function card(id: string) { return [{ getData: () => ({ hero: id }) }]; }
function slot(i: number) { return [{ getData: () => ({ slot: i }) }]; }

beforeEach(() => {
  vi.clearAllMocks();
  harness.save = newGame(GAME, 0);
  harness.save.squad = [harness.save.heroes[0].id, null, null, null, null];
});

describe('жесты отряда в прокручиваемом коротком окне', () => {
  it('предупреждение, разведка, пресеты и первая карточка не перекрывают практические цели 44 CSS', () => {
    for (const bottom of [872, 990, 1018]) for (const threat of [false, true]) {
      const rows = formationBodyRows(bottom, threat);
      const half = TOUCH_COMFORT / 2;
      expect(TOUCH_COMFORT / 3).toBeGreaterThanOrEqual(44);
      expect(rows.warningY - half - bottom).toBeGreaterThanOrEqual(S.xs);
      const zones = [rows.warningY, ...(threat ? [rows.threat.zoneY] : []), rows.rosterHeadY];
      for (let i = 1; i < zones.length; i++) expect(zones[i] - zones[i - 1] - 2 * half).toBeGreaterThanOrEqual(S.m);
      expect(rows.rosterTop + S.xs - (rows.rosterHeadY + half)).toBeGreaterThanOrEqual(S.s);
    }
  });

  it('карточка после прокрутки остаётся доступной по видимой координате', () => {
    const { editor } = fixture();
    const id = harness.save.heroes[1].id;
    editor.onDown(point(680, 950), card(id));
    editor.onUp(point(680, 950));
    expect(editor.tapCard).toHaveBeenCalledExactlyOnceWith(id);
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it('быстрое вертикальное движение по карточке листает, не поднимая и не выдавая героя', () => {
    const { editor, area } = fixture();
    editor.onDown(point(680, 950), card(harness.save.heroes[1].id));
    editor.onMove(point(690, 650));
    expect(editor.gesture.mode).toBe('scroll');
    expect(editor.ghost).toBeNull();
    expect(area.locked).toBe(false);
    editor.onUp(point(690, 650));
    expect(editor.tapCard).not.toHaveBeenCalled();
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it('вертикальная прокрутка по занятому и пустому слотам не убирает героя и не выбирает слот', () => {
    const { editor } = fixture();
    for (const i of [0, 1]) {
      editor.onDown(point(386, 740 - 400), slot(i));
      editor.onMove(point(390, 540));
      expect(editor.gesture.mode).toBe('scroll');
      editor.onUp(point(390, 540));
    }
    expect(editor.tapSlot).not.toHaveBeenCalled();
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it('мышь сразу переносит занятый слот вертикально, сохраняя позицию прокрутки', () => {
    const { editor, area } = fixture();
    editor.onDown(point(386, 340, false), slot(0));
    editor.onMove(point(386, 620, false));
    expect(editor.gesture.mode).toBe('drag');
    expect(area.offset).toBe(400);
    expect(area.locked).toBe(true);
    editor.onUp(point(386, 620, false));
    expect(editor.apply).toHaveBeenCalledExactlyOnceWith({ squad: [null, harness.save.heroes[0].id, null, null, null] }, 1);
    expect(area.locked).toBe(false);
  });

  it('мышь сразу переносит карточку из списка в видимый слот без удержания', () => {
    const { editor, area } = fixture();
    const id = harness.save.heroes[1].id;
    editor.onDown(point(680, 950, false), card(id));
    editor.onMove(point(386, 410, false));
    expect(editor.gesture.mode).toBe('drag');
    expect(area.offset).toBe(400);
    editor.onUp(point(386, 410, false));
    expect(editor.apply).toHaveBeenCalledExactlyOnceWith({ squad: [id, null, null, null, null] }, 0);
    expect(area.locked).toBe(false);
  });

  it('удержание фиксирует тело; видимый слот преобразуется обратно в игровую координату при drop', () => {
    const { editor, area, scene } = fixture();
    const id = harness.save.heroes[1].id;
    scene.input.activePointer = point(680, 950);
    editor.onDown(scene.input.activePointer, card(id));
    editor.gesture.holdTimer.callback();
    expect(editor.gesture.mode).toBe('drag');
    expect(area.locked).toBe(true);
    expect(area.setBounds).toHaveBeenCalledWith(216, 1000);
    editor.onMove(point(386, 410)); // slot740 - offset400 + ghost lift70
    editor.onUp(point(386, 410));
    expect(editor.apply).toHaveBeenCalledExactlyOnceWith({ squad: [id, null, null, null, null] }, 0);
    expect(area.locked).toBe(false);
    expect(editor.ghost).toBeNull();
  });

  it('pointerup над шапкой или закреплённой кнопкой отменяет перенос', () => {
    for (const y of [180, 1100]) {
      const { editor, scene } = fixture();
      scene.input.activePointer = point(680, 950);
      editor.onDown(scene.input.activePointer, card(harness.save.heroes[1].id));
      editor.gesture.holdTimer.callback();
      editor.onUp(point(386, y));
      expect(editor.apply).not.toHaveBeenCalled();
      expect(editor.ghost).toBeNull();
    }
  });

  it('clipped карточка под шапкой не начинает жест', () => {
    const { editor } = fixture();
    editor.onDown(point(680, 150), card(harness.save.heroes[1].id));
    expect(editor.gesture).toBeNull();
  });

  it('resize сохраняет выбор пустого слота, отменяя незавершённое касание без сохранения', () => {
    const { editor, area } = fixture();
    editor.selected = 3;
    editor.onDown(point(386, 340), slot(1));
    editor.setBodyBounds(216, 1200);
    expect(editor.selected).toBe(3);
    expect(editor.gesture).toBeNull();
    expect(area.setBounds).toHaveBeenCalledWith(216, 1200);
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it('resize во время удержания убирает призрак и разблокирует прокрутку', () => {
    const { editor, area, scene } = fixture();
    scene.input.activePointer = point(680, 950);
    editor.onDown(scene.input.activePointer, card(harness.save.heroes[1].id));
    editor.gesture.holdTimer.callback();
    editor.setBodyBounds(216, 1200);
    expect(editor.gesture).toBeNull();
    expect(editor.ghost).toBeNull();
    expect(area.locked).toBe(false);
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it('классический редактор продолжает перетаскивать слот вертикальным движением', () => {
    const { editor } = fixture(false);
    editor.onDown(point(386, 740), slot(0));
    editor.onMove(point(386, 765));
    expect(editor.gesture.mode).toBe('drag');
    editor.onMove(point(386, 1020));
    editor.onUp(point(386, 1020));
    expect(editor.apply).toHaveBeenCalledExactlyOnceWith({ squad: [null, harness.save.heroes[0].id, null, null, null] }, 1);
  });
});
