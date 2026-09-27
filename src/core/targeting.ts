import type { Rng } from './rng';
import type { CombatConfig, TargetDef, Unit } from './types';

export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

const bySlot = (a: Unit, b: Unit) => a.slot - b.slot;

export function inRow(u: Unit, row: 'front' | 'back', cfg: CombatConfig): boolean {
  return (row === 'front' ? cfg.slots.front : cfg.slots.back).includes(u.slot);
}

/**
 * Выбор целей навыка. Детерминирован: равенство решает меньший слот,
 * случайность — только через rng боя.
 */
export function selectTargets(actor: Unit, t: TargetDef, allies: Unit[], enemies: Unit[], rng: Rng, cfg: CombatConfig): Unit[] {
  if (t.pick === 'self') return actor.alive ? [actor] : [];

  let pool = (t.side === 'enemy' ? enemies : allies).filter((u) => u.alive && (t.side === 'enemy' || t.includeSelf || u !== actor));
  if (t.onlyWounded) pool = pool.filter((u) => u.hp < u.maxHp);
  if (t.row !== 'any') {
    const row = t.row;
    const inWanted = pool.filter((u) => inRow(u, row, cfg));
    pool = inWanted.length > 0 || !t.rowFallback ? inWanted : pool.filter((u) => !inRow(u, row, cfg));
  }
  pool.sort(bySlot);
  if (pool.length === 0) return [];

  switch (t.pick) {
    case 'all':
      return pool;
    case 'nearest':
      return [...pool].sort((a, b) => dist(actor, a) - dist(actor, b) || a.slot - b.slot).slice(0, t.count);
    case 'lowestHp':
      return [...pool].sort((a, b) => a.hp - b.hp || a.slot - b.slot).slice(0, t.count);
    case 'lowestHpPct':
      return [...pool].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.slot - b.slot).slice(0, t.count);
    case 'random': {
      const left = [...pool];
      const out: Unit[] = [];
      for (let i = 0; i < t.count && left.length > 0; i++) out.push(left.splice(rng.int(left.length), 1)[0]);
      return out;
    }
  }
}
