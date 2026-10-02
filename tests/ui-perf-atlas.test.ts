import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';
import { addAtlasAliases, shelfPack, type AtlasSlot } from '../src/game/packedTexture';
import { objectStats, textureCount } from '../src/game/perf';
import { SKIN_TILES } from '../src/game/skin';

const overlap = (a: AtlasSlot, b: AtlasSlot, g: number) =>
  a.x - g < b.x + b.w + g && b.x - g < a.x + a.w + g && a.y - g < b.y + b.h + g && b.y - g < a.y + a.h + g;

describe('shelfPack (атлас скина)', () => {
  it('кадры с полем не пересекаются и лежат внутри атласа', () => {
    const items = [
      ...Object.keys(SKIN_TILES).map((key) => ({ key, w: 128, h: 128 })),
      ...Array.from({ length: 80 }, (_, i) => ({ key: `skin_ico_${i}`, w: 64, h: 64 })),
      ...['locked', 'cleared', 'open', 'boss'].map((k) => ({ key: `skin_node_${k}`, w: 200, h: 200 })),
      { key: 'skin_header_grad', w: 4, h: 256 },
      { key: 'skin_trim', w: 512, h: 12 },
      { key: 'skin_ribbon', w: 256, h: 96 },
    ];
    const g = 2;
    const { width, height, slots } = shelfPack(items, 2048, g);
    expect(slots).toHaveLength(items.length);
    expect(width).toBeLessThanOrEqual(2048);
    // Мобильный WebGL гарантированно держит 2048 по стороне; весь скин помещается с запасом.
    expect(height).toBeLessThanOrEqual(2048);
    for (const s of slots) {
      const it = items.find((i) => i.key === s.key)!;
      expect([s.w, s.h]).toEqual([it.w, it.h]);
      expect(s.x - g).toBeGreaterThanOrEqual(0);
      expect(s.y - g).toBeGreaterThanOrEqual(0);
      expect(s.x + s.w + g).toBeLessThanOrEqual(width);
      expect(s.y + s.h + g).toBeLessThanOrEqual(height);
    }
    for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) expect(overlap(slots[i], slots[j], g - 0.5)).toBe(false);
  });

  it('детерминирована и не зависит от порядка входа', () => {
    const items = [
      { key: 'a', w: 10, h: 30 },
      { key: 'b', w: 50, h: 30 },
      { key: 'c', w: 20, h: 5 },
    ];
    expect(shelfPack(items, 64, 1)).toEqual(shelfPack([...items].reverse(), 64, 1));
  });

  it('кадр шире атласа — ошибка, а не тихая порча', () => {
    expect(() => shelfPack([{ key: 'x', w: 100, h: 10 }], 64, 2)).toThrow(/шире атласа/);
  });
});

describe('addAtlasAliases', () => {
  class FakeTexture {
    source: unknown[] = [];
    frames: Record<string, { x: number; y: number; w: number; h: number }> = {};
    destroyed = 0;
    constructor(
      readonly manager: unknown,
      readonly key: string,
      src: unknown,
    ) {
      for (const s of Array.isArray(src) ? src : [src]) this.source.push({ own: s });
    }
    add(name: string, _i: number, x: number, y: number, w: number, h: number) {
      this.frames[name] = { x, y, w, h };
    }
    destroy() {
      this.destroyed++;
      for (const s of this.source as { gone?: boolean }[]) s.gone = true;
    }
  }

  it('у каждого ключа свой кадр __BASE, источник — общий; удаление псевдонима не трогает атлас', () => {
    const list: Record<string, unknown> = {};
    const tm = { list, exists: (k: string) => k in list } as unknown as Phaser.Textures.TextureManager;
    const atlas = new FakeTexture(tm, 'skin_atlas', 'CANVAS');
    list.skin_atlas = atlas;
    list.skin_old = {};
    const n = addAtlasAliases(tm, atlas as unknown as Phaser.Textures.Texture, [
      { key: 'skin_btn', x: 2, y: 2, w: 128, h: 128 },
      { key: 'skin_old', x: 134, y: 2, w: 64, h: 64 },
    ]);
    expect(n).toBe(1);
    const alias = list.skin_btn as FakeTexture;
    expect(alias).toBeInstanceOf(FakeTexture);
    expect(alias.source).toHaveLength(1);
    expect(alias.source[0]).toBe(atlas.source[0]);
    expect(alias.frames.__BASE).toEqual({ x: 2, y: 2, w: 128, h: 128 });
    alias.destroy();
    expect((atlas.source[0] as { gone?: boolean }).gone).toBeUndefined();
  });
});

describe('objectStats / textureCount (perf:ui)', () => {
  const src = (id: string) => ({ glTexture: id });
  const scene = [
    { type: 'Image', texture: { key: 'skin_btn' }, frame: { source: src('atlas') } },
    { type: 'NineSlice', texture: { key: 'skin_panel' }, frame: { source: src('atlas') } },
    { type: 'Text', texture: { key: 't1' }, frame: { source: src('t1') } },
    {
      type: 'Container',
      list: [
        { type: 'Text', texture: { key: 't2' }, frame: { source: src('t2') } },
        { type: 'Graphics' },
        { type: 'Container', list: [{ type: 'BitmapText', texture: { key: 'num' }, frame: { source: src('num') } }] },
      ],
    },
    { type: 'Text', visible: false, texture: { key: 't3' }, frame: { source: src('t3') } },
    { type: 'Image', texture: { key: '__DEFAULT' }, frame: { source: src('def') } },
  ];

  it('считает объекты по типам, включая вложенные', () => {
    expect(objectStats(scene)).toEqual({ total: 10, text: 3, bitmapText: 1, containers: 2, nineslices: 1, images: 2, graphics: 1 });
  });

  it('кадры одного атласа — одна текстура; невидимые и служебные не считаются', () => {
    // atlas, t1, t2, num
    expect(textureCount(scene)).toBe(4);
  });
});
