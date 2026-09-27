import { buildContent, COMBAT, rarityForLevel, type CardRarity, type CombatConfig, type Content, type GameContext, type HeroState } from '../src/core';
import type { Unit } from '../src/core';

// ---------- Карточки героев (docs/design/heroes.md) ----------

/** Карточка по классу — для тестов, где раньше герой задавался профессией (первые — сюжетные/призывные, вторые — фиолетовые). */
export const JOB_CARD: Record<string, string> = {
  swordman: 'alan',
  archer: 'bran',
  acolyte: 'vika',
  merchant: 'greta',
  thief: 'dorn',
  mage: 'kai',
  knight: 'seyren',
  crusader: 'randel',
  hunter: 'cecil',
  bard: 'alphoccio',
  wizard: 'kathryne',
  sage: 'celia',
  assassin: 'eremes',
  rogue: 'gertie',
  priest: 'margaretha',
  monk: 'chen',
  blacksmith: 'howard',
  alchemist: 'flamel',
};

/**
 * Экземпляр карточки templateId на уровне level: редкость — самая низкая, чей предел вмещает уровень (не ниже baseRarity
 * шаблона), если не задана явно. id по умолчанию — h_<шаблон>.
 */
export function cardHero(ctx: GameContext, templateId: string, level = 1, opts: { id?: string; rarity?: CardRarity } = {}): HeroState {
  const base = ctx.content.heroes[templateId]?.baseRarity ?? 'green';
  return { id: opts.id ?? `h_${templateId}`, templateId, rarity: opts.rarity ?? rarityForLevel(ctx, level, base), level };
}

export const cfg: CombatConfig = COMBAT;

type Json = Record<string, unknown>;

/** Навык для тестов: по умолчанию — обычная атака дальнего боя по ближайшему. */
export function skill(id: string, patch: Json = {}): Json {
  return {
    id,
    name: id,
    range: 'ranged',
    target: { side: 'enemy', pick: 'nearest' },
    effects: [{ type: 'damage', k: 1 }],
    ...patch,
  };
}

/** Юнит для тестов. */
export function unitDef(id: string, patch: Json = {}, stats: Json = {}): Json {
  return {
    id,
    name: id,
    kind: 'hero',
    role: 'damage',
    stats: { hp: 1000, atk: 100, def: 0, spd: 100, ...stats },
    skills: { basic: 'shot', passives: [] },
    visual: { sprite: id },
    ...patch,
  };
}

/** Контент из объектов; навык shot (дальняя атака) добавляется всегда. */
export function content(units: Json[], skills: Json[] = []): Content {
  const all = [skill('shot'), skill('hit', { range: 'melee' }), ...skills];
  return buildContent({
    units: units.map((data, i) => ({ file: `unit${i}`, data })),
    skills: all.map((data, i) => ({ file: `skill${i}`, data })),
  });
}

/** Юнит боя для тестов выбора цели. */
export function unit(side: 'A' | 'B', slot: number, x: number, y: number, patch: Partial<Unit> = {}): Unit {
  return {
    uid: `${side}${slot}`,
    side,
    slot,
    unitId: 'u',
    def: {} as Unit['def'],
    basic: {} as Unit['basic'],
    passives: [],
    actives: [],
    readyAt: {},
    casting: null,
    maxHp: 1000,
    hp: 1000,
    base: { atk: 100, def: 0, spd: 100 },
    energy: 0,
    gauge: 0,
    shield: 0,
    alive: true,
    statuses: [],
    x,
    y,
    moveSpeed: 300,
    body: 0,
    range: Infinity,
    engage: null,
    moving: null,
    ...patch,
  };
}
