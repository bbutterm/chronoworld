/**
 * Звуки боя по потоку событий лога (issue #26). BattleScene зовёт `battleSound(...)` одной строкой в начале
 * `play()` — сам бой, эффекты и тайминги сцены этот модуль не трогает.
 *
 * Звук удара должен совпасть с кадром удара, а событие damage приходит в момент замаха. Точное время удара знает
 * только сцена (UnitView.impactAt) — здесь оценка по виду атаки: ближний бой — WINDUP_MS, дальний — ещё полёт снаряда,
 * с поправкой на скорость боя. Для точной синхронизации (позже, владелец BattleScene) — см. docs/design/audio.md,
 * раздел «Точки подключения».
 */
import type { BattleEvent, BattleResult, UnitDef } from '../core';
import monsterSoundsJson from '../../data/monster_sounds.json';
import { preloadSoundFiles, sfx, sfxFile } from './audio';
import type { SfxId } from './audioCatalog';
import type { SoundRule } from './audioCore';
import { haptic } from './haptics';
import { CONTENT } from './content';
import { MonsterSoundsSchema, monsterSoundFile, type MonsterSound, type MonsterSoundKind, type MonsterSounds } from './monsterSounds';
import { elementOf, type Element } from './skillLook';
import { playback } from './state';

/** Замах до кадра удара, мс (при скорости 1x). */
const WINDUP_MS = 260;
/** Полёт снаряда, мс. */
const FLIGHT_MS = 300;
/** «Сильный удар» по герою для вибрации — не меньше этой доли его здоровья. */
const HURT_SHARE = 0.3;
/** Звук готовности ульты у одного героя — не чаще, с времени боя. */
export const READY_GAP_S = 4;

type Weapon = 'hit_sword' | 'hit_dagger' | 'hit_blunt' | 'hit_arrow' | 'hit_claw' | 'hit_magic';

/** Оружие по профессии / спрайту (у юнитов нет поля «оружие» — угадываем по id, как стихию навыка). */
const WEAPON_KEYS: [Weapon, RegExp][] = [
  ['hit_dagger', /thief|assassin|rogue|dagger|katar/],
  ['hit_arrow', /archer|hunter|bard|dancer|ranger|bow/],
  ['hit_magic', /mage|wizard|sage|witch|magic/],
  ['hit_blunt', /acolyte|priest|monk|merchant|blacksmith|alchemist|mace|guard/],
  ['hit_sword', /swords|knight|crusader|warrior|sword|novice/],
];

export function weaponOf(def: UnitDef | undefined): Weapon {
  if (!def) return 'hit_blunt';
  if (def.kind !== 'hero') return def.kind === 'boss' ? 'hit_blunt' : 'hit_claw';
  const key = `${def.id} ${def.visual.sprite}`;
  return WEAPON_KEYS.find(([, re]) => re.test(key))?.[0] ?? 'hit_sword';
}

/** Взмах по оружию героя (звуки взмаха RO: меч, кинжал/катар, булава/топор). */
const SWING: Partial<Record<Weapon, SfxId>> = { hit_dagger: 'swing_dagger', hit_blunt: 'swing_blunt' };
export const swingOf = (w: Weapon): SfxId => SWING[w] ?? 'swing';

/** Свои звуки монстров RO по листу спрайта (data/monster_sounds.json; ошибка в файле — общие звуки, content:check её покажет). */
const MONSTER_SOUNDS: MonsterSounds['sprites'] = (() => {
  const r = MonsterSoundsSchema.safeParse(monsterSoundsJson);
  return r.success ? r.data.sprites : {};
})();

/** Звуки монстра (не героя) по его листу; нет — общие звуки каталога. */
export function monsterSoundsOf(def: UnitDef | undefined): MonsterSound | undefined {
  if (!def || def.kind === 'hero') return undefined;
  return MONSTER_SOUNDS[def.visual.sprite];
}

/**
 * Ограничитель для файла звука монстра: удар — обычный звук боя (minor, −6 дБ к прежним 0.45), смерть — важный (major),
 * как общий «пуф» (docs/design/audio.md, «Плотность звуков боя»).
 */
const MONSTER_RULE: Record<MonsterSoundKind, SoundRule & { gain: number }> = {
  attack: { gap: 90, voices: 1, gain: 0.22, tier: 'minor' },
  death: { gap: 60, voices: 3, gain: 0.45, tier: 'major', priority: true },
};

/** Сыграть свой звук монстра (по очереди из списка). false — своего звука нет или он ещё грузится. */
function monsterSound(u: UnitAudio, kind: MonsterSoundKind, delay: number): boolean {
  const list = u.sounds?.[kind];
  if (!list?.length) return false;
  const name = list[u.turn++ % list.length];
  const rule = MONSTER_RULE[kind];
  return sfxFile(monsterSoundFile(name), rule, { delay, gain: rule.gain });
}

const CAST: Record<Element, SfxId> = {
  fire: 'cast_fire',
  ice: 'cast_ice',
  wind: 'cast_wind',
  earth: 'cast_earth',
  holy: 'cast_holy',
  poison: 'cast_poison',
  dark: 'cast_dark',
  neutral: 'cast_neutral',
  physical: 'swing',
};

interface UnitAudio {
  def: UnitDef | undefined;
  side: string;
  maxHp: number;
  /** Задержка удара последней атаки, с (при скорости 1x). */
  impact: number;
  /** Звук попадания последней атаки. */
  hit: SfxId;
  inUlt: boolean;
  /** Свои звуки RO (монстры). */
  sounds: MonsterSound | undefined;
  /** Счётчик для чередования своих звуков. */
  turn: number;
  /** Когда (время боя, с) звучала готовность ульты. */
  readyT: number;
}

interface BattleAudioState {
  units: Map<string, UnitAudio>;
}

const states = new WeakMap<BattleResult, BattleAudioState>();

function stateOf(result: BattleResult, defs: Record<string, UnitDef>): BattleAudioState {
  let s = states.get(result);
  if (!s) {
    s = { units: new Map() };
    const files = new Set<string>();
    // Свита фаз босса (result.spawned) — тоже: её звуки грузятся заранее, удары и смерть звучат как у всех.
    for (const u of [...result.units, ...(result.spawned ?? [])]) {
      const def = defs[u.unitId];
      const sounds = monsterSoundsOf(def);
      for (const n of [...(sounds?.attack ?? []), ...(sounds?.death ?? [])]) files.add(monsterSoundFile(n));
      s.units.set(u.uid, { def, side: u.side, maxHp: u.maxHp, impact: WINDUP_MS / 1000, hit: weaponOf(def), inUlt: false, sounds, turn: 0, readyT: -Infinity });
    }
    states.set(result, s);
    // Звуки монстров этого боя — заранее (первое событие лога приходит до первого удара).
    preloadSoundFiles([...files]);
  }
  return s;
}

/** Задержка до удара с учётом скорости боя, с. */
const scaled = (sec: number) => sec / Math.max(0.25, playback.speed);

/**
 * Звук события боя. animate = false (перемотка «Пропустить», доигрывание лога) — тишина.
 */
export function battleSound(e: BattleEvent, animate: boolean, result: BattleResult, defs: Record<string, UnitDef>): void {
  if (!animate) return;
  const s = stateOf(result, defs);
  switch (e.type) {
    case 'attack': {
      const u = s.units.get(e.unit);
      if (!u) return;
      const skill = CONTENT.skills[e.skill];
      const el = skill ? elementOf(skill) : 'physical';
      const magic = !!skill && (skill.castTime > 0 || (el !== 'physical' && e.kind !== 'melee'));
      u.inUlt = false;
      u.impact = (WINDUP_MS + (e.kind === 'melee' ? 0 : FLIGHT_MS)) / 1000;
      u.hit = magic ? 'hit_magic' : e.kind === 'melee' ? weaponOf(u.def) : weaponOf(u.def) === 'hit_magic' ? 'hit_magic' : 'hit_arrow';
      if (e.kind === 'heal') return;
      // Активный навык — звук стихии; обычная атака — свой звук монстра RO, иначе выстрел лука. Взмах перед ударом
      // ближнего боя больше не звучит: удар и взмах на каждую атаку удваивали кашу (docs/design/audio.md, «Плотность»).
      if (e.name && el !== 'physical') sfx(CAST[el], { delay: scaled(0.08) });
      else if (monsterSound(u, 'attack', scaled(WINDUP_MS / 1000) * 0.6)) return;
      else if (u.hit === 'hit_arrow') sfx('bow_shot', { delay: scaled(0.12) });
      return;
    }
    case 'cast':
      if (e.action === 'start') sfx('cast_start');
      // «Сбито!»: заряд босса сорван ультой — звонкий срыв каста и вибрация «успех» (docs/design/battle-decisions.md §4).
      else if (e.action === 'interrupt' && e.reason === 'break') {
        sfx('charge_break');
        haptic('chargeBreak');
      }
      return;
    case 'ready': {
      // Ручной режим: ульта героя готова — тихий звон и лёгкий толчок; раз на готовность и не чаще READY_GAP_S на героя.
      const u = s.units.get(e.unit);
      if (e.lost || !u || u.side !== 'A' || e.t - u.readyT < READY_GAP_S) return;
      u.readyT = e.t;
      sfx('ult_ready');
      haptic('ultReady');
      return;
    }
    case 'ult': {
      const u = s.units.get(e.unit);
      if (u) {
        u.inUlt = true;
        u.impact = 0.5;
      }
      sfx('ult');
      return;
    }
    case 'damage': {
      if (e.dot) return;
      const u = s.units.get(e.source);
      const delay = scaled(u?.impact ?? WINDUP_MS / 1000);
      const target = s.units.get(e.target);
      // По боссу и от ульты — чуть громче.
      const gain = target?.def?.kind === 'boss' ? 1.15 : 1;
      if (e.amount - e.absorbed <= 0) {
        sfx('shield', { delay, gain: 0.6 });
        return;
      }
      sfx(u?.hit ?? 'hit_blunt', { delay, gain, rate: 0.94 + ((e.amount * 7) % 13) / 100 });
      if (u?.inUlt) sfx('crit', { delay });
      // Вибрация: удар ульты своего героя; по герою прошёл сильный удар (редко — окно в таблице haptics.ts).
      if (u?.inUlt && u.side === 'A') haptic('ultHit', delay * 1000);
      if (target?.side === 'A' && e.amount - e.absorbed >= target.maxHp * HURT_SHARE) haptic('heroHurt', delay * 1000);
      return;
    }
    case 'heal':
      if (e.amount > 0) sfx('heal', { delay: scaled(s.units.get(e.source)?.impact ?? 0.3) });
      return;
    case 'buff':
      sfx('shield', { delay: scaled(s.units.get(e.source)?.impact ?? 0.3) });
      return;
    case 'status': {
      if (e.action !== 'apply') return;
      const src = s.units.get(e.source);
      const tgt = s.units.get(e.target);
      const delay = scaled(src?.impact ?? 0.3);
      if (e.status === 'stun' || /stun|оглуш/i.test(`${e.status} ${e.name}`)) sfx('stun', { delay });
      else if (src && tgt && src.side === tgt.side) sfx('buff', { delay });
      else sfx('debuff', { delay });
      return;
    }
    case 'death': {
      const u = s.units.get(e.unit);
      const killer = e.killer ? s.units.get(e.killer) : undefined;
      const delay = scaled((killer?.impact ?? 0) + 0.15);
      // Свой звук смерти монстра RO; босс — ещё и фанфара MVP.
      const own = !!u && monsterSound(u, 'death', delay);
      if (u?.def?.kind === 'boss') sfx('boss_death', { delay: delay + (own ? 0.25 : 0) });
      else if (!own) sfx(u?.side === 'A' ? 'death_hero' : 'death_monster', { delay });
      if (u?.def?.kind === 'boss') haptic('bossDown', delay * 1000);
      else if (u?.side === 'A') haptic('heroDown', delay * 1000);
      return;
    }
    default:
      return;
  }
}
