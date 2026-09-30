import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRegistry } from '../src/pipeline/sprites';
import { loadFullContext, ROOT } from '../scripts/lib/content-node';
import { collectUsedAssets, listAssetFiles, usedAssets } from '../scripts/lib/used-assets';

const json = (rel: string) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

describe('O: used assets (что попадает в dist)', () => {
  const used = collectUsedAssets(ROOT);
  const files = new Set(used.files);

  it('включает каждый файл из assets/manifest.json (file и atlasXml)', () => {
    const manifest = json('assets/manifest.json') as { assets: Record<string, { file?: string | null; atlasXml?: string }> };
    for (const a of Object.values(manifest.assets)) {
      if (!a.file) continue;
      expect(files).toContain(a.file);
      if (a.atlasXml) expect(files).toContain(a.atlasXml);
    }
  });

  it('включает все 73 анимированных FX (у каждого свой лист; 30.09 — +31 оригинальный атлас RO из клиента scRO) в сборку при наличии статических fallback в манифесте', () => {
    const catalog = json('assets/effects/effects.json') as { effects: { id: string; file: string }[] };
    expect(catalog.effects.map((effect) => effect.id).sort()).toEqual([
      'fx_arrow', 'fx_death', 'fx_heal', 'fx_hit', 'fx_job_acolyte_angelus', 'fx_job_acolyte_blessing',
      'fx_job_acolyte_holy_light', 'fx_job_acolyte_increase_agi', 'fx_job_acolyte_signum_crucis',
      'fx_job_alchemist_acid_terror_projectile', 'fx_job_alchemist_demonstration',
      'fx_job_archer_arrow_shower_source', 'fx_job_archer_improve_concentration', 'fx_job_assassin_grimtooth',
      'fx_job_assassin_sonic_blow', 'fx_job_assassin_venom_splasher', 'fx_job_blacksmith_adrenaline_rush',
      'fx_job_blacksmith_hammer_fall', 'fx_job_blacksmith_weapon_perfection', 'fx_job_crusader_defender',
      'fx_job_crusader_devotion', 'fx_job_crusader_grand_cross', 'fx_job_crusader_holy_cross',
      'fx_job_crusader_shield_charge', 'fx_job_hunter_ankle_snare', 'fx_job_hunter_claymore_trap',
      'fx_job_hunter_sandman', 'fx_job_knight_auto_counter', 'fx_job_knight_bowling_bash', 'fx_job_knight_parrying',
      'fx_job_knight_two_hand_quicken', 'fx_job_mage_cold_bolt', 'fx_job_mage_fire_ball_projectile',
      'fx_job_mage_fire_bolt', 'fx_job_mage_frost_diver', 'fx_job_mage_frost_diver_spikes', 'fx_job_mage_safety_wall',
      'fx_job_mage_thunderstorm', 'fx_job_merchant_cart_revolution', 'fx_job_merchant_crazy_uproar',
      'fx_job_merchant_mammonite', 'fx_job_priest_assumptio', 'fx_job_priest_impositio_manus',
      'fx_job_priest_kyrie_eleison', 'fx_job_priest_lex_aeterna', 'fx_job_priest_magnificat',
      'fx_job_priest_magnus_exorcismus', 'fx_job_rogue_strip_armor', 'fx_job_rogue_strip_weapon',
      'fx_job_sage_dispell', 'fx_job_sage_earth_spike', 'fx_job_sage_heavens_drive', 'fx_job_sage_volcano_ground',
      'fx_job_swordman_magnum_break', 'fx_job_swordman_provoke', 'fx_job_thief_envenom', 'fx_job_thief_steal',
      'fx_job_thief_venom_knife_projectile', 'fx_job_wizard_jupitel_thunder_projectile',
      'fx_job_wizard_jupitel_thunder_target', 'fx_job_wizard_meteor_storm', 'fx_job_wizard_soul_drain',
      'fx_job_wizard_storm_gust', 'fx_magic', 'fx_npc_dark_strike', 'fx_npc_defender', 'fx_npc_earthquake',
      'fx_npc_keeping', 'fx_npc_poison', 'fx_npc_stun_attack', 'fx_shield', 'fx_swordman_bash', 'fx_swordman_endure',
    ]);
    for (const effect of catalog.effects) expect(files).toContain(effect.file);
  });

  it('включает лист и портрет каждого спрайта, на который ссылается контент', () => {
    const ctx = loadFullContext();
    const registry = buildRegistry(json('assets/sprites.legacy.json'), json('assets/sprites/sprites.json'));
    const ids = [...Object.values(ctx.content.units), ...Object.values(ctx.content.jobs)].map((x) => x.visual.sprite);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const s = registry[id];
      if (!s) {
        expect(used.missingSprites).toContain(id);
        continue;
      }
      expect(files).toContain(s.file);
      if (s.portrait) expect(files).toContain(s.portrait);
    }
  });

  it('не берёт огромные старые листы монстров, на которые контент не ссылается', () => {
    expect(files).not.toContain('ro/sheets/enemy_boss_ch6.png');
    expect(files).not.toContain('ro/sheets/enemy_melee.png');
    expect(files).not.toContain('ro/README.md');
    expect(files).not.toContain('manifest.json');
  });

  it('включает бюсты RO для портретов в рамке (диалоги, смена профессии)', () => {
    expect(files).toContain('ro/portraits/hero_warrior_portrait.png');
    expect(files).toContain('ro/portraits/hero_priestess_portrait.png');
    expect(files).not.toContain('ro/stills/hero_warrior_battle.png');
  });

  it('включает иконки и картинки предметов RO и атлас цифр урона', () => {
    // У каждого предмета игры есть иконка RO (иначе в ячейке — запасной силуэт).
    for (const id of Object.keys(loadFullContext().equipment.items)) expect(files).toContain(`ui/icons/item_${id}.png`);
    for (const f of ['ui/icons/item_knife.png', 'ui/icons/item_gold.png', 'ui/collection/item_knife.png', 'fx/damage/numbers.png']) expect(files).toContain(f);
  });

  it('все нужные файлы лежат на диске', () => {
    const present = new Set(listAssetFiles(ROOT));
    expect(used.files.filter((f) => !present.has(f))).toEqual([]);
  });

  it('v2 перекрывает legacy по id; неизвестный спрайт — в missingSprites', () => {
    const r = usedAssets({
      manifest: { assets: { a: { file: 'ui/a.png' }, b: { file: null } } },
      legacy: { sprites: [{ id: 'x', file: 'ro/old.png', cell: [1, 1], anchor: [0, 0], columns: 1, scale: 1, anims: {}, portrait: 'ro/p.png' }] },
      v2: {
        schema: 2,
        columns: 1,
        classes: { hero: { cell: [1, 1], anchor: [0, 0], anims: ['idle'] } },
        anims: { idle: { frames: 1, ms: 100 } },
        sprites: [{ id: 'x', class: 'hero', file: 'sprites/x.png' }],
      },
      spriteIds: ['x', 'nope'],
    });
    expect(r.files).toEqual(['sprites/x.png', 'ui/a.png']);
    expect(r.missingSprites).toEqual(['nope']);
  });
});
