import { EventEmitter } from 'node:events';
import type { ButtonView, Panel } from '../src/game/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {
  Scene: class {},
  GameObjects: { Events: { DESTROY: 'destroy' }, Container: class {} },
  Scenes: { Events: { PRE_UPDATE: 'preupdate', SHUTDOWN: 'shutdown' } },
  Math: { Clamp: (n: number, min: number, max: number) => Math.min(max, Math.max(min, n)) },
  BlendModes: { ADD: 1 },
} }));
vi.mock('../src/game/audio', () => ({ sfx: vi.fn() }));
vi.mock('../src/game/haptics', () => ({ haptic: vi.fn() }));

const { noticeModal } = await import('../src/game/screen');
const ui = await import('../src/game/ui');
const { GAME_H, GAME_W } = await import('../src/game/layout');
const { T } = await import('../src/game/theme');
const { ExpeditionsScene } = await import('../src/game/scenes/ExpeditionsScene');
const { lootLines } = await import('../src/game/chestView');
const { GAME } = await import('../src/game/content');

/** Geometry/event double only: real noticeModal, popIn and ScrollArea execute below.
 * Text metrics approximate wrapping; actual font rendering is covered by browser QA. */
class Node extends EventEmitter {
  list: Node[] = [];
  parentContainer: Node | null = null;
  scene: object | undefined = {};
  name = '';
  data = new Map<string, unknown>();
  constructor(public x = 0, public y = 0, public width = 0, public height = 0, public text = '', public size = 0) { super(); }
  setName(n: string) { this.name = n; return this; }
  setDepth() { return this; }
  setInteractive() { return this; }
  setOrigin() { return this; }
  setShadow() { return this; }
  setMask() { return this; }
  setVisible() { return this; }
  setScale() { return this; }
  setAlpha() { return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setY(y: number) { this.y = y; return this; }
  setSize(w: number, h: number) { this.width = w; this.height = h; return this; }
  setData(k: string, v: unknown) { this.data.set(k, v); return this; }
  getData(k: string) { return this.data.get(k); }
  add(nodes: Node | Node[]) {
    for (const n of [nodes].flat()) { n.parentContainer?.remove(n); this.list.push(n); n.parentContainer = this; }
    return this;
  }
  remove(n: Node) { this.list = this.list.filter((x) => x !== n); n.parentContainer = null; return this; }
  destroy() {
    if (!this.scene) return;
    for (const n of [...this.list]) n.destroy();
    this.emit('destroy');
    this.parentContainer?.remove(this);
    this.scene = undefined;
    this.removeAllListeners();
  }
}

function setup() {
  const nodes: Node[] = [];
  const make = (x = 0, y = 0, w = 0, h = 0) => { const n = new Node(x, y, w, h); nodes.push(n); return n; };
  const graphics = { fillStyle() { return this; }, fillRect() { return this; }, createGeometryMask() { return {}; } };
  const scene = {
    add: { container: make, rectangle: make },
    make: { graphics: () => graphics },
    input: new EventEmitter(), events: new EventEmitter(),
    sys: { game: undefined }, tweens: { add: vi.fn() },
    scene: { start: vi.fn() },
    cameras: { main: { getWorldPoint: (x: number, y: number) => ({ x, y }) } },
  };
  const buttons: { label: string; node: Node; tap: () => void }[] = [];
  vi.spyOn(ui, 'panel').mockImplementation((_sc, x, y, w, h) => make(x, y, w, h) as unknown as Panel);
  vi.spyOn(ui, 'text').mockImplementation((_sc, x, y, value, size = 32, _color, style = {}) => {
    const wrap = style.wordWrap?.width ?? 10000;
    const lines = value.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length * size * 0.55 / wrap)), 0);
    const node = make(x, y, wrap, lines * (size + (style.lineSpacing ?? 0)));
    node.text = value; node.size = size;
    return node as unknown as ReturnType<typeof ui.text>;
  });
  vi.spyOn(ui, 'button').mockImplementation((_sc, x, y, w, h, _key, label, tap) => {
    const node = make(x, y, w, h); buttons.push({ label, node, tap });
    return { container: node } as unknown as ButtonView;
  });
  const open = (paragraphs: string[], go?: Parameters<typeof noticeModal>[3], lead?: string) =>
    noticeModal(scene as unknown as Parameters<typeof noticeModal>[0], 'Сообщение', paragraphs, go, lead) as unknown as Node;
  const worldY = (n: Node): number => n.y + (n.parentContainer ? worldY(n.parentContainer) : 0);
  const clip = () => nodes.find((n) => n.scene && n.getData('clip'));
  return { nodes, scene, buttons, open, worldY, clip };
}

const longParagraphs = Array.from({ length: 12 }, (_, i) => `Событие ${i + 1}. ${'Герои вернулись из дальнего похода с наградами. '.repeat(5)}`);

beforeEach(() => vi.restoreAllMocks());

describe('noticeModal: читаемый текст без уменьшения шрифта', () => {
  it('короткий текст целиком, без прокрутки и с прежней кнопкой закрытия', () => {
    const h = setup();
    const layer = h.open(['Получена награда.']);
    const body = h.nodes.find((n) => n.text === 'Получена награда.')!;
    expect(body.size).toBe(T.body);
    expect(h.clip()).toBeUndefined();
    expect(h.buttons.map((b) => b.label)).toEqual(['Понятно']);
    expect(h.worldY(body) + body.height).toBeLessThan(h.worldY(h.buttons[0].node) - 60);
    h.buttons[0].tap();
    expect(layer.scene).toBeUndefined();
    expect(h.scene.scene.start).not.toHaveBeenCalled();
  });

  it.each([undefined, 'Итого: 12 событий, 24 000 золота и 300 алмазов'])('12 абзацев, итог %s: весь текст 40, конец достижим, кнопки вне полосы', (lead) => {
    const h = setup();
    const layer = h.open(longParagraphs, { label: 'К героям', to: 'Heroes', data: { from: 'notice' } }, lead);
    const body = h.nodes.find((n) => n.text === longParagraphs.join('\n\n'))!;
    expect(body.size).toBe(T.body);
    if (lead) {
      const summary = h.nodes.find((n) => n.text === lead)!;
      expect(summary.size).toBe(T.body);
      expect(summary.parentContainer?.name).toBe('popInner'); // Short summary stays pinned.
    }
    expect(h.nodes.find((n) => n.text === 'листайте ↕')?.size).toBe(T.caption);
    const content = h.clip()!;
    const [top, bottom] = content.getData('clip') as [number, number];
    expect(bottom).toBeGreaterThan(top);
    expect(top).toBeGreaterThan(0);
    expect(bottom).toBeLessThan(GAME_H);
    expect(content.parentContainer).toBe(layer); // Added AFTER popIn: still in world coordinates.
    expect(h.worldY(body)).toBe(top);
    const panel = h.nodes.find((n) => n.width === 940 && !n.text)!;
    expect(panel.height).toBeLessThanOrEqual(GAME_H - 300);
    expect(h.worldY(panel) - panel.height / 2).toBeGreaterThanOrEqual(0);
    expect(h.worldY(panel) + panel.height / 2).toBeLessThanOrEqual(GAME_H);
    const positions = h.buttons.map((b) => h.worldY(b.node));
    expect(positions.every((y) => y - 60 > bottom)).toBe(true);
    h.scene.input.emit('wheel', { x: GAME_W / 2, y: positions[0] }, [], 0, 100000);
    expect(h.worldY(body)).toBe(top); // Footer is outside the scroll input bounds.
    h.scene.input.emit('pointerdown', { x: GAME_W / 2, y: bottom - 10 });
    h.scene.input.emit('pointermove', { x: GAME_W / 2, y: top + 10, isDown: true });
    h.scene.input.emit('pointerup');
    expect(h.worldY(body)).toBeLessThan(top);
    h.scene.input.emit('wheel', { x: GAME_W / 2, y: (top + bottom) / 2 }, [], 0, 100000);
    expect(h.worldY(body) + body.height).toBe(bottom - 24);
    expect(h.worldY(body)).toBeLessThan(top);
    expect(h.buttons.map((b) => h.worldY(b.node))).toEqual(positions);
    h.buttons.find((b) => b.label === 'К героям')!.tap();
    expect(layer.scene).toBeUndefined();
    expect(h.scene.scene.start).toHaveBeenCalledExactlyOnceWith('Heroes', { from: 'notice' });
  });

  it('средний итог и короткий рассказ помещаются целиком без лишней прокрутки', () => {
    const h = setup();
    const lead = Array.from({ length: 10 }, (_, i) => `Награда ${i + 1}`).join('\n');
    h.open(['Вернулись.'], undefined, lead);
    const summary = h.nodes.find((n) => n.text === lead)!;
    const body = h.nodes.find((n) => n.text === 'Вернулись.')!;
    expect(h.clip()).toBeUndefined();
    expect(summary.size).toBe(T.body);
    expect(h.worldY(body)).toBeGreaterThan(h.worldY(summary) + summary.height);
    expect(h.worldY(body) + body.height).toBeLessThan(h.worldY(h.buttons[0].node) - 60);
    h.buttons[0].tap();
  });

  it.each([['короткий', 'Вернулись.'], ['длинный', longParagraphs.join('\n\n')]])('длинная добыча реального отчёта экспедиций: %s рассказ', (_label, storyText) => {
    const h = setup();
    const lines = ['Экспедиций: 12 · 24 000 золота · 12 000 опыта в запас',
      ...lootLines({ items: [...Object.keys(GAME.equipment.items), ...Object.keys(GAME.equipment.items)], gems: 300, scrolls: 12 })];
    const lead = lines.join('\n');
    ExpeditionsScene.prototype['report'].call(h.scene as unknown as InstanceType<typeof ExpeditionsScene>,
      'Экспедиции вернулись', [{ location: GAME.meta.expeditions.locations[0].id,
        story: [{ title: 'Встреча', choice: 'Продолжить путь', text: storyText, auto: false, eventId: 'test_event', at: 0, ok: true, gold: 0, jobExp: 0, gems: 0 }],
      }], lines);
    const leadNode = h.nodes.find((n) => n.text === lead)!;
    const body = h.nodes.find((n) => n.text.includes(storyText) && n !== leadNode)!;
    expect(leadNode.height).toBeGreaterThan(GAME_H - 700);
    expect(leadNode.size).toBe(T.body);
    expect(body.size).toBe(T.body);
    const content = h.clip()!;
    const [top, bottom] = content.getData('clip') as [number, number];
    expect(top).toBeGreaterThan(0);
    expect(bottom - top).toBe(GAME_H - 700);
    expect(leadNode.parentContainer).toBe(content);
    expect(body.parentContainer).toBe(content);
    expect(h.worldY(leadNode)).toBe(top);
    const footer = h.worldY(h.buttons[0].node);
    expect(footer - 60).toBeGreaterThan(bottom);
    h.scene.input.emit('wheel', { x: GAME_W / 2, y: top + 10 }, [], 0, leadNode.height - (bottom - top) + 24);
    expect(h.worldY(leadNode) + leadNode.height).toBe(bottom - 24); // Final reward line can be read.
    h.scene.input.emit('wheel', { x: GAME_W / 2, y: top + 10 }, [], 0, 100000);
    expect(h.worldY(body) + body.height).toBe(bottom - 24); // Final story line can be read too.
    expect(h.worldY(h.buttons[0].node)).toBe(footer);
    h.buttons[0].tap();
    expect(h.scene.input.eventNames()).toEqual([]);
    expect(h.scene.events.eventNames()).toEqual([]);
  });

  it('повторное открытие/закрытие и shutdown не оставляют обработчиков', () => {
    const h = setup();
    for (let i = 0; i < 12; i++) {
      const layer = h.open(longParagraphs);
      expect(h.scene.input.listenerCount('wheel')).toBe(1);
      expect(h.scene.events.listenerCount('preupdate')).toBe(1);
      expect(h.scene.events.listenerCount('shutdown')).toBe(1);
      if (i % 2) h.scene.events.emit('shutdown');
      (layer.getData('close') as () => void)();
      layer.destroy(); // Explicit close and scene teardown remain idempotent.
      expect(h.scene.input.eventNames()).toEqual([]);
      expect(h.scene.events.eventNames()).toEqual([]);
      expect(h.clip()).toBeUndefined();
    }
  });
});
