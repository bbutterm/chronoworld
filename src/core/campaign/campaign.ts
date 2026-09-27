import type { BattleResult } from '../types';
import { simulateBattle } from '../battle';
import type { UnitDef } from '../content/schema';
import type { HeroState, SaveState } from '../save/schema';
import { addJobExp } from '../progression/exp';
import { buildUnit } from '../progression/stats';
import { GameRuleError, type GameContext, type ProgressEvent } from '../progression/types';
import type { StageInfo } from './schema';
import { withGear } from '../equipment/equipment';

export type StageStatus = 'locked' | 'open' | 'cleared';

/** Этап по id; неизвестный — GameRuleError('unknown_stage'). */
export function getStage(ctx: GameContext, stageId: string): StageInfo {
  const stage = ctx.content.stages.find((s) => s.id === stageId);
  if (!stage) throw new GameRuleError('unknown_stage', `Неизвестный этап: ${stageId}`);
  return stage;
}

/**
 * T-B. Статус этапа: cleared — в save.campaign.cleared; open — первый этап кампании
 * или предыдущий (по globalIndex) пройден; иначе locked.
 */
export function stageStatus(save: SaveState, stageId: string, ctx: GameContext): StageStatus {
  const stage = getStage(ctx, stageId);
  if (save.campaign.cleared.includes(stage.id)) return 'cleared';
  if (stage.globalIndex === 0) return 'open';
  const prev = ctx.content.stages[stage.globalIndex - 1];
  return prev && save.campaign.cleared.includes(prev.id) ? 'open' : 'locked';
}

/**
 * T-B. Отряд врагов этапа: UnitDef монстров со статами hp/atk/def × mult × (1 + growth)^globalIndex
 * (growth = progression.campaign.enemyStatGrowthPerStage; spd не растёт), округление до целых.
 * id юнита — `${stage.id}_${slot}` (у разных слотов разные id), остальное — из data/units.
 */
export function enemySquad(stageId: string, ctx: GameContext): (UnitDef | null)[] {
  const stage = getStage(ctx, stageId);
  const growth = Math.pow(1 + ctx.progression.campaign.enemyStatGrowthPerStage, stage.globalIndex);
  return stage.enemies.map((e, slot) => {
    if (!e) return null;
    const base = ctx.content.units[e.unit];
    if (!base) throw new Error(`Этап ${stage.id}: враг ${e.unit} не найден`);
    const k = e.mult * growth;
    return {
      ...base,
      id: `${stage.id}_${slot}`,
      stats: {
        ...base.stats,
        hp: Math.max(1, Math.round(base.stats.hp * k)),
        atk: Math.round(base.stats.atk * k),
        def: Math.round(base.stats.def * k),
      },
    };
  });
}

export interface StageOutcome {
  save: SaveState;
  result: BattleResult;
  events: ProgressEvent[];
}

/**
 * T-B. Сыграть этап. Чистая функция: исходный save не меняется.
 * - GameRuleError('unknown_stage') / ('stage_locked') / ('empty_squad');
 * - отряд игрока: save.squad → buildUnit(hero) (null — пустой слот);
 * - бой: simulateBattle(ctx.content, squad, enemySquad, seed, { combat: ctx.combat });
 * - battleSeq + 1 всегда;
 * - победа: награда целиком при первом прохождении, × replayRewardMultiplier при повторе (floor);
 *   золото в resources, jobExp каждому герою отряда через addJobExp; события rewards, stageCleared,
 *   stageUnlocked (для следующего этапа при первом прохождении), события addJobExp;
 * - поражение: только battleSeq;
 * - P9 (T1-15): первая победа в кампании (cleared был пуст) при переданном now ставит offline.lastClaimAt = now —
 *   сундук копит время с первого пройденного этапа, а не с создания сохранения. Без now lastClaimAt не меняется.
 */
export function playStage(save: SaveState, stageId: string, seed: number, ctx: GameContext, now?: number): StageOutcome {
  // Экипировка героев из сохранения (если в контексте есть предметы).
  ctx = withGear(ctx, save);
  const stage = getStage(ctx, stageId);
  if (stageStatus(save, stageId, ctx) === 'locked') throw new GameRuleError('stage_locked', `Этап ${stage.name} ещё закрыт`);

  const heroIds: string[] = [];
  const squad = save.squad.map((heroId) => {
    if (heroId === null) return null;
    const hero = save.heroes.find((h) => h.id === heroId);
    if (!hero) throw new GameRuleError('unknown_hero', `Герой ${heroId} не найден`);
    if (!heroIds.includes(hero.id)) heroIds.push(hero.id);
    return buildUnit(hero, ctx);
  });
  if (heroIds.length === 0) throw new GameRuleError('empty_squad', 'В отряде нет героев');

  const result = simulateBattle(ctx.content, squad, enemySquad(stageId, ctx), seed, { combat: ctx.combat });
  const next: SaveState = { ...save, battleSeq: save.battleSeq + 1 };
  const events: ProgressEvent[] = [];
  if (result.winner !== 'A') return { save: next, result, events };

  const firstTime = !save.campaign.cleared.includes(stage.id);
  const mult = firstTime ? 1 : ctx.progression.campaign.replayRewardMultiplier;
  const gold = Math.floor(stage.rewards.gold * mult);
  const jobExp = Math.floor(stage.rewards.jobExp * mult);

  next.resources = { ...save.resources, gold: save.resources.gold + gold };
  if (firstTime) next.campaign = { ...save.campaign, cleared: [...save.campaign.cleared, stage.id] };
  if (firstTime && save.campaign.cleared.length === 0 && now !== undefined) next.offline = { ...save.offline, lastClaimAt: now };

  events.push({ type: 'rewards', gold, jobExp, heroIds });
  events.push({ type: 'stageCleared', stageId: stage.id, firstTime });
  const following = ctx.content.stages[stage.globalIndex + 1];
  if (firstTime && following) events.push({ type: 'stageUnlocked', stageId: following.id });

  const expEvents: ProgressEvent[] = [];
  next.heroes = save.heroes.map((h): HeroState => {
    if (!heroIds.includes(h.id)) return h;
    const r = addJobExp(h, jobExp, ctx);
    expEvents.push(...r.events);
    return r.hero;
  });
  events.push(...expEvents);
  if (firstTime) {
    for (const rc of ctx.progression.heroes.recruits) {
      if (rc.afterStage !== stage.id || next.heroes.some((h) => h.name === rc.name)) continue;
      const hero = recruit(next.heroes, rc.name, ctx);
      next.heroes = [...next.heroes, hero];
      // В отряд — на первое свободное место (если есть).
      const free = next.squad.indexOf(null);
      if (free >= 0) next.squad = next.squad.map((id, i) => (i === free ? hero.id : id));
      events.push({ type: 'heroJoined', heroId: hero.id, name: hero.name });
    }
  }
  return { save: next, result, events };
}

/** Новый герой-Новичок джоба 1 со свободным id h<N>. */
function recruit(heroes: HeroState[], name: string, ctx: GameContext): HeroState {
  let n = heroes.length + 1;
  while (heroes.some((h) => h.id === `h${n}`)) n++;
  return { id: `h${n}`, name, job: ctx.progression.heroes.startJob, jobLevel: 1, jobExp: 0, jobHistory: [] };
}
