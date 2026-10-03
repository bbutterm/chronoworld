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
    advice: interrupter ? `${interrupter.name}: ульта сбивает заряд. В бою можно выключить «Авто».` : 'Красная полоса — заряд. В разведке проверьте, чем его сбить.',
  };
  const diver = foes.find((u) => enemyTraits(u, ctx.content, ctx.combat).includes('прыгает в тыл'));
  if (diver) {
    const guard = allies.find((u) => resolveBehavior(u, ctx.content.skills[u.skills.basic]?.range !== 'melee', ctx.combat).profile.intercept);
    return {
      text: `${diver.name}: прыгает к героям в тылу`,
      advice: guard ? `${guard.name}: перехват рядом с союзником. Проверьте расстановку.` : stunner ? `${stunner.name} оглушает. Без «Авто» в бою вы выбираете момент.` : 'Тыл не всегда безопасен. Проверьте расстановку и навыки.',
    };
  }
  const healer = foes.find((u) => enemyTraits(u, ctx.content, ctx.combat).includes('лечит'));
  if (healer) return { text: `${healer.name}: лечит союзников`, advice: 'Затяжной бой ему выгоден. Посмотрите навыки врагов в разведке.' };
  return null;
}

/** Считаем только подтверждённые атаки после начала заряда; прерванный/оборванный бой — не попадание. */
function chargeTimeline(result: BattleResult): { releasedStarts: number[]; interrupted: number } {
  const enemies = new Set([...result.units, ...(result.spawned ?? [])].filter((u) => u.side === 'B').map((u) => u.uid));
  const pending = new Map<string, { skill: string; start: number }>();
  const releasedStarts: number[] = [];
  let interrupted = 0;
  for (const [index, e] of result.log.entries()) {
    if (e.type === 'cast' && enemies.has(e.unit)) {
      if (e.action === 'start' && e.charge) pending.set(e.unit, { skill: e.skill, start: index });
      else if (e.action === 'interrupt' && pending.get(e.unit)?.skill === e.skill) {
        if (e.reason === 'break' || e.reason === 'stun' || e.reason === 'dispel') interrupted++;
        pending.delete(e.unit);
      }
    } else if (e.type === 'attack' && pending.get(e.unit)?.skill === e.skill) {
      releasedStarts.push(pending.get(e.unit)!.start);
      pending.delete(e.unit);
    } else if (e.type === 'death') pending.delete(e.unit);
  }
  return { releasedStarts, interrupted };
}

export function chargeFacts(result: BattleResult): { released: number; interrupted: number } {
  const { releasedStarts, interrupted } = chargeTimeline(result);
  return { released: releasedStarts.length, interrupted };
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
  const { releasedStarts } = chargeTimeline(result);
  if (releasedStarts.length) {
    const breakers = own.filter((u) => {
      const ult = defs[u.unitId]?.skills.ult;
      return ult && ctx.content.skills[ult] && breaksCharge(ctx.content.skills[ult]);
    });
    // Снимки — начало боя/призыв, report.alive — конец. Нужен порядок событий у начала
    // именно выпущенного заряда; одинаковое t не отменяет порядок смерти и каста в журнале.
    const arrivals = new Map(result.units.map((u) => [u.uid, -1]));
    const deaths = new Map<string, number>();
    result.log.forEach((e, index) => {
      if (e.type === 'spawn') arrivals.set(e.unit, index);
      if (e.type === 'death') deaths.set(e.unit, index);
    });
    const interrupter = breakers.find((u) => releasedStarts.some((start) =>
      arrivals.has(u.uid) && arrivals.get(u.uid)! < start && (deaths.get(u.uid) ?? Infinity) > start));
    const fallen = breakers.find((u) => {
      const arrival = arrivals.get(u.uid);
      const death = deaths.get(u.uid);
      return arrival !== undefined && death !== undefined && arrival < death && releasedStarts.some((start) => death < start);
    });
    return {
      text: `Враг выполнил заряженных атак: ${releasedStarts.length}.`,
      advice: interrupter
        ? `Попробуйте выключить «Авто» в бою и сохранить ульту героя «${defs[interrupter.unitId].name}» до красного заряда.`
        : fallen
          ? `Герой «${defs[fallen.unitId].name}» выбыл до начала заряда. Сначала попробуйте защитить его расстановкой.`
          : 'Проверьте в разведке, есть ли в вашем отряде оглушение или срыв каста.',
    };
  }
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
