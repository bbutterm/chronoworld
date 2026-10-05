import { EventEmitter } from 'node:events';
import type { ButtonView, Panel } from '../src/game/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {
  Scene: class {},
  Geom: { Rectangle: class {
    constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
    setTo(x: number, y: number, width: number, height: number) { Object.assign(this, { x, y, width, height }); return this; }
    static Contains = (r: { x: number; y: number; width: number; height: number }, x: number, y: number) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
  } },
  GameObjects: { Events: { DESTROY: 'destroy' }, Container: class {} },
  Scenes: { Events: { PRE_UPDATE: 'preupdate', SHUTDOWN: 'shutdown' } },
  Math: { Clamp: (n: number, min: number, max: number) => Math.min(max, Math.max(min, n)) },
  BlendModes: { ADD: 1 },
} }));
vi.mock('../src/game/audio', () => ({ sfx: vi.fn() }));
vi.mock('../src/game/haptics', () => ({ haptic: vi.fn() }));

const { noticeModal, bottomSheet, closeTopModal, confirm } = await import('../src/game/screen');
const juice = await import('../src/game/juice');
const { loreModal } = await import('../src/game/loreView');
const ui = await import('../src/game/ui');
const { GAME_H, GAME_W } = await import('../src/game/layout');
const { T } = await import('../src/game/theme');
const { ExpeditionsScene } = await import('../src/game/scenes/ExpeditionsScene');
const { lootLines } = await import('../src/game/chestView');
const { GAME } = await import('../src/game/content');
const viewport = await import('../src/game/viewport');

/** Geometry/event double only: real noticeModal, popIn and ScrollArea execute below.
 * Text metrics approximate wrapping; actual font rendering is covered by browser QA. */
class Node extends EventEmitter {
  list: Node[] = [];
  parentContainer: Node | null = null;
  scene: object | undefined = {};
  name = '';
  data = new Map<string, unknown>();
  input?: { enabled: boolean; hitArea: { x: number; y: number; width: number; height: number; setTo?: (...args: number[]) => unknown }; hitAreaCallback?: (area: unknown, x: number, y: number) => boolean };
  constructor(public x = 0, public y = 0, public width = 0, public height = 0, public text = '', public size = 0) { super(); }
  setName(n: string) { this.name = n; return this; }
  setDepth() { return this; }
  setInteractive(area?: NonNullable<Node['input']>['hitArea'], hit?: NonNullable<Node['input']>['hitAreaCallback']) {
    // Phaser InputPlugin.enable keeps the old region when this object already owns input.
    if (!this.input) this.input = { enabled: true, hitArea: area ?? { x: 0, y: 0, width: this.width, height: this.height }, hitAreaCallback: hit };
    this.input.enabled = true;
    return this;
  }
  disableInteractive() { if (this.input) this.input.enabled = false; return this; }
  clear() { return this; }
  fillStyle() { return this; }
  lineStyle() { return this; }
  fillCircle() { return this; }
  lineBetween() { return this; }
  fillRoundedRect() { return this; }
  strokeRoundedRect() { return this; }
  getByName(name: string) { return this.list.find((n) => n.name === name); }
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
  const make = (x = 0, y = 0, w = 0, h = 0) => { const n = new Node(x, y, w, h); n.scene = scene; nodes.push(n); return n; };
  const masks: { x: number; y: number; width: number; height: number }[] = [];
  const graphics = { clear() { return this; }, fillStyle() { return this; },
    fillRect(x: number, y: number, width: number, height: number) { masks.push({ x, y, width, height }); return this; },
    createGeometryMask() { return {}; }, destroy: vi.fn() };
  const scene = {
    add: { container: make, rectangle: make, graphics: () => make() },
    children: { get list() { return nodes.filter((n) => n.scene && !n.parentContainer); } },
    make: { graphics: () => graphics },
    input: new EventEmitter(), events: new EventEmitter(),
    sys: { game: undefined, isActive: () => true }, tweens: { add: vi.fn() },
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
  return { nodes, scene, buttons, open, worldY, clip, masks };
}

const longParagraphs = Array.from({ length: 12 }, (_, i) => `Событие ${i + 1}. ${'Герои вернулись из дальнего похода с наградами. '.repeat(5)}`);

beforeEach(() => vi.restoreAllMocks());

describe('noticeModal: читаемый текст без уменьшения шрифта', () => {
  it('resize390→360 обновляет существующий hitArea листа: видимая шапка не закрывает его через shade', () => {
    vi.spyOn(juice, 'juiceOn').mockReturnValue(false);
    vi.spyOn(ui, 'ellipsize').mockImplementation((t) => t);
    const insets = { top: 136, bottom: 34, left: 0, right: 0 };
    let current = viewport.computeView(390, 844, 1, insets, 2, true);
    vi.spyOn(viewport, 'view').mockImplementation(() => current);
    const h = setup();
    const sheet = bottomSheet(h.scene as unknown as Parameters<typeof bottomSheet>[0], 'Детали', () => 400);
    const layer = sheet.layer as unknown as Node;
    const bg = h.nodes.find((n) => n.input?.hitAreaCallback)!;
    const hit = bg.input!.hitArea;
    const initialTop = hit.y;
    const initialMask = h.masks.at(-1)!;
    current = viewport.computeView(360, 640, 1, insets, 2, true);
    h.scene.events.emit(viewport.VIEW_CHANGED, current);
    const header = h.nodes.find((n) => n.text === 'Детали')!;
    const headerY = header.y + header.parentContainer!.y;
    expect(bg.input!.hitArea).toBe(hit);
    expect(hit.y).toBeLessThan(initialTop);
    expect(hit.y).toBeCloseTo(headerY - 80);
    expect(h.masks.at(-1)!.y).toBeLessThan(initialMask.y);
    const shade = layer.list[0];
    const routeUp = (y: number) => {
      if (!bg.input!.hitAreaCallback!(hit, 540, y)) shade.emit('pointerup');
    };
    // Native swipe ends in the visible header, which now consumes it above the full-screen shade.
    routeUp(headerY - 60);
    expect(layer.scene).toBeDefined();
    expect(hit.height).toBeGreaterThan(400);
    routeUp(hit.y - 1);
    expect(layer.scene).toBeUndefined();
    expect(h.scene.events.listenerCount(viewport.VIEW_CHANGED)).toBe(0);
  });

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
    expect(h.scene.events.listenerCount('preupdate')).toBe(0);
    expect(h.scene.events.listenerCount('shutdown')).toBe(1); // Scene Back owns its hook until scene shutdown.
    h.scene.events.emit('shutdown');
    expect(h.scene.events.eventNames()).toEqual([]);
  });

  it('маска и ползунок внутри панели; ввод за боковыми границами не прокручивает окно', () => {
    const h = setup();
    h.open(longParagraphs);
    const content = h.clip()!;
    const [top, bottom] = content.getData('clip') as [number, number];
    const mask = h.masks[0];
    expect(mask).toEqual({ x: 94, y: top, width: 892, height: bottom - top });
    const thumb = h.nodes.find((n) => n.width === 8)!;
    expect(thumb.x).toBe(980);
    expect(thumb.x + thumb.width / 2).toBeLessThan(mask.x + mask.width);
    for (const x of [mask.x - 1, mask.x + mask.width + 1]) {
      h.scene.input.emit('wheel', { x, y: top + 100 }, [], 0, 500);
      h.scene.input.emit('pointerdown', { x, y: bottom - 10 });
      h.scene.input.emit('pointermove', { x, y: top + 10, isDown: true });
      h.scene.input.emit('pointerup');
      expect(content.y).toBe(top);
    }
    h.scene.input.emit('wheel', { x: mask.x + mask.width / 2, y: top + 100 }, [], 0, 500);
    expect(content.y).toBe(top - 500);
    h.buttons[0].tap();
  });

  it('обычная ScrollArea без новых границ сохраняет маску, ползунок и прежний ввод', () => {
    const h = setup();
    const area = new ui.ScrollArea(h.scene as unknown as Parameters<typeof noticeModal>[0], 100, 500);
    area.setContentHeight(1000);
    expect(h.masks).toEqual([{ x: 0, y: 100, width: GAME_W, height: 400 }]);
    expect((area.parts[1] as unknown as Node).x).toBe(GAME_W - 6);
    h.scene.input.emit('wheel', { x: -10, y: 200 }, [], 0, 50);
    expect(area.offset).toBe(50); // Existing full-width lists do not gain a new horizontal hit filter.
    area.content.destroy();
    expect(h.scene.input.eventNames()).toEqual([]);
    expect(h.scene.events.eventNames()).toEqual([]);
  });

  it('повторное открытие/закрытие и shutdown не оставляют обработчиков', () => {
    const h = setup();
    for (let i = 0; i < 12; i++) {
      const layer = h.open(longParagraphs);
      expect(h.scene.input.listenerCount('wheel')).toBe(1);
      expect(h.scene.events.listenerCount('preupdate')).toBe(1);
      expect(h.scene.events.listenerCount('shutdown')).toBe(2); // ScrollArea + lazy scene Back, both bounded.
      if (i % 2) h.scene.events.emit('shutdown');
      (layer.getData('close') as () => void)();
      layer.destroy(); // Explicit close and scene teardown remain idempotent.
      expect(h.scene.input.eventNames()).toEqual([]);
      expect(h.scene.events.listenerCount('preupdate')).toBe(0);
      expect(h.scene.events.listenerCount('shutdown')).toBe(i % 2 ? 0 : 1);
      h.scene.events.emit('shutdown');
      expect(h.scene.events.eventNames()).toEqual([]);
      expect(h.clip()).toBeUndefined();
    }
  });
});


describe('Back: стабильная идентичность модальных слоёв', () => {
  beforeEach(() => vi.spyOn(ui, 'ellipsize').mockImplementation((node) => node));
  it.each(['itemSheet', 'wearPicker', 'refineSheet', 'cardTargetPicker'])('закрывает %s, повторный Back ждёт конца анимации', (name) => {
    const h = setup();
    vi.spyOn(juice, 'juiceOn').mockReturnValue(true);
    const onClose = vi.fn();
    const scene = h.scene as unknown as Parameters<typeof bottomSheet>[0];
    const sheet = bottomSheet(scene, 'Предмет', () => 200, { onClose });
    sheet.layer.setName(name);
    expect(closeTopModal(scene)).toBe(true);
    expect(sheet.layer.name).toBe('');
    expect(onClose).not.toHaveBeenCalled();
    const calls = h.scene.tweens.add.mock.calls.length;
    expect(closeTopModal(scene)).toBe(true);
    expect(h.scene.tweens.add.mock.calls).toHaveLength(calls);
    const finish = h.scene.tweens.add.mock.calls.at(-1)![0].onComplete;
    finish();
    expect(onClose).toHaveBeenCalledOnce();
    expect(closeTopModal(scene)).toBe(false);
  });

  it('вложенное подтверждение закрывается первым; повторный Back не закрывает лист под ним', () => {
    const h = setup();
    vi.spyOn(juice, 'juiceOn').mockReturnValue(true);
    const scene = h.scene as unknown as Parameters<typeof bottomSheet>[0];
    const onClose = vi.fn();
    const onYes = vi.fn();
    bottomSheet(scene, 'Заточка', () => 200, { onClose }).layer.setName('refineSheet');
    confirm(scene, 'Точить?', 'Да', onYes);
    expect(closeTopModal(scene)).toBe(true);
    const finish = h.scene.tweens.add.mock.calls.at(-1)![0].onComplete;
    expect(closeTopModal(scene)).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(onYes).not.toHaveBeenCalled();
    finish();
    expect(closeTopModal(scene)).toBe(true);
    h.scene.tweens.add.mock.calls.at(-1)![0].onComplete();
    expect(onClose).toHaveBeenCalledOnce();
    expect(closeTopModal(scene)).toBe(false);
  });

  it('Летопись поверх листа закрывается первой, сохраняя блокировку инвентаря', () => {
    const h = setup();
    vi.spyOn(juice, 'juiceOn').mockReturnValue(true);
    vi.spyOn(ui, 'plate').mockImplementation((_sc, x, y, w, height) => new Node(x, y, w, height) as unknown as ReturnType<typeof ui.plate>);
    const scene = h.scene as unknown as Parameters<typeof bottomSheet>[0];
    const inventory = { locked: true };
    const onClose = vi.fn(() => { inventory.locked = false; });
    const sheet = bottomSheet(scene, 'Предмет', () => 200, { onClose });
    sheet.layer.setName('itemSheet');
    const lore = loreModal(scene, { title: 'Предмет', blocks: [{ text: 'История предмета.' }] });
    expect(closeTopModal(scene)).toBe(true);
    expect(lore.scene).toBeUndefined();
    expect(sheet.layer.scene).toBeDefined();
    expect(inventory.locked).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(closeTopModal(scene)).toBe(true);
    expect(closeTopModal(scene)).toBe(true);
    h.scene.tweens.add.mock.calls.at(-1)![0].onComplete();
    expect(inventory.locked).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
    expect(closeTopModal(scene)).toBe(false);
  });

  it('Back Летописи вызывает её очистку отдельной блокировки списка', () => {
    const h = setup();
    vi.spyOn(ui, 'plate').mockImplementation((_sc, x, y, w, height) => new Node(x, y, w, height) as unknown as ReturnType<typeof ui.plate>);
    const scene = h.scene as unknown as Parameters<typeof loreModal>[0];
    const lock = { locked: false } as unknown as import('../src/game/ui').ScrollArea;
    loreModal(scene, { title: 'Предмет', blocks: [{ text: 'История предмета.' }], lock });
    expect(lock.locked).toBe(true);
    expect(closeTopModal(scene)).toBe(true);
    expect(lock.locked).toBe(false);
    expect(h.scene.input.eventNames()).toEqual([]);
    expect(h.scene.events.listenerCount('preupdate')).toBe(0);
    expect(h.scene.events.listenerCount('shutdown')).toBe(1);
    h.scene.events.emit('shutdown');
    expect(h.scene.events.eventNames()).toEqual([]);
  });

  it('сообщение закрывается по метаданным; случайное имя окна не считается модальным', () => {
    const h = setup();
    const scene = h.scene as unknown as Parameters<typeof closeTopModal>[0];
    h.open(['Готово']).setName('customNotice');
    expect(closeTopModal(scene)).toBe(true);
    const ordinary = h.scene.add.container().setName('noticeModal');
    expect(closeTopModal(scene)).toBe(false);
    expect(ordinary.scene).toBeDefined();
  });
});
