import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveState } from '../src/core';

vi.mock('phaser', () => ({ default: {
  Scene: class {},
  Textures: { FilterMode: { NEAREST: 1, LINEAR: 0 } },
  Core: { Events: { PRE_RENDER: 'prerender' } },
  Scenes: { Events: { SHUTDOWN: 'shutdown' } },
} }));
vi.mock('../src/game/content', async () => {
  const { loadFullContext } = await import('../scripts/lib/content-node');
  const GAME = loadFullContext();
  return { GAME, CONTENT: GAME.content, LORE: { lines: { loading: [] } } };
});
vi.mock('../src/game/session', () => ({ session: { save: null } }));
vi.mock('../src/game/assets', () => ({ queueAssets: vi.fn(), setupLoadedAssets: vi.fn(), buildPlaceholders: vi.fn() }));
vi.mock('../src/game/skin', () => ({ buildSkin: vi.fn() }));
vi.mock('../src/game/audio', () => ({ installAudio: vi.fn() }));
vi.mock('../src/game/sceneAudio', () => ({ sceneSoundOf: vi.fn() }));
vi.mock('../src/game/bootLook', () => ({
  BOOT: {},
  drawBoot: () => ({ setProgress: vi.fn(), label: { text: '', setText: vi.fn() }, hint: { text: '', setText: vi.fn(), setColor: vi.fn() } }),
}));
vi.mock('../src/game/assetUrl', async (original) => ({
  ...await original<typeof import('../src/game/assetUrl')>(), bootPack: vi.fn(),
}));
vi.mock('../src/game/sprites', async (original) => ({
  ...await original<typeof import('../src/game/sprites')>(), setupSprites: vi.fn(),
}));

import { activeForm, addHeroCard, loadOrNew, MemoryStorage, newGame } from '../src/core';
import { bootFiles } from '../scripts/lib/used-assets';
import { SKIN_REPLACED } from '../src/pipeline/bootAssets';
import { bootPack } from '../src/game/assetUrl';
import { GAME, CONTENT } from '../src/game/content';
import { heroSprite } from '../src/game/flow';
import { heroJobId } from '../src/core';
import { BootScene } from '../src/game/scenes/BootScene';
import { session } from '../src/game/session';
import { portraitKey, SPRITES } from '../src/game/sprites';
import type { AssetPack } from 'virtual:asset-pack';

const now = 1792645536853;
const day = '2026-10-22';
// Actual pre-final-boss snapshot: fresh legal rational campaign seed 2, 179 victories,
// 33 +12 h waits, all development through core APIs. See night-campaign-2026-10-05.md.
const lateText = readFileSync(new URL('./fixtures/boot-late-save.json', import.meta.url), 'utf8');
const packFiles = bootFiles(process.cwd(), SKIN_REPLACED);

function fakePack(): AssetPack {
  return {
    url: 'assets/boot-test.bin', bytes: packFiles.length,
    files: Object.fromEntries(packFiles.map((file, index) => [file, [index, 1, 'image/png']])),
  };
}

interface QueuedImage { key: string; url: string }

function boot(save: SaveState, packaged = true) {
  session.save = save;
  vi.mocked(bootPack).mockReturnValue(packaged ? fakePack() : null);
  const images: QueuedImage[] = [];
  const loaded = new Map<string, { setFilter: ReturnType<typeof vi.fn> }>();
  const events = new EventEmitter();
  const loader = Object.assign(new EventEmitter(), {
    imageLoadType: '',
    image(this: EventEmitter, key: string, url: string) {
      const file = { key, url };
      this.emit('addfile', key, 'image', this, file);
      images.push(file);
      return this;
    },
    binary: vi.fn(),
  });
  const start = vi.fn();
  const scene = Object.assign(new BootScene(), {
    load: loader, events,
    game: { events: new EventEmitter(), textures: { exists: (key: string) => loaded.has(key), get: (key: string) => loaded.get(key) } },
    cache: { binary: { remove: vi.fn() } }, scene: { start },
  });
  scene.preload();
  const completePack = () => loader.emit('filecomplete-binary-__boot_pack', '__boot_pack', 'binary', new ArrayBuffer(packFiles.length));
  const completeImages = () => {
    for (const { key } of images) {
      loaded.set(key, { setFilter: vi.fn() });
      loader.emit('filecomplete', key);
    }
  };
  return { scene, loader, images, loaded, start, completePack, completeImages };
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('Boot consumes owned portrait files before discarding its pack', () => {
  it('newGame has all three personal portraits ready before Campaign, using actual pack paths', async () => {
    const save = newGame(GAME, now, day);
    const own = save.heroes.map(hero => heroSprite(hero, GAME));
    expect(own).toEqual(['hero_alan_first_profession_detail_v1', 'hero_bran_first_profession_detail_v1', 'hero_vika_acolyte_details_v2']);
    const b = boot(save);
    expect(b.images).toHaveLength(0);
    b.completePack();
    for (const id of own) {
      const matches = b.images.filter(file => file.key === portraitKey(id));
      expect(matches).toHaveLength(1);
      expect(matches[0].url).toMatch(/^blob:/);
      expect(packFiles).toContain(SPRITES[id].portrait);
    }
    b.completeImages();
    b.scene.create();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(own.every(id => b.loaded.has(portraitKey(id)))).toBe(true);
    for (const id of own) expect(b.loaded.get(portraitKey(id))?.setFilter).toHaveBeenCalledExactlyOnceWith(1);
    expect(b.start).toHaveBeenCalledExactlyOnceWith('Campaign');
  });

  it('sanitized legal late save includes advanced and off-squad inventory heroes; no duplicate queue keys', () => {
    const raw = JSON.parse(lateText) as SaveState;
    raw.heroes.push({ id: 'removed_hero', templateId: 'removed_template', rarity: 'green', level: 1 });
    const storage = new MemoryStorage();
    storage.save(JSON.stringify(raw));
    const result = loadOrNew(storage, GAME, now, day);
    expect(result.source).toBe('loaded');
    expect(result.save.campaign.cleared).toHaveLength(179);
    expect(result.save.inventory.items.length).toBeGreaterThan(200);
    expect(result.save.heroes.some(hero => hero.templateId === 'removed_template')).toBe(false);
    expect(result.warnings?.length).toBeGreaterThan(0);
    const advanced = result.save.heroes.filter(hero => activeForm(GAME.content.heroes[hero.templateId], hero).advanced);
    expect(advanced.length).toBeGreaterThan(0);
    const offSquad = result.save.heroes.filter(hero => !result.save.squad.includes(hero.id));
    expect(offSquad.length).toBeGreaterThan(0);
    const b = boot(result.save);
    b.completePack();
    const keys = b.images.map(file => file.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const hero of [...advanced, ...offSquad]) {
      const id = heroSprite(hero, GAME);
      if (SPRITES[id]?.portrait) expect(keys).toContain(portraitKey(id));
    }
    b.completeImages();
    b.scene.create();
  });

  it('shared job/gender sprites and repeated personal copies each queue exactly once', () => {
    let save = newGame(GAME, now, day);
    save = addHeroCard(save, 'alan', 'green').save;
    save = addHeroCard(save, 'greta', 'green').save;
    save = addHeroCard(save, 'greta', 'green').save;
    const greta = save.heroes.find(hero => hero.templateId === 'greta')!;
    const shared = heroSprite(greta, GAME);
    expect(SPRITES[shared]?.portrait).toBeTruthy();
    // A permitted content alias: the job and its private card portrait use the same registry ID.
    const job = CONTENT.jobs[heroJobId(save.heroes[0], GAME)];
    const original = job.visual.sprite;
    job.visual.sprite = heroSprite(save.heroes[0], GAME);
    try {
      const b = boot(save);
      b.completePack();
      expect(b.images.filter(file => file.key === portraitKey(heroSprite(save.heroes[0], GAME)))).toHaveLength(1);
      expect(b.images.filter(file => file.key === portraitKey(shared))).toHaveLength(1);
      const roles = Object.values(CONTENT.jobs).map(role => role.visual.sprite);
      for (const id of roles) if (SPRITES[id]?.portrait) expect(b.images.filter(file => file.key === portraitKey(id))).toHaveLength(1);
      b.completeImages();
      b.scene.create();
    } finally {
      job.visual.sprite = original;
    }
  });

  it.each([false, true])('dev/no pack and failed pack preserve independent-file fallback (%s)', (failedPack) => {
    const save = newGame(GAME, now, day);
    const b = boot(save, failedPack);
    if (failedPack) b.loader.emit('loaderror', { key: '__boot_pack' });
    for (const hero of save.heroes) {
      const id = heroSprite(hero, GAME);
      expect(b.images.find(file => file.key === portraitKey(id))?.url).toBe(SPRITES[id].portrait);
    }
    b.completeImages();
    b.scene.create();
  });
});
