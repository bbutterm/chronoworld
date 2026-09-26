export type Side = 'A' | 'B';
export type HeroId = string;
export type AttackType = 'melee' | 'ranged' | 'healer';

export interface Stats {
  hp: number;
  atk: number;
  def: number;
  spd: number;
}

export type EffectTarget =
  | 'enemyFrontRow'
  | 'enemyLowestHp'
  | 'enemyRandom'
  | 'enemyAll'
  | 'allyAll'
  | 'selfAndNeighbor';

export type Effect =
  | { type: 'damage'; target: EffectTarget; k: number; hits?: number }
  | { type: 'heal'; target: EffectTarget; k: number }
  | { type: 'shield'; target: EffectTarget; pctMaxHp: number };

export interface HeroDef {
  name: string;
  role: string;
  position: 'front' | 'back';
  attack: AttackType;
  /** Для дальнего боя: 'back' — бьёт в тыл врага. */
  targetRule?: 'front' | 'back';
  stats: Stats;
  ult: { name: string; effects: Effect[] };
}

export type HeroesConfig = Record<HeroId, HeroDef>;

export interface CombatConfig {
  actionThreshold: number;
  tickSeconds: number;
  timeLimitSeconds: number;
  damage: { defScale: number; varianceMin: number; varianceMax: number; minDamage: number };
  basicAttack: { k: number };
  basicHeal: { k: number };
  energy: { max: number; perBasicAction: number; perHitTaken: number };
  slots: { count: number; front: number[]; back: number[]; lane: number[] };
}

/** Отряд: 5 слотов, null — пустой слот. Индексы из combat.slots (0–1 фронт, 2–4 тыл). */
export type Squad = (HeroId | null)[];

export interface Unit {
  /** Уникальный id юнита в бою, например "A2". */
  uid: string;
  side: Side;
  slot: number;
  heroId: HeroId;
  def: HeroDef;
  maxHp: number;
  hp: number;
  atk: number;
  armor: number;
  spd: number;
  energy: number;
  gauge: number;
  shield: number;
  alive: boolean;
}

interface BaseEvent {
  /** Время события в секундах боя. */
  t: number;
}

export type BattleEvent = BaseEvent &
  (
    | { type: 'turn'; unit: string }
    | {
        type: 'attack';
        unit: string;
        targets: string[];
        kind: 'melee' | 'ranged' | 'heal';
        /** Энергия атакующего после действия. */
        energy: number;
      }
    | { type: 'ult'; unit: string; name: string }
    | {
        type: 'damage';
        source: string;
        target: string;
        amount: number;
        absorbed: number;
        hp: number;
        shield: number;
        energy: number;
      }
    | { type: 'heal'; source: string; target: string; amount: number; hp: number }
    | { type: 'buff'; source: string; target: string; kind: 'shield'; amount: number; shield: number }
    | { type: 'death'; unit: string }
    | { type: 'end'; winner: Side; reason: 'wipe' | 'timeout' }
  );

export interface UnitSnapshot {
  uid: string;
  side: Side;
  slot: number;
  heroId: HeroId;
  maxHp: number;
}

export interface UnitReport {
  uid: string;
  heroId: HeroId;
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
