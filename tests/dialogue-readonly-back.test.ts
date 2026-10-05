import { EventEmitter } from 'node:events';
import type Phaser from 'phaser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveState, StoryScene } from '../src/core';
import type { DialogueOptions } from '../src/game/dialogue';

const h = vi.hoisted(() => {
  class Node {
    name = ''; text = ''; x = 0; y = 0; width = 100; height = 100;
    scene: unknown; list: Node[] = []; parentContainer?: Node; visible = true;
    data = new Map<string, unknown>();
    events = new EventEmitter();
    destroying = false;
    constructor(scene: unknown, x = 0, y = 0, text = '') { this.scene = scene; this.x = x; this.y = y; this.text = text; }
    add(items: Node | Node[]) { for (const n of [items].flat()) { n.parentContainer = this; this.list.push(n); } return this; }
    removeAll(destroy: boolean) { if (destroy) this.list.forEach((n) => n.destroy()); this.list = []; return this; }
    destroy() {
      if (!this.scene || this.destroying) return;
      this.destroying = true;
      this.emit('destroy'); this.removeAll(true); this.scene = undefined; this.events.removeAllListeners();
    }
    on(event: string, fn: (...args: any[]) => void) { this.events.on(event, fn); return this; }
    once(event: string, fn: (...args: any[]) => void) { this.events.once(event, fn); return this; }
    emit(event: string, ...args: any[]) { this.events.emit(event, ...args); return this; }
    setData(key: string, value: unknown) { this.data.set(key, value); return this; }
    getData(key: string) { return this.data.get(key); }
    setName(name: string) { this.name = name; return this; }
    setText(text: string) { this.text = text; return this; }
    setX(x: number) { this.x = x; return this; }
    setY(y: number) { this.y = y; return this; }
    setVisible(visible: boolean) { this.visible = visible; return this; }
    setInteractive() { return this; }
    setOrigin() { return this; } setDepth() { return this; } setShadow() { return this; } setWordWrapWidth() { return this; }
    setScale() { return this; } setTint() { return this; } setAlpha() { return this; } setBlendMode() { return this; }
    setSize(w: number, height: number) { this.width = w; this.height = height; return this; }
    setDisplaySize(w: number, height: number) { return this.setSize(w, height); }
    setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
    clear() { return this; } fillStyle() { return this; } fillCircle() { return this; }
    lineStyle() { return this; } strokeCircle() { return this; }
    fillRoundedRect() { return this; } strokeRoundedRect() { return this; }
  }
  return { Node, save: undefined as unknown as SaveState, commits: [] as SaveState[], now: 1000, nodes: [] as Node[] };
});

vi.mock('phaser', () => ({ default: {
  BlendModes: { ADD: 1 }, Scenes: { Events: { SHUTDOWN: 'shutdown' } }, GameObjects: { Events: { DESTROY: 'destroy' } },
  Geom: { Rectangle: class { static Contains = () => true; } },
} }));
vi.mock('../src/game/content', async () => ({ GAME: (await import('../scripts/lib/content-node')).loadFullContext() }));
vi.mock('../src/game/session', () => ({
  session: { get save() { return h.save; } }, takeWarnings: () => [],
  commit: (save: SaveState) => { h.save = save; h.commits.push(save); },
}));
vi.mock('../src/game/audio', () => ({ sfx: vi.fn() }));
vi.mock('../src/game/haptics', () => ({ haptic: vi.fn() }));
vi.mock('../src/game/transitions', () => ({ isLeaving: () => false }));
vi.mock('../src/game/juice', () => ({ animateCurrency: vi.fn() }));
vi.mock('../src/game/illust', () => ({ illustKey: (id: string) => id, loadIllust: async () => false }));
vi.mock('../src/game/assets', () => ({ hasArt: () => true }));
vi.mock('../src/game/itemIcons', () => ({ roIcon: () => null }));
vi.mock('../src/game/skin', () => ({ SKIN: { cream: '#fff' }, SKIN_TINT: { gold: 1 }, skinIcon: () => 'icon' }));
vi.mock('../src/game/portraitFrame', () => ({ framedPortrait: (sc: unknown) => new h.Node(sc) }));
vi.mock('../src/game/storyView', () => ({ isChapterFinale: () => false, speakerView: (_s: unknown, id: string) => ({ name: id, sprite: null }) }));
vi.mock('../src/game/storyPage', () => ({ introPages: () => [], showPages: (_s: unknown, _pages: unknown, done: () => void) => done() }));
vi.mock('../src/game/ui', () => ({
  BTN: { m: 96, l: 120 }, SURFACE: { raised: {} }, mixHex: () => 0,
  text: (sc: unknown, x: number, y: number, text: string) => { const n = new h.Node(sc, x, y, text); h.nodes.push(n); return n; },
  plate: (sc: unknown, x: number, y: number, w: number, height: number) => new h.Node(sc, x, y).setSize(w, height),
  button: (sc: unknown, x: number, y: number, w: number, height: number, _tex: string, label: string, tap: () => void) => {
    const container = new h.Node(sc, x, y, label).setSize(w, height);
    container.on('pointerup', tap);
    return { container };
  },
}));

// The real screen registration, ModalBack and SDK bridge are deliberately used.
// Only Phaser rendering is replaced; loading the content fixture happens during collection.
const [{ playScenes, LINE_GUARD_MS }, { screen }, { newGame, serialize }, { GAME }, telegram] = await Promise.all([
  import('../src/game/dialogue'), import('../src/game/screen'), import('../src/core'),
  import('../src/game/content'), import('../src/game/telegram'),
]);

const flatten = (n: InstanceType<typeof h.Node>): InstanceType<typeof h.Node>[] => [n, ...n.list.flatMap(flatten)];
const decision = () => GAME.story.scenes.find((s) => s.id === 'ch3o_s15_after')!;

function harness(back = true) {
  type Timer = { active: boolean; callback: () => void; remove: () => void };
  const timers: Timer[] = [];
  const handlers = new Set<() => void>();
  const bb = { show: vi.fn(), hide: vi.fn(), onClick: (fn: () => void) => handlers.add(fn), offClick: (fn: () => void) => handlers.delete(fn) };
  telegram.setTgAppForTests({ version: '9.0', platform: 'ios', BackButton: bb });
  let active = true;
  const make = (x = 0, y = 0, children: unknown = []) => {
    const n = new h.Node(sc, x, y); h.nodes.push(n);
    if (Array.isArray(children)) n.add(children);
    return n;
  };
  const timer = (callback: () => void) => {
    const t: Timer = { active: true, callback, remove: () => { t.active = false; } };
    timers.push(t); return t;
  };
  const sc = {
    add: { container: make, rectangle: make, image: make, graphics: () => make() },
    textures: { exists: () => false }, tweens: { add: () => {} },
    events: new EventEmitter(), input: new EventEmitter(), sys: { isActive: () => active },
    time: { get now() { return h.now; }, addEvent: ({ callback }: { callback: () => void }) => timer(callback), delayedCall: (_delay: number, callback: () => void) => timer(callback) },
    scene: { start: vi.fn() }, game: {},
    children: {
      get list() { return h.nodes.filter((n) => n.scene && !n.parentContainer); },
      get length() { return this.list.length; },
      getIndex(n: InstanceType<typeof h.Node>) { return this.list.indexOf(n); }, moveTo: () => {},
    },
  };
  screen(sc as unknown as Phaser.Scene, '', null, back ? { to: 'Home' } : undefined);
  const baseViewListeners = sc.events.listenerCount('ui-view-changed');
  const current = () => sc.children.list.flatMap(flatten).filter((n) => n.scene);
  const layer = () => current().find((n) => n.name === 'dialogue');
  const open = (scenes: readonly StoryScene[] = [decision()], opts: DialogueOptions = { readOnly: true }, done = vi.fn()) => {
    playScenes(sc as unknown as Phaser.Scene, scenes, done, opts); return done;
  };
  const sdkTap = () => { for (const fn of [...handlers]) fn(); };
  const shutdown = () => { active = false; sc.events.emit('shutdown'); };
  const next = () => {
    h.now += 5000;
    for (const t of [...timers]) if (t.active) t.callback();
    h.now += LINE_GUARD_MS + 1;
    layer()?.list[0].emit('pointerdown', { event: { timeStamp: h.now } }).emit('pointerup');
  };
  return { sc, open, layer, current, timers, handlers, bb, sdkTap, shutdown, next, baseViewListeners, setActive: (value: boolean) => { active = value; } };
}

beforeEach(() => {
  h.now = 1000; h.nodes = []; h.commits = []; h.save = newGame(GAME, 1234);
  h.save.storyQueue = [decision().id];
  vi.spyOn(performance, 'now').mockImplementation(() => h.now);
});
afterEach(() => { telegram.setTgAppForTests(undefined); vi.restoreAllMocks(); });

describe('ReadOnly campaign replay: modal Back and one-shot lifecycle', () => {
  it.each([undefined, 'block', 'evacuate'])('SDK Back closes the replay before its parent with byte-exact save (choice=%s)', (choice) => {
    if (choice) h.save.campaignChoices = { [decision().choice!.id]: choice };
    const saved = serialize(h.save);
    const ui = harness(); const done = ui.open(); const layer = ui.layer()!;
    const staleClose = layer.getData('close') as (() => void);
    expect(layer.getData('screenModal')).toBe(true);
    expect(ui.handlers.size).toBe(1);
    ui.sdkTap();
    expect(done).toHaveBeenCalledOnce(); expect(ui.layer()).toBeUndefined();
    expect(ui.sc.scene.start).not.toHaveBeenCalled();
    expect(ui.timers.every((t) => !t.active)).toBe(true);
    expect(ui.sc.events.listenerCount('ui-view-changed')).toBe(ui.baseViewListeners);
    staleClose(); layer.destroy(); ui.shutdown();
    expect(done).toHaveBeenCalledOnce(); expect(h.commits).toHaveLength(0);
    expect(serialize(h.save)).toBe(saved);
  });

  it('restores the logical parent on a separate Back, and a root replay hides SDK Back after close', () => {
    const ui = harness(); ui.open(); ui.sdkTap(); ui.sdkTap();
    expect(ui.sc.scene.start).toHaveBeenCalledExactlyOnceWith('Home', undefined);
    ui.shutdown(); h.nodes = [];
    const root = harness(false); const done = root.open();
    expect(root.handlers.size).toBe(1); root.sdkTap();
    expect(done).toHaveBeenCalledOnce(); expect(root.handlers.size).toBe(0);
    expect(root.sc.scene.start).not.toHaveBeenCalled(); root.shutdown();
  });

  it('external destroy in an active parent releases replay completion and timers exactly once', () => {
    const saved = serialize(h.save); const ui = harness(); const done = ui.open(); const layer = ui.layer()!;
    layer.destroy(); layer.destroy();
    expect(done).toHaveBeenCalledOnce(); expect(ui.timers.every((t) => !t.active)).toBe(true);
    expect(ui.sc.events.listenerCount('ui-view-changed')).toBe(ui.baseViewListeners);
    ui.shutdown(); expect(done).toHaveBeenCalledOnce();
    expect(h.commits).toHaveLength(0); expect(serialize(h.save)).toBe(saved);
  });

  it.each(['shutdown', 'inactiveDestroy'])('%s stops work without completing replay or advancing its queue', (path) => {
    const saved = serialize(h.save); const ui = harness();
    const done = ui.open([decision(), decision()]); const layer = ui.layer()!;
    if (path === 'shutdown') ui.shutdown(); else ui.setActive(false);
    layer.destroy(); ui.sdkTap();
    expect(done).not.toHaveBeenCalled(); expect(ui.layer()).toBeUndefined();
    expect(ui.timers.every((t) => !t.active)).toBe(true);
    expect(h.commits).toHaveLength(0); expect(serialize(h.save)).toBe(saved);
    ui.shutdown();
  });

  it('ordinary replay completion consumes one queue entry at a time and leaves no timer or SDK listener debt', () => {
    const saved = serialize(h.save); const ui = harness(false); const done = ui.open([decision(), decision()]);
    for (let i = 0; i < decision().lines.length; i++) ui.next();
    expect(done).not.toHaveBeenCalled(); expect(ui.layer()?.getData('screenModal')).toBe(true);
    ui.sdkTap(); expect(done).toHaveBeenCalledOnce();
    for (let i = 0; i < 20; i++) { const completed = ui.open(); ui.sdkTap(); expect(completed).toHaveBeenCalledOnce(); }
    expect(ui.timers.every((t) => !t.active)).toBe(true); expect(ui.handlers.size).toBe(0);
    expect(ui.sc.events.listenerCount('ui-view-changed')).toBe(ui.baseViewListeners);
    expect(h.commits).toHaveLength(0); expect(serialize(h.save)).toBe(saved); ui.shutdown();
  });

  it('live plot remains outside the replay Back stack and external destruction does not mark it seen', () => {
    const saved = serialize(h.save); const ui = harness(false);
    const done = ui.open([decision()], {});
    expect(ui.layer()!.getData('screenModal')).toBeUndefined(); expect(ui.handlers.size).toBe(0);
    ui.layer()!.destroy(); expect(done).not.toHaveBeenCalled(); expect(h.commits).toHaveLength(0);
    ui.shutdown(); expect(serialize(h.save)).toBe(saved);
  });
});
