import type { CombatConfig } from './types';
import type { Rng } from './rng';

/** dmg = ATK × k × defScale / (defScale + DEF) × r, вниз, минимум minDamage. */
export function calcDamage(atk: number, k: number, def: number, rng: Rng, cfg: CombatConfig): number {
  const d = cfg.damage;
  const r = rng.range(d.varianceMin, d.varianceMax);
  const raw = ((atk * k * d.defScale) / (d.defScale + def)) * r;
  return Math.max(d.minDamage, Math.floor(raw));
}

export function calcHeal(atk: number, k: number): number {
  return Math.max(0, Math.floor(atk * k));
}
