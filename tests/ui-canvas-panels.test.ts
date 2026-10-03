import type Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { CANVAS: 1, GameObjects: { Events: { DESTROY: 'destroy' } }, BlendModes: { ADD: 1 } } }));
const { slicedPanel, fitButtonLabel } = await import('../src/game/ui');
const { TOUCH_COMFORT } = await import('../src/game/theme');

function harness(renderer = 1) {
  const canvases = new Map<string, { calls: number[][]; refresh: ReturnType<typeof vi.fn> }>();
  const removed: string[] = [];
  const source = { cutX: 100, cutY: 200, cutWidth: 30, cutHeight: 30, source: { image: {} } };
  const textures = {
    getFrame: vi.fn(() => source),
    createCanvas: vi.fn((key: string) => {
      const calls: number[][] = [];
      const result = { calls, refresh: vi.fn(), getContext: () => ({ drawImage: (_image: unknown, ...coords: number[]) => calls.push(coords) }) };
      canvases.set(key, result);
      return result;
    }),
    remove: (key: string) => { removed.push(key); canvases.delete(key); },
  };
  const scene = {
    sys: { game: { renderer: { type: renderer } } }, textures,
    add: {
      nineslice: vi.fn(() => ({ kind: 'webgl' })),
      image: vi.fn((_x: number, _y: number, key: string) => {
        let destroy = () => {};
        const image = { key, width: 0, height: 0, scaleX: 1, scaleY: 1,
          setScale(x: number, y = x) { image.scaleX = x; image.scaleY = y; return image; },
          setDisplaySize(w: number, h: number) { image.width = w; image.height = h; return image; },
          setTexture(k: string) { image.key = k; return image; },
          once(_event: string, cb: () => void) { destroy = cb; return image; },
          destroy() { destroy(); },
        };
        return image;
      }),
    },
  };
  const make = () => slicedPanel(scene as unknown as Phaser.Scene, 0, 0, 'atlas', 'gold', 90, 60, 5, 5, 5, 5);
  return { scene, make, canvases, removed };
}

describe('поверхности Canvas', () => {
  it('WebGL сохраняет настоящий NineSlice, без копий текстур', () => {
    const h = harness(2);
    h.make();
    expect(h.scene.add.nineslice).toHaveBeenCalledExactlyOnceWith(0, 0, 'atlas', 'gold', 90, 60, 5, 5, 5, 5);
    expect(h.scene.textures.createCanvas).not.toHaveBeenCalled();
  });
  it('Canvas рисует все девять участков атласа в Image, включая видимый центр', () => {
    const h = harness();
    h.make();
    expect(h.scene.add.nineslice).not.toHaveBeenCalled();
    const c = [...h.canvases.values()][0];
    expect(c.calls).toHaveLength(9);
    expect(c.calls[0]).toEqual([100, 200, 5, 5, 0, 0, 5, 5]);
    expect(c.calls[4]).toEqual([105, 205, 20, 20, 5, 5, 80, 50]);
    expect(c.calls[8]).toEqual([125, 225, 5, 5, 85, 55, 5, 5]);
    expect(c.refresh).toHaveBeenCalledOnce();
  });
  it('общая текстура живёт до последней панели, смена pressed/disabled не оставляет кэш навсегда', () => {
    const h = harness();
    const a = h.make(), b = h.make();
    expect(h.canvases.size).toBe(1);
    a.setTexture('pressed');
    expect(h.canvases.size).toBe(2);
    a.setTexture('disabled');
    expect(h.canvases.size).toBe(2);
    expect(h.removed).toHaveLength(1);
    b.destroy();
    expect(h.canvases.size).toBe(1);
    a.destroy();
    expect(h.canvases.size).toBe(0);
  });
  it('изменение размера перерисовывает центр и освобождает старую текстуру', () => {
    const h = harness();
    const a = h.make();
    a.setSize(120, 80);
    expect(h.canvases.size).toBe(1);
    expect(h.removed).toHaveLength(1);
    expect([...h.canvases.values()][0].calls[4]).toEqual([105, 205, 20, 20, 5, 5, 110, 70]);
    a.setSize(120, 80);
    expect(h.scene.textures.createCanvas).toHaveBeenCalledTimes(2);
    a.destroy();
    expect(h.canvases.size).toBe(0);
  });
  it('повторная установка того же кадра не пересобирает поверхность', () => {
    const h = harness();
    h.make().setTexture('atlas', 'gold');
    expect(h.scene.textures.createCanvas).toHaveBeenCalledOnce();
    expect(h.removed).toEqual([]);
  });
});

describe('размеры и подписи', () => {
  it('комфортная цель даёт 44 CSS px на телефоне шириной 360 px', () => {
    expect(TOUCH_COMFORT * 360 / 1080).toBeGreaterThanOrEqual(44);
  });
  it('длинная подпись умещается, а новая короткая возвращает исходный размер', () => {
    const label = {
      text: 'Очень длинная подпись кнопки', size: 48,
      get width() { return this.text.length * this.size * 0.6; },
      setFontSize(size: number) { this.size = size; return this; },
      setText(value: string) { this.text = value; return this; },
    };
    fitButtonLabel(label as unknown as Phaser.GameObjects.Text, 240, 48);
    expect(label.width).toBeLessThanOrEqual(240 - 2 * 28.8);
    expect(label.size).toBeGreaterThanOrEqual(34);
    label.setText('В бой');
    fitButtonLabel(label as unknown as Phaser.GameObjects.Text, 240, 48);
    expect(label.size).toBe(48);
    expect(label.text).toBe('В бой');
  });
});
