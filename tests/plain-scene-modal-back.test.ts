import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => {
  const { EventEmitter } = await import('node:events');
  class Container extends EventEmitter {
    parentContainer: Container | null = null;
    data = new Map<string, unknown>();
    constructor(public scene: unknown) { super(); }
    setData(key: string, value: unknown) { this.data.set(key, value); return this; }
    getData(key: string) { return this.data.get(key); }
    destroy() { if (!this.scene) return; this.emit('destroy'); this.scene = undefined; }
  }
  return { default: {
    Scene: class {},
    GameObjects: { Container, Events: { DESTROY: 'destroy' } },
    Scenes: { Events: { SHUTDOWN: 'shutdown' } },
  } };
});

const { EventEmitter } = await import('node:events');
const Phaser = (await import('phaser')).default;
const { registerModal, closeTopModal } = await import('../src/game/screen');
const { ModalBack } = await import('../src/game/modalBack');
const { setTgAppForTests, tgBack } = await import('../src/game/telegram');

afterEach(() => setTgAppForTests(undefined));

function setup() {
  const handlers = new Set<() => void>();
  setTgAppForTests({ version: '9.0', platform: 'ios', BackButton: {
    onClick: (fn) => handlers.add(fn), offClick: (fn) => handlers.delete(fn), show: vi.fn(), hide: vi.fn(),
  } });
  const scenes: { events: InstanceType<typeof EventEmitter>; active: boolean; nodes: Phaser.GameObjects.Container[] }[] = [];
  const scene = () => {
    const state = { events: new EventEmitter(), active: true, nodes: [] as Phaser.GameObjects.Container[] };
    const scene = { events: state.events, sys: { isActive: () => state.active },
      children: { get list() { return state.nodes.filter((n) => n.scene); } } } as unknown as Phaser.Scene;
    const open = (animated = false) => {
      const layer = new Phaser.GameObjects.Container(scene);
      state.nodes.push(layer);
      const close = vi.fn(() => { if (animated) layer.setData('closing', true); else layer.destroy(); });
      registerModal(layer, close);
      return { layer, close };
    };
    const stop = () => { state.active = false; state.events.emit('shutdown'); };
    scenes.push(state);
    return { scene, state, open, stop };
  };
  return { scene, handlers, tap: () => [...handlers].forEach((fn) => fn()),
    cleanup: () => scenes.forEach((s) => { s.active = false; s.events.emit('shutdown'); }) };
}

describe('registered modal Back on a scene without screen()', () => {
  it('plain ChapterDone page and history each receive SDK Back and restore hidden root Back', () => {
    const h = setup(); const sc = h.scene();
    for (const type of ['page', 'history']) {
      const modal = sc.open(); modal.layer.setData('type', type);
      expect(h.handlers.size).toBe(1);
      h.tap();
      expect(modal.close).toHaveBeenCalledOnce();
      expect(h.handlers.size).toBe(0);
      expect(tgBack()).toBeNull();
    }
    expect(sc.state.events.listenerCount('shutdown')).toBe(1);
    h.cleanup();
  });

  it('nested layers keep the parent alive and closing top blocks repeated Back until DESTROY', () => {
    const h = setup(); const sc = h.scene(); const page = sc.open(); const history = sc.open(true);
    h.tap(); h.tap();
    expect(history.close).toHaveBeenCalledOnce();
    expect(page.close).not.toHaveBeenCalled();
    expect(h.handlers.size).toBe(1);
    history.layer.destroy(); h.tap();
    expect(page.close).toHaveBeenCalledOnce();
    expect(h.handlers.size).toBe(0);
    h.cleanup();
  });

  it('20 windows reuse one scene shutdown hook and one SDK listener', () => {
    const h = setup(); const sc = h.scene();
    for (let i = 0; i < 20; i++) {
      sc.open(); expect(h.handlers.size).toBe(1); h.tap(); expect(h.handlers.size).toBe(0);
    }
    expect(sc.state.events.listenerCount('shutdown')).toBe(1);
    h.cleanup();
    expect(sc.state.events.listenerCount('shutdown')).toBe(0);
  });

  it('late destruction and shutdown of an inactive plain scene do not steal another scene Back', () => {
    const h = setup(); const old = h.scene(); const modal = old.open();
    old.state.active = false;
    const parent = vi.fn(); const next = new ModalBack(parent, vi.fn(), () => true);
    modal.layer.destroy(); old.stop(); h.tap();
    expect(parent).toHaveBeenCalledOnce();
    expect(h.handlers.size).toBe(1);
    next.destroy(); h.cleanup();
  });

  it('a controller created before screen chrome can acquire its parent without dropping open layers', () => {
    const h = setup(); const parent = vi.fn(); const nodes: Phaser.GameObjects.Container[] = [];
    const scene = { children: { list: nodes } } as unknown as Phaser.Scene;
    const modal = new Phaser.GameObjects.Container(scene); nodes.push(modal);
    modal.setData('screenModal', true).setData('close', () => modal.destroy());
    const back = new ModalBack(null, () => closeTopModal(scene), () => true);
    modal.once('destroy', back.opened(modal));
    back.setFallback(parent);
    expect(h.handlers.size).toBe(1);
    h.tap(); expect(parent).not.toHaveBeenCalled();
    h.tap(); expect(parent).toHaveBeenCalledOnce();
    back.destroy(); h.cleanup();
  });
});
