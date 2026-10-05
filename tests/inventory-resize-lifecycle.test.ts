import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('phaser', () => ({ default: {
  Scene: class {},
  GameObjects: { Events: { DESTROY: 'destroy' } },
  Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
  BlendModes: { ADD: 1 },
} }));

const { InventoryScene } = await import('../src/game/scenes/InventoryScene');
const ui = await import('../src/game/ui');
const screen = await import('../src/game/screen');
const viewport = await import('../src/game/viewport');
const juice = await import('../src/game/juice');

/** Run the real scene's virtualization/lifecycle with an input-free scroll view. */
class Content extends EventEmitter {
  list: { index: number; destroy: () => void }[] = [];
  name = '';
  clip: [number, number] = [0, 0];
  setName(name: string) { this.name = name; return this; }
  getData(key: string) { return key === 'clip' ? this.clip : undefined; }
}

describe('Inventory keeps virtualization in sync with changing safe height', () => {
  let scene: InstanceType<typeof InventoryScene>;
  let events: EventEmitter;
  let area: { content: Content; offset: number; setBounds: (top: number, bottom: number) => void; setContentHeight: ReturnType<typeof vi.fn> };
  let bottom: number;
  let resized: () => void;
  let offView: Mock<() => void>;
  let draw: Mock<(index: number) => void>;
  const liveIndices = () => area.content.list.map(o => o.index).sort((a, b) => a - b);

  beforeEach(() => {
    vi.restoreAllMocks();
    scene = new InventoryScene();
    events = new EventEmitter();
    scene.events = events as unknown as typeof scene.events;
    bottom = 290; // The list's bottom includes the existing +10 gutter.
    offView = vi.fn<() => void>();
    vi.spyOn(screen, 'contentBottom').mockImplementation(() => bottom);
    vi.spyOn(viewport, 'onViewChange').mockImplementation((_scene, fn) => {
      resized = () => fn(viewport.view(), viewport.view());
      return offView;
    });
    vi.spyOn(juice, 'juiceOn').mockReturnValue(false);
    vi.spyOn(ui, 'ScrollArea').mockImplementation(function (_scene, top, bottom) {
      const content = new Content();
      content.clip = [top, bottom];
      area = {
        content, offset: 0,
        setBounds: (nextTop, nextBottom) => { content.clip = [nextTop, nextBottom]; },
        setContentHeight: vi.fn(),
      };
      return area as unknown as InstanceType<typeof ui.ScrollArea>;
    });
    draw = vi.fn((index: number) => {
      const o = { index, destroy: () => { area.content.list = area.content.list.filter(row => row !== o); } };
      area.content.list.push(o);
    });
    scene['list'](50, 100, 100, draw);
  });

  it('builds newly visible rows when the safe height grows without any scroll', () => {
    expect(liveIndices()).toEqual([0, 1, 2, 3, 4]);
    bottom = 890;
    resized();
    events.emit('update');
    expect(area.offset).toBe(0);
    expect(liveIndices()).toEqual(Array.from({ length: 11 }, (_, i) => i));
    // Existing rows stay alive; resize does not rebuild the complete collection.
    for (let i = 0; i < 5; i++) expect(draw.mock.calls.filter(call => call[0] === i)).toHaveLength(1);
  });

  it('removes offscreen rows when the height shrinks and continues to follow scrolling', () => {
    bottom = 890; resized(); events.emit('update');
    bottom = 290; resized(); events.emit('update');
    expect(liveIndices()).toEqual([0, 1, 2, 3, 4]);
    area.offset = 400;
    events.emit('update');
    expect(liveIndices()).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(area.content.list).toHaveLength(7);
  });

  it('releases both viewport and virtualization subscriptions with their owners', () => {
    expect(area.content.name).toBe('inventoryScroll');
    expect(events.listenerCount('update')).toBe(1);
    area.content.emit('destroy');
    expect(offView).toHaveBeenCalledOnce();
    events.emit('shutdown');
    expect(events.listenerCount('update')).toBe(0);
    const calls = draw.mock.calls.length;
    area.offset = 2000;
    events.emit('update');
    expect(draw).toHaveBeenCalledTimes(calls);
  });
});
