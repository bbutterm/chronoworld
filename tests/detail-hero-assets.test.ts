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
const release = json('tests/fixtures/profession-release.json') as {
  readyIndexSha256: string;
  assets: { target_id: string; hero_id: string; job_id: string; stage: string; new_sprite_id: string; sheet_sha256: string; source_sprite_id: string }[];
  preservedSpriteIds: string[];
  preservedRuntimeEntriesSha256: string;
};
const cases = release.assets;

describe('Approved 36-pack profession release', () => {
  for (const { target_id: target, hero_id: hero, job_id: job, stage, new_sprite_id: id, sheet_sha256: sourceHash } of cases) {
    it(`${target}: unique runtime entry has the agreed frame contract`, () => {
      if (stage !== 'novice') {
        const key = stage === 'promotion' ? `${hero}/${job}` : hero;
        expect(heroSprite(cardHero(ctx, key, stage === 'promotion' ? 40 : 1), ctx, has)).toBe(id);
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
    it(`${target}: exact approved PNG, own idle0 portrait and fresh WebP pair`, () => {
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
  it('generic professions and unfinished named forms retain their own identities', () => {
    expect(registry.magician_m.file).toBe('sprites/heroes/magician_m.png');
    expect(registry.merchant_f.file).toBe('sprites/heroes/merchant_f.png');
    expect(registry.hero_bran_archer.file).toBe('sprites/heroes/hero_bran_archer.png');
    expect(registry.hero_alan_swordman.file).toBe('sprites/heroes/hero_alan_swordman.png');
    expect(registry.hero_vika_acolyte.file).toBe('sprites/heroes/hero_vika_acolyte.png');
    expect(registry.swordman_f.file).toBe('sprites/heroes/swordman_f.png');
    expect(heroSprite(cardHero(ctx, 'iris'), ctx, id => has(id) && !id.includes('detail'))).toBe('swordman_f');
    expect(heroSprite(cardHero(ctx, 'lira/sage', 40), ctx, has)).toBe('sage_f');
    expect(heroSprite(cardHero(ctx, 'meilin/dancer', 40), ctx, has)).toBe('dancer_f');
  });
  it('contains exactly 12 first professions, 22 named promotions and 2 novice packs', () => {
    expect(cases).toHaveLength(36);
    expect(cases.filter(a => a.stage === 'first')).toHaveLength(12);
    expect(cases.filter(a => a.stage === 'promotion')).toHaveLength(22);
    expect(cases.filter(a => a.stage === 'novice')).toHaveLength(2);
    expect(new Set(cases.map(a => a.new_sprite_id)).size).toBe(36);
    const approved = Object.keys(provenance).filter(id => provenance[id].source?.renderer === 'QA-approved current detail atlas, copied byte-for-byte');
    expect(approved.sort()).toEqual(cases.map(a => a.new_sprite_id).sort());
  });
  it('retains every prior runtime entry, including all monsters and generic professions', () => {
    const preserved = manifest.sprites.filter(s => release.preservedSpriteIds.includes(s.id));
    const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) :
      value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)])) : value;
    expect(preserved).toHaveLength(release.preservedSpriteIds.length);
    expect(createHash('sha256').update(JSON.stringify(canonical(preserved))).digest('hex')).toBe(release.preservedRuntimeEntriesSha256);
    const added = manifest.sprites.filter(s => !release.preservedSpriteIds.includes(s.id));
    // The approved original 36 remain intact; the veteran release adds exactly 24 gender forms.
    const veterans = Object.values(ctx.content.heroes).flatMap(t => t.branches.flatMap(b => b.advanced ? [b.advanced.visual.sprite!] : []));
    expect(veterans).toHaveLength(24);
    expect(new Set(veterans).size).toBe(24);
    expect(added.map(s => s.id).sort()).toEqual([...cases.map(a => a.new_sprite_id), ...veterans].sort());
    expect(added.every(s => s.class === 'hero')).toBe(true);
  });

});
