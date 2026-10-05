import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { refreshTarget, refreshText, responsiveText } from '../src/game/responsiveUi';

function caption(fontSize = 36) {
  const text = { style: { fontSize, wordWrapWidth: 800 }, text: 'Реплика героя',
    setFontSize: vi.fn(function (this: { style: { fontSize: number } }, size: number) { this.style.fontSize = size; return this; }),
  };
  const raw = text.setFontSize;
  return { text: text as unknown as Phaser.GameObjects.Text, raw };
}

describe('requested UI sizes survive temporary phone floors', () => {
  it('a live floor never becomes the requested font; later fitted labels and TextStyle assignments remain authoritative', () => {
    const { text, raw } = caption(); let floor = 36;
    responsiveText(text, '34px', () => floor);
    refreshText(text, 41); expect(text.style.fontSize).toBe(41);
    refreshText(text, 36); expect(text.style.fontSize).toBe(36);
    refreshText(text, 0); expect(text.style.fontSize).toBe(34);
    floor = 41; expect(text.setFontSize(38)).toBe(text); expect(text.style.fontSize).toBe(41);
    refreshText(text, 36); expect(text.style.fontSize).toBe(38);
    text.style.fontSize = 50; refreshText(text, 41); refreshText(text, 36);
    expect(text.style.fontSize).toBe(50);
    text.style.fontSize = 38; refreshText(text, 41); expect(text.style.fontSize).toBe(41);
    refreshText(text, 36); expect(text.style.fontSize).toBe(38);
    expect(text.style.wordWrapWidth).toBe(800); expect(text.text).toBe('Реплика героя');
    raw.mockClear(); refreshText(text, 36); refreshText(text, 36); expect(raw).not.toHaveBeenCalled();
  });

  it('manual Rectangle reflow and replacement keep their new centers and input state', () => {
    const rectangle = (x: number, y: number, width: number, height: number) => ({ x, y, width, height,
      setTo(nx: number, ny: number, w: number, h: number) { Object.assign(this, { x: nx, y: ny, width: w, height: h }); return this; },
    } as unknown as Phaser.Geom.Rectangle);
    const callback = vi.fn();
    const rect = rectangle(0, 0, 260, 132);
    const input = { enabled: false, hitArea: rect, hitAreaCallback: callback };
    const object = { input, getWorldTransformMatrix: () => ({ a: 1, b: 0, c: 0, d: 1 }) } as unknown as Phaser.GameObjects.GameObject;
    refreshTarget(object, rect, 149); expect(rect.height).toBe(149);
    rect.setTo(20, 200, 280, 100);
    refreshTarget(object, rect, 149);
    expect(rect.x + rect.width / 2).toBe(160); expect(rect.y + rect.height / 2).toBe(250);
    refreshTarget(object, rect, 0); expect(rect).toMatchObject({ x: 20, y: 200, width: 280, height: 100 });
    const replacement = rectangle(100, 350, 360, 96); input.hitArea = replacement;
    refreshTarget(object, replacement, 149); refreshTarget(object, replacement, 0);
    expect(replacement).toMatchObject({ x: 100, y: 350, width: 360, height: 96 });
    expect(object.input).toBe(input); expect(input.enabled).toBe(false); expect(input.hitAreaCallback).toBe(callback);
  });
});
