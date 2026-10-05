import type Phaser from 'phaser';

/** Requested sizes remain distinct from the temporary floor imposed by a narrow phone. */
type FontSize = string | number;
type FontState = { requested: FontSize; applied: number; set: Phaser.GameObjects.Text['setFontSize'] };
const fonts = new WeakMap<Phaser.GameObjects.Text, FontState>();

function sizeOf(size: FontSize): number {
  return parseFloat(String(size));
}

/** Factory-created Text retains later explicit setFontSize requests (including fitted labels). */
export function responsiveText(
  text: Phaser.GameObjects.Text, requested: FontSize, minimum: () => number,
  refreshInput?: (text: Phaser.GameObjects.Text) => void,
): void {
  const state: FontState = { requested, applied: sizeOf(text.style.fontSize), set: text.setFontSize };
  fonts.set(text, state);
  text.setFontSize = function (size: FontSize) {
    state.requested = size;
    const floor = minimum();
    const next = Math.max(sizeOf(size), floor);
    state.applied = next;
    return state.set.call(this, next);
  };
  const update = text.updateText;
  text.updateText = function () {
    const input = this.input;
    // Text.updateText rewrites auto width/height but leaves padded x/y untouched. Restore its natural
    // origin first, then resize around the new glyph center; custom/manual hit areas remain authoritative.
    if (input?.customHitArea === false && targets.get(this)?.rect === input.hitArea) {
      input.hitArea.x = 0;
      input.hitArea.y = 0;
      targets.delete(this);
    }
    const result = update.call(this);
    if (this.input) refreshInput?.(this);
    return result;
  };
}

/** Run before scene reflow, so wrapped text's width/height already match the new minimum. */
export function refreshText(text: Phaser.GameObjects.Text, minimum: number): void {
  const state = fonts.get(text);
  if (!state) return;
  // Pool/style helpers may assign fontSize through TextStyle instead of Text.setFontSize.
  const current = sizeOf(text.style.fontSize);
  if (current !== state.applied) state.requested = text.style.fontSize;
  const next = Math.max(sizeOf(state.requested), minimum);
  state.applied = next;
  if (next === current) return;
  state.set.call(text, next);
}

type Rect = Pick<Phaser.Geom.Rectangle, 'x' | 'y' | 'width' | 'height' | 'setTo'>;
type Bounds = { x: number; y: number; width: number; height: number };
type HitState = { rect: Rect; requested: Bounds; applied: Bounds };
const targets = new WeakMap<Phaser.GameObjects.GameObject, HitState>();
const bounds = ({ x, y, width, height }: Rect): Bounds => ({ x, y, width, height });
const same = (a: Bounds, b: Bounds) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * Resize the existing Rectangle around its original center. Input identity, callback, enabled state and
 * display origin stay intact. A scene's explicit hitArea.setTo remains authoritative on the next refresh.
 * Caller only supplies actual Rectangle hit areas; other shapes and callbacks remain untouched.
 */
export function refreshTarget(target: Phaser.GameObjects.GameObject, rect: Rect, minimum: number): void {
  let state = targets.get(target);
  const current = bounds(rect);
  if (!state || state.rect !== rect) {
    state = { rect, requested: current, applied: current };
    targets.set(target, state);
  } else if (!same(current, state.applied)) state.requested = current;
  const matrix = (target as Phaser.GameObjects.Container).getWorldTransformMatrix();
  const scaleX = Math.hypot(matrix.a, matrix.b), scaleY = Math.hypot(matrix.c, matrix.d);
  const base = state.requested;
  const width = Math.max(base.width, scaleX > 0 ? minimum / scaleX : base.width);
  const height = Math.max(base.height, scaleY > 0 ? minimum / scaleY : base.height);
  const next = { x: base.x + (base.width - width) / 2, y: base.y + (base.height - height) / 2, width, height };
  if (!same(current, next)) rect.setTo(next.x, next.y, next.width, next.height);
  state.applied = next;
}
