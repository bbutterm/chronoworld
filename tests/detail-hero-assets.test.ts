import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { heroSprite } from '../src/game/flow';
import { buildRegistry, type SpritesV2, type LegacySprites } from '../src/pipeline/sprites';
import { packSheet } from '../src/pipeline/sheetPack';
import { loadFullContext } from '../scripts/lib/content-node';
import { cardHero } from './helpers';

const ROOT = join(import.meta.dirname, '..');
const json = (path: string) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const manifest = json('assets/sprites/sprites.json') as SpritesV2;
const registry = buildRegistry(json('assets/sprites.legacy.json') as LegacySprites, manifest);
const provenance = json('assets/sprites/sprites.provenance.json').sprites;
const index = json('assets-webp/index.json');
const ctx = loadFullContext();
const has = (id: string) => !!registry[id];
const cases = [
  ['alan', 'hero_alan_first_profession_detail_v1', '5fd5feded2d540b849eed613e54b008f86aab1268317f2bb5407a798903d5d26'],
  ['kai', 'hero_kai_magician_details_v2', '4d6cbe76cbf98f91dfc7b653bbd0b064224fa3684e71a47b1caa31b9a92c0f8e'],
  ['bran', 'hero_bran_first_profession_detail_v1', '98d3358ec8c09698c72ff31fac25b3b44762790d2f782849d50eaed79b381e09'],
  ['greta', 'hero_greta_merchant_detail_v2', '7296830bc2e832d303cfcf3464b8814266543f18bf145806c3e72b20558725c5'],
] as const;
const promoted: Record<string, Record<string, string>> = {"alan":{"knight":"knight_m","crusader":"crusader_m"},"kai":{"wizard":"wizard_m","sage":"sage_m"},"bran":{"hunter":"hunter_m","bard":"bard_m"},"greta":{"blacksmith":"blacksmith_f","alchemist":"alchemist_f"}};

describe('Approved four-hero detail batch', () => {
  for (const [hero, id, sourceHash] of cases) {
    it(`${hero}: only first-profession cards resolve to the new unique identity`, () => {
      expect(heroSprite(cardHero(ctx, hero), ctx, has)).toBe(id);
      expect(heroSprite(cardHero(ctx, hero, 40, { rarity: 'purple' }), ctx, has)).toBe(id);
      for (const [branch, expected] of Object.entries(promoted[hero])) {
        expect(heroSprite(cardHero(ctx, `${hero}/${branch}`, 40), ctx, has)).toBe(expected);
      }
      expect(manifest.sprites.filter(s => s.id === id)).toHaveLength(1);
      expect(registry[id].anchor).toEqual([104, 144]);
      expect(registry[id].cell).toEqual([224, 192]);
      expect(registry[id].scale).toBe(3.2);
      expect(registry[id].anims.attack?.hitFrame).toBe(3);
      expect(registry[id].anims.cast?.hitFrame).toBe(4);
      expect(Object.values(registry[id].anims).map(a => a?.frames)).toEqual([4, 8, 6, 6, 3, 4]);
      expect(Object.values(registry[id].anims).map(a => a?.ms[0])).toEqual([150, 90, 80, 100, 100, 150]);
      expect(packSheet(registry[id])?.frames).toHaveLength(31);
    });
    it(`${hero}: exact approved PNG, own idle0 portrait and fresh WebP pair`, () => {
      const sprite = registry[id];
      const bytes = readFileSync(join(ROOT, 'assets', sprite.file));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(sourceHash);
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1792, 1152]);
      expect(sprite.portrait).toBe(`sprites/portraits/${id}.png`);
      const portrait = readFileSync(join(ROOT, 'assets', sprite.portrait!));
      expect([portrait.readUInt32BE(16), portrait.readUInt32BE(20)]).toEqual([256, 256]);
      expect(provenance[id].portraitSource).toMatchObject({ frame: 0, crop: [72, 56, 136, 120], resample: 'nearest' });
      expect(createHash('sha256').update(portrait).digest('hex')).toBe(provenance[id].portraitSource.sha256);
      for (const file of [sprite.file, sprite.portrait!]) {
        const png = readFileSync(join(ROOT, 'assets', file));
        const webp = readFileSync(join(ROOT, 'assets-webp', file.replace(/\.png$/, '.webp')));
        expect(index[file].sha1).toBe(createHash('sha1').update(png).digest('hex'));
        expect(index[file].webp).toBe(webp.length);
        expect(webp.toString('ascii', 0, 4)).toBe('RIFF');
        expect(webp.toString('ascii', 8, 12)).toBe('WEBP');
      }
    });
  }
  it('generic professions and not-yet-integrated heroes retain their own identities', () => {
    expect(registry.magician_m.file).toBe('sprites/heroes/magician_m.png');
    expect(registry.merchant_f.file).toBe('sprites/heroes/merchant_f.png');
    expect(registry.hero_bran_archer.file).toBe('sprites/heroes/hero_bran_archer.png');
    expect(registry.hero_alan_swordman.file).toBe('sprites/heroes/hero_alan_swordman_style_v07.png');
    expect(heroSprite(cardHero(ctx, 'vika'), ctx, has)).toBe('hero_vika_acolyte');
    expect(heroSprite(cardHero(ctx, 'iris'), ctx, has)).toBe('swordman_f');
    expect(heroSprite(cardHero(ctx, 'meilin'), ctx, has)).not.toMatch(/detail/);
    expect(heroSprite(cardHero(ctx, 'otto'), ctx, has)).not.toMatch(/detail/);
  });
});
