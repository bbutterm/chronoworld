import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';

vi.mock('phaser', () => {
  class Rectangle {
    constructor(public x: number, public y: number, public width: number, public height: number) {}
    setTo(x: number, y: number, width: number, height: number) { Object.assign(this, { x, y, width, height }); return this; }
  }
  class GameObject {
    input?: { hitArea: Rectangle; enabled: boolean; hitAreaCallback: unknown };
    scaleX = 1; scaleY = 1;
    parentContainer: GameObject | null = null;
    list: GameObject[] = [];
    constructor(public scene: unknown) {}
    // Phaser InputPlugin.enable preserves an existing hitArea and callback.
    setInteractive(area: Rectangle, callback?: unknown) {
      if (this.input) this.input.enabled = true;
      else this.input = { hitArea: area, enabled: true, hitAreaCallback: callback };
      return this;
    }
    getWorldTransformMatrix() { return { a: this.scaleX, b: 0, c: 0, d: this.scaleY }; }
  }
  class Text extends GameObject {
    style: { fontSize: string | number };
    constructor(scene: unknown, public text: string, style: { fontSize?: string | number }) { super(scene); this.style = { fontSize: style.fontSize ?? 16 }; }
    setFontSize(size: string | number) { this.style.fontSize = size; return this; }
  }
  class GameObjectFactory {
    constructor(public scene: { children: { list: GameObject[] } }) {}
    text(_x: number, _y: number, text: string, style: { fontSize?: string | number }) {
      const node = new Text(this.scene, text, style); this.scene.children.list.push(node); return node;
    }
    rectangle() { return {}; }
  }
  return { default: {
    GameObjects: { GameObject, Text, Container: class extends GameObject {}, Image: class extends GameObject {}, GameObjectFactory },
    Geom: { Rectangle }, Scenes: { Events: { SHUTDOWN: 'shutdown', START: 'start', CREATE: 'create' }, RUNNING: 5 },
    Core: { Events: { READY: 'ready', PRE_RENDER: 'prerender' } },
  } };
});
vi.mock('../src/game/telegram', () => ({ inTelegram: () => true, installTelegram: vi.fn(), onTgEvent: vi.fn(),
  tgInsets: () => ({ top: 136, bottom: 34, left: 0, right: 0 }),
}));

it('live360→320→360 refreshes existing fonts and Rectangle targets, including new chrome, without replacing input or scene', async () => {
  const callbacks = new Map<string, () => void>();
  const phone = { innerWidth: 360, innerHeight: 640, devicePixelRatio: 1,
    addEventListener: (name: string, fn: () => void) => callbacks.set(name, fn), setTimeout: vi.fn(),
  };
  vi.stubGlobal('window', phone); vi.stubGlobal('document', { getElementById: () => null });
  vi.stubGlobal('location', { search: '' }); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => { fn(); return 1; });
  const Phaser = (await import('phaser')).default;
  const { installViewport, minimumTouchSize, view, VIEW_CHANGED } = await import('../src/game/viewport');
  const events = new EventEmitter();
  const scene = { children: { list: [] as Phaser.GameObjects.GameObject[] }, events,
    scene: { key: 'Campaign' }, sys: { events, settings: { status: 0 } },
  } as unknown as Phaser.Scene;
  const factory = new Phaser.GameObjects.GameObjectFactory(scene);
  const game = { canvas: { style: {} }, events: new EventEmitter(),
    scene: { scenes: [scene], getScenes: () => [scene] },
    scale: { zoom: 1, width: 0, height: 0, resize(w: number, h: number) { this.width = w; this.height = h; }, refresh: vi.fn() },
  } as unknown as Phaser.Game;
  installViewport(game);
  const caption = factory.text(0, 0, '1/12 ›', { fontSize: '34px' });
  const requested = factory.text(0, 0, 'Длинная подпись', { fontSize: 44 }); requested.setFontSize(38);
  const nested = new Phaser.GameObjects.Container(scene);
  nested.list = [caption, requested]; caption.parentContainer = requested.parentContainer = nested;
  scene.children.list.splice(0, 2, nested);
  const callback = vi.fn(() => true);
  const skip = new Phaser.GameObjects.GameObject(scene, 'Container');
  scene.children.list.push(skip);
  const rect = new Phaser.Geom.Rectangle(0, 0, 260, 132);
  skip.setInteractive(rect, callback);
  const input = skip.input!; input.enabled = false;
  const panel = new Phaser.GameObjects.GameObject(scene, 'Container');
  scene.children.list.push(panel);
  const panelRect = new Phaser.Geom.Rectangle(-240, 850, 1560, 920); panel.setInteractive(panelRect, callback);
  const custom = new Phaser.GameObjects.GameObject(scene, 'Circle');
  const circle = { radius: 32 };
  custom.setInteractive(circle, callback); scene.children.list.push(custom);
  const scaled = new Phaser.GameObjects.GameObject(scene, 'Image') as Phaser.GameObjects.GameObject & { scaleX: number; scaleY: number };
  scaled.scaleX = scaled.scaleY = 2.5; scene.children.list.push(scaled);
  const scaledRect = new Phaser.Geom.Rectangle(0, 0, 52.8, 52.8); scaled.setInteractive(scaledRect, callback);
  let observed = 0;
  let chrome: Phaser.GameObjects.GameObject | undefined;
  events.on(VIEW_CHANGED, () => {
    observed++;
    // Font rasterization/layout completes before the owning scene measures its content again.
    expect.soft(parseFloat(String(caption.style.fontSize)) * view().cssW / view().worldW).toBeGreaterThanOrEqual(12);
    chrome = new Phaser.GameObjects.GameObject(scene, 'Container');
    chrome.setInteractive(new Phaser.Geom.Rectangle(0, 0, 132, 132), callback);
    scene.children.list.push(chrome);
  });
  const resize = (width: number) => { phone.innerWidth = width; callbacks.get('resize')!(); };
  expect(parseFloat(String(caption.style.fontSize))).toBe(36);
  resize(320);
  const scale = view().cssW / view().worldW;
  expect.soft(parseFloat(String(caption.style.fontSize)) * scale).toBeGreaterThanOrEqual(12);
  expect.soft(parseFloat(String(requested.style.fontSize)) * scale).toBeGreaterThanOrEqual(12);
  expect.soft(rect.height * scale).toBeGreaterThanOrEqual(44);
  expect.soft(scaledRect.height * 2.5 * scale).toBeGreaterThanOrEqual(44);
  expect.soft(chrome!.input!.hitArea.height * scale).toBeGreaterThanOrEqual(44);
  expect(rect.x + rect.width / 2).toBe(130); expect(rect.y + rect.height / 2).toBe(66);
  expect(skip.input).toBe(input); expect(input.hitArea).toBe(rect); expect(input.hitAreaCallback).toBe(callback); expect(input.enabled).toBe(false);
  expect(custom.input!.hitArea).toBe(circle); expect(circle.radius).toBe(32);
  expect([panelRect.x, panelRect.y, panelRect.width, panelRect.height]).toEqual([-240, 850, 1560, 920]);
  // A modal's own reflow owns its coordinates; subsequent refreshes must not restore a stale baseline.
  panelRect.setTo(-240, 1050, 1560, 744);
  resize(360);
  expect(parseFloat(String(caption.style.fontSize))).toBe(36);
  expect(parseFloat(String(requested.style.fontSize))).toBe(38);
  expect([rect.x, rect.y, rect.width, rect.height]).toEqual([0, 0, 260, 132]);
  expect([panelRect.x, panelRect.y, panelRect.width, panelRect.height]).toEqual([-240, 1050, 1560, 744]);
  expect(minimumTouchSize()).toBe(132); expect(observed).toBe(2);
  expect(scene.events).toBe(events); expect(scene.scene.key).toBe('Campaign');
  // Objects removed from the scene are not retained or resized by the viewport.
  events.removeAllListeners(VIEW_CHANGED);
  nested.list.splice(nested.list.indexOf(caption), 1);
  resize(320); expect(parseFloat(String(caption.style.fontSize))).toBe(36);
  vi.unstubAllGlobals();
});
