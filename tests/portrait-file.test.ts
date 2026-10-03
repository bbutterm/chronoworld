import { describe, expect, it, vi } from 'vitest';
import { ensurePortraitFile, type PortraitTextureStore } from '../src/game/portraitFile';

function store() {
  const keys = new Set<string>();
  const filter = vi.fn();
  const textures: PortraitTextureStore = {
    exists: key => keys.has(key),
    addImage: vi.fn((key: string) => { keys.add(key); return { setFilter: filter }; }),
  };
  return { keys, textures, filter };
}

describe('hero-specific registered portraits', () => {
  it('loads the dedicated file even when boot only queued class portraits', async () => {
    const s = store();
    const image = {} as HTMLImageElement;
    const read = vi.fn(async () => image);
    const key = 'portrait_hero_kai_magician_details_v2';
    const file = 'sprites/portraits/hero_kai_magician_details_v2.png';
    expect(await ensurePortraitFile(s.textures, key, file, read, 1)).toBe(true);
    expect(read).toHaveBeenCalledExactlyOnceWith(file);
    expect(s.textures.addImage).toHaveBeenCalledExactlyOnceWith(key, image);
    expect(s.filter).toHaveBeenCalledExactlyOnceWith(1);
  });
  it('reuses an existing portrait without loading a sheet or another image', async () => {
    const s = store(); s.keys.add('portrait_alan');
    const read = vi.fn(async () => null);
    expect(await ensurePortraitFile(s.textures, 'portrait_alan', 'alan.png', read, 1)).toBe(true);
    expect(read).not.toHaveBeenCalled();
  });
  it('permits sheet fallback only when the file is absent or fails', async () => {
    const s = store(); const read = vi.fn(async () => null);
    expect(await ensurePortraitFile(s.textures, 'portrait_alan', undefined, read, 1)).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(await ensurePortraitFile(s.textures, 'portrait_alan', 'missing.png', read, 1)).toBe(false);
    expect(s.textures.addImage).not.toHaveBeenCalled();
  });
  it('does not replace a portrait installed concurrently', async () => {
    const s = store();
    const read = vi.fn(async () => { s.keys.add('portrait_alan'); return {} as HTMLImageElement; });
    expect(await ensurePortraitFile(s.textures, 'portrait_alan', 'alan.png', read, 1)).toBe(true);
    expect(s.textures.addImage).not.toHaveBeenCalled();
  });
  it('does not report success if texture installation fails', async () => {
    const textures = { exists: () => false, addImage: () => null };
    expect(await ensurePortraitFile(textures, 'portrait_alan', 'alan.png', async () => ({} as HTMLImageElement), 1)).toBe(false);
  });
});
