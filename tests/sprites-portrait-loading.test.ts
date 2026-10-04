import type Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {
  Textures: { FilterMode: { NEAREST: 0, LINEAR: 1 } },
  Scenes: { Events: { SHUTDOWN: 'shutdown' } },
} }));
vi.mock('../src/game/assetUrl', () => ({ assetUrl: (path: string) => path }));
vi.mock('../src/pipeline/sheetPack', () => ({ packSheet: () => null }));
vi.mock('../src/pipeline/sprites', () => ({
  buildRegistry: () => ({
    deferred_hero: {
      id: 'deferred_hero', file: 'deferred-sheet.png', portrait: 'deferred-portrait.png',
      cell: [224, 192], columns: 8, anims: { idle: { row: 0, frames: 1, ms: [100] } },
    },
  }),
  resolveAnim: vi.fn(),
}));

import { portraitKey, requestPortrait, spriteKey, spritesBusy, whenSprites } from '../src/game/sprites';

afterEach(() => vi.unstubAllGlobals());

describe('concurrent sheet and portrait loading', () => {
  it('waits for the original fallback when a second portrait-file request fails after the sheet arrives', async () => {
    const images: DeferredImage[] = [];
    class DeferredImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      url = '';
      set src(url: string) { this.url = url; images.push(this); }
    }
    vi.stubGlobal('Image', DeferredImage);

    const texturesByKey = new Map<string, unknown>();
    const frame = { name: '0', realWidth: 2, realHeight: 2, x: 0, y: 0 };
    const textures = {
      exists: (key: string) => texturesByKey.has(key),
      addSpriteSheet: vi.fn((key: string) => {
        const texture = { setFilter: vi.fn(), source: [{ width: 224, height: 192 }] };
        texturesByKey.set(key, texture);
        return texture;
      }),
      addImage: vi.fn((key: string) => {
        const texture = { setFilter: vi.fn() };
        texturesByKey.set(key, texture);
        return texture;
      }),
      getFrame: vi.fn(() => frame),
      createCanvas: vi.fn((key: string) => {
        const context = { getImageData: () => ({ data: new Uint8ClampedArray(16).fill(255) }), drawImage: vi.fn() };
        const texture = {
          key, drawFrame: vi.fn(), getContext: () => context, getSourceImage: () => ({}),
          refresh: vi.fn(), setFilter: vi.fn(),
        };
        texturesByKey.set(key, texture);
        return texture;
      }),
      remove: vi.fn((texture: { key: string }) => texturesByKey.delete(texture.key)),
    };
    const game = { textures, anims: { exists: () => true } } as unknown as Phaser.Game;
    const scene = {
      game, events: { once: vi.fn() }, sys: { isActive: () => true },
    } as unknown as Phaser.Scene;
    const flush = () => new Promise<void>(resolve => setImmediate(resolve));
    const ready = vi.fn();
    const id = 'deferred_hero';

    whenSprites(scene, [id], ready, { quiet: true });
    expect(images.map(image => image.url)).toEqual(['deferred-sheet.png']);
    images[0].onload!();
    await flush();
    expect(textures.exists(spriteKey(id))).toBe(true);
    expect(textures.exists(portraitKey(id))).toBe(false);
    expect(spritesBusy()).toBe(true);
    expect(ready).not.toHaveBeenCalled();

    let portraitSettled = false;
    const portrait = requestPortrait(game, id).then(() => { portraitSettled = true; });
    await flush();
    expect(images.map(image => image.url)).toEqual([
      'deferred-sheet.png', 'deferred-portrait.png', 'deferred-portrait.png',
    ]);
    images[2].onerror!();
    await flush();
    expect(portraitSettled).toBe(false);
    expect(textures.exists(portraitKey(id))).toBe(false);
    expect(spritesBusy()).toBe(true);

    images[1].onerror!();
    await portrait;
    await flush();
    expect(textures.getFrame).toHaveBeenCalledExactlyOnceWith(spriteKey(id), '0');
    expect(textures.exists(portraitKey(id))).toBe(true);
    expect(portraitSettled).toBe(true);
    expect(ready).toHaveBeenCalledOnce();
    expect(spritesBusy()).toBe(false);
    expect(textures.addSpriteSheet).toHaveBeenCalledOnce();
    expect(textures.addImage).not.toHaveBeenCalled();

    await requestPortrait(game, id);
    expect(images).toHaveLength(3);
  });
});
