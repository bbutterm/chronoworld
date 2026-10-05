import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => {
  const { EventEmitter } = await import('node:events');
  class Container extends EventEmitter {
    list: Container[] = [];
    parentContainer: Container | null = null;
    data = new Map<string, unknown>();
    name = '';
    setName(name: string) { this.name = name; return this; }
    input?: { hitArea: object; hitAreaCallback: (...args: unknown[]) => boolean };
    constructor(public scene: unknown, public x = 0, public y = 0) { super(); }
    setData(key: string, value: unknown) { this.data.set(key, value); return this; }
    getData(key: string) { return this.data.get(key); }
    setOrigin() { return this; }
    setDepth() { return this; }
    setVisible() { return this; }
    setSize() { return this; }
    setY(y: number) { this.y = y; return this; }
    setMask() { return this; }
    add(nodes: Container | Container[]) {
      for (const node of [nodes].flat()) { node.parentContainer?.remove(node); node.parentContainer = this; this.list.push(node); }
      return this;
    }
    remove(node: Container) { this.list = this.list.filter((n) => n !== node); node.parentContainer = null; return this; }
    destroy() {
      if (!this.scene) return;
      for (const node of [...this.list]) node.destroy();
      this.emit('destroy'); this.parentContainer?.remove(this); this.scene = undefined;
    }
  }
  return { default: {
    Scene: class {},
    GameObjects: { Container, Events: { DESTROY: 'destroy' } },
    Scenes: { Events: { PRE_UPDATE: 'preupdate', SHUTDOWN: 'shutdown' } },
    Geom: { Rectangle: class {} },
  } };
});
vi.mock('../src/game/viewport', () => ({
  worldPoint: (_scene: unknown, p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
  minimumTouchSize: () => 132, minimumFontSize: () => 36, view: () => ({ uiHeight: 1410 }),
}));

const { EventEmitter } = await import('node:events');
const Phaser = (await import('phaser')).default;
const { ScrollArea } = await import('../src/game/ui');
const { closeTopModal } = await import('../src/game/screen');

afterEach(() => vi.restoreAllMocks());

function setup() {
  const nodes: Phaser.GameObjects.Container[] = [];
  const input = Object.assign(new EventEmitter(), { activePointer: { x: 150, y: 180, isDown: false } });
  const events = new EventEmitter();
  const mask = () => ({ clear() { return this; }, fillStyle() { return this; }, fillRect() { return this; },
    createGeometryMask() { return {}; }, destroy: vi.fn() });
  const scene = { input, events, make: { graphics: mask },
    children: { get list() { return nodes.filter((n) => n.scene && !n.parentContainer); } },
    add: { container: (x: number, y: number) => node(x, y), rectangle: (x: number, y: number) => node(x, y) },
  } as unknown as Phaser.Scene;
  const node = (x = 0, y = 0) => { const n = new Phaser.GameObjects.Container(scene, x, y); nodes.push(n); return n; };
  const area = (parent?: Phaser.GameObjects.Container) => {
    const a = new ScrollArea(scene, 100, 300);
    a.setContentHeight(1200);
    if (parent) parent.add(a.parts);
    return a;
  };
  const open = () => {
    const layer = node().setName('registered').setData('screenModal', true);
    layer.setData('close', () => layer.destroy());
    return layer;
  };
  const wheel = (dy: number) => input.emit('wheel', input.activePointer, [], 0, dy);
  const down = (y = 180) => { input.activePointer = { x: 150, y, isDown: true }; input.emit('pointerdown', input.activePointer); };
  const move = (y: number) => { input.activePointer = { x: 150, y, isDown: true }; input.emit('pointermove', input.activePointer); };
  const up = () => { input.activePointer.isDown = false; input.emit('pointerup', input.activePointer); };
  return { scene, input, events, node, area, open, wheel, down, move, up };
}

describe('ScrollArea input belongs only to the top registered modal', () => {
  it('a visible confirm blocks background wheel, swipe, tap and hit testing without changing explicit locked', () => {
    const h = setup(); const body = h.area(); const called = vi.fn(); const tap = body.tap(called);
    const button = h.node(); const originalHit = vi.fn(() => true);
    button.input = { hitArea: {}, hitAreaCallback: originalHit } as unknown as NonNullable<Phaser.GameObjects.Container['input']>;
    body.add(button); h.events.emit('preupdate');
    const confirm = h.open();
    h.wheel(300); h.down(); h.move(120); tap();
    expect(body.offset).toBe(0);
    expect(body.locked).toBe(false);
    expect(called).not.toHaveBeenCalled();
    expect(button.input!.hitAreaCallback({}, 150, 180, button)).toBe(false);
    expect(originalHit).not.toHaveBeenCalled();
    confirm.destroy(); h.up(); h.wheel(60);
    expect(body.offset).toBe(60);
    h.down(); tap(); expect(called).toHaveBeenCalledOnce(); h.up();
    body.content.destroy();
  });

  it('the top modal own list works through popInner ancestors; lower modal and scene body stay still', () => {
    const h = setup(); const body = h.area(); const outer = h.open(); const outerList = h.area(outer);
    const inner = h.open(); const popInner = h.node(); inner.add(popInner); const innerList = h.area(popInner);
    const innerTap = vi.fn(); const outerTap = vi.fn();
    h.wheel(70); innerList.tap(innerTap)(); outerList.tap(outerTap)();
    expect(innerList.offset).toBe(70);
    expect(outerList.offset).toBe(0);
    expect(body.offset).toBe(0);
    expect(innerTap).toHaveBeenCalledOnce();
    expect(outerTap).not.toHaveBeenCalled();
    // Back and input agree on the same top root layer.
    expect(closeTopModal(h.scene)).toBe(true);
    h.wheel(40); expect(outerList.offset).toBe(40); expect(body.offset).toBe(0);
    outer.destroy(); body.content.destroy();
  });

  it('a renamed closing layer blocks all lists until its DESTROY, then restores the remaining layer', () => {
    const h = setup(); const body = h.area(); const outer = h.open(); const outerList = h.area(outer);
    const closing = h.open(); const own = h.area(closing);
    closing.setData('closing', true).setName('');
    const called = vi.fn(); h.wheel(100); own.tap(called)();
    expect(called).not.toHaveBeenCalled();
    expect([body.offset, outerList.offset, own.offset]).toEqual([0, 0, 0]);
    expect(closeTopModal(h.scene)).toBe(true);
    expect(closing.scene).toBe(h.scene);
    closing.destroy(); h.wheel(40);
    expect(outerList.offset).toBe(40); expect(body.offset).toBe(0);
    outer.destroy(); body.content.destroy();
  });

  it('replacement/external DESTROY never changes an owner lock or retains stale input callbacks', () => {
    const h = setup(); const body = h.area(); body.locked = true;
    const first = h.open(); const firstList = h.area(first); const second = h.open(); const secondList = h.area(second);
    h.wheel(50); expect(secondList.offset).toBe(50); expect(firstList.offset).toBe(0);
    second.destroy(); h.wheel(40); expect(firstList.offset).toBe(40);
    first.destroy(); h.wheel(80); expect(body.offset).toBe(0); expect(body.locked).toBe(true);
    body.locked = false; h.wheel(80); expect(body.offset).toBe(80);
    expect(h.input.listenerCount('wheel')).toBe(1);
    body.content.destroy(); expect(h.input.listenerCount('wheel')).toBe(0);
    expect(h.events.listenerCount('preupdate')).toBe(0);
  });

  it('a modal appearing during a captured body gesture cancels it, so closing cannot resume the old swipe', () => {
    const h = setup(); const body = h.area(); const canceled = vi.fn(); h.input.on('ui-cancel-press', canceled);
    h.down(220); h.move(200); expect(body.offset).toBe(20);
    canceled.mockClear(); const modal = h.open(); h.events.emit('preupdate');
    h.move(160); expect(body.offset).toBe(20); expect(canceled).toHaveBeenCalledOnce();
    modal.destroy(); h.move(120); expect(body.offset).toBe(20);
    h.up(); h.down(220); h.move(200); expect(body.offset).toBe(40);
    body.content.destroy();
  });

  it('destroyed content tap closures cannot fire after a modal/scene body is removed', () => {
    const h = setup(); const modal = h.open(); const own = h.area(modal); const called = vi.fn(); const tap = own.tap(called);
    tap(); expect(called).toHaveBeenCalledOnce(); modal.destroy(); tap();
    expect(called).toHaveBeenCalledOnce();
    expect(h.input.listenerCount('pointermove')).toBe(0);
    expect(h.input.listenerCount('wheel')).toBe(0);
  });
});
