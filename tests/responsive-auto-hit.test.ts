import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { refreshTarget, refreshText, responsiveText } from '../src/game/responsiveUi';

class Rectangle {
  constructor(public x: number, public y: number, public width: number, public height: number) {}
  setTo(x: number, y: number, width: number, height: number) { Object.assign(this, { x, y, width, height }); return this; }
}

class Text {
  style = { fontSize: 36 };
  width = 100; height = 40; text = 'Счётчик';
  input = { enabled: false, customHitArea: false, hitArea: new Rectangle(0, 0, 100, 40), hitAreaCallback: vi.fn() };
  get displayOriginX() { return this.width / 2; }
  get displayOriginY() { return this.height / 2; }
  getWorldTransformMatrix() { return { a: 1, b: 0, c: 0, d: 1 }; }
  updateText() {
    this.width = Math.ceil(100 * this.style.fontSize / 36 * this.text.length / 7);
    this.height = Math.ceil(40 * this.style.fontSize / 36);
    // Exact Text.updateText contract: Phaser updates only width/height of an auto Rectangle.
    if (!this.input.customHitArea) { this.input.hitArea.width = this.width; this.input.hitArea.height = this.height; }
    return this;
  }
  setFontSize(size: number) { this.style.fontSize = size; return this.updateText(); }
  setText(text: string) { this.text = text; return this.updateText(); }
}

const object = (text: Text) => text as unknown as Phaser.GameObjects.Text;
const rect = (text: Text) => text.input.hitArea as unknown as Phaser.Geom.Rectangle;
const center = (text: Text) => ({ x: text.input.hitArea.x + text.input.hitArea.width / 2 - text.displayOriginX,
  y: text.input.hitArea.y + text.input.hitArea.height / 2 - text.displayOriginY });

describe('auto Text input follows natural glyph bounds, then reapplies the phone minimum', () => {
  it('font rasterization cannot retain the padding origin from the old enlarged auto Rectangle', () => {
    const text = new Text(); const input = text.input; const callback = input.hitAreaCallback;
    responsiveText(object(text), 34, () => 36);
    refreshTarget(object(text), rect(text), 132); expect(center(text)).toEqual({ x: 0, y: 0 });
    refreshText(object(text), 41); refreshTarget(object(text), rect(text), 149);
    expect(center(text)).toEqual({ x: 0, y: 0 });
    expect(text.input).toBe(input); expect(input.hitAreaCallback).toBe(callback); expect(input.enabled).toBe(false);
  });

  it('later setText keeps the44CSS target and natural center immediately, without waiting for another viewport resize', () => {
    const text = new Text();
    const after = () => refreshTarget(object(text), rect(text), 149);
    // Extra arguments are ignored by the original API during the before regression.
    Reflect.apply(responsiveText, undefined, [object(text), 34, () => 41, after]);
    after(); text.setText('Да');
    expect(text.input.hitArea.height * 320 / 1080).toBeGreaterThanOrEqual(44);
    expect(text.input.hitArea.width * 320 / 1080).toBeGreaterThanOrEqual(44);
    expect(center(text)).toEqual({ x: 0, y: 0 });
  });

  it('custom Rectangle coordinates remain authoritative when Text redraws', () => {
    const text = new Text(); text.input.customHitArea = true;
    text.input.hitArea.setTo(20, 200, 280, 100);
    responsiveText(object(text), 34, () => 36);
    refreshTarget(object(text), rect(text), 132);
    const before = { ...text.input.hitArea };
    refreshText(object(text), 41); refreshTarget(object(text), rect(text), 132);
    expect({ ...text.input.hitArea }).toEqual(before);
    expect(text.input.enabled).toBe(false);
  });
});
