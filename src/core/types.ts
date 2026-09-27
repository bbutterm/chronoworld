import type { ChapterDef, StageInfo } from './campaign/schema';
import type { SkillDef, StatMods, StatusDef, UnitDef } from './content/schema';
import type { JobDef } from './progression/schema';

export type { Effect, SkillDef, StatMods, StatusDef, Stats, TargetDef, UnitDef } from './content/schema';

export type Side = 'A' | 'B';

/**
 * Отряд: 5 слотов (0–1 фронт, 2–4 тыл). В слоте — id юнита из data/units,
 * готовый UnitDef (герой игрока из профессии, усиленный монстр этапа) или null.
 */
export type Squad = (string | UnitDef | null)[];

/** Отряд только из id юнитов (CLI, тестовый бой). */
export type SquadIds = (string | null)[];

export interface Content {
  units: Record<string, UnitDef>;
  skills: Record<string, SkillDef>;
  jobs: Record<string, JobDef>;
  chapters: ChapterDef[];
  /** Все этапы по порядку кампании. */
  stages: StageInfo[];
}

export interface CombatConfig {
  actionThreshold: number;
  tickSeconds: number;
  timeLimitSeconds: number;
  damage: { defScale: number; varianceMin: number; varianceMax: number; minDamage: number };
  energy: { max: number; perBasicAction: number; perHitTaken: number };
  movement: {
    meleeRange: number;
    moveSpeed: number;
    dashSeconds: number;
    stackAngles: number[];
    /** Ближний боец не может дойти до цели дольше стольких секунд — берёт ближайшего врага. */
    retargetSeconds: number;
    /** «Радиус тела» по виду юнита: ближний боец встаёт дальше от крупной цели (босса). */
    bodyRadius?: Partial<Record<'hero' | 'monster' | 'boss', number>>;
  };
  slots: { count: number; front: number[]; back: number[] };
  field: { width: number; slotsA: [number, number][] };
}

export interface ActiveStatus {
  def: StatusDef;
  turnsLeft: number;
  /** ATK наложившего на момент наложения (для урона за ход). */
  sourceAtk: number;
  source: string;
}

export interface Unit {
  /** Уникальный id юнита в бою, например "A2". */
  uid: string;
  side: Side;
  slot: number;
  unitId: string;
  def: UnitDef;
  basic: SkillDef;
  ult?: SkillDef;
  passives: SkillDef[];
  maxHp: number;
  hp: number;
  base: { atk: number; def: number; spd: number };
  energy: number;
  gauge: number;
  shield: number;
  alive: boolean;
  statuses: ActiveStatus[];
  /** Позиция на поле (точка ног), единицы поля из combat.field. */
  x: number;
  y: number;
  moveSpeed: number;
  /** «Радиус тела» (единицы поля): к крупной цели ближний бой встаёт дальше. */
  body: number;
  /** Дальность обычной атаки: meleeRange для ближнего боя, Infinity для остальных. */
  range: number;
  /** Цель сражения ближнего бойца: к ней он идёт и её бьёт. */
  engage: Unit | null;
  moving: { toX: number; toY: number } | null;
}

export type StatMod = keyof StatMods;

interface BaseEvent {
  /** Время события в секундах боя. */
  t: number;
}

export type BattleEvent = BaseEvent &
  (
    | { type: 'turn'; unit: string }
    | { type: 'skip'; unit: string; reason: 'stun' }
    | { type: 'move'; unit: string; from: [number, number]; to: [number, number]; duration: number; kind: 'walk' | 'dash' }
    | {
        type: 'attack';
        unit: string;
        skill: string;
        targets: string[];
        kind: 'melee' | 'ranged' | 'heal';
        /** Энергия атакующего после действия. */
        energy: number;
      }
    | { type: 'ult'; unit: string; skill: string; name: string; targets: string[] }
    | { type: 'passive'; unit: string; skill: string; name: string }
    | {
        type: 'damage';
        source: string;
        target: string;
        amount: number;
        absorbed: number;
        hp: number;
        shield: number;
        energy: number;
        dot?: boolean;
      }
    | { type: 'heal'; source: string; target: string; amount: number; hp: number }
    | { type: 'buff'; source: string; target: string; kind: 'shield'; amount: number; shield: number }
    | { type: 'status'; source: string; target: string; status: string; name: string; turns: number; action: 'apply' | 'expire' }
    | { type: 'energy'; unit: string; energy: number }
    | { type: 'death'; unit: string; killer: string | null }
    | { type: 'end'; winner: Side; reason: 'wipe' | 'timeout' }
  );

export interface UnitSnapshot {
  uid: string;
  side: Side;
  slot: number;
  unitId: string;
  maxHp: number;
  x: number;
  y: number;
}

export interface UnitReport {
  uid: string;
  unitId: string;
  damageDealt: number;
  healingDone: number;
  shieldGiven: number;
  damageTaken: number;
  ults: number;
  alive: boolean;
}

export interface BattleResult {
  seed: number;
  winner: Side;
  reason: 'wipe' | 'timeout';
  duration: number;
  units: UnitSnapshot[];
  log: BattleEvent[];
  report: Record<string, UnitReport>;
}
