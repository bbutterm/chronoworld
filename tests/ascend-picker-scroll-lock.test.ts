import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {
  Scene: class {}, GameObjects: { Events: { DESTROY: 'destroy' }, Container: class {} },
  Scenes: { Events: { PRE_UPDATE: 'preupdate', SHUTDOWN: 'shutdown', CREATE: 'create' } },
  BlendModes: { ADD: 1 }, Math: { Clamp: (n: number, a: number, b: number) => Math.max(a, Math.min(b, n)) },
} }));
vi.mock('../src/game/audio', () => ({ sfx: vi.fn() }));
vi.mock('../src/game/haptics', () => ({ haptic: vi.fn() }));
const h = vi.hoisted(() => ({ save: undefined as unknown }));
vi.mock('../src/game/session', () => ({ session: { get save() { return h.save; } }, commit: vi.fn(), today: () => '2026-10-05' }));

import { addHeroCard, ascendRequirement, autoFodder, newGame } from '../src/core';
import { GAME } from '../src/game/content';
import { AscendScene } from '../src/game/scenes/AscendScene';
import * as screen from '../src/game/screen';
import * as cards from '../src/game/heroCard';
import * as ui from '../src/game/ui';

class Node extends EventEmitter {
  list: Node[] = [];
  scene: object | undefined = {};
  data = new Map<string, unknown>();
  name = '';
  constructor(public x = 0, public y = 0) { super(); }
  setName(name: string) { this.name = name; return this; }
  setDepth() { return this; }
  setOrigin() { return this; }
  setMask() { return this; }
  setVisible() { return this; }
  setAlpha() { return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setY(y: number) { this.y = y; return this; }
  setDisplaySize() { return this; }
  setSize() { return this; }
  setData(k: string, v: unknown) { this.data.set(k, v); return this; }
  getData(k: string) { return this.data.get(k); }
  add(nodes: Node | Node[]) { this.list.push(...[nodes].flat()); return this; }
  destroy() { if (!this.scene) return; this.emit('destroy'); this.scene = undefined; for (const n of this.list) n.destroy(); }
}
function setup(initiallyLocked = false, modal: 'picker' | 'sources' | 'confirm' = 'picker') {
  let save = newGame(GAME, 0);
  const hero = save.heroes.find(h => h.templateId === 'alan')!;
  save = addHeroCard(save, 'alan', 'green').save;
  save = addHeroCard(save, 'alan', 'green').save;
  save = { ...save, resources: { ...save.resources, gold: 100000 } };
  h.save = save;
  const req = ascendRequirement(save, hero.id, GAME)!;
  const s = new AscendScene();
  const graphics = { clear() { return this; }, fillStyle() { return this; }, fillRect() { return this; }, createGeometryMask: () => ({}), destroy: vi.fn() };
  Object.assign(s, {
    add: { container: (x: number, y: number) => new Node(x, y), rectangle: (x: number, y: number) => new Node(x, y) },
    make: { graphics: () => graphics }, events: new EventEmitter(), input: new EventEmitter(),
    cameras: { main: { getWorldPoint: (x: number, y: number) => ({ x, y }) } },
  });
  const body = new ui.ScrollArea(s, 160, 1000);
  body.setContentHeight(3000); body.offset = 300; body.locked = initiallyLocked;
  s['body'] = body; s['heroId'] = hero.id; s['chosen'] = []; s['reopen'] = vi.fn();
  const taps: (() => void)[] = [];
  vi.spyOn(cards, 'drawHeroCard').mockImplementation((_s, _x, _y, _h, opts) => { taps.push(opts!.onTap!); return new Node() as unknown as ReturnType<typeof cards.drawHeroCard>; });
  vi.spyOn(ui, 'text').mockImplementation(() => new Node() as unknown as ReturnType<typeof ui.text>);
  const layer = new Node(); const close = vi.fn();
  vi.spyOn(screen, 'bottomSheet').mockImplementation((_s, _title, build) => {
    build(new Node() as unknown as Parameters<typeof build>[0], 984, close);
    return { layer, close } as unknown as ReturnType<typeof screen.bottomSheet>;
  });
  vi.spyOn(screen, 'noticeModal').mockImplementation(() => layer as unknown as ReturnType<typeof screen.noticeModal>);
  const confirmations: Node[] = [];
  Object.assign(s, { children: {
    get list() { return confirmations.filter(node => node.scene); },
    getByName: (name: string) => confirmations.find(node => node.scene && node.name === name) ?? null,
  } });
  const confirm = vi.spyOn(screen, 'confirm').mockImplementation(() => {
    confirmations.push((confirmations.length ? new Node() : layer).setName('confirmModal').setData('screenModal', true));
  });
  if (modal === 'sources') s['sources'](hero);
  else if (modal === 'confirm') {
    s['chosen'] = autoFodder(save, hero.id, GAME)!;
    expect(s['chosen']).toHaveLength(2);
    s['confirmAscend'](hero, req);
  } else s['pick'](hero, req, 0);
  const wheel = () => s.input.emit('wheel', { x: 540, y: 800 }, [], 0, -180);
  return { s, body, layer, close, taps, wheel, hero, req, confirm, confirmations };
}

beforeEach(() => vi.restoreAllMocks());

describe('Ascend: выбор копии блокирует реальную прокрутку подготовленного героя', () => {
  it('wheel и swipe под открытым пикером сохраняют offset и выбранные копии', () => {
    const p = setup(); expect(p.body.locked).toBe(true);
    p.wheel();
    p.s.input.emit('pointerdown', { x: 540, y: 800 });
    p.s.input.emit('pointermove', { x: 540, y: 300, isDown: true });
    p.s.input.emit('pointerup');
    expect(p.body.offset).toBe(300); expect(p.s['chosen']).toEqual([]);
    p.layer.destroy(); expect(p.body.locked).toBe(false);
    p.wheel(); expect(p.body.offset).toBe(120);
  });
  it('выбор копии не снимает lock до фактического DESTROY анимации закрытия', () => {
    const p = setup(); p.taps[0]();
    expect(p.close).toHaveBeenCalledOnce(); expect(p.s['reopen']).toHaveBeenCalledOnce();
    expect(p.body.locked).toBe(true); p.wheel(); expect(p.body.offset).toBe(300);
    p.layer.destroy(); expect(p.body.locked).toBe(false);
  });
  it.each([false, true])('DESTROY возвращает прежний lock=%s именно захваченной области после resize/reopen', (wasLocked) => {
    const p = setup(wasLocked);
    const next = { locked: true } as ui.ScrollArea;
    p.s['body'] = next;
    p.layer.destroy();
    expect(p.body.locked).toBe(wasLocked); expect(next.locked).toBe(true);
  });
});


describe('Ascend: окно источников копий держит ту же блокировку', () => {
  it('wheel и swipe по открытому noticeModal не двигают подготовку; после DESTROY прокрутка работает', () => {
    const p = setup(false, 'sources');
    expect(p.body.locked).toBe(true); p.wheel();
    p.s.input.emit('pointerdown', { x: 540, y: 800 });
    p.s.input.emit('pointermove', { x: 540, y: 400, isDown: true });
    p.s.input.emit('pointerup');
    expect(p.body.offset).toBe(300);
    p.layer.setData('closing', true); p.wheel(); expect(p.body.offset).toBe(300);
    p.layer.destroy(); expect(p.body.locked).toBe(false); p.wheel(); expect(p.body.offset).toBe(120);
  });
  it.each([false, true])('sources: DESTROY возвращает captured lock=%s и сохраняет новую body', (wasLocked) => {
    const p = setup(wasLocked, 'sources'); const next = { locked: true } as ui.ScrollArea;
    p.s['body'] = next; p.layer.destroy();
    expect(p.body.locked).toBe(wasLocked); expect(next.locked).toBe(true);
  });
});


describe('Ascend: финальное подтверждение удерживает фон и сохраняет копии', () => {
  it('не открывает другое подтверждение, пока popOut очищает имя, и разрешает новое после DESTROY', () => {
    const p = setup(false, 'confirm');
    // popOut clears the name immediately, but the registered layer lives through its closing animation.
    p.layer.setName('').setData('closing', true);
    p.s['confirmAscend'](p.hero, p.req);
    expect(p.confirm).toHaveBeenCalledOnce();
    expect(p.confirmations).toEqual([p.layer]);
    expect(p.body.locked).toBe(true);
    p.layer.destroy();
    expect(p.body.locked).toBe(false);
    p.s['confirmAscend'](p.hero, p.req);
    expect(p.confirm).toHaveBeenCalledTimes(2);
    expect(p.confirmations.filter(node => node.scene)).toHaveLength(1);
  });
  it('повторное нажатие не вызывает confirm второй раз и оставляет ровно одно защищённое окно', () => {
    const p = setup(false, 'confirm');
    p.s['confirmAscend'](p.hero, p.req);
    expect(p.confirm).toHaveBeenCalledOnce();
    expect(p.confirmations).toEqual([p.layer]);
    expect(p.layer.listenerCount('destroy')).toBe(1);
    expect(p.body.locked).toBe(true);
    p.layer.destroy();
    expect(p.body.locked).toBe(false);
  });
  it('wheel/swipe и анимация отмены сохраняют offset, выбранные копии и точный save', () => {
    const p = setup(false, 'confirm'); const ids = [...p.s['chosen']]; const saved = JSON.stringify(h.save);
    expect(p.body.locked).toBe(true); p.wheel();
    p.s.input.emit('pointerdown', { x: 540, y: 800 });
    p.s.input.emit('pointermove', { x: 540, y: 400, isDown: true }); p.s.input.emit('pointerup');
    p.layer.setData('closing', true); p.wheel(); expect(p.body.offset).toBe(300);
    p.layer.destroy(); expect(p.body.locked).toBe(false); expect(p.s['chosen']).toEqual(ids); expect(JSON.stringify(h.save)).toBe(saved);
  });
  it.each([false, true])('confirm DESTROY возвращает captured lock=%s, не разблокируя новую body', (wasLocked) => {
    const p = setup(wasLocked, 'confirm'); const next = { locked: true } as ui.ScrollArea;
    p.s['body'] = next; p.layer.destroy();
    expect(p.body.locked).toBe(wasLocked); expect(next.locked).toBe(true);
  });
});
