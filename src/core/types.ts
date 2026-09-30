import type { ChapterDef, StageInfo } from './campaign/schema';
import type { SkillDef, StatMods, StatusDef, UnitDef } from './content/schema';
import type { JobDef } from './progression/schema';
import type { HeroTemplate } from './heroes/schema';
import type { BehaviorProfile, EnrageConfig, SustainConfig } from './behavior';

export type { Effect, PhaseActionDef, PhaseDef, SkillDef, StatMods, StatusDef, Stats, TargetDef, UnitDef } from './content/schema';

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
  /** Шаблоны карточек героев (data/heroes). */
  heroes: Record<string, HeroTemplate>;
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
    /**
     * Строй (QA T2-05, BUG-045): не больше стольких ближних бойцов на одну цель — лишние выбирают другую
     * (первой — ту, что по обычной атаке, дальше ближайшую свободную). Рывок считается сверх лимита.
     */
    maxMeleePerTarget?: number;
    /** Прыжок в тыл без «остаться» (профиль без dive.stay): через столько секунд после рывка — назад к прежнему противнику. */
    diveReturnSeconds?: number;
  };
  /** Полёт снаряда дальней атаки (с): урон приходит позже, по погибшей к тому времени цели снаряд пропадает. */
  projectileSeconds?: number;
  /** Длительность статусов: «ход» статуса = столько секунд боя (одинаково для всех, не зависит от SPD носителя). */
  statusTurnSeconds?: number;
  /**
   * Потолок щита (LT-01): суммарный щит юнита не больше этой доли его макс. ОЗ (по умолчанию 0.5).
   * Новые щиты складываются до потолка — как в AFK «щит до X% макс. здоровья».
   */
  shieldCapPctMaxHp?: number;
  /** Библиотека профилей поведения (docs/design/battle-behavior.md): id → правила и числа. */
  behaviors?: Record<string, BehaviorProfile>;
  /** Профиль по умолчанию: `<kind>_<role>_<melee|ranged>`, затем `<kind>`; нет — line. */
  behaviorDefaults?: Record<string, string>;
  /** Мягкая ярость всех после afterSeconds боя: урон растёт на perSecond за секунду сверх порога. */
  enrage?: EnrageConfig;
  /** Живучесть врагов: убывающее повторное лечение одной цели, щиты не складываются. */
  sustain?: SustainConfig;
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
  casting: { skill: SkillDef; until: number; at?: [number, number]; radius?: number } | null;
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
  /** Профиль поведения (id из combat.json → behaviors) и его правила. */
  behavior: string;
  bh: BehaviorProfile;
  /** Призван фазой босса посреди боя (свита). */
  summoned?: boolean;
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
    | {
        type: 'move';
        unit: string;
        from: [number, number];
        to: [number, number];
        duration: number;
        kind: 'walk' | 'dash';
        /** Почему (профили поведения): kite — отход стрелка, follow — лекарь за танком, intercept — перехват стража. */
        reason?: 'kite' | 'follow' | 'intercept' | 'flee';
      }
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
        /**
         * Только для interrupt: stun — каст сбит оглушением; dispel — сбит статусом interrupt (Развеивание контрмага);
         * noTarget — к концу каста не осталось целей (каст пропал).
         */
        reason?: 'stun' | 'dispel' | 'noTarget';
        /** Удар по кругу (маг, навык с area): центр круга на земле и радиус. */
        at?: [number, number];
        radius?: number;
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
        /** Урон перенаправлен связью (Самопожертвование): target — защитник, from — тот, кого он закрыл. */
        redirect?: string;
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
        /** refresh — аура продлила статус тому, у кого он уже был (сцена не рисует). */
        action: 'apply' | 'expire' | 'refresh';
        /** Для apply: длительность в секундах боя (turns × statusTurnSeconds). */
        seconds?: number;
        /** Статус-провокация: носитель бьёт source. */
        taunt?: boolean;
      }
    | { type: 'link'; unit: string; target: string; action: 'apply' | 'break'; pct?: number; seconds?: number }
    | {
        type: 'phase';
        unit: string;
        /** Номер фазы в phases юнита (с 0). */
        index: number;
        title: string;
        bark?: 'half' | 'rage';
      }
    | { type: 'spawn'; unit: string; unitId: string; source: string; x: number; y: number; maxHp: number }
    | { type: 'enrage'; afterSeconds: number; perSecond: number }
    /** Аура барда/танцовщицы (пассивка с aura): круг радиуса radius вокруг unit, кто внутри — получает статус навыка. */
    | { type: 'aura'; unit: string; skill: string; radius: number }
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
  /** Призванные посреди боя (свита фаз босса): снимки на момент появления; в отчёте report есть, в units — нет. */
  spawned?: (UnitSnapshot & { t: number })[];
  log: BattleEvent[];
  report: Record<string, UnitReport>;
}
