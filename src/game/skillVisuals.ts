/**
 * Свой вид навыка в бою (без Phaser — проверяется в тестах, из него же собирается аудит docs/content/skills-vfx.md).
 * Рисуют: `skillFx.ts` (примитивы и старые эффекты) и `skillSigs.ts` (рецепты по именам ниже), вызывает `BattleScene`.
 *
 * - `sig` — эффект навыка целиком: рисуется один раз в момент удара/каста (снаряды, площадь, всё на кастере и целях);
 *   рецепт сам решает, когда «попадает» по каждой цели (цифры урона встают под свой удар).
 * - `hit` — особое попадание на каждую цель в момент удара (вместо искры обычного удара).
 * - `aura` — вид баффа/щита/лечения на цели (событие status/buff/heal от этого навыка) вместо общего столба искр.
 * - `proc` — короткая вспышка на кастере при срабатывании пассивки (событие passive).
 * - `tint` — цвет навыка, где цвет стихии не подходит.
 * Навыка нет в таблице — работают общие правила по стихии (`skillLook.ts lookOf`).
 */

/** Навыки со своим видом целиком (рецепты — skillSigs.ts, старые — skillFx.ts). */
export type Signature =
  // старые (skillFx.ts)
  | 'magnum'
  | 'cart'
  | 'bounce'
  | 'provoke'
  | 'roots'
  // мечник, рыцарь, крестоносец
  | 'bowlingBash'
  | 'chargeAttack'
  | 'spiralPierce'
  | 'holyCross'
  | 'shieldCharge'
  | 'grandCross'
  | 'devotion'
  | 'defender'
  // лучник, охотник, бард, танцовщица
  | 'blitzBeat'
  | 'falconAssault'
  | 'ankleSnare'
  | 'claymore'
  | 'sandman'
  | 'musicalStrike'
  | 'slingingArrow'
  | 'scream'
  | 'dontForgetMe'
  | 'fortuneKiss'
  | 'assassinCross'
  // вор, ассасин, разбойник
  | 'venomKnife'
  | 'sonicBlow'
  | 'meteorAssault'
  | 'grimtooth'
  | 'venomSplasher'
  | 'raid'
  | 'stripWeapon'
  | 'backStab'
  | 'stripArmor'
  // торговец, кузнец, алхимик
  | 'fryingPan'
  | 'hammerFall'
  | 'cartTermination'
  | 'weaponPerfection'
  | 'acidTerror'
  | 'demonstration'
  | 'acidBomb'
  | 'slimPotion'
  // маг, волшебник, мудрец
  | 'fireBall'
  | 'coldBolt'
  | 'jupitel'
  | 'meteorStorm'
  | 'frostNova'
  | 'quagmire'
  | 'heavensDrive'
  | 'dispell'
  | 'volcano'
  // аколит, жрец, монах
  | 'signumCrucis'
  | 'angelus'
  | 'impositio'
  | 'magnus'
  | 'lexAeterna'
  | 'assumptio'
  | 'tripleAttack'
  | 'investigate'
  | 'asura'
  | 'bladeStop';

/** Особый вид попадания навыка (на каждую цель, в момент удара) — skillFx.ts skillHit. */
export type SkillHit =
  | 'bash'
  | 'envenom'
  | 'steal'
  | 'sand'
  | 'coins'
  | 'knock'
  | 'ice'
  | 'kick'
  | 'smash'
  | 'roots'
  | 'goo'
  | 'mud'
  | 'bite'
  | 'leap'
  | 'cart'
  | 'fire'
  | 'bounce'
  // пассивки с уроном
  | 'counter'
  | 'double'
  | 'peck'
  | 'gank';

/** Вид баффа/щита/лечения на цели (skillSigs.ts playAura). */
export type Aura =
  | 'endure'
  | 'regen'
  | 'rage'
  | 'bladeGlint'
  | 'parry'
  | 'quicken'
  | 'faith'
  | 'autoGuard'
  | 'devotion'
  | 'bulwark'
  | 'owl'
  | 'vulture'
  | 'focus'
  | 'beast'
  | 'bragi'
  | 'idun'
  | 'song'
  | 'kiss'
  | 'dodge'
  | 'katar'
  | 'plagiarism'
  | 'uproar'
  | 'overcharge'
  | 'pushcart'
  | 'fury'
  | 'temper'
  | 'adrenaline'
  | 'forge'
  | 'potion'
  | 'chemical'
  | 'mana'
  | 'energyCoat'
  | 'safetyWall'
  | 'amplify'
  | 'soulDrain'
  | 'freeCast'
  | 'magicRod'
  | 'volcano'
  | 'divine'
  | 'blessing'
  | 'agi'
  | 'angelus'
  | 'impositio'
  | 'magnificat'
  | 'kyrie'
  | 'assumptio'
  | 'spheres'
  | 'ironHand'
  | 'steelBody';

/** Вспышка на кастере при срабатывании пассивки (skillSigs.ts playProc); цели — из событий того же момента. */
export type Proc = 'flash' | 'falcon' | 'potion' | 'venomEdge' | 'soulDrain' | 'spheres' | 'shout' | 'notes';

export interface SkillVisual {
  sig?: Signature;
  hit?: SkillHit;
  aura?: Aura;
  proc?: Proc;
  /** Цвет proc-вспышки и искр навыка. */
  tint?: number;
}

export const SKILL_VISUALS: Record<string, SkillVisual> = {
  // ---------- мечник ----------
  swordman_bash: { hit: 'bash' },
  swordman_endure: { aura: 'endure', proc: 'flash', tint: 0xff9a50 },
  job_swordman_hp_recovery: { aura: 'regen', proc: 'flash', tint: 0x8dff9a },
  job_swordman_provoke: { sig: 'provoke' },
  job_swordman_magnum_break: { sig: 'magnum' },
  job_swordman_auto_berserk: { aura: 'rage', proc: 'flash', tint: 0xff3a2a },
  // ---------- рыцарь ----------
  job_knight_bowling_bash: { sig: 'bowlingBash', tint: 0xffe0a0 },
  job_knight_auto_counter: { hit: 'counter', proc: 'flash', tint: 0xdff0ff },
  job_knight_parrying: { aura: 'parry', proc: 'flash', tint: 0xe8f4ff },
  job_knight_charge_attack: { sig: 'chargeAttack', tint: 0x9fd8ff },
  job_knight_two_hand_mastery: { aura: 'bladeGlint', proc: 'flash', tint: 0xcfe0ff },
  job_knight_two_hand_quicken: { aura: 'quicken', proc: 'flash', tint: 0xffe45a },
  job_knight_spiral_pierce: { sig: 'spiralPierce', tint: 0xffc060 },
  // ---------- крестоносец ----------
  job_crusader_devotion: { sig: 'devotion', aura: 'devotion', tint: 0xffd860 },
  job_crusader_faith: { aura: 'faith', proc: 'flash', tint: 0xfff0a0 },
  job_crusader_auto_guard: { aura: 'autoGuard', proc: 'flash', tint: 0xcfe0ff },
  job_crusader_defender: { sig: 'defender', aura: 'bulwark', tint: 0xd8e4ff },
  job_crusader_holy_cross: { sig: 'holyCross', tint: 0xfff0a0 },
  job_crusader_shield_charge: { sig: 'shieldCharge', tint: 0xd8e4ff },
  job_crusader_grand_cross: { sig: 'grandCross', tint: 0xffe070 },
  // ---------- вор ----------
  job_thief_envenom: { hit: 'envenom' },
  job_thief_improve_dodge: { aura: 'dodge', proc: 'flash', tint: 0x9fd8ff },
  job_thief_steal: { hit: 'steal' },
  job_thief_double_attack: { hit: 'double', proc: 'flash', tint: 0xe8f0ff },
  job_thief_sand_attack: { hit: 'sand' },
  job_thief_venom_knife: { sig: 'venomKnife', tint: 0x8fe04a },
  // ---------- ассасин ----------
  job_assassin_sonic_blow: { sig: 'sonicBlow', tint: 0xc9a0ff },
  job_assassin_katar_mastery: { aura: 'katar', proc: 'flash', tint: 0xb77aff },
  job_assassin_meteor_assault: { sig: 'meteorAssault', tint: 0xb050ff },
  job_assassin_grimtooth: { sig: 'grimtooth', tint: 0x9a5aff },
  job_assassin_enchant_poison: { proc: 'venomEdge', tint: 0x8fe04a },
  job_assassin_venom_splasher: { sig: 'venomSplasher', tint: 0x7ee03a },
  // ---------- разбойник ----------
  job_rogue_raid: { sig: 'raid', tint: 0x6a5a7a },
  job_rogue_plagiarism: { aura: 'plagiarism', proc: 'flash', tint: 0xc080ff },
  job_rogue_strip_weapon: { sig: 'stripWeapon', tint: 0xff8a6a },
  job_rogue_back_stab: { sig: 'backStab', tint: 0xff4a3a },
  job_rogue_gank: { hit: 'gank', proc: 'flash', tint: 0xffd84a },
  job_rogue_strip_armor: { sig: 'stripArmor', tint: 0xb8c0d0 },
  // ---------- лучник ----------
  job_archer_double_strafe: { tint: 0xffd860 },
  job_archer_owls_eye: { aura: 'owl', proc: 'flash', tint: 0x9be36b },
  job_archer_arrow_shower: { tint: 0xffe7a0 },
  job_archer_vultures_eye: { aura: 'vulture', proc: 'flash', tint: 0xffb04a },
  job_archer_charge_arrow: { hit: 'knock', tint: 0x8fe6ff },
  job_archer_improve_concentration: { aura: 'focus', tint: 0xc8ff6a },
  // ---------- охотник ----------
  job_hunter_blitz_beat: { sig: 'blitzBeat', tint: 0xffe0b0 },
  job_hunter_beast_bane: { aura: 'beast', proc: 'flash', tint: 0xff9a4a },
  job_hunter_steel_crow: { hit: 'peck', proc: 'falcon', tint: 0xd8e4ff },
  job_hunter_falcon_assault: { sig: 'falconAssault', tint: 0xffd060 },
  job_hunter_ankle_snare: { sig: 'ankleSnare', tint: 0xd8d8e0 },
  job_hunter_claymore_trap: { sig: 'claymore', tint: 0xff8a2a },
  job_hunter_sandman: { sig: 'sandman', tint: 0xc8b0ff },
  // ---------- бард, танцовщица ----------
  job_bard_musical_strike: { sig: 'musicalStrike', tint: 0x8fb8ff },
  job_bard_poem_of_bragi: { aura: 'bragi', proc: 'notes', tint: 0x7fd4ff },
  job_bard_apple_of_idun: { aura: 'idun', proc: 'notes', tint: 0x9dff7a },
  job_bard_assassin_cross: { sig: 'assassinCross', aura: 'song', tint: 0xff5a8a },
  job_bard_scream: { sig: 'scream', tint: 0xffa0d0 },
  job_dancer_slinging_arrow: { sig: 'slingingArrow', tint: 0xff8ac8 },
  job_dancer_dont_forget_me: { sig: 'dontForgetMe', tint: 0xb070ff },
  job_dancer_fortune_kiss: { sig: 'fortuneKiss', aura: 'kiss', tint: 0xff7ab0 },
  // ---------- торговец ----------
  job_merchant_mammonite: { hit: 'coins' },
  job_merchant_pushcart: { aura: 'pushcart', proc: 'flash', tint: 0xd8a860 },
  job_merchant_cart_revolution: { sig: 'cart' },
  job_merchant_crazy_uproar: { aura: 'uproar', proc: 'shout', tint: 0xffa040 },
  job_merchant_overcharge: { aura: 'overcharge', proc: 'flash', tint: 0xffd84a },
  job_merchant_frying_pan: { sig: 'fryingPan', tint: 0xfff0d0 },
  // ---------- кузнец ----------
  job_blacksmith_power_thrust: { aura: 'fury', tint: 0xff5a2a },
  job_blacksmith_hammer_fall: { sig: 'hammerFall', tint: 0xffc860 },
  job_blacksmith_cart_termination: { sig: 'cartTermination', tint: 0xffd890 },
  job_blacksmith_tempering: { aura: 'temper', proc: 'flash', tint: 0xff8a2a },
  job_blacksmith_adrenaline_rush: { aura: 'adrenaline', proc: 'flash', tint: 0xff6a3a },
  job_blacksmith_weapon_perfection: { sig: 'weaponPerfection', aura: 'forge', tint: 0xffb040 },
  // ---------- алхимик ----------
  job_alchemist_potion_pitcher: { aura: 'potion', proc: 'potion', tint: 0xff5a5a },
  job_alchemist_chemical_protection: { aura: 'chemical', proc: 'flash', tint: 0xd8ff6a },
  job_alchemist_slim_potion: { sig: 'slimPotion', tint: 0xf4f8ff },
  job_alchemist_acid_terror: { sig: 'acidTerror', tint: 0xc8f040 },
  job_alchemist_demonstration: { sig: 'demonstration', tint: 0xff7a2a },
  job_alchemist_acid_bomb: { sig: 'acidBomb', tint: 0xb8f040 },
  // ---------- маг ----------
  job_mage_fire_bolt: {},
  job_mage_cold_bolt: { sig: 'coldBolt', tint: 0x9fe6ff },
  job_mage_fire_ball: { sig: 'fireBall', tint: 0xff8a20 },
  job_mage_frost_diver: { hit: 'ice' },
  job_mage_sp_recovery: { aura: 'mana', proc: 'flash', tint: 0x6fa8ff },
  job_mage_energy_coat: { aura: 'energyCoat', proc: 'flash', tint: 0x9a8aff },
  job_mage_safety_wall: { aura: 'safetyWall', tint: 0xff9ae0 },
  // ---------- волшебник ----------
  job_wizard_jupitel_thunder: { sig: 'jupitel', tint: 0xffe45a },
  job_wizard_mystical_amplification: { aura: 'amplify', proc: 'flash', tint: 0xc080ff },
  job_wizard_soul_drain: { aura: 'soulDrain', proc: 'soulDrain', tint: 0xb77aff },
  job_wizard_meteor_storm: { sig: 'meteorStorm', tint: 0xff7a2a },
  job_wizard_frost_nova: { sig: 'frostNova', tint: 0xbfeaff },
  job_wizard_quagmire: { sig: 'quagmire', tint: 0x8a6a3a },
  // ---------- мудрец ----------
  job_sage_earth_spike: { tint: 0xd89a4a },
  job_sage_free_cast: { aura: 'freeCast', proc: 'flash', tint: 0x5ae8d0 },
  job_sage_heavens_drive: { sig: 'heavensDrive', tint: 0xd89a4a },
  job_sage_dispell: { sig: 'dispell', tint: 0xe0c8ff },
  job_sage_magic_rod: { aura: 'magicRod', proc: 'flash', tint: 0xa878ff },
  job_sage_volcano: { sig: 'volcano', aura: 'volcano', tint: 0xff6a20 },
  // ---------- аколит ----------
  job_acolyte_heal: {},
  job_acolyte_divine_protection: { aura: 'divine', proc: 'flash', tint: 0xfff4c8 },
  job_acolyte_blessing: { aura: 'blessing', tint: 0xffd84a },
  job_acolyte_increase_agi: { aura: 'agi', tint: 0x7fd4ff },
  job_acolyte_signum_crucis: { sig: 'signumCrucis', tint: 0xfff0a0 },
  job_acolyte_angelus: { sig: 'angelus', aura: 'angelus', tint: 0xfff8d8 },
  // ---------- жрец ----------
  job_priest_impositio_manus: { sig: 'impositio', aura: 'impositio', tint: 0xffe070 },
  job_priest_magnificat: { aura: 'magnificat', proc: 'flash', tint: 0xb8d8ff },
  job_priest_magnus_exorcismus: { sig: 'magnus', tint: 0xf0e0ff },
  job_priest_lex_aeterna: { sig: 'lexAeterna', tint: 0xff6a4a },
  job_priest_kyrie_eleison: { aura: 'kyrie', tint: 0xdff4ff },
  job_priest_sanctuary: {},
  job_priest_assumptio: { sig: 'assumptio', aura: 'assumptio', tint: 0xffb8d8 },
  // ---------- монах ----------
  job_monk_triple_attack: { sig: 'tripleAttack', tint: 0xffb050 },
  job_monk_call_spirits: { aura: 'spheres', proc: 'spheres', tint: 0xffe070 },
  job_monk_investigate: { sig: 'investigate', tint: 0x9fd8ff },
  job_monk_asura_strike: { sig: 'asura', tint: 0xffd84a },
  job_monk_blade_stop: { sig: 'bladeStop', tint: 0xe8f0ff },
  job_monk_iron_hand: { aura: 'ironHand', proc: 'flash', tint: 0xff9a40 },
  job_monk_steel_body: { aura: 'steelBody', tint: 0xc8d0dc },
  // ---------- монстры ----------
  mob_rocker_kick: { hit: 'kick' },
  mob_elite_smash: { hit: 'smash' },
  mob3_elite_cleave: { hit: 'smash' },
  mob_poporing_goo: { hit: 'goo' },
  mob2_fast_mud_splash: { hit: 'mud' },
  mob_mastering_sticky_slam: { hit: 'bounce' },
  mob_mastering_royal_bounce: { sig: 'bounce' },
  mob_mandragora_roots: { sig: 'roots' },
  mob2_melee_bite: { hit: 'bite' },
  mob_lunatic_leap: { hit: 'leap' },
  mob_eclipse_moon_leap: { hit: 'leap' },
  mob_fast_lunge: { hit: 'leap' },
  mob3_fast_haunt: { hit: 'leap' },
  assassin_leap: { hit: 'leap' },
};

export const visualOf = (id: string | undefined): SkillVisual | undefined => (id ? SKILL_VISUALS[id] : undefined);

/**
 * Навыки, которые рисуются «своим» снарядом/площадью из skillLook (FX_OVERRIDE) или огненной стрелой — у них в таблице
 * только цвет; для аудита и тестов считаются своим видом.
 */
export const OWN_BY_LOOK = new Set([
  'job_mage_fire_bolt',
  'job_mage_thunderstorm',
  'job_acolyte_holy_light',
  'job_priest_sanctuary',
  'job_archer_arrow_shower',
  'job_archer_double_strafe',
  'job_archer_charge_arrow',
  'job_wizard_storm_gust',
  'job_sage_earth_spike',
  'job_acolyte_heal',
  'job_mage_frost_diver',
]);
