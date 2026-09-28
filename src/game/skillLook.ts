/**
 * Как выглядит навык: стихия, значок и эффекты в бою. В данных навыка стихии нет — выводим её из id
 * (имена навыков RO: fire_bolt, frost_diver, thunderstorm…), эффектов и цели. Без Phaser — проверяется в тестах.
 */
import type { SkillDef, StatusDef } from '../core';

export type Element = 'fire' | 'ice' | 'wind' | 'earth' | 'holy' | 'poison' | 'dark' | 'neutral' | 'physical';

export type Glyph =
  | 'cross'
  | 'shield'
  | 'up'
  | 'haste'
  | 'guard'
  | 'down'
  | 'bang'
  | 'stars'
  | 'flame'
  | 'snow'
  | 'bolt'
  | 'spike'
  | 'holy'
  | 'drop'
  | 'skull'
  | 'orb'
  | 'arrow'
  | 'arrows'
  | 'sword'
  | 'slashes'
  | 'sweep'
  | 'dash'
  | 'fist'
  | 'coin'
  | 'note'
  | 'trap'
  | 'bird'
  | 'pan';

/** Снаряд навыка от кастера к цели. */
export type Projectile = 'fireball' | 'ice' | 'lightning' | 'beam' | 'poison' | 'dark' | 'arcane' | 'arrow' | 'meteor' | 'rock';
/** Эффект по площади. */
export type Area = 'lightning' | 'ring' | 'arrows' | 'blizzard' | 'holy' | 'quake' | 'cloud' | 'sanctuary';

export interface SkillLook {
  element: Element;
  glyph: Glyph;
  /** Навык по всем целям (на значке — лучи за символом). */
  aoe: boolean;
  passive: boolean;
  projectile?: Projectile;
  area?: Area;
}

/** Цвета стихий: основной (свечение, частицы), светлый (цифры, блик) и тёмный (фон значка). */
export const ELEMENT_COLORS: Record<Element, { main: number; light: string; dark: string; css: string }> = {
  fire: { main: 0xff7a2a, light: '#ffc27a', dark: '#5a1606', css: '#ff7a2a' },
  ice: { main: 0x6fd6ff, light: '#c8f0ff', dark: '#0d2f5a', css: '#6fd6ff' },
  wind: { main: 0xffe45a, light: '#fff3a8', dark: '#2c2a6a', css: '#ffe45a' },
  earth: { main: 0xd89a4a, light: '#f0cf9a', dark: '#3a2410', css: '#d89a4a' },
  holy: { main: 0xfff0a0, light: '#fffbe0', dark: '#6a4c12', css: '#fff0a0' },
  poison: { main: 0x8fe04a, light: '#cff5a0', dark: '#1b3a0c', css: '#8fe04a' },
  dark: { main: 0xb77aff, light: '#e0c8ff', dark: '#26103e', css: '#b77aff' },
  neutral: { main: 0x9aa8ff, light: '#d4dbff', dark: '#1e2350', css: '#9aa8ff' },
  physical: { main: 0xc0784a, light: '#fff0d0', dark: '#2e140c', css: '#e8c890' },
};

/** Ключевые слова id → стихия (порядок важен: первое совпадение). */
const ELEMENT_KEYS: [Element, RegExp][] = [
  ['fire', /fire|flame|magnum|volcano|meteor|demonstration|burn/],
  ['ice', /frost|ice|storm_gust|cold/],
  ['wind', /thunder|jupitel|lightning/],
  ['earth', /earth|quake|heaven/],
  ['poison', /poison|venom|envenom|acid|goo|spit|curse/],
  ['holy', /holy|heal|bless|sanctu|magnus|grand_cross|divine|assumptio|impositio|kyrie|magnificat|first_aid|increase_agi|faith|devotion/],
  ['dark', /nova|wither|haunt|soul|shadow|dark|fear|grimtooth/],
];

/** Явные значки по id (там, где правила по эффектам не угадают смысл). */
const GLYPH_KEYS: [Glyph, RegExp][] = [
  ['bang', /provoke|crazy_uproar/],
  ['pan', /frying_pan/],
  ['coin', /steal|mammonite|gank|snatcher|overcharge/],
  ['note', /musical|whistle|bragi|apple_of_idun|frost_joker/],
  ['trap', /snare|claymore|trap/],
  ['bird', /blitz|steel_crow/],
  ['fist', /asura|iron_hand|investigate|triple_attack/],
  ['orb', /call_spirits|magic_rod|sp_recovery|energy_coat|free_cast|mystical|magnificat|poem/],
  ['sweep', /magnum|brandish|cleave|cart_revolution|raid/],
  ['spike', /spike|quake|grimtooth/],
];

const isPassive = (s: SkillDef) => !!s.trigger;

export function elementOf(s: SkillDef): Element {
  for (const [el, re] of ELEMENT_KEYS) if (re.test(s.id)) return el;
  const statuses = s.effects.flatMap((e) => (e.type === 'status' ? [e.status] : []));
  if (statuses.some((st) => st.dot)) return statuses.some((st) => /burn/.test(st.id)) ? 'fire' : 'poison';
  if (s.effects.some((e) => e.type === 'heal')) return 'holy';
  if (s.effects.some((e) => e.type === 'damage') && s.castTime === 0) return 'physical';
  if (s.effects.some((e) => e.type === 'shield')) return 'physical';
  // Бафф по статам без стихии: атака — «боевой», скорость — ветер, защита — физика.
  const mods = statuses.find((st) => st.stats)?.stats;
  if (mods && s.target.side === 'ally') return mods.spd ? 'wind' : 'physical';
  return 'neutral';
}

/** Значок баффа/дебаффа по статам статуса. */
function statGlyph(st: StatusDef, ally: boolean): Glyph {
  const m = st.stats ?? {};
  if (!ally) return 'down';
  if ((m.spd ?? 0) > 0 && !(m.atk ?? 0)) return 'haste';
  if ((m.def ?? 0) > 0 && !(m.atk ?? 0)) return 'guard';
  return 'up';
}

const ELEMENT_GLYPH: Partial<Record<Element, Glyph>> = {
  fire: 'flame',
  ice: 'snow',
  wind: 'bolt',
  earth: 'spike',
  holy: 'holy',
  poison: 'drop',
  dark: 'skull',
  neutral: 'orb',
};

export function glyphOf(s: SkillDef, element = elementOf(s)): Glyph {
  for (const [g, re] of GLYPH_KEYS) if (re.test(s.id)) return g;
  const ally = s.target.side === 'ally';
  const has = (t: string) => s.effects.some((e) => e.type === t);
  if (has('heal')) return 'cross';
  if (has('shield')) return 'shield';
  const statuses = s.effects.flatMap((e) => (e.type === 'status' ? [e.status] : []));
  if (!has('damage')) {
    const st = statuses.find((x) => x.stats);
    if (st) return statGlyph(st, ally);
    return ELEMENT_GLYPH[element] ?? 'orb';
  }
  if (element !== 'physical') return ELEMENT_GLYPH[element] ?? 'orb';
  if (statuses.some((x) => x.stun)) return 'stars';
  if (has('dash')) return 'dash';
  if (s.range === 'ranged') return s.hits > 1 || s.target.pick === 'all' ? 'arrows' : 'arrow';
  if (s.target.pick === 'all') return 'sweep';
  if (s.hits > 1) return 'slashes';
  if (statuses.some((x) => x.stats)) return 'down';
  return 'sword';
}

/** Снаряды и площадь для «явных» навыков RO (остальное — по правилам в lookOf). */
const FX_OVERRIDE: Record<string, Pick<SkillLook, 'projectile' | 'area'>> = {
  job_mage_fire_bolt: { projectile: 'fireball' },
  job_mage_frost_diver: { projectile: 'ice' },
  job_mage_thunderstorm: { area: 'lightning' },
  job_acolyte_holy_light: { projectile: 'beam' },
  job_priest_sanctuary: { area: 'sanctuary' },
  job_swordman_magnum_break: { area: 'ring' },
  job_archer_arrow_shower: { area: 'arrows' },
  job_archer_double_strafe: { projectile: 'arrow' },
  job_archer_charge_arrow: { projectile: 'arrow' },
  job_wizard_jupitel_thunder: { projectile: 'lightning' },
  job_wizard_meteor_storm: { projectile: 'meteor' },
  job_wizard_storm_gust: { area: 'blizzard' },
  job_sage_earth_spike: { projectile: 'rock' },
  job_priest_magnus_exorcismus: { area: 'holy' },
  job_crusader_grand_cross: { area: 'holy' },
  mob_boss1_quake: { area: 'quake' },
  mage_firestorm: { area: 'ring' },
};

const PROJECTILE_OF: Partial<Record<Element, Projectile>> = {
  fire: 'fireball',
  ice: 'ice',
  wind: 'lightning',
  earth: 'rock',
  holy: 'beam',
  poison: 'poison',
  dark: 'dark',
  neutral: 'arcane',
};
const AREA_OF: Partial<Record<Element, Area>> = {
  fire: 'ring',
  ice: 'blizzard',
  wind: 'lightning',
  earth: 'quake',
  holy: 'holy',
  poison: 'cloud',
  dark: 'cloud',
  neutral: 'ring',
};

const cache = new Map<string, SkillLook>();

/** Вид навыка (кэшируется по id). */
export function lookOf(s: SkillDef): SkillLook {
  const hit = cache.get(s.id);
  if (hit) return hit;
  const element = elementOf(s);
  const passive = isPassive(s);
  const aoe = s.target.pick === 'all';
  const look: SkillLook = { element, glyph: glyphOf(s, element), aoe, passive };
  const damage = s.effects.some((e) => e.type === 'damage');
  const heal = s.effects.some((e) => e.type === 'heal');
  const o = FX_OVERRIDE[s.id];
  if (o) Object.assign(look, o);
  else if (!passive && damage && !s.effects.some((e) => e.type === 'dash')) {
    if (aoe) look.area = s.range === 'melee' ? 'ring' : element === 'physical' ? 'arrows' : AREA_OF[element];
    else if (s.range === 'ranged') look.projectile = element === 'physical' ? 'arrow' : PROJECTILE_OF[element];
  } else if (!passive && heal && aoe) look.area = 'sanctuary';
  cache.set(s.id, look);
  return look;
}

/** Значок статуса над полоской HP. */
export type StatusIcon = 'atkUp' | 'atkDown' | 'defUp' | 'defDown' | 'spdUp' | 'spdDown' | 'stun' | 'poison' | 'burn';

export function statusIconOf(st: StatusDef): StatusIcon {
  if (st.stun) return 'stun';
  if (st.dot) return /burn/.test(st.id) ? 'burn' : 'poison';
  const m = st.stats ?? {};
  const [k, v] = (Object.entries(m) as [string, number][]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0] ?? ['atk', 1];
  const up = v >= 0;
  if (k === 'def') return up ? 'defUp' : 'defDown';
  if (k === 'spd') return up ? 'spdUp' : 'spdDown';
  return up ? 'atkUp' : 'atkDown';
}

/** Цвет искр баффа по статусу: атака — золото, скорость — голубой, защита — серебро. */
export function buffColor(st: StatusDef | undefined): number {
  if (!st) return 0xffe28a;
  const icon = statusIconOf(st);
  if (icon === 'spdUp') return 0x7fd4ff;
  if (icon === 'defUp') return 0xcfe0ff;
  if (icon === 'atkUp') return 0xffd84a;
  return 0xff8a6a;
}

/**
 * Настоящие иконки Ragnarok Online (assets/ui/icons/skill_<roId>.png, родные 24×24, см. ro-skills.json и docs/ART_EXTRACT_RO.md §2):
 * наш id навыка → id иконки RO. Пиксель-арт кладётся в нашу рамку (стихия, активный/пассивный) без сглаживания.
 */
export const RO_SKILL_ICONS: Record<string, string> = {
  novice_first_aid: 'nv_firstaid',
  swordman_bash: 'sm_bash',
  swordman_endure: 'sm_endure',
  job_swordman_magnum_break: 'sm_magnum',
  job_swordman_hp_recovery: 'sm_recovery',
  job_swordman_provoke: 'sm_provoke',
  job_thief_envenom: 'tf_poison',
  job_thief_improve_dodge: 'tf_miss',
  job_thief_steal: 'tf_steal',
  job_thief_double_attack: 'tf_double',
  job_thief_sand_attack: 'tf_sprinklesand',
  job_archer_double_strafe: 'ac_double',
  job_archer_owls_eye: 'ac_owl',
  job_archer_arrow_shower: 'ac_shower',
  job_archer_vultures_eye: 'ac_vulture',
  job_archer_charge_arrow: 'ac_chargearrow',
  job_mage_fire_bolt: 'mg_firebolt',
  job_mage_sp_recovery: 'mg_srecovery',
  job_mage_frost_diver: 'mg_frostdiver',
  job_mage_energy_coat: 'mg_energycoat',
  job_mage_thunderstorm: 'mg_thunderstorm',
  job_acolyte_heal: 'al_heal',
  job_acolyte_divine_protection: 'al_dp',
  job_acolyte_blessing: 'al_blessing',
  job_acolyte_holy_light: 'al_holylight',
  job_acolyte_increase_agi: 'al_incagi',
  job_priest_sanctuary: 'pr_sanctuary',
  job_merchant_mammonite: 'mc_mammonite',
  job_merchant_frying_pan: 'mc_fryingpan',
  job_merchant_pushcart: 'mc_pushcart',
  job_merchant_cart_revolution: 'mc_cartrevolution',
  job_merchant_crazy_uproar: 'mc_loud',
  job_merchant_overcharge: 'mc_overcharge',
  job_knight_two_hand_mastery: 'sm_twohand',
  job_swordman_auto_berserk: 'sm_autoberserk',
  job_archer_improve_concentration: 'ac_concentration',
  job_mage_cold_bolt: 'mg_coldbolt',
  job_mage_fire_ball: 'mg_fireball',
  job_mage_safety_wall: 'mg_safetywall',
  job_acolyte_angelus: 'al_angelus',
  job_acolyte_signum_crucis: 'al_crucis',
  job_knight_bowling_bash: 'kn_bowlingbash',
  job_knight_auto_counter: 'kn_autocounter',
  job_knight_parrying: 'lk_parrying',
  job_knight_charge_attack: 'kn_chargeatk',
  job_knight_two_hand_quicken: 'kn_twohandquicken',
  job_knight_spiral_pierce: 'lk_spiralpierce',
  job_crusader_devotion: 'cr_devotion',
  job_crusader_faith: 'cr_trust',
  job_crusader_auto_guard: 'cr_autoguard',
  job_crusader_defender: 'cr_defender',
  job_crusader_holy_cross: 'cr_holycross',
  job_crusader_shield_charge: 'cr_shieldcharge',
  job_crusader_grand_cross: 'cr_grandcross',
  job_hunter_blitz_beat: 'ht_blitzbeat',
  job_hunter_beast_bane: 'ht_beastbane',
  job_hunter_steel_crow: 'ht_steelcrow',
  job_hunter_falcon_assault: 'sn_falconassault',
  job_hunter_ankle_snare: 'ht_anklesnare',
  job_hunter_claymore_trap: 'ht_claymoretrap',
  job_hunter_sandman: 'ht_sandman',
  job_bard_musical_strike: 'ba_musicalstrike',
  job_bard_poem_of_bragi: 'ba_poembragi',
  job_bard_apple_of_idun: 'ba_appleidun',
  job_bard_assassin_cross: 'ba_assassincross',
  job_bard_whistle: 'ba_whistle',
  job_bard_frost_joker: 'ba_frostjoke',
  job_bard_scream: 'dc_scream',
  job_dancer_slinging_arrow: 'dc_throwarrow',
  job_dancer_dont_forget_me: 'dc_dontforgetme',
  job_dancer_fortune_kiss: 'dc_fortunekiss',
  job_assassin_sonic_blow: 'as_sonicblow',
  job_assassin_katar_mastery: 'as_katar',
  job_assassin_meteor_assault: 'asc_meteorassault',
  job_assassin_grimtooth: 'as_grimtooth',
  job_assassin_enchant_poison: 'as_enchantpoison',
  job_assassin_venom_splasher: 'as_splasher',
  job_thief_venom_knife: 'as_venomknife',
  job_rogue_raid: 'rg_raid',
  job_rogue_plagiarism: 'rg_plagiarism',
  job_rogue_strip_weapon: 'rg_stripweapon',
  job_rogue_strip_armor: 'rg_striparmor',
  job_rogue_back_stab: 'rg_backstap',
  job_rogue_gank: 'rg_snatcher',
  job_blacksmith_power_thrust: 'bs_overthrust',
  job_blacksmith_hammer_fall: 'bs_hammerfall',
  job_blacksmith_cart_termination: 'ws_carttermination',
  job_blacksmith_tempering: 'bs_iron',
  job_blacksmith_adrenaline_rush: 'bs_adrenaline',
  job_blacksmith_weapon_perfection: 'bs_weaponperfect',
  job_alchemist_potion_pitcher: 'am_potionpitcher',
  job_alchemist_chemical_protection: 'am_cp_armor',
  job_alchemist_slim_potion: 'cr_slimpitcher',
  job_alchemist_acid_terror: 'am_acidterror',
  job_alchemist_demonstration: 'am_demonstration',
  job_alchemist_acid_bomb: 'cr_aciddemonstration',
  job_wizard_jupitel_thunder: 'wz_jupitel',
  job_wizard_mystical_amplification: 'hw_magicpower',
  job_wizard_soul_drain: 'hw_souldrain',
  job_wizard_meteor_storm: 'wz_meteor',
  job_wizard_frost_nova: 'wz_frostnova',
  job_wizard_quagmire: 'wz_quagmire',
  job_wizard_storm_gust: 'wz_stormgust',
  job_sage_earth_spike: 'wz_earthspike',
  job_sage_free_cast: 'sa_freecast',
  job_sage_heavens_drive: 'wz_heavendrive',
  job_sage_dispell: 'sa_dispell',
  job_sage_magic_rod: 'sa_magicrod',
  job_sage_volcano: 'sa_volcano',
  job_priest_impositio_manus: 'pr_impositio',
  job_priest_magnificat: 'pr_magnificat',
  job_priest_magnus_exorcismus: 'pr_magnus',
  job_priest_lex_aeterna: 'pr_lexaeterna',
  job_priest_kyrie_eleison: 'pr_kyrie',
  job_priest_assumptio: 'hp_assumptio',
  job_monk_triple_attack: 'mo_tripleattack',
  job_monk_call_spirits: 'mo_callspirits',
  job_monk_investigate: 'mo_investigate',
  job_monk_asura_strike: 'mo_extremityfist',
  job_monk_blade_stop: 'mo_bladestop',
  job_monk_iron_hand: 'mo_ironhand',
  job_monk_steel_body: 'mo_steelbody',
};
