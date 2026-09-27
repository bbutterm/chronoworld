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
  /** Активные навыки: перезарядка по умолчанию (с), если у навыка не задана. */
  skills?: { defaultCooldown: number };
  movement: {
    meleeRange: number;
    moveSpeed: number;
    dashSeconds: number;
    stackAngles: number[];
    /** Сжатие веера по вертикали (псевдоперспектива: бойцы толпятся плотнее, как в AFK). 1 — круг. */
    crowdSquash?: number;
    /** Ближний боец не может дойти до цели дольше стольких секунд — берёт ближайшего врага. */
    retargetSeconds: number;
    /** «Радиус тела» по виду юнита: ближний боец встаёт дальше от крупной цели (босса). */
    bodyRadius?: Partial<Record<'hero' | 'monster' | 'boss', number>>;
    /** Минимальное расстояние между точками стоянки бойцов (единиц поля): свободное место у цели ищется с этим зазором. */
    minSeparation?: number;
    /** Ближний навык по площади задевает только врагов не дальше этого радиуса (+ радиус тела) от цели сражения. */
    meleeAoeRadius?: number;
  };
  /** Полёт снаряда дальней атаки (с): урон приходит позже, по погибшей к тому времени цели снаряд пропадает. */
  projectileSeconds?: number;
  /** Длительность статусов: «ход» статуса = столько секунд боя (одинаково для всех, не зависит от SPD носителя). */
  statusTurnSeconds?: number;
  slots: { count: number; front: number[]; back: number[] };
  field: {
    width: number;
    slotsA: [number, number][];
    /** Границы поля для точек ног: юниты не уходят за край экрана. */
    bounds?: { minX: number; maxX: number; minY: number; maxY: number };
  };
}

export interface ActiveStatus {
  def: StatusDef;
  /** Время боя (с), когда статус спадёт: turns × statusTurnSeconds от наложения. */
  until: number;
  /** Урон за ход (dot): время следующего тика. */
  nextTick: number;
  /** Порядок наложения — тики dot в один момент идут в этом порядке. */
  seq: number;
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
  /** Активные навыки в порядке приоритета (первый — важнейший). */
  actives: SkillDef[];
  /** Когда навык снова готов: время боя (с) по id навыка. */
  readyAt: Record<string, number>;
  /** Идёт каст: навык и время окончания. */
  casting: { skill: SkillDef; until: number } | null;
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
        /** Активный навык: его название (у обычной атаки нет) и перезарядка в секундах. */
        name?: string;
        cooldown?: number;
      }
    | {
        type: 'cast';
        unit: string;
        skill: string;
        name: string;
        duration: number;
        action: 'start' | 'interrupt';
        /** Только для interrupt: stun — каст сбит оглушением; noTarget — к концу каста не осталось целей (каст пропал). */
        reason?: 'stun' | 'noTarget';
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
    | {
        type: 'status';
        source: string;
        target: string;
        status: string;
        name: string;
        turns: number;
        action: 'apply' | 'expire';
        /** Для apply: длительность в секундах боя (turns × statusTurnSeconds). */
        seconds?: number;
      }
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
  /** Сколько раз применены активные навыки. */
  skills: number;
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
