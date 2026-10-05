import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { computeView } from '../src/game/viewLayout';

const state = vi.hoisted(() => ({ view: {} as ReturnType<typeof computeView>, resize: undefined as (() => void) | undefined }));
const account = vi.hoisted(() => ({ save: { resources: { gold: 123_456 }, currency: { gems: 8765 } } }));
vi.mock('phaser', () => ({ default: {
  Geom: { Rectangle: class { constructor(public x: number, public y: number, public width: number, public height: number) {} static Contains = () => true; } },
  GameObjects: { Events: { DESTROY: 'destroy' } }, Scenes: { Events: { SHUTDOWN: 'shutdown' } }, BlendModes: { ADD: 1 },
} }));
vi.mock('../src/game/session', () => ({ session: account, takeWarnings: () => [] }));
vi.mock('../src/game/viewport', () => ({
  view: () => state.view,
  minimumTouchSize: () => state.view.adaptive ? Math.max(132, Math.ceil(44 * state.view.worldW / state.view.cssW)) : 96,
  onViewChange: vi.fn((_scene: unknown, fn: () => void) => { state.resize = fn; }),
}));
vi.mock('../src/game/telegram', () => ({ setTgBack: vi.fn(() => () => {}) }));
vi.mock('../src/game/transitions', () => ({ isLeaving: () => false }));
vi.mock('../src/game/juice', () => ({ animateCurrency: vi.fn() }));
vi.mock('../src/game/audio', () => ({ sfx: vi.fn() }));
vi.mock('../src/game/haptics', () => ({ haptic: vi.fn() }));
vi.mock('../src/game/assets', () => ({ hasArt: () => true }));
vi.mock('../src/game/itemIcons', () => ({ roIcon: () => null }));
vi.mock('../src/game/ui', () => ({ text: vi.fn(), toast: vi.fn() }));
const { screen, refreshScreen, registerModal } = await import('../src/game/screen');
const ui = await import('../src/game/ui');
const telegram = await import('../src/game/telegram');
const juice = await import('../src/game/juice');
const viewport = await import('../src/game/viewport');

class Node extends EventEmitter {
  scene: unknown = {};
  list: Node[] = [];
  name = '';
  data = new Map<string, unknown>();
  input?: { hitArea: { width: number; height: number } };
  text = '';
  constructor(public x = 0, public y = 0, public width = 0, public height = 0) { super(); }
  setSize(w: number, h: number) { this.width = w; this.height = h; return this; }
  setDisplaySize(w: number, h: number) { return this.setSize(w, h); }
  setOrigin() { return this; }
  setShadow() { return this; }
  setTint() { return this; }
  setBlendMode() { return this; }
  setAlpha() { return this; }
  setName(n: string) { this.name = n; return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setData(key: string, value: unknown) { this.data.set(key, value); return this; }
  setInteractive(config: { hitArea: { width: number; height: number } }) { this.input = { hitArea: config.hitArea }; return this; }
  setText(text: string | string[]) { this.text = String(text); return this; }
  fillStyle() { return this; }
  lineStyle() { return this; }
  fillRoundedRect() { return this; }
  strokeRoundedRect() { return this; }
  destroy() { this.emit('destroy'); this.scene = undefined; }
}

function setup() {
  const roots: Node[] = [];
  const make = (x = 0, y = 0, w = 0, h = 0) => {
    const n = new Node(x, y, w, h); n.scene = scene; roots.push(n);
    n.on('destroy', () => { const i = roots.indexOf(n); if (i >= 0) roots.splice(i, 1); });
    return n;
  };
  const scene = {
    add: {
      image: make, rectangle: make, graphics: () => make(),
      container: (x: number, y: number, list: Node[] = []) => {
        const node = make(x, y); node.list = list;
        for (const child of list) roots.splice(roots.indexOf(child), 1);
        return node;
      },
    },
    children: {
      get list() { return roots.filter((n) => n.scene); }, get length() { return this.list.length; },
      getIndex(node: Node) { return this.list.indexOf(node); },
      moveTo(node: Node, index: number) { roots.splice(roots.indexOf(node), 1); roots.splice(index, 0, node); },
    },
    events: new EventEmitter(), input: new EventEmitter(), sys: { isActive: () => true },
  };
  vi.mocked(ui.text).mockImplementation((_scene, x, y, text) => make(x, y, 136, 48).setText(text) as unknown as ReturnType<typeof ui.text>);
  screen(scene as unknown as Phaser.Scene, '', null);
  return Object.assign(() => scene.children.list.filter((n) => n.input), { roots, scene });
}

beforeEach(() => { vi.clearAllMocks(); account.save.resources.gold = 123_456; account.save.currency.gems = 8765; });

describe('Баланс в адаптивной шапке', () => {
  it('одна непересекающаяся цель44CSSpx показывает точные текущие суммы обеих валют', () => {
    state.view = computeView(360, 640, 1, { top: 136, bottom: 34, left: 0, right: 0 }, 2, true);
    const targets = setup()();
    expect(targets.map((n) => n.name)).toEqual(['currencyBalanceTarget']);
    const balance = targets[0];
    const scale = state.view.cssW / state.view.worldW;
    expect(balance.input!.hitArea.height * scale).toBeGreaterThanOrEqual(44);
    expect(balance.y - balance.height / 2).toBeGreaterThanOrEqual(0);
    expect(balance.y + balance.height / 2).toBeLessThanOrEqual(150);
    // После награды информация читает save при тапе, а не устаревшее число при create.
    account.save.resources.gold = 1_234_567; account.save.currency.gems = 9012;
    balance.emit('pointerdown'); balance.emit('pointerup');
    expect(vi.mocked(ui.toast).mock.calls[0][1]).toBe('Баланс\nЗолото: 1 234 567\nГемы: 9 012');
  });

  it('полоса96world не выпускает цель132world в область выреза; высокий экран получает две отдельные цели', () => {
    state.view = computeView(360, 700, 1, undefined, 2, true);
    const targets = setup();
    expect(targets().map((n) => n.name)).toEqual(['currencyBalanceTarget']);
    state.view = computeView(360, 780, 1, undefined, 2, true);
    state.resize!();
    const pills = targets();
    expect(pills.map((n) => n.name)).toEqual(['pill_gems', 'pill_gold']);
    for (const n of pills) {
      expect(n.input!.hitArea.height / 3).toBeGreaterThanOrEqual(44);
      expect(n.y - n.height / 2).toBeGreaterThanOrEqual(state.view.safeTop);
      expect(n.y + n.height / 2).toBeLessThanOrEqual(0);
    }
    expect(pills[1].x + pills[1].width / 2).toBeLessThan(pills[0].x - pills[0].width / 2);
    pills[0].emit('pointerdown'); pills[0].emit('pointerup');
    expect(vi.mocked(ui.toast).mock.calls[0][1]).toBe('Гемы: 8 765');
  });

  it('классическая сцена сохраняет прежние две цели валют', () => {
    state.view = computeView(360, 640, 1);
    expect(setup()().map((n) => n.name)).toEqual(['pill_gold', 'pill_gems']);
  });

  it('после добавления background bleed и resize шапка остаётся над ним', () => {
    state.view = computeView(360, 640, 1, { top: 136, bottom: 34, left: 0, right: 0 }, 2, true);
    const h = setup();
    const bleed = new Node(); h.roots.splice(1, 0, bleed);
    state.resize!();
    const header = h.scene.children.list.find((n) => n.height === 510)!;
    expect(header).toBeDefined();
    expect(h.scene.children.getIndex(header)).toBeGreaterThan(h.scene.children.getIndex(bleed));
    state.resize!();
    expect(h.scene.children.getIndex(h.scene.children.list.find((n) => n.height === 510)!)).toBeGreaterThan(h.scene.children.getIndex(bleed));
  });

  it('refreshScreen обновляет текущий баланс, сохраняя body, offset, модальное окно и единственные bindings', () => {
    state.view = computeView(360, 640, 1, { top: 136, bottom: 34, left: 0, right: 0 }, 2, true);
    const h = setup();
    const scene = h.scene as unknown as Phaser.Scene;
    const body = new Node(0, -470).setName('bodyScroll').setData('clip', [170, 1050]); body.scene = scene;
    const modal = new Node().setName('activeModal'); modal.scene = scene;
    h.roots.push(body, modal);
    registerModal(modal as unknown as Phaser.GameObjects.Container, () => {});
    const sdkBindings = vi.mocked(telegram.setTgBack).mock.calls.length;
    const resizeBindings = vi.mocked(viewport.onViewChange).mock.calls.length;
    for (let i = 1; i <= 3; i++) {
      account.save.resources.gold = 345_678 + i; account.save.currency.gems = 9010 + i;
      refreshScreen(scene);
      const pills = vi.mocked(juice.animateCurrency).mock.calls.at(-1)![1];
      expect(pills.map((p) => p.value)).toEqual([345_678 + i, 9010 + i]);
      expect(h.scene.children.list).toContain(body);
      expect(h.scene.children.list).toContain(modal);
      expect(body.y).toBe(-470);
      expect(body.data.get('clip')).toEqual([170, 1050]);
      expect(modal.data.get('screenModal')).toBe(true);
      expect(vi.mocked(telegram.setTgBack).mock.calls).toHaveLength(sdkBindings);
      expect(vi.mocked(viewport.onViewChange).mock.calls).toHaveLength(resizeBindings);
      expect(h().filter((n) => n.name === 'currencyBalanceTarget')).toHaveLength(1);
    }
    h.scene.events.emit('shutdown');
    const roots = [...h.roots];
    refreshScreen(scene);
    expect(h.roots).toEqual(roots);
  });

});
