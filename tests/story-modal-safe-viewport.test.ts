import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveState } from '../src/core';
import type { ButtonView, Panel, ScrollArea } from '../src/game/ui';
import type { View } from '../src/game/viewLayout';

const h = vi.hoisted(() => ({ save: undefined as unknown as SaveState, current: undefined as unknown as View, commits: vi.fn() }));
vi.mock('phaser', () => ({ default: {
  Scene: class {}, GameObjects: { Events: { DESTROY: 'destroy' }, Container: class {} },
  Scenes: { Events: { PRE_UPDATE: 'preupdate', SHUTDOWN: 'shutdown' } }, BlendModes: { ADD: 1 },
  Math: { Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)), Vector2: class { constructor(public x: number, public y: number) {} } },
} }));
vi.mock('../src/game/audio', () => ({ sfx: vi.fn(), playVoiceFile: vi.fn(async () => null), stopVoiceFile: vi.fn() }));
vi.mock('../src/game/haptics', () => ({ haptic: vi.fn() }));
vi.mock('../src/game/session', () => ({ session: { get save() { return h.save; } }, commit: (s: SaveState) => { h.save = s; h.commits(s); } }));
vi.mock('../src/game/viewport', async (original) => ({ ...await original<typeof import('../src/game/viewport')>(), view: () => h.current, minimumFontSize: () => Math.ceil(12 * h.current.worldW / h.current.cssW), minimumTouchSize: () => Math.ceil(44 * h.current.worldW / h.current.cssW) }));

import { levelUpHero, newGame } from '../src/core';
import { GAME } from '../src/game/content';
import { computeView } from '../src/game/viewLayout';
import { closeTopModal } from '../src/game/screen';
import { loreModal } from '../src/game/loreView';
import { openHeroStory } from '../src/game/heroStoryView';
import { showPages, type StoryPage } from '../src/game/storyPage';
import * as ui from '../src/game/ui';

class Node extends EventEmitter {
  list: Node[] = []; parentContainer: Node | null = null; scene: unknown = {};
  data = new Map<string, unknown>(); name = ''; size = 0;
  originX = 0; alpha = 1; scaleX = 1; scaleY = 1; visible = true;
  constructor(public x = 0, public y = 0, public width = 0, public height = 0, public text = '') { super(); }
  setName(n: string) { this.name = n; return this; }
  setDepth() { return this; } setInteractive() { return this; } disableInteractive() { return this; }
  setOrigin(x = 0.5) { this.originX = x; return this; } setShadow() { return this; } setMask() { return this; }
  setVisible(v: boolean) { this.visible = v; return this; } setTint() { return this; } setBlendMode() { return this; } setFlipY() { return this; }
  setScale(v: number) { this.scaleX = this.scaleY = v; return this; } setAlpha(v: number) { this.alpha = v; return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setY(y: number) { this.y = y; return this; } setSize(w: number, height: number) { this.width = w; this.height = height; return this; }
  setDisplaySize(w: number, height: number) { return this.setSize(w, height); }
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
  const make = (x = 0, y = 0, w = 0, height = 0) => { const n = new Node(x, y, w, height); n.scene = scene; nodes.push(n); return n; };
  const scene = {
    add: { container: make, rectangle: make, image: make, circle: make, graphics: () => make() }, make: { graphics: () => make() },
    children: { get list() { return nodes.filter(o => o.scene && !o.parentContainer); } },
    input: new EventEmitter(), events: new EventEmitter(), sys: { game: undefined, isActive: () => true }, textures: { exists: () => false, createCanvas: () => null },
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
  return { scene, sc, nodes, named, resize, wheel, tap: (name: string) => taps.get(named(name))!() };
}
const pages: StoryPage[] = [1, 2].map(i => ({ kicker: 'Легенда', title: `Страница ${i}`, text: 'Длинная история спутников. '.repeat(300) }));
beforeEach(() => {
  vi.restoreAllMocks(); h.commits.mockClear();
  h.current = computeView(360, 640, 1, { top: 136, bottom: 34, left: 0, right: 0 }, 1, true);
  let save = newGame(GAME, 0); const hero = save.heroes.find(h => h.templateId === 'alan')!;
  save = { ...save, resources: { ...save.resources, gold: 1e8, heroExp: 1e8 } };
  h.save = levelUpHero(save, hero.id, GAME, 19).save;
});

describe('сюжетные окна: безопасная высота, Back и владение блокировкой', () => {
  it('HeroStory регистрируется; Back закрывает историю один раз и сохраняет уже прочитанные части', () => {
    const q = setup(), lock = { locked: false } as ScrollArea, done = vi.fn();
    openHeroStory(q.sc, 'alan', { lock, onClose: done });
    const reads = JSON.stringify(h.save.heroStoryRead);
    expect(h.commits).toHaveBeenCalledOnce(); expect(lock.locked).toBe(true);
    expect(closeTopModal(q.sc)).toBe(true); expect(done).toHaveBeenCalledOnce();
    expect(lock.locked).toBe(false); expect(JSON.stringify(h.save.heroStoryRead)).toBe(reads);
    expect(closeTopModal(q.sc)).toBe(false);
    openHeroStory(q.sc, 'alan', { lock, onClose: done }); expect(h.commits).toHaveBeenCalledOnce();
  });
  it('HeroStory footer остаётся в safeBottom, а открытый список сохраняет offset при resize640↔760', () => {
    const q = setup(); openHeroStory(q.sc, 'alan');
    const content = q.named('heroStoryScroll'); q.wheel(content, 200);
    const beforeClip = content.getData('clip') as number[]; const offset = beforeClip[0] - content.y;
    expect(offset).toBeGreaterThan(0);
    q.resize(760); q.resize(640);
    const [top, bottom] = content.getData('clip') as number[];
    expect(top - content.y).toBe(offset); expect(bottom).toBeLessThan(q.named('heroStoryClose').y - 72);
    expect(q.named('heroStoryClose').y + 72).toBeLessThanOrEqual(h.current.safeBottom);
  });
  it.each([false, true])('HeroStory внешний DESTROY восстанавливает captured lock=%s без onClose/restart', (wasLocked) => {
    const q = setup(), original = { locked: wasLocked } as ScrollArea, next = { locked: true } as ScrollArea, done = vi.fn();
    const opts = { lock: original, onClose: done };
    const layer = openHeroStory(q.sc, 'alan', opts); opts.lock = next; layer.destroy();
    expect(original.locked).toBe(wasLocked); expect(next.locked).toBe(true); expect(done).not.toHaveBeenCalled();
    expect(q.scene.events.listenerCount('ui-view-changed')).toBe(0);
  });
  it('Lore: длинная шапка и текст прокручиваются целиком; footer44CSS и clip обновляются на resize', () => {
    const q = setup(); const layer = loreModal(q.sc, { title: 'Очень длинное название '.repeat(20), subtitle: 'Описание '.repeat(50), blocks: [{ text: 'Последняя запись '.repeat(300) }] });
    const content = q.named('loreModalScroll'); const body = q.nodes.find(n => n.text.startsWith('Последняя запись'))!;
    expect(body.parentContainer).toBe(content);
    const button = q.named('loreModalClose');
    expect(button.height * h.current.cssW / h.current.worldW).toBeGreaterThanOrEqual(44);
    expect(button.y + button.height / 2).toBeLessThanOrEqual(h.current.safeBottom);
    q.wheel(content, 150); const clip = content.getData('clip') as number[]; const offset = clip[0] - content.y;
    q.resize(760); q.resize(640);
    const next = content.getData('clip') as number[];
    expect(next[0] - content.y).toBe(offset); expect(next[1]).toBeLessThan(button.y - button.height / 2);
    q.wheel(content, 100000); expect(content.y + body.y + body.height).toBeLessThanOrEqual(next[1]);
    layer.destroy(); expect(q.scene.events.listenerCount('ui-view-changed')).toBe(0);
  });
  it('Lore уничтожение освобождает прежнюю area и не меняет новую область списка', () => {
    const q = setup(), original = { locked: false } as ScrollArea, next = { locked: true } as ScrollArea;
    const opts = { title: 'Алан', blocks: [{ text: 'История' }], lock: original };
    const layer = loreModal(q.sc, opts); opts.lock = next; layer.destroy();
    expect(original.locked).toBe(false); expect(next.locked).toBe(true);
  });
  it('showPages возвращает зарегистрированный layer; Back завершает рассказ ровно один раз и снимает lock', () => {
    const q = setup(), lock = { locked: false } as ScrollArea, done = vi.fn();
    const layer = showPages(q.sc, pages, done, { lock })!;
    expect(layer.getData('screenModal')).toBe(true); expect(lock.locked).toBe(true);
    expect(closeTopModal(q.sc)).toBe(true); expect(done).toHaveBeenCalledOnce(); expect(lock.locked).toBe(false);
    expect(closeTopModal(q.sc)).toBe(false); expect(done).toHaveBeenCalledOnce();
  });
  it('showPages открытая вторая страница сохраняет текст, номер и прокрутку на resize; внешний DESTROY не завершает сюжет', () => {
    const q = setup(), done = vi.fn(), lock = { locked: false } as ScrollArea; let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const layer = showPages(q.sc, pages, done, { lock })!; now = 400; q.tap('pagesNext');
    expect(q.named('pageTitle').text).toBe('Страница 2');
    const content = q.named('storyPageScroll'); q.wheel(content, 400); const offset = 170 - content.y;
    q.resize(760); q.resize(640);
    expect(q.named('pageTitle').text).toBe('Страница 2'); expect(170 - content.y).toBe(offset);
    expect(q.named('pagesNext').y + 72).toBeLessThanOrEqual(h.current.safeBottom);
    layer.destroy(); expect(done).not.toHaveBeenCalled(); expect(lock.locked).toBe(false);
    expect(q.scene.events.listenerCount('ui-view-changed')).toBe(0);
  });
  it('«Пропустить» есть до последней страницы; на последней и единственной закрывает одна главная кнопка (ui-core 10)', () => {
    const q = setup(); let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const done = vi.fn();
    showPages(q.sc, pages, done)!;
    expect(q.named('pagesSkip').visible).toBe(true);
    expect(q.named('pagesNext').list[0].text).toBe('Далее ›');
    now = 400; q.tap('pagesNext');
    expect(q.named('pagesSkip').visible).toBe(false);
    expect(q.named('pagesNext').list[0].text).toBe('Закрыть');
    now = 800; q.tap('pagesNext'); expect(done).toHaveBeenCalledOnce();
    const one = setup(), done1 = vi.fn();
    showPages(one.sc, pages.slice(0, 1), done1, { doneLabel: 'В путь' })!;
    expect(one.named('pagesSkip').visible).toBe(false);
    expect(one.named('pagesNext').list[0].text).toBe('В путь');
  });
  it('пустые страницы не создают окно и не берут блокировку', () => {
    const q = setup(), lock = { locked: false } as ScrollArea, done = vi.fn();
    expect(showPages(q.sc, [], done, { lock })).toBeNull(); expect(done).toHaveBeenCalledOnce(); expect(lock.locked).toBe(false);
  });
});
