/** Короткая разведка и факты боя. Никаких догадок о единственной причине поражения. */
import { enemyTraits, resolveBehavior } from '../core/behavior';
import { breaksCharge } from '../core/battle';
import type { BattleResult, CombatConfig, Content, UnitDef } from '../core/types';

type TacticsContext = { content: Pick<Content, 'skills'>; combat: CombatConfig };
export interface TacticalTip { text: string; advice: string }

/** Самая важная угроза состава; ответ предлагаем только от уже выбранного отряда. */
export function encounterThreat(enemies: readonly (UnitDef | null)[], allies: readonly UnitDef[], ctx: TacticsContext): TacticalTip | null {
  const foes = enemies.filter((u): u is UnitDef => !!u);
  const interrupter = allies.find((u) => u.skills.ult && ctx.content.skills[u.skills.ult] && breaksCharge(ctx.content.skills[u.skills.ult]));
  const stunner = allies.find((u) => u.skills.ult && ctx.content.skills[u.skills.ult]?.effects.some((e) => e.type === 'status' && e.status.stun));
  const charging = foes.find((u) => u.charge);
  if (charging) return {
    text: `${charging.name}: готовит мощный удар`,
    advice: interrupter ? `${interrupter.name}: ульта сбивает заряд. «Авто» можно выключить.` : 'Красная полоса — заряд. В разведке проверьте, чем его сбить.',
  };
  const diver = foes.find((u) => enemyTraits(u, ctx.content, ctx.combat).includes('прыгает в тыл'));
  if (diver) {
    const guard = allies.find((u) => resolveBehavior(u, ctx.content.skills[u.skills.basic]?.range !== 'melee', ctx.combat).profile.intercept);
    return {
      text: `${diver.name}: прыгает к героям в тылу`,
      advice: guard ? `${guard.name}: перехват рядом с союзником. Проверьте расстановку.` : stunner ? `${stunner.name}: ульта оглушает. Момент можно выбрать без «Авто».` : 'Тыл не всегда безопасен. Проверьте расстановку и навыки.',
    };
  }
  const healer = foes.find((u) => enemyTraits(u, ctx.content, ctx.combat).includes('лечит'));
  if (healer) return { text: `${healer.name}: лечит союзников`, advice: 'Затяжной бой ему выгоден. Посмотрите навыки врагов в разведке.' };
  return null;
}

/** Считаем только подтверждённые атаки после начала заряда; прерванный/оборванный бой — не попадание. */
export function chargeFacts(result: BattleResult): { released: number; interrupted: number } {
  const enemies = new Set([...result.units, ...(result.spawned ?? [])].filter((u) => u.side === 'B').map((u) => u.uid));
  const pending = new Map<string, string>();
  let released = 0;
  let interrupted = 0;
  for (const e of result.log) {
    if (e.type === 'cast' && enemies.has(e.unit)) {
      if (e.action === 'start' && e.charge) pending.set(e.unit, e.skill);
      else if (e.action === 'interrupt' && pending.get(e.unit) === e.skill) {
        if (e.reason === 'break' || e.reason === 'stun' || e.reason === 'dispel') interrupted++;
        pending.delete(e.unit);
      }
    } else if (e.type === 'attack' && pending.get(e.unit) === e.skill) {
      released++;
      pending.delete(e.unit);
    } else if (e.type === 'death') pending.delete(e.unit);
  }
  return { released, interrupted };
}

/** Позитивная обратная связь — наблюдаемое действие, без выдуманного «спасено N здоровья». */
export function tacticalSuccess(result: BattleResult): string | null {
  const { interrupted } = chargeFacts(result);
  if (interrupted) return `Заряды врага сбиты: ${interrupted}`;
  const own = new Set(result.units.filter((u) => u.side === 'A').map((u) => u.uid));
  const intercepts = result.log.filter((e) => e.type === 'move' && e.reason === 'intercept' && own.has(e.unit)).length;
  return intercepts ? `Защита тыла: перехватов ${intercepts}` : null;
}

/** Факт из журнала + вариант следующей попытки. Нет надёжного факта — обычный совет по прогрессу. */
export function tacticalDefeat(result: BattleResult, defs: Record<string, UnitDef>, ctx: TacticsContext): TacticalTip | null {
  if (result.winner === 'A') return null;
  const units = [...result.units, ...(result.spawned ?? [])];
  const own = units.filter((u) => u.side === 'A');
  const interrupter = own.map((u) => defs[u.unitId]).find((u) => u?.skills.ult && ctx.content.skills[u.skills.ult] && breaksCharge(ctx.content.skills[u.skills.ult]));
  const { released } = chargeFacts(result);
  if (released) return {
    text: `Враг выполнил заряженных атак: ${released}.`,
    advice: interrupter ? `Попробуйте выключить «Авто» и сохранить ульту героя «${interrupter.name}» до красного заряда.` : 'Проверьте в разведке, есть ли в вашем отряде оглушение или срыв каста.',
  };
  const firstDeath = result.log.find((e) => e.type === 'death' && own.some((u) => u.uid === e.unit));
  if (firstDeath?.type === 'death') {
    const victim = units.find((u) => u.uid === firstDeath.unit);
    const killer = units.find((u) => u.uid === firstDeath.killer);
    const victimDef = victim && defs[victim.unitId];
    const killerDef = killer && defs[killer.unitId];
    if (victimDef?.role === 'healer' && killer?.side === 'B' && killerDef && enemyTraits(killerDef, ctx.content, ctx.combat).includes('прыгает в тыл')) return {
      text: `Первым выбыл лекарь ${victimDef.name}. Последний удар: ${killerDef.name}.`,
      advice: 'Этот враг прыгает в тыл. Попробуйте другую расстановку и оглушение.',
    };
  }
  if (result.reason === 'timeout') {
    const healed = units.filter((u) => u.side === 'B').reduce((n, u) => n + (result.report[u.uid]?.healingDone ?? 0), 0);
    if (healed > 0) return { text: `Время вышло. Противник восстановил ${Math.round(healed)} ОЗ.`, advice: 'Попробуйте состав с большим уроном или контролем против лекаря.' };
  }
  return null;
}
