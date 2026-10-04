import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  class Node {
    scene: unknown = {}; name = ''; tint = 0; alpha = 1; destroyed = false;
    setName(name: string) { this.name = name; return this; }
    setTint(tint: number) { this.tint = tint; return this; }
    setAlpha(alpha: number) { this.alpha = alpha; return this; }
    destroy() { this.destroyed = true; this.scene = undefined; }
  }
  return { Node, cached: true, pending: [] as (() => void)[], figures: [] as Node[] };
});
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/game/content', () => ({ GAME: { content: { units: { monster: { visual: { sprite: 'skeleton' } } } } } }));
vi.mock('../src/game/screen', () => ({
  CONTENT_TOP: 160, unitTint: () => 0xffffff,
  unitFigure: (_scene: unknown, _id: string, _x: number, _y: number, _h: number, opts: { onReady: (n: InstanceType<typeof h.Node>) => void }) => {
    const ready = () => { const n = new h.Node(); h.figures.push(n); opts.onReady(n); };
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

beforeEach(() => { h.cached = true; h.pending = []; h.figures = []; });

describe('expedition monster art lifecycle', () => {
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
