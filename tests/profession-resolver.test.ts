import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newGame } from '../src/core';
import { heroSprite } from '../src/game/flow';
import { setSpriteLookup } from '../src/game/spriteRegistry';
import { portraitSprite, speakerView } from '../src/game/storyView';
import { buildRegistry, genderedSpriteId, type LegacySprites, type SpritesV2 } from '../src/pipeline/sprites';
import { loadFullContext } from '../scripts/lib/content-node';
import { cardHero } from './helpers';

const ROOT = join(import.meta.dirname, '..');
const json = (path: string) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const registry = buildRegistry(json('assets/sprites.legacy.json') as LegacySprites, json('assets/sprites/sprites.json') as SpritesV2);
const has = (id: string) => !!registry[id];
const ctx = loadFullContext();
const noviceM = 'profession_novice_m_detail_v1';
const noviceF = 'profession_novice_f_detail_v1';

// Frozen release identities: the two unfinished promotions deliberately keep their old packs.
const forms: [string, string, Record<string, string>][] = [
  ['alan', 'hero_alan_first_profession_detail_v1', { knight: 'hero_alan_knight_detail_v2', crusader: 'hero_alan_crusader_detail_v2' }],
  ['iris', 'hero_iris_first_profession_detail_v1', { knight: 'hero_iris_knight_detail_v2', crusader: 'hero_iris_crusader_detail_v2' }],
  ['bran', 'hero_bran_first_profession_detail_v1', { hunter: 'hero_bran_hunter_detail_v2', bard: 'hero_bran_bard_detail_v2' }],
  ['meilin', 'hero_meilin_first_profession_detail_v1', { hunter: 'hero_meilin_hunter_detail_v2', dancer: 'dancer_f' }],
  ['kai', 'hero_kai_magician_details_v2', { wizard: 'hero_kai_wizard_detail_v2', sage: 'hero_kai_sage_detail_v2' }],
  ['lira', 'hero_lira_magician_details_v2', { wizard: 'hero_lira_wizard_detail_v2', sage: 'sage_f' }],
  ['otto', 'hero_otto_merchant_detail_v2', { blacksmith: 'hero_otto_blacksmith_detail_v2', alchemist: 'hero_otto_alchemist_detail_v2' }],
  ['greta', 'hero_greta_merchant_detail_v2', { blacksmith: 'hero_greta_blacksmith_detail_v2', alchemist: 'hero_greta_alchemist_detail_v2' }],
  ['teo', 'hero_teo_acolyte_details_v2', { priest: 'hero_teo_priest_detail_v2', monk: 'hero_teo_monk_detail_v2' }],
  ['vika', 'hero_vika_acolyte_details_v2', { priest: 'hero_vika_priest_detail_v2', monk: 'hero_vika_monk_detail_v2' }],
  ['dorn', 'hero_dorn_thief_detail_v2', { assassin: 'hero_dorn_assassin_detail_v2', rogue: 'hero_dorn_rogue_detail_v2' }],
  ['zara', 'hero_zara_thief_detail_v2', { assassin: 'hero_zara_assassin_detail_v2', rogue: 'hero_zara_rogue_detail_v2' }],
];

beforeEach(() => setSpriteLookup(has));
afterEach(() => setSpriteLookup(() => false));

describe('profession release sprite routing', () => {
  for (const [hero, first, branches] of forms) {
    it(`${hero}: first form and each active promotion resolve to their own registered pack`, () => {
      expect(heroSprite(cardHero(ctx, hero), ctx)).toBe(first);
      expect(heroSprite(cardHero(ctx, hero, 40, { rarity: 'purple' }), ctx)).toBe(first);
      expect(heroSprite({ ...cardHero(ctx, hero, 40), branch: 'unknown' }, ctx)).toBe(first);
      for (const [branch, promoted] of Object.entries(branches)) {
        expect(has(promoted), promoted).toBe(true);
        expect(heroSprite(cardHero(ctx, `${hero}/${branch}`, 40, { rarity: 'blue' }), ctx)).toBe(first);
        for (const rarity of ['purple', 'gold', 'red'] as const) {
          const card = cardHero(ctx, `${hero}/${branch}`, 40, { rarity });
          expect(heroSprite(card, ctx)).toBe(promoted);
          expect(portraitSprite('hero', ctx, card)).toBe(promoted);
        }
      }
    });
  }

  it('available novice packs never replace missing first or promoted packs', () => {
    const onlyNovices = (id: string) => id === noviceM || id === noviceF;
    for (const [hero, , branches] of forms) {
      expect(heroSprite(cardHero(ctx, hero), ctx, onlyNovices)).toBe(ctx.content.jobs[ctx.content.heroes[hero].job].visual.sprite);
      for (const branch of Object.keys(branches)) {
        expect(heroSprite(cardHero(ctx, `${hero}/${branch}`, 40), ctx, onlyNovices)).toBe(ctx.content.jobs[branch].visual.sprite);
      }
    }
  });

  it('generic profession and NPC portraits retain the source identities', () => {
    for (const job of Object.values(ctx.content.jobs).filter((j) => j.id !== 'novice')) {
      expect(portraitSprite(job.id, ctx)).toBe(job.visual.sprite);
    }
    expect(portraitSprite('npc_garret', ctx, undefined, 'm')).toBe('npc_garret');
    expect(portraitSprite('unit:missing', ctx)).toBeNull();
    expect(genderedSpriteId('hero_alan_novice', 'm', has)).toBe('hero_alan_novice');
    expect(genderedSpriteId('hero_greta_novice', 'f', has)).toBe('hero_greta_novice');
  });
});

describe('actual novice fallbacks', () => {
  it('resolves male, female and unspecified novice portraits with the runtime registry', () => {
    expect(has(noviceM)).toBe(true);
    expect(has(noviceF)).toBe(true);
    expect(portraitSprite('novice', ctx)).toBe(noviceM);
    expect(portraitSprite('novice', ctx, undefined, 'm')).toBe(noviceM);
    expect(portraitSprite('novice', ctx, undefined, 'f')).toBe(noviceF);
    expect(portraitSprite('novice_m', ctx)).toBe(noviceM);
    expect(portraitSprite('novice_f', ctx)).toBe(noviceF);
    expect(portraitSprite('hero', ctx)).toBe(noviceM);
    expect(portraitSprite('hero', ctx, undefined, 'f')).toBe(noviceF);
    expect(heroSprite(cardHero(ctx, 'missing'), ctx)).toBe(noviceM);
  });

  it('story recruits use their novice gender while recruited heroes use their current form', () => {
    const save = newGame(ctx, 1000);
    expect(speakerView(ctx.story.chapters.chapter1, 'greta', save, ctx)).toMatchObject({ name: 'Грета', gender: 'f', sprite: noviceF });
    expect(speakerView(ctx.story.chapters.chapter1, 'hero1', save, ctx).sprite).toBe('hero_alan_first_profession_detail_v1');
    expect(speakerView(ctx.story.chapters.chapter2, 'hero4', save, ctx).sprite).toBe(noviceF);
    const promoted = { ...save, heroes: [cardHero(ctx, 'greta/alchemist', 40)] };
    expect(speakerView(ctx.story.chapters.chapter2, 'hero4', promoted, ctx).sprite).toBe('hero_greta_alchemist_detail_v2');
  });

  it('falls back to legacy novice assets when the new matching pack is absent', () => {
    const legacy = (id: string) => has(id) && id !== noviceM && id !== noviceF;
    setSpriteLookup(legacy);
    expect(portraitSprite('novice', ctx)).toBe('novice');
    expect(portraitSprite('novice', ctx, undefined, 'f')).toBe('novice_f');
    expect(portraitSprite('novice_f', ctx)).toBe('novice_f');
    expect(portraitSprite('hero', ctx, undefined, 'f')).toBe('novice_f');
    expect(heroSprite(cardHero(ctx, 'missing'), ctx)).toBe('novice');
    expect(genderedSpriteId('novice', 'f', (id) => id === noviceM || id === 'novice_f')).toBe('novice_f');
    expect(genderedSpriteId('novice', 'f', () => false)).toBe('novice');
  });
});
