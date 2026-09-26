import { COMBAT, HEROES } from '../src/core';
import type { CombatConfig, HeroDef, HeroesConfig, Unit } from '../src/core';

export const cfg: CombatConfig = COMBAT;

export function hero(overrides: Partial<HeroDef> & { stats?: Partial<HeroDef['stats']> } = {}): HeroDef {
  return {
    name: 'Тест',
    role: 'damage',
    position: 'front',
    attack: 'melee',
    ult: { name: 'Ульта', effects: [{ type: 'damage', target: 'enemyAll', k: 1 }] },
    ...overrides,
    stats: { hp: 1000, atk: 100, def: 0, spd: 100, ...overrides.stats },
  };
}

export function unit(side: 'A' | 'B', slot: number, patch: Partial<Unit> = {}, def: HeroDef = hero()): Unit {
  return {
    uid: `${side}${slot}`,
    side,
    slot,
    heroId: 'test',
    def,
    maxHp: def.stats.hp,
    hp: def.stats.hp,
    atk: def.stats.atk,
    armor: def.stats.def,
    spd: def.stats.spd,
    energy: 0,
    gauge: 0,
    shield: 0,
    alive: true,
    ...patch,
  };
}

export function withHeroes(extra: HeroesConfig): HeroesConfig {
  return { ...HEROES, ...extra };
}
