import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => {
  const { EventEmitter } = await import('node:events');
  class Container extends EventEmitter {
    list: Container[] = [];
    parentContainer: Container | null = null;
    scene: object | undefined = {};
    name = '';
    scaleX = 1;
    scaleY = 1;
    alpha = 1;
    x = 0;
    y = 0;
    constructor(_scene: unknown, x = 0, y = 0) { super(); this.x = x; this.y = y; }
    setName(name: string) { this.name = name; return this; }
    setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
    setScale(scale: number) { this.scaleX = this.scaleY = scale; return this; }
    setAlpha(alpha: number) { this.alpha = alpha; return this; }
    add(nodes: Container | Container[]) {
      for (const node of [nodes].flat()) {
        node.parentContainer?.remove(node);
        node.parentContainer = this;
        this.list.push(node);
      }
      return this;
    }
    remove(node: Container) { this.list = this.list.filter((o) => o !== node); node.parentContainer = null; return this; }
    destroy() { this.emit('destroy'); this.scene = undefined; }
  }
  return { default: {
    Scene: class {},
    Geom: { Rectangle: class { static Contains = () => true; } },
    GameObjects: { Container, Events: { DESTROY: 'destroy' } },
    Scenes: { Events: { PRE_UPDATE: 'preupdate', SHUTDOWN: 'shutdown' } },
    Math: { Clamp: (n: number, min: number, max: number) => Math.min(max, Math.max(min, n)) },
  } };
});
vi.mock('../src/game/audio', () => ({ sfx: vi.fn() }));
vi.mock('../src/game/haptics', () => ({ haptic: vi.fn() }));
vi.mock('../src/game/viewport', () => ({
  view: () => ({ uiHeight: 1410, adaptive: true }), minimumTouchSize: () => 132, minimumFontSize: () => 36,
  onViewChange: vi.fn(() => vi.fn()), worldPoint: vi.fn(),
}));

const Phaser = (await import('phaser')).default;
const { popIn } = await import('../src/game/screen');
const ui = await import('../src/game/ui');
const { motion } = await import('../src/game/state');
const { E, M } = await import('../src/game/theme');
const { sfx } = await import('../src/game/audio');
const initialReduced = motion.reduced;

function setup() {
  const make = (x = 0, y = 0) => new Phaser.GameObjects.Container(undefined as unknown as Phaser.Scene, x, y);
  const layer = make().setPosition(0, 0);
  const shade = make().setPosition(540, 705).setAlpha(0.7);
  const action = make().setPosition(540, 1230);
  layer.add([shade, action]);
  const game = { input: { enabled: true } };
  const tweens = { add: vi.fn() };
  const scene = { sys: { game }, tweens, add: { container: (x: number, y: number) => make().setPosition(x, y) } };
  vi.spyOn(ui, 'shieldTaps').mockImplementation(() => {});
  const inner = () => layer.list.find((o) => o.name === 'popInner') as Phaser.GameObjects.Container;
  return { layer, shade, action, game, scene, tweens, inner };
}

afterEach(() => { motion.reduced = initialReduced; vi.restoreAllMocks(); });

describe('popIn respects the reduced-motion setting immediately', () => {
  it('shows the modal at its final scale and opacity without moving a44CSS action', () => {
    motion.reduced = true;
    const h = setup();
    popIn(h.scene as unknown as Phaser.Scene, h.layer, h.shade);
    expect(h.inner().scaleX).toBe(1);
    expect(h.inner().scaleY).toBe(1);
    expect(h.inner().alpha).toBe(1);
    expect(h.shade.alpha).toBe(1);
    expect(h.action.x + h.inner().x).toBe(540);
    expect(h.action.y + h.inner().y).toBe(1230);
    expect(132 * h.inner().scaleY / 3).toBe(44);
    expect(h.tweens.add).not.toHaveBeenCalled();
    expect(sfx).toHaveBeenCalledWith('ui_open');
    h.layer.destroy();
    expect(ui.shieldTaps).toHaveBeenCalledTimes(1);
    expect(ui.shieldTaps).toHaveBeenCalledWith(h.game);
  });

  it('retains normal shade/window animations and the same final geometry', () => {
    motion.reduced = false;
    const h = setup();
    popIn(h.scene as unknown as Phaser.Scene, h.layer, h.shade);
    expect(h.inner().scaleX).toBe(0.92);
    expect(h.inner().alpha).toBe(0);
    expect(h.tweens.add).toHaveBeenCalledTimes(2);
    expect(h.tweens.add).toHaveBeenNthCalledWith(1, { targets: h.shade, alpha: { from: 0, to: 1 }, duration: M.base, ease: E.out });
    expect(h.tweens.add).toHaveBeenNthCalledWith(2, { targets: h.inner(), scale: 1, alpha: 1, duration: M.base, ease: E.pop });
    h.inner().setScale(1).setAlpha(1);
    expect(h.action.x + h.inner().x).toBe(540);
    expect(h.action.y + h.inner().y).toBe(1230);
    h.layer.destroy();
    expect(ui.shieldTaps).toHaveBeenCalledTimes(1);
  });
});
