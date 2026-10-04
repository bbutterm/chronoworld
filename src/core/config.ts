import combatJson from '../../data/combat.json';
import { parseCombatConfig } from './combatSchema';

export const COMBAT = parseCombatConfig(combatJson);
