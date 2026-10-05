import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {
  Scene: class {}, GameObjects: { Events: { DESTROY: 'destroy' } }, BlendModes: { ADD: 1 },
  Math: { Clamp: (n: number, a: number, b: number) => Math.min(b, Math.max(a, n)) },
} }));

import { BarkLayer } from '../src/game/battleFx';

function harness() {
  const node = { x: 1030, y: 600 };
  const target = { node, nameY: -300 };
  const data = new Map();
  const box = {
    x: 0, y: 0, destroy: vi.fn(),
    setPosition(x: number, y: number) { this.x = x; this.y = y; return this; },
    setDepth() { return this; }, setName() { return this; }, setScale() { return this; }, setAlpha() { return this; },
    setData(key: string, value: unknown) { data.set(key, value); return this; },
  };
  const graphics = { fillStyle() { return this; }, fillRoundedRect() { return this; }, lineStyle() { return this; },
    strokeRoundedRect() { return this; }, fillTriangle() { return this; }, lineBetween() { return this; } };
  const label = { width: 220, height: 90, setOrigin() { return this; }, setPosition() { return this; } };
  const addTween = vi.fn();
  const scene = { add: { text: () => label, graphics: () => graphics, container: () => box }, tweens: { add: addTween } };
  const layer = new BarkLayer(scene as never, 242);
  layer.show(target as never, 'Отряд, держите строй!');
  return { layer, target, box, data, addTween };
}

describe('активная реплика босса на изменяющемся Telegram viewport', () => {
  it('двигает тот же текст и облачко, не повторяет popup и не возвращает прошедшее время', () => {
    const h = harness();
    h.layer.step(1375);
    const before = h.layer['items'][0];
    const left = before.left;
    h.layer.reflow(440, 1000);
    expect(h.layer['items'][0]).toBe(before);
    expect(h.layer['items'][0].left).toBe(left);
    expect(h.data.get('text')).toBe('Отряд, держите строй!');
    expect(h.box.y - before.h).toBeGreaterThanOrEqual(440);
    expect(h.addTween).toHaveBeenCalledOnce();
    h.layer.reflow(72, 1920);
    expect(h.layer['items'][0].left).toBe(left);
    h.layer.step(left - 1);
    expect(h.layer['items']).toHaveLength(1);
    h.layer.step(1);
    expect(h.layer['items']).toHaveLength(0);
    expect(h.addTween).toHaveBeenCalledTimes(2);
  });

  it('ограничивает нижний край в обе стороны и удерживает ширину внутри экрана', () => {
    const h = harness();
    h.target.node.y = 2000;
    h.target.nameY = -100;
    const item = h.layer['items'][0];
    h.layer.reflow(284, 1410);
    expect(h.box.y).toBe(1370);
    expect(h.box.x + item.w / 2).toBeLessThanOrEqual(1070);
    h.layer.reflow(72, 1920);
    expect(h.box.y).toBe(1860);
    h.layer.reflow(284, 1100);
    expect(h.box.y).toBe(1060);
    expect(h.box.destroy).not.toHaveBeenCalled();
    expect(h.data.get('text')).toBe('Отряд, держите строй!');
  });
});
