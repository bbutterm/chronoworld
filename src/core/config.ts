import heroesJson from '../../data/heroes.json';
import combatJson from '../../data/combat.json';
import type { CombatConfig, HeroesConfig } from './types';

export const HEROES = heroesJson as unknown as HeroesConfig;
export const COMBAT = combatJson as CombatConfig;
