import { describe, expect, it } from 'vitest';
import catalogJson from '../assets/effects/effects.json';

/**
 * Правило (жалоба владельца 30.09 «Маммонит — это большой мешок над головой»): атлас RO получает только навык, чей это
 * ОРИГИНАЛЬНЫЙ эффект в клиенте RO. Прошлые агенты подставляли чужие атласы (Маммонит — кража, Удар Асуры — Клеймор,
 * Стальное тело — Защита крестоносца…). Здесь — белый список: навык игры → навык RO (skill_db rAthena) → id эффектов
 * клиента, которые этот навык RO действительно показывает (roBrowser `src/DB/Skills/SkillEffect.js`: effectId,
 * effectIdOnCaster, hitEffectId, beforeHitEffectId, successEffectId, groundEffectId; `str_*` / `sprite …` — файлы клиента
 * без записи в roBrowser). Атлас с другим `source.roEffectId` — подстановка, тест падает.
 *
 * У монстров навыков RO нет — разрешены эффекты монстровых навыков клиента (NPC_*) того же смысла (яд → NPC_POISON 192,
 * щит себе → NPC_DEFENDER 213, оглушающий удар → NPC_STUNATTACK 194…) и навык игрока, который RO сам даёт монстрам
 * (NPC_AGIUP = AL_INCAGI, Тёмный лорд — WZ_METEOR).
 *
 * Новая привязка в effects.json → skills: сперва строка сюда (с навыком RO), потом атлас. Список извлечения — docs/RO_EFFECTS_EXTRACT.md.
 */
const RO_ORIGIN: Record<string, { ro: string; fx: string[] }> = {
  // Мечник, Рыцарь, Крестоносец
  swordman_bash: { ro: 'SM_BASH', fx: ['16', '1'] },
  swordman_endure: { ro: 'SM_ENDURE', fx: ['11'] },
  job_swordman_magnum_break: { ro: 'SM_MAGNUM', fx: ['17'] },
  job_swordman_provoke: { ro: 'SM_PROVOKE', fx: ['67'] },
  job_knight_bowling_bash: { ro: 'KN_BOWLINGBASH', fx: ['149', '1'] },
  job_knight_two_hand_quicken: { ro: 'KN_TWOHANDQUICKEN', fx: ['130'] },
  job_knight_parrying: { ro: 'LK_PARRYING', fx: ['336'] },
  job_knight_auto_counter: { ro: 'KN_AUTOCOUNTER', fx: ['131', 'str_autocounter'] },
  job_crusader_defender: { ro: 'CR_DEFENDER', fx: ['222'] },
  job_crusader_grand_cross: { ro: 'CR_GRANDCROSS', fx: ['226'] },
  job_crusader_holy_cross: { ro: 'CR_HOLYCROSS', fx: ['245'] },
  job_crusader_shield_charge: { ro: 'CR_SHIELDCHARGE', fx: ['246'] },
  job_crusader_auto_guard: { ro: 'CR_AUTOGUARD', fx: ['336'] },
  job_crusader_devotion: { ro: 'CR_DEVOTION', fx: ['251'] },
  // Вор, Ассасин, Разбойник
  job_thief_envenom: { ro: 'TF_POISON', fx: ['20'] },
  job_thief_steal: { ro: 'TF_STEAL', fx: ['18'] },
  // Грабёж (RG_SNATCHER) в RO крадёт через TF_STEAL — клиент показывает эффект Кражи.
  job_rogue_gank: { ro: 'RG_SNATCHER → TF_STEAL', fx: ['18'] },
  job_rogue_strip_weapon: { ro: 'RG_STRIPWEAPON', fx: ['269'] },
  job_rogue_strip_armor: { ro: 'RG_STRIPARMOR', fx: ['271'] },
  job_thief_venom_knife: { ro: 'AS_VENOMKNIFE', fx: ['600'] },
  job_assassin_sonic_blow: { ro: 'AS_SONICBLOW', fx: ['121', '143', '122'] },
  job_assassin_grimtooth: { ro: 'AS_GRIMTOOTH', fx: ['123', '132'] },
  job_assassin_enchant_poison: { ro: 'AS_ENCHANTPOISON', fx: ['20'] },
  job_assassin_venom_splasher: { ro: 'AS_SPLASHER', fx: ['129'] },
  // Лучник, Охотник
  job_archer_arrow_shower: { ro: 'AC_SHOWER', fx: ['ef_arrow_shower_projectile'] },
  job_archer_improve_concentration: { ro: 'AC_CONCENTRATION', fx: ['153'] },
  job_hunter_claymore_trap: { ro: 'HT_CLAYMORETRAP', fx: ['107'] },
  job_hunter_sandman: { ro: 'HT_SANDMAN', fx: ['139'] },
  job_hunter_ankle_snare: { ro: 'HT_ANKLESNARE', fx: ['ef_anklesnare', 'ef_trap_01'] },
  // Маг, Волшебник, Мудрец
  job_mage_fire_bolt: { ro: 'MG_FIREBOLT', fx: ['ef_firebolt', '49'] },
  job_mage_fire_ball: { ro: 'MG_FIREBALL', fx: ['24', '49'] },
  job_mage_cold_bolt: { ro: 'MG_COLDBOLT', fx: ['ef_coldbolt', '51'] },
  job_mage_frost_diver: { ro: 'MG_FROSTDIVER', fx: ['27', '28'] },
  job_mage_thunderstorm: { ro: 'MG_THUNDERSTORM', fx: ['30', '52'] },
  job_mage_energy_coat: { ro: 'MG_ENERGYCOAT', fx: ['169'] },
  job_mage_safety_wall: { ro: 'MG_SAFETYWALL', fx: ['315'] },
  job_wizard_jupitel_thunder: { ro: 'WZ_JUPITEL', fx: ['93', '94'] },
  job_wizard_meteor_storm: { ro: 'WZ_METEOR', fx: ['92', '49'] },
  job_wizard_storm_gust: { ro: 'WZ_STORMGUST', fx: ['89', '51'] },
  // Кольцо мороза: в RO effectIdOnCaster 28 — тот же ледяной кристалл, что у Frost Diver.
  job_wizard_frost_nova: { ro: 'WZ_FROSTNOVA', fx: ['28', '51'] },
  job_wizard_soul_drain: { ro: 'HW_SOULDRAIN', fx: ['217'] },
  job_sage_earth_spike: { ro: 'WZ_EARTHSPIKE', fx: ['79', '147'] },
  job_sage_volcano: { ro: 'SA_VOLCANO', fx: ['239'] },
  job_sage_dispell: { ro: 'SA_DISPELL', fx: ['235'] },
  // Послушник, Священник
  job_acolyte_blessing: { ro: 'AL_BLESSING', fx: ['42'] },
  job_acolyte_holy_light: { ro: 'AL_HOLYLIGHT', fx: ['152'] },
  job_acolyte_increase_agi: { ro: 'AL_INCAGI', fx: ['37'] },
  job_acolyte_signum_crucis: { ro: 'AL_CRUCIS', fx: ['40'] },
  job_acolyte_angelus: { ro: 'AL_ANGELUS', fx: ['41'] },
  job_priest_impositio_manus: { ro: 'PR_IMPOSITIO', fx: ['84'] },
  job_priest_lex_aeterna: { ro: 'PR_LEXAETERNA', fx: ['85'] },
  job_priest_kyrie_eleison: { ro: 'PR_KYRIE', fx: ['112'] },
  job_priest_magnificat: { ro: 'PR_MAGNIFICAT', fx: ['76'] },
  job_priest_assumptio: { ro: 'HP_ASSUMPTIO', fx: ['440'] },
  // Та же HP_ASSUMPTIO: продвинутая форма использует существующий подтверждённый EF440.
  ro_high_priest_assumptio: { ro: 'HP_ASSUMPTIO', fx: ['440'] },
  job_priest_magnus_exorcismus: { ro: 'PR_MAGNUS', fx: ['113', '152', '318'] },
  // Торговец, Кузнец, Алхимик
  job_merchant_mammonite: { ro: 'MC_MAMMONITE', fx: ['10'] },
  job_merchant_cart_revolution: { ro: 'MC_CARTREVOLUTION', fx: ['170'] },
  job_merchant_crazy_uproar: { ro: 'MC_LOUD', fx: ['311'] },
  job_blacksmith_hammer_fall: { ro: 'BS_HAMMERFALL', fx: ['102'] },
  job_blacksmith_weapon_perfection: { ro: 'BS_WEAPONPERFECT', fx: ['103'] },
  job_blacksmith_adrenaline_rush: { ro: 'BS_ADRENALINE', fx: ['98', 'str_adrenaline'] },
  job_alchemist_acid_terror: { ro: 'AM_ACIDTERROR', fx: ['298'] },
  job_alchemist_demonstration: { ro: 'AM_DEMONSTRATION', fx: ['302', 'sprite 데몬스트레이션'] },

  // Ульты героев (01.10, docs/design/battle-decisions.md §1): усиленные формы навыков RO — эффект того же навыка RO.
  ult_alan_magnum_break: { ro: 'SM_MAGNUM', fx: ['17'] },
  ult_alan_grand_cross: { ro: 'CR_GRANDCROSS', fx: ['226'] },
  ult_iris_fatal_bash: { ro: 'SM_BASH (Fatal Blow)', fx: ['16', '1'] },
  ult_iris_bowling_bash: { ro: 'KN_BOWLINGBASH', fx: ['149', '1'] },
  ult_iris_defender: { ro: 'CR_DEFENDER', fx: ['222'] },
  ult_bran_claymore: { ro: 'HT_CLAYMORETRAP', fx: ['107'] },
  ult_dorn_envenom: { ro: 'TF_POISON', fx: ['20'] },
  ult_dorn_venom_splasher: { ro: 'AS_SPLASHER', fx: ['129'] },
  ult_zara_sonic_blow: { ro: 'AS_SONICBLOW', fx: ['121', '143', '122'] },
  ult_zara_strip_weapon: { ro: 'RG_STRIPWEAPON', fx: ['269'] },
  ult_greta_cart_revolution: { ro: 'MC_CARTREVOLUTION', fx: ['170'] },
  ult_greta_adrenaline_rush: { ro: 'BS_ADRENALINE', fx: ['98', 'str_adrenaline'] },
  ult_otto_loud: { ro: 'MC_LOUD', fx: ['311'] },
  ult_otto_hammer_fall: { ro: 'BS_HAMMERFALL', fx: ['102'] },
  ult_lira_frost_nova: { ro: 'WZ_FROSTNOVA', fx: ['28', '51'] },
  ult_lira_storm_gust: { ro: 'WZ_STORMGUST', fx: ['89', '51'] },
  ult_teo_angelus: { ro: 'AL_ANGELUS', fx: ['41'] },
  ult_teo_kyrie: { ro: 'PR_KYRIE', fx: ['112'] },
  ult_vika_magnus: { ro: 'PR_MAGNUS', fx: ['113', '152', '318'] },
  // 01.10, вторая партия сырья (raw/ro/BATCH_2026-10-01.md, raw/ro-build/tools/fx/build_ro_fx.py — рендер STR/SPR/3D без EffectViewer).
  ult_vika_asura: { ro: 'MO_EXTREMITYFIST', fx: ['328', '510', '266'] },
  ult_kai_lord_of_vermillion: { ro: 'WZ_VERMILION', fx: ['90', '52'] },
  ult_kai_fire_wall: { ro: 'MG_FIREWALL', fx: ['25', '49'] },
  ult_alan_brandish_spear: { ro: 'KN_BRANDISHSPEAR', fx: ['70', '144'] },
  // Удар сокола / Атака сокола: roBrowser играет только звук (115 / 387), в клиенте — спрайт сокола data/sprite/이팩트/매.
  ult_meilin_blitz_beat: { ro: 'HT_BLITZBEAT', fx: ['sprite 매'] },
  ult_dorn_close_confine: { ro: 'RG_CLOSECONFINE', fx: ['604'] },
  ult_meilin_service_for_you: { ro: 'DC_SERVICEFORYOU', fx: ['294_ground'] },
  // Метание зелья: EF_THROWITEM2 299 в roBrowser нет — STR брызг зелья из клиента (빨간포션.str).
  ult_greta_potion_rain: { ro: 'AM_POTIONPITCHER', fx: ['str_빨간포션'] },
  // Морская сфера: навык призывает монстра Marine Sphere — его спрайт (вращение и смерть-взрыв).
  ult_otto_sphere_mine: { ro: 'AM_SPHEREMINE', fx: ['sprite marine_sphere'] },
  ult_kai_spell_breaker: { ro: 'SA_SPELLBREAKER', fx: ['234'] },
  ult_lira_deluge: { ro: 'SA_DELUGE', fx: ['240'] },
  job_monk_asura_strike: { ro: 'MO_EXTREMITYFIST', fx: ['328', '510', '266'] },
  job_hunter_blitz_beat: { ro: 'HT_BLITZBEAT', fx: ['sprite 매'] },
  job_hunter_falcon_assault: { ro: 'SN_FALCONASSAULT', fx: ['sprite 매'] },
  job_assassin_meteor_assault: { ro: 'ASC_METEORASSAULT', fx: ['409'] },
  job_sage_heavens_drive: { ro: 'WZ_HEAVENDRIVE', fx: ['142', '147'] },
  job_priest_sanctuary: { ro: 'PR_SANCTUARY', fx: ['83', '319'] },
  job_sage_magic_rod: { ro: 'SA_MAGICROD', fx: ['244'] },
  job_wizard_quagmire: { ro: 'WZ_QUAGMIRE', fx: ['95'] },
  // Проникающий удар: roBrowser играет только звук 267, в клиенте — спрайт data/sprite/이팩트/침투경_.
  job_monk_investigate: { ro: 'MO_INVESTIGATE', fx: ['sprite 침투경_'] },

  // Монстры: эффекты монстровых навыков клиента (NPC_*) по смыслу.
  mob2_boss_rot_spores: { ro: 'NPC_POISON', fx: ['192'] },
  mob2_melee_bite: { ro: 'NPC_POISON', fx: ['192'] },
  mob2_ranged_poison_arrow: { ro: 'NPC_POISON', fx: ['192'] },
  maze_side_winder_venom: { ro: 'NPC_POISON', fx: ['192'] },
  mob4_scorpion_sting: { ro: 'NPC_POISON', fx: ['192'] },
  mob_poporing_goo: { ro: 'NPC_POISON', fx: ['192'] },
  orc_zombie_grave_bite: { ro: 'NPC_POISON', fx: ['192'] },
  sewer_plankton_spit: { ro: 'NPC_POISON', fx: ['192'] },
  mob_boss2_curse: { ro: 'NPC_POISON', fx: ['192'] },
  guard_shield_wall: { ro: 'NPC_DEFENDER', fx: ['213'] },
  mob_tank_guard: { ro: 'NPC_DEFENDER', fx: ['213'] },
  mob3_tank_guard: { ro: 'NPC_DEFENDER', fx: ['213'] },
  mob2_tank_mire: { ro: 'NPC_DEFENDER', fx: ['213'] },
  mob6_tank_shell: { ro: 'NPC_DEFENDER', fx: ['213'] },
  mob5_munak_talisman: { ro: 'NPC_DEFENDER', fx: ['213'] },
  mob4_boss_wrappings: { ro: 'NPC_DEFENDER', fx: ['213'] },
  orc_high_war_hide: { ro: 'NPC_DEFENDER', fx: ['213'] },
  alde_owl_baron_wings: { ro: 'NPC_DEFENDER', fx: ['213'] },
  maze_ghostring_fade: { ro: 'NPC_DEFENDER', fx: ['213'] },
  mob4_sandman_sand_wall: { ro: 'NPC_DEFENDER', fx: ['213'] },
  mob7_bridge_warden_ward: { ro: 'NPC_DEFENDER', fx: ['213'] },
  mob_pupa_harden: { ro: 'NPC_DEFENDER', fx: ['213'] },
  sewer_bug_egg_shell: { ro: 'NPC_DEFENDER', fx: ['213'] },
  alde_keeper_winding: { ro: 'NPC_DEFENDER', fx: ['213'] },
  maze_baphomet_bargain: { ro: 'NPC_DEFENDER', fx: ['213'] },
  mob5_boss_moon_veil: { ro: 'NPC_DEFENDER', fx: ['213'] },
  mob7_boss_bell_ward: { ro: 'NPC_DEFENDER', fx: ['213'] },
  alde_clock_pendulum: { ro: 'NPC_STUNATTACK', fx: ['194'] },
  alde_keeper_hands: { ro: 'NPC_STUNATTACK', fx: ['194'] },
  alde_mimic_snap: { ro: 'NPC_STUNATTACK', fx: ['194'] },
  mob3_elite_cleave: { ro: 'NPC_STUNATTACK', fx: ['194'] },
  mob5_bongun_hop: { ro: 'NPC_STUNATTACK', fx: ['194'] },
  mob6_bosun_anchor: { ro: 'NPC_STUNATTACK', fx: ['194'] },
  mob6_elite_tentacles: { ro: 'NPC_STUNATTACK', fx: ['194'] },
  mob7_tank_noose: { ro: 'NPC_STUNATTACK', fx: ['194'] },
  mob_rocker_kick: { ro: 'NPC_STUNATTACK', fx: ['194'] },
  orc_skeleton_ancestor_blow: { ro: 'NPC_STUNATTACK', fx: ['194'] },
  maze_stem_worm_grip: { ro: 'NPC_STUNATTACK', fx: ['194'] },
  mob_mastering_jelly_armor: { ro: 'NPC_KEEPING', fx: ['214'] },
  mob_elite_smash: { ro: 'NPC_STUNATTACK', fx: ['194'] },
  maze_scribe_seal: { ro: 'NPC_STUNATTACK', fx: ['194'] },
  mob7_boss_dark_chains: { ro: 'NPC_STUNATTACK', fx: ['194'] },
  mvp_pharaoh_grasp: { ro: 'NPC_STUNATTACK', fx: ['194'] },
  mob3_boss_nova: { ro: 'NPC_DARKSTRIKE', fx: ['451'] },
  mob_boss1_quake: { ro: 'NPC_EARTHQUAKE', fx: ['666', 'sprite 어스퀘이크'] },
  mage_firestorm: { ro: 'NPC_FIREATTACK', fx: ['49'] },
  mob5_horong_foxfire: { ro: 'NPC_FIREATTACK', fx: ['49'] },
  mob6_bosun_all_hands: { ro: 'NPC_AGIUP (= AL_INCAGI)', fx: ['37'] },
  mob4_isis_blessing: { ro: 'AL_BLESSING', fx: ['42'] },
  // Тёмный лорд в RO сам колдует Метеоритный дождь.
  mob7_boss_meteor_storm: { ro: 'WZ_METEOR', fx: ['92', '49'] },
};

type Catalog = { effects: { id: string; source?: { kind?: string; roEffectId?: string } }[]; skills: Record<string, Record<string, string>> };
const catalog = catalogJson as unknown as Catalog;
const roOf = new Map(catalog.effects.map((e) => [e.id, e.source?.roEffectId]));
const original = new Set(catalog.effects.filter((e) => e.source?.kind === 'original').map((e) => e.id));

describe('эффекты навыков — только оригинальные эффекты RO (без подстановок)', () => {
  it('сигнатуры без подтверждённого атласа используют процедурный эффект, без чужих RO захватов', () => {
    for (const id of ['ro_paladin_pressure', 'ro_high_wizard_mystical_amplification',
      'ro_professor_mind_breaker', 'ro_assassin_cross_soul_breaker',
      'ro_whitesmith_cart_termination', 'ro_creator_acid_demonstration']) {
      expect(catalog.skills[id], id).toEqual({});
    }
    expect(catalog.skills.ro_high_priest_assumptio).toEqual({ buff: 'fx_job_priest_assumptio' });
  });
  it('каждая привязка effects.json → skills есть в белом списке и атлас — эффект этого навыка RO', () => {
    const bad: string[] = [];
    for (const [skill, roles] of Object.entries(catalog.skills)) {
      // Chronoworld-authored veteran signatures explicitly are not RO captures.
      if (Object.values(roles).every((fx) => original.has(fx))) continue;
      const origin = RO_ORIGIN[skill];
      if (!origin) {
        bad.push(`${skill}: нет в RO_ORIGIN (какой навык RO?)`);
        continue;
      }
      for (const [role, fx] of Object.entries(roles)) {
        const ro = roOf.get(fx);
        if (!ro || !origin.fx.includes(ro)) bad.push(`${skill}.${role} = ${fx} (эффект RO ${ro}) — не эффект ${origin.ro}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('жалобы владельца: Маммонит — мешок с деньгами EF_COIN 10, чужие атласы сняты', () => {
    expect(catalog.skills.job_merchant_mammonite).toEqual({ hit: 'fx_job_merchant_mammonite' });
    expect(roOf.get('fx_job_merchant_mammonite')).toBe('10');
    // Своего эффекта у нас пока нет — процедурный эффект, а не чужая картинка.
    // Удар Асуры, Метеоритный удар и Небесный удар с 01.10 — свои эффекты RO (328/266, 409, 147); Стальное тело, Мощный
    // удар и Удар тележкой в клиенте картинки не имеют (только звук / код клиента) — процедурный вид.
    for (const id of ['job_monk_steel_body', 'job_blacksmith_power_thrust', 'ult_zara_sand_attack', 'ult_bran_frost_joker',
      'ult_teo_ki_explosion', 'ult_meilin_arrow_vulcan', 'job_blacksmith_cart_termination', 'sewer_golden_bug_coin_rain',
      'mob6_boss_ghost_cannons']) {
      expect(catalog.skills[id], id).toBeUndefined();
    }
    expect(catalog.skills.job_mage_cold_bolt).toEqual({ hit: 'fx_job_mage_cold_bolt' });
    expect(catalog.skills.job_thief_venom_knife).toEqual({ projectile: 'fx_job_thief_venom_knife_projectile' });
  });
});
