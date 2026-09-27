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
  | 'bird';

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
  job_acolyte_sanctuary: { area: 'sanctuary' },
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
