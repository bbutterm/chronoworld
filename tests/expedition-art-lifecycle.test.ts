import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  class Node {
    scene: unknown = {}; name = ''; tint = 0; alpha = 1; destroyed = false;
    x = 0; scaleX = 1; displayOriginX = 16; frame = { x: 0, cutWidth: 32 };
    setName(name: string) { this.name = name; return this; }
    setTint(tint: number) { this.tint = tint; return this; }
    setAlpha(alpha: number) { this.alpha = alpha; return this; }
    setScale(scale: number) { this.scaleX = scale; return this; }
    setX(x: number) { this.x = x; return this; }
    destroy() { this.destroyed = true; this.scene = undefined; }
  }
  return { Node, cached: true, pending: [] as (() => void)[], figures: [] as Node[], frame: { x: 0, cutWidth: 32 }, origin: 16, scale: 1 };
});
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/game/content', () => ({ GAME: { content: { units: { monster: { visual: { sprite: 'skeleton' } } } } } }));
vi.mock('../src/game/screen', () => ({
  CONTENT_TOP: 160, unitTint: () => 0xffffff,
  unitFigure: (_scene: unknown, _id: string, _x: number, _y: number, _h: number, opts: { onReady: (n: InstanceType<typeof h.Node>) => void }) => {
    const ready = () => { const n = new h.Node(); n.frame = h.frame; n.displayOriginX = h.origin; n.scaleX = h.scale; h.figures.push(n); opts.onReady(n); };
    if (h.cached) ready(); else h.pending.push(ready);
  },
}));
vi.mock('../src/game/ui', () => ({ plate: () => new h.Node(), pressable: () => {} }));
vi.mock('../src/game/session', () => ({}));
vi.mock('../src/game/flow', () => ({}));
vi.mock('../src/game/sprites', () => ({}));
vi.mock('../src/game/expeditionEventModal', () => ({}));
vi.mock('../src/game/chestView', () => ({}));
vi.mock('../src/game/skin', () => ({}));
vi.mock('../src/game/loreView', () => ({}));
vi.mock('../src/game/juice', () => ({}));
vi.mock('../src/game/heroCard', () => ({}));
vi.mock('../src/game/rewardsView', () => ({}));

import { ExpeditionsScene } from '../src/game/scenes/ExpeditionsScene';
const require = createRequire(import.meta.url);
const Systems = require('phaser/src/scene/Systems.js');
const Status = require('phaser/src/scene/const.js');

function area() {
  const content = new h.Node();
  const children: InstanceType<typeof h.Node>[] = [];
  return { content, children, add: (n: InstanceType<typeof h.Node>) => { children.push(n); return n; }, tap: (fn: () => void) => fn };
}
function harness(status = Status.CREATING) {
  const scene = new ExpeditionsScene() as any;
  scene.sys = new Systems(scene, { key: 'Expeditions' });
  scene.sys.settings.status = status;
  scene.area = area();
  scene.textures = { exists: () => true };
  scene.add = { image: () => new h.Node(), ellipse: () => new h.Node() };
  const draw = (unlocked = true) => scene.art({ unlocked, location: { id: 'payon_cave', tint: '#4f6b3a', monster: 'monster' } }, 0, 436);
  return { scene, draw };
}

beforeEach(() => { h.cached = true; h.pending = []; h.figures = []; h.frame = { x: 0, cutWidth: 32 }; h.origin = 16; h.scale = 1; });

describe('expedition monster art lifecycle', () => {
  it('fits a wide, off-centre packed sprite inside its artwork column', () => {
    h.frame = { x: 40, cutWidth: 320 }; h.origin = 120; h.scale = 1.8;
    const { draw } = harness(); draw();
    const figure = h.figures[0];
    const visibleLeft = figure.x + (figure.frame.x - figure.displayOriginX) * figure.scaleX;
    const visibleRight = visibleLeft + figure.frame.cutWidth * figure.scaleX;
    expect(visibleLeft).toBeCloseTo(80);
    expect(visibleRight).toBeCloseTo(312);
    expect(figure.destroyed).toBe(false);
  });

  it('keeps cached sprites delivered synchronously during Phaser create()', () => {
    const { scene, draw } = harness();
    expect(scene.sys.isActive()).toBe(false);
    draw();
    expect(h.figures[0].destroyed).toBe(false);
    expect(scene.area.children).toContain(h.figures[0]);
    expect(h.figures[0].tint).toBe(0xffffff);
  });
  it('keeps cached sprites after a scene restart and applies locked tint', () => {
    const { scene, draw } = harness();
    draw(); scene.area.content.destroy(); scene.area = area(); draw(false);
    expect(h.figures[1].destroyed).toBe(false);
    expect(scene.area.children).toContain(h.figures[1]);
    expect(h.figures[1].tint).toBe(0x202020);
    expect(h.figures[1].alpha).toBe(0.8);
  });
  it('adds a cold sprite after its asynchronous load completes', () => {
    h.cached = false;
    const { scene, draw } = harness();
    draw(); scene.sys.settings.status = Status.RUNNING; h.pending.shift()!();
    expect(h.figures[0].destroyed).toBe(false);
    expect(scene.area.children).toContain(h.figures[0]);
  });
  it('discards a late sprite for a replaced list', () => {
    h.cached = false;
    const { scene, draw } = harness();
    draw(); scene.area = area(); scene.sys.settings.status = Status.RUNNING; h.pending.shift()!();
    expect(h.figures[0].destroyed).toBe(true);
    expect(scene.area.children).not.toContain(h.figures[0]);
  });
  it('discards a late sprite after the list is destroyed', () => {
    h.cached = false;
    const { scene, draw } = harness();
    draw(); scene.area.content.destroy(); scene.sys.settings.status = Status.SHUTDOWN; h.pending.shift()!();
    expect(h.figures[0].destroyed).toBe(true);
    expect(scene.area.children).not.toContain(h.figures[0]);
  });
});
