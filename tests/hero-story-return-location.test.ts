import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveState } from '../src/core';
import type { ButtonView, Panel } from '../src/game/ui';
import type { View } from '../src/game/viewLayout';

const h = vi.hoisted(() => ({ save: undefined as unknown as SaveState, current: undefined as unknown as View, commits: vi.fn() }));
vi.mock('phaser', () => ({ default: {
  Scene: class {}, GameObjects: { Events: { DESTROY: 'destroy' }, Container: class {} },
  Scenes: { Events: { PRE_UPDATE: 'preupdate', SHUTDOWN: 'shutdown' } }, BlendModes: { ADD: 1 },
  Math: { Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)), Vector2: class { constructor(public x: number, public y: number) {} } },
} }));
vi.mock('../src/game/audio', () => ({ sfx: vi.fn() }));
vi.mock('../src/game/haptics', () => ({ haptic: vi.fn() }));
vi.mock('../src/game/juice', () => ({ juiceOn: () => false }));
vi.mock('../src/game/hints', () => ({ hintDone: () => true }));
vi.mock('../src/game/scenes/TavernEveningScene', () => ({ linkText: () => '', startTavernEvening: vi.fn() }));
vi.mock('../src/game/heroCard', async (original) => ({ ...await original<typeof import('../src/game/heroCard')>(), glowTexture: () => 'glow' }));
vi.mock('../src/game/session', () => ({ session: { get save() { return h.save; } }, commit: (s: SaveState) => { h.save = s; h.commits(s); } }));
vi.mock('../src/game/viewport', async (original) => ({ ...await original<typeof import('../src/game/viewport')>(), view: () => h.current, minimumFontSize: () => Math.ceil(12 * h.current.worldW / h.current.cssW), minimumTouchSize: () => Math.ceil(44 * h.current.worldW / h.current.cssW) }));

import { levelUpHero, newGame, serialize } from '../src/core';
import { GAME } from '../src/game/content';
import { computeView } from '../src/game/viewLayout';
import { closeTopModal } from '../src/game/screen';
import * as frame from '../src/game/screen';
import { openHeroStory } from '../src/game/heroStoryView';
import { HeroScene, type HeroData } from '../src/game/scenes/HeroScene';
import * as ui from '../src/game/ui';

class Node extends EventEmitter {
  list: Node[] = []; parentContainer: Node | null = null; scene: unknown = {};
  data = new Map<string, unknown>(); name = ''; size = 0;
  originX = 0; alpha = 1; scaleX = 1; scaleY = 1; visible = true;
  constructor(public x = 0, public y = 0, public width = 0, public height = 0, public text = '') { super(); }
  setName(n: string) { this.name = n; return this; }
  setDepth() { return this; } setInteractive() { return this; } disableInteractive() { return this; }
  setOrigin(x = 0.5) { this.originX = x; return this; } setShadow() { return this; } setMask() { return this; }
  setVisible(v: boolean) { this.visible = v; return this; } setTint() { return this; } setBlendMode() { return this; }
  setScale(v: number) { this.scaleX = this.scaleY = v; return this; } setAlpha(v: number) { this.alpha = v; return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setY(y: number) { this.y = y; return this; } setSize(w: number, height: number) { this.width = w; this.height = height; return this; }
  setDisplaySize(w: number, height: number) { return this.setSize(w, height); }
  setStrokeStyle() { return this; }
  setFontFamily() { return this; } setLetterSpacing() { return this; } setText(s: string) { this.text = s; return this; }
  setData(k: string, v: unknown) { this.data.set(k, v); return this; } getData(k: string) { return this.data.get(k); }
  getByName(n: string) { return this.list.find(o => o.name === n); } getIndex(n: Node) { return this.list.indexOf(n); }
  add(nodes: Node | Node[]) { for (const n of [nodes].flat()) { n.parentContainer?.remove(n); this.list.push(n); n.parentContainer = this; } return this; }
  addAt(n: Node, at: number) { n.parentContainer?.remove(n); this.list.splice(at, 0, n); n.parentContainer = this; return this; }
  remove(n: Node) { this.list = this.list.filter(o => o !== n); n.parentContainer = null; return this; }
  removeAll(destroy = false) { for (const n of [...this.list]) { this.remove(n); if (destroy) n.destroy(); } return this; }
  clear() { return this; } fillStyle() { return this; } lineStyle() { return this; } fillGradientStyle() { return this; }
  fillRect() { return this; } fillPoints() { return this; } fillCircle() { return this; } lineBetween() { return this; }
  createGeometryMask() { return {}; }
  getWrappedText() { return this.text.split('\n'); }
  destroy() { if (!this.scene) return; for (const n of [...this.list]) n.destroy(); this.emit('destroy'); this.parentContainer?.remove(this); this.scene = undefined; this.removeAllListeners(); }
}

function setup() {
  const nodes: Node[] = [], taps = new Map<Node, () => void>();
  let owner: unknown;
  const make = (x = 0, y = 0, w = 0, height = 0) => { const n = new Node(x, y, w, height); n.scene = owner ?? scene; nodes.push(n); return n; };
  const scene = {
    add: { container: make, rectangle: make, image: make, circle: make, graphics: () => make() }, make: { graphics: () => make() },
    children: { get list() { return nodes.filter(o => o.scene && !o.parentContainer); }, getByName: (name: string) => nodes.find(o => o.scene && !o.parentContainer && o.name === name) },
    input: new EventEmitter(), events: new EventEmitter(), sys: { game: undefined, isActive: () => true }, textures: { exists: () => false },
    cameras: { main: { getWorldPoint: (x: number, y: number) => ({ x, y }) } },
    tweens: { add: vi.fn((o: { targets: Node | Node[] }) => { for (const n of [o.targets].flat()) n.alpha = n.scaleX = n.scaleY = 1; }) },
  };
  vi.spyOn(ui, 'text').mockImplementation((_s, x, y, value, size = 32, _color, style = {}) => {
    const wrap = style.wordWrap?.width ?? 2000;
    const fs = Math.max(size, Math.ceil(12 * h.current.worldW / h.current.cssW));
    const lines = value.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length * fs * 0.55 / wrap)), 0);
    const n = make(x, y, wrap, lines * (fs + (style.lineSpacing ?? 0))); n.text = value; n.size = fs;
    return n as unknown as ReturnType<typeof ui.text>;
  });
  vi.spyOn(ui, 'plate').mockImplementation((_s, x, y, w, height) => make(x, y, w, height) as unknown as Panel);
  vi.spyOn(ui, 'ellipsize').mockImplementation(n => n);
  vi.spyOn(ui, 'button').mockImplementation((_s, x, y, w, height, _skin, value, tap, size = 32) => {
    const n = make(x, y, w, height), label = make(0, 0, w - 20, size); label.text = value; n.add(label); taps.set(n, tap);
    return { container: n, label } as unknown as ButtonView;
  });
  vi.spyOn(ui, 'tag').mockImplementation((_s, x, y) => make(x, y, 100, 40) as unknown as ReturnType<typeof ui.tag>);
  const sc = scene as unknown as Parameters<typeof openHeroStory>[0];
  const named = (name: string) => nodes.find(n => n.scene && n.name === name)!;
  const resize = (height: number) => { const before = h.current; h.current = computeView(360, height, 1, { top: 136, bottom: 34, left: 0, right: 0 }, 1, true); scene.events.emit('ui-view-changed', h.current, before); };
  const wheel = (content: Node, dy: number) => { const [top, bottom] = content.getData('clip') as number[]; scene.input.emit('wheel', { x: 540, y: (top + bottom) / 2 }, [], 0, dy); };
  return { scene, sc, nodes, named, resize, wheel, setSceneOwner: (s: unknown) => { owner = s; }, tap: (name: string) => taps.get(named(name))!() };
}
beforeEach(() => {
  vi.restoreAllMocks(); h.commits.mockClear();
  h.current = computeView(360, 640, 1, { top: 136, bottom: 34, left: 0, right: 0 }, 1, true);
  let save = newGame(GAME, 0); const hero = save.heroes.find(h => h.templateId === 'alan')!;
  save = { ...save, resources: { ...save.resources, gold: 1e8, heroExp: 1e8 } };
  h.save = levelUpHero(save, hero.id, GAME, 19).save;
});

function heroHarness() {
  const q = setup(), s = new HeroScene(); Object.assign(s, q.scene);
  q.setSceneOwner(s);
  const hero = h.save.heroes.find(h => h.templateId === 'alan')!;
  const parent = { to: 'Inventory', data: { tab: 'cards', templateId: 'alan', from: { to: 'Home', data: { page: 2 } } } };
  Object.assign(s, { heroId: hero.id, tab: 'story', back: parent, ui: { info: new Node() } });
  const body = new ui.ScrollArea(s, 310, 1080); body.setContentHeight(4000); body.offset = 720;
  Object.assign(s, { tabArea: body });
  // Изолируем витрину и боевые CTA: здесь проверяется настоящий callback истории и потребление HeroData при create.
  vi.spyOn(frame, 'screen').mockImplementation(() => {});
  s['showcase'] = vi.fn(); s['statsStrip'] = vi.fn(); s['actions'] = vi.fn(); s['renderDynamic'] = vi.fn();
  s['tabs'] = () => { const next = new ui.ScrollArea(s, 310, 1080); next.setContentHeight(4000); Object.assign(s, { tabArea: next }); };
  s['renderTab'] = vi.fn();
  const restart = vi.fn((data: HeroData) => {
    q.scene.events.emit('shutdown');
    for (const node of [...q.scene.children.list]) node.destroy();
    s.create(data);
  });
  Object.assign(s, { scene: { restart } });
  return { ...q, s, hero, body, parent, restart };
}

describe('возврат из истории в карточку героя', () => {
  it('настоящий Story callback сохраняет offset720/героя/вкладку/сложный parent и readmarks при Back', () => {
    const q = heroHarness(); q.s['storyTab'](q.hero); q.body.setContentHeight(4000); q.body.offset = 720;
    const before = JSON.parse(serialize(h.save)); q.tap('heroStoryBtn');
    expect(q.body.locked).toBe(true);
    const read = JSON.stringify(h.save.heroStoryRead); expect(read).not.toBe(JSON.stringify(before.heroStoryRead));
    expect(closeTopModal(q.s)).toBe(true);
    expect(q.restart).toHaveBeenCalledOnce(); expect(q.s['tabArea'].offset).toBe(720);
    expect(q.s['heroId']).toBe(q.hero.id); expect(q.s['tab']).toBe('story'); expect(q.s['back']).toEqual(q.parent);
    expect(q.s['tabArea'].locked).toBe(false); expect(JSON.stringify(h.save.heroStoryRead)).toBe(read);
    const after = JSON.parse(serialize(h.save)); delete before.heroStoryRead; delete after.heroStoryRead;
    expect(after).toEqual(before);
  });

  it('обычное открытие карточки начинает тело с начала, а возвращаемый offset ограничен новой высотой', () => {
    const q = heroHarness();
    q.s.create({ heroId: q.hero.id, tab: 'story', back: q.parent, bodyOffset: 100000 });
    expect(q.s['tabArea'].offset).toBe(3230);
    q.s.create({ heroId: q.hero.id, tab: 'skills', back: q.parent });
    expect(q.s['tabArea'].offset).toBe(0); expect(q.s['tab']).toBe('skills'); expect(q.s['back']).toEqual(q.parent);
  });
});
