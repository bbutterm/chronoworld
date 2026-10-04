import { afterEach, describe, expect, it, vi } from 'vitest';
import { addPackedTexture } from '../src/game/packedTexture';
import type { PackedSheet } from '../src/pipeline/sheetPack';

afterEach(() => vi.unstubAllGlobals());

function fixture(names: number[]) {
  const frames: Record<string, { name: string | number; setTrim: ReturnType<typeof vi.fn> }> = {};
  const texture = {
    firstFrame: '__BASE' as string | number,
    add(name: string | number) {
      const frame = { name, setTrim: vi.fn() }; frames[name] = frame;
      if (this.firstFrame === '__BASE') this.firstFrame = name;
      return frame;
    },
    // Matches Phaser Texture.get: numeric zero selects firstFrame.
    get(name?: string | number) { return frames[name || this.firstFrame]; },
  };
  const drawImage = vi.fn();
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({ imageSmoothingEnabled: true, drawImage }) }) });
  const manager = { create: () => texture } as unknown as Parameters<typeof addPackedTexture>[0];
  const pack: PackedSheet = { width: 200, height: 200, frames: names.map((name, i) => ({ name, sx: 0, sy: 0, w: 40, h: 80, x: i * 50, y: 0, dx: 80, dy: 60 })) };
  addPackedTexture(manager, 'hero', {} as HTMLImageElement, pack, [224, 192]);
  return { texture, frames, drawImage };
}

describe('packed sprite default frame', () => {
  it('keeps numeric frame0 on idle when a taller attack frame is packed first', () => {
    const { texture, frames, drawImage } = fixture([16, 0, 1]);
    expect(texture.firstFrame).toBe('0');
    expect(texture.get(0).name).toBe(0);
    expect(texture.get('0').name).toBe(0);
    expect(texture.get().name).toBe(0);
    expect(texture.get(16).name).toBe(16);
    expect(frames[0].setTrim).toHaveBeenCalledWith(224, 192, 80, 60, 40, 80);
    expect(drawImage).toHaveBeenCalledTimes(3);
  });
  it('retains the first available frame for a pack with no frame0', () => {
    expect(fixture([5, 8]).texture.get().name).toBe(5);
  });
});
