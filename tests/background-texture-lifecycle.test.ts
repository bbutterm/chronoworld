import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackgroundCache } from '../src/game/backgroundCache';

vi.mock('phaser', () => ({ default: { GameObjects: { Events: { DESTROY: 'destroy' } } } }));
vi.mock('../src/game/content', () => ({ GAME: {}, CONTENT: { chapters: [] } }));
vi.mock('../src/game/viewport', () => ({ bleedImage: vi.fn() }));
const { setThemeBackground } = await import('../src/game/backdrops');

type Background = Parameters<typeof setThemeBackground>[0];

function fixture(keys: string[]) {
  const sources = new Map(keys.map((key) => [key, { source: {} as object | null }]));
  const textures = {
    exists: (key: string) => sources.has(key),
    addImage: vi.fn((key: string) => sources.set(key, { source: {} })),
    remove: vi.fn((key: string) => {
      // Phaser destroys its Frame.source when a texture is removed. Live images still retain that Frame.
      sources.get(key)!.source = null;
      sources.delete(key);
    }),
  };
  const game = { textures };
  const scene = { game, textures };
  const image = () => {
    let destroy = () => {};
    const img = {
      scene: scene as typeof scene | undefined,
      frame: { source: null } as { source: object | null },
      key: '',
      setTexture(key: string) {
        img.key = key;
        img.frame = sources.get(key)!;
        return img;
      },
      setDisplaySize: () => img,
      once: (_event: string, callback: () => void) => { destroy = callback; return img; },
      getData: () => undefined,
      destroy: () => { destroy(); img.scene = undefined; },
    };
    return { img, background: img as unknown as Background };
  };
  return { textures, sources, image };
}

afterEach(() => vi.unstubAllGlobals());

describe('background ownership and bounded spare cache', () => {
  it('retains a Tower image while the Arena banner selects a permanent meadow background', () => {
    const f = fixture(['bg_battle_ch8', 'bg_battle_ch1', 'skin_bg_battle']);
    const tower = f.image(), arena = f.image();
    setThemeBackground(tower.background, 'battle', 'crypt');
    setThemeBackground(arena.background, 'battle', 'meadow');
    expect(tower.img.frame.source).not.toBeNull();
    expect(arena.img.frame.source).not.toBeNull();
    expect(f.textures.remove).not.toHaveBeenCalled();
  });

  it('keeps shared sources until all images release them and bounds idle textures independently by kind', () => {
    const cache = new BackgroundCache();
    const tower = {}, preview = {}, map = {};
    expect(cache.bind(tower, 'battle', 'crypt')).toEqual([]);
    expect(cache.bind(preview, 'battle', 'crypt')).toEqual([]);
    expect(cache.bind(map, 'map', 'desert')).toEqual([]);
    expect(cache.bind(tower, 'battle', 'swamp')).toEqual([]);
    // crypt is still on the preview, so using another battle theme cannot evict it.
    expect(cache.bind(tower, 'battle', 'niflheim')).toEqual([]);
    expect(cache.release(preview)).toEqual(['crypt']);
    // Once the last user releases niflheim, only the latest battle spare remains. The map is untouched.
    expect(cache.release(tower)).toEqual(['swamp']);
    expect(cache.release(map)).toEqual([]);
  });

  it('does not multiply a hold on repeated theme assignment and releases the old frame after replacement', () => {
    const f = fixture(['bg_battle_ch8', 'bg_battle_ch10', 'bg_battle_ch2']);
    const first = f.image(), next = f.image();
    setThemeBackground(first.background, 'battle', 'crypt');
    setThemeBackground(first.background, 'battle', 'crypt');
    setThemeBackground(next.background, 'battle', 'niflheim');
    setThemeBackground(first.background, 'battle', 'sewer');
    expect(first.img.frame.source).not.toBeNull();
    expect(next.img.frame.source).not.toBeNull();
    first.img.destroy();
    expect(f.textures.remove).toHaveBeenCalledWith('bg_battle_ch8');
    next.img.destroy();
    expect(f.textures.remove).toHaveBeenCalledWith('bg_battle_ch10');
    expect(f.sources.size).toBe(1);
  });

  it('does not share texture ownership between game instances', () => {
    const first = fixture(['bg_battle_ch8', 'bg_battle_ch1', 'skin_bg_battle']);
    const second = fixture(['bg_battle_ch8', 'bg_battle_ch1', 'skin_bg_battle']);
    const tower = first.image(), arena = second.image();
    setThemeBackground(tower.background, 'battle', 'crypt');
    setThemeBackground(arena.background, 'battle', 'meadow');
    expect(tower.img.frame.source).not.toBeNull();
    expect(first.textures.remove).not.toHaveBeenCalled();
    expect(second.textures.remove).not.toHaveBeenCalled();
  });
});

describe('background file completion after scene/theme changes', () => {
  function downloads() {
    const images: { onload: () => void; src: string }[] = [];
    vi.stubGlobal('Image', class {
      onload = () => {};
      src = '';
      constructor() { images.push(this); }
    });
    return images;
  }
  async function finish(image: { onload: () => void }) {
    image.onload();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('updates every live image awaiting the same file through one download', async () => {
    const files = downloads();
    const f = fixture(['skin_bg_battle_crypt']);
    const tower = f.image(), preview = f.image();
    setThemeBackground(tower.background, 'battle', 'crypt');
    setThemeBackground(preview.background, 'battle', 'crypt');
    expect(files).toHaveLength(1);
    await finish(files[0]);
    expect(f.textures.addImage).toHaveBeenCalledOnce();
    expect(tower.img.key).toBe('bg_battle_ch8');
    expect(preview.img.key).toBe('bg_battle_ch8');
    expect(tower.img.frame.source).not.toBeNull();
    expect(preview.img.frame.source).not.toBeNull();
  });

  it('ignores a late download for a destroyed image instead of resurrecting an unused texture', async () => {
    const files = downloads();
    const f = fixture(['skin_bg_battle_crypt']);
    const tower = f.image();
    setThemeBackground(tower.background, 'battle', 'crypt');
    tower.img.destroy();
    await finish(files[0]);
    expect(f.textures.addImage).not.toHaveBeenCalled();
    expect(f.sources.has('bg_battle_ch8')).toBe(false);
  });

  it('does not replace a newer theme when an older file finishes last', async () => {
    const files = downloads();
    const f = fixture(['skin_bg_battle_crypt', 'bg_battle_ch10']);
    const background = f.image();
    setThemeBackground(background.background, 'battle', 'crypt');
    setThemeBackground(background.background, 'battle', 'niflheim');
    await finish(files[0]);
    expect(background.img.key).toBe('bg_battle_ch10');
    expect(background.img.frame.source).not.toBeNull();
    expect(f.textures.addImage).not.toHaveBeenCalled();
  });
});
