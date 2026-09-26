import type { CombatConfig, Unit } from './types';
import type { Rng } from './rng';

const alive = (units: Unit[]) => units.filter((u) => u.alive);
const bySlot = (a: Unit, b: Unit) => a.slot - b.slot;

export function frontRow(units: Unit[], cfg: CombatConfig): Unit[] {
  return alive(units).filter((u) => cfg.slots.front.includes(u.slot)).sort(bySlot);
}

export function backRow(units: Unit[], cfg: CombatConfig): Unit[] {
  return alive(units).filter((u) => cfg.slots.back.includes(u.slot)).sort(bySlot);
}

/** Ближайший по линии (lane) юнит из списка, равенство — меньший слот. */
export function nearest(from: Unit, candidates: Unit[], cfg: CombatConfig): Unit | undefined {
  const lane = cfg.slots.lane;
  let best: Unit | undefined;
  let bestDist = Infinity;
  for (const c of [...candidates].sort(bySlot)) {
    const d = Math.abs(lane[from.slot] - lane[c.slot]);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

/** Цель обычной атаки. Лекарь лечит союзника, остальные бьют врага. */
export function pickBasicTarget(
  actor: Unit,
  allies: Unit[],
  enemies: Unit[],
  cfg: CombatConfig,
): { target: Unit; heal: boolean } | undefined {
  const def = actor.def;
  if (def.attack === 'healer') {
    const wounded = alive(allies).filter((u) => u.hp < u.maxHp);
    if (wounded.length > 0) {
      const target = [...wounded].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.slot - b.slot)[0];
      return { target, heal: true };
    }
    // Все союзники целы — лекарь бьёт как дальний боец.
  }
  const front = frontRow(enemies, cfg);
  const back = backRow(enemies, cfg);
  const wantBack = def.attack !== 'melee' && def.targetRule === 'back';
  const primary = wantBack ? back : front;
  const fallback = wantBack ? front : back;
  const target = nearest(actor, primary.length > 0 ? primary : fallback, cfg);
  return target ? { target, heal: false } : undefined;
}

export function lowestHp(units: Unit[]): Unit | undefined {
  return alive(units).sort((a, b) => a.hp - b.hp || a.slot - b.slot)[0];
}

export function randomAlive(units: Unit[], rng: Rng): Unit | undefined {
  const list = alive(units).sort(bySlot);
  return list.length > 0 ? list[rng.int(list.length)] : undefined;
}

/** Сосед — ближайший по линии живой союзник (не сам юнит). */
export function neighbor(actor: Unit, allies: Unit[], cfg: CombatConfig): Unit | undefined {
  return nearest(
    actor,
    alive(allies).filter((u) => u !== actor),
    cfg,
  );
}
