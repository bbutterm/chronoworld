import type { z } from 'zod';
import { simulateBattle } from '../battle';
import type { UnitDef } from '../content/schema';
import type { FeatureEvent } from '../features/config';
import { addJobExp } from '../progression/exp';
import { buildUnit } from '../progression/stats';
import { GameRuleError, type GameContext } from '../progression/types';
import type { HeroState, SaveState } from '../save/schema';
import type { BattleResult, Content } from '../types';
import { TowerConfigSchema, type TowerBand, type TowerConfig } from './schema';

/** Коды ошибок башни (отдельный класс, чтобы не трогать общие GameRuleError/FeatureError). */
export type TowerErrorCode = 'invalid_config' | 'invalid_floor' | 'tower_locked' | 'tower_completed';

/** Нарушение правил башни. message — русский текст для игрока. */
export class TowerError extends Error {
  override name = 'TowerError';
  constructor(
    public code: TowerErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** GameContext + конфиг башни. */
export interface TowerContext extends GameContext {
  tower: TowerConfig;
}

export interface TowerRewards {
  gold: number;
  gems: number;
  /** Каждому герою отряда. */
  jobExp: number;
}

export interface TowerFloor {
  floor: number;
  boss: boolean;
  /** Полоса этажей (индекс в tower.bands). */
  band: number;
  /** 5 слотов врагов, как enemySquad; id юнита — `tower_f${floor}_${slot}`. */
  enemies: (UnitDef | null)[];
  rewards: TowerRewards;
}

export type TowerEvent = FeatureEvent | { type: 'towerFloorCleared'; floor: number; boss: boolean };

export interface TowerOutcome {
  save: SaveState;
  /** Какой этаж штурмовали. */
  floor: number;
  result: BattleResult;
  events: TowerEvent[];
}

export interface TowerStatus {
  unlocked: boolean;
  /** Этап, после которого башня откроется (null — открыта сразу). */
  unlockAfterStage: string | null;
  /** Последний пройденный этаж (0 — не начата). */
  floor: number;
  /** Следующий этаж или null, если башня пройдена. */
  next: number | null;
  maxFloor: number;
}

/**
 * Перекрёстные проверки башни с контентом: враги существуют и имеют kind monster/boss,
 * в каждом bossLayouts есть босс, unlockAfterStage — существующий этап, первая полоса не выше maxFloor.
 */
export function validateTower(cfg: TowerConfig, content: Content, problems: string[]): void {
  if (cfg.unlockAfterStage && !content.stages.some((s) => s.id === cfg.unlockAfterStage)) {
    problems.push(`башня: unlockAfterStage ${cfg.unlockAfterStage} — нет такого этапа кампании`);
  }
  cfg.bands.forEach((b, i) => {
    const where = `башня: полоса ${i + 1} (с ${b.fromFloor} этажа)`;
    if (b.fromFloor > cfg.maxFloor) problems.push(`${where}: начинается выше maxFloor ${cfg.maxFloor}`);
    const check = (layouts: TowerBand['layouts'], what: string, needBoss: boolean) =>
      layouts.forEach((l, j) => {
        for (const e of l) {
          if (!e) continue;
          const u = content.units[e.unit];
          if (!u) problems.push(`${where}, ${what}[${j}]: враг ${e.unit} не найден в data/units`);
          else if (u.kind !== 'monster' && u.kind !== 'boss') problems.push(`${where}, ${what}[${j}]: ${e.unit} — не монстр (kind ${u.kind})`);
        }
        if (needBoss && !l.some((e) => e && content.units[e.unit]?.kind === 'boss')) problems.push(`${where}, ${what}[${j}]: нет юнита kind boss`);
      });
    check(b.layouts, 'layouts', false);
    check(b.bossLayouts, 'bossLayouts', true);
  });
}

function describe(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.length ? i.path.map(String).join('.') : '(корень)'}: ${i.message}`)
    .join('; ');
}

/** Разобрать data/tower.json (ядро файлы не читает). Ошибка схемы → TowerError('invalid_config'). */
export function parseTowerConfig(json: unknown): TowerConfig {
  const r = TowerConfigSchema.safeParse(json);
  if (!r.success) throw new TowerError('invalid_config', `data/tower.json: ${describe(r.error)}`);
  return r.data;
}

/** GameContext → TowerContext: схема + перекрёстные проверки (TowerError('invalid_config') со списком проблем). */
export function withTower<C extends GameContext>(ctx: C, towerJson: unknown): C & { tower: TowerConfig } {
  const tower = parseTowerConfig(towerJson);
  const problems: string[] = [];
  validateTower(tower, ctx.content, problems);
  if (problems.length) throw new TowerError('invalid_config', `data/tower.json: ${problems.join('; ')}`);
  return { ...ctx, tower };
}

function bandIndex(cfg: TowerConfig, floor: number): number {
  let idx = 0;
  cfg.bands.forEach((b, i) => {
    if (b.fromFloor <= floor) idx = i;
  });
  return idx;
}

/**
 * Этаж n (1…maxFloor): состав, сила врагов и награда — по правилам data/tower.json.
 * Детерминирован: зависит только от n и конфига. TowerError('invalid_floor') — n вне диапазона.
 */
export function towerFloor(n: number, ctx: TowerContext): TowerFloor {
  const cfg = ctx.tower;
  if (!Number.isInteger(n) || n < 1 || n > cfg.maxFloor) throw new TowerError('invalid_floor', `В башне нет этажа ${n} (всего ${cfg.maxFloor})`);
  const boss = n % cfg.bossEvery === 0;
  const band = bandIndex(cfg, n);
  const b = cfg.bands[band];
  let layout;
  if (boss) {
    // Номер босса внутри полосы: 0 для первого босс-этажа не ниже fromFloor.
    const firstBoss = Math.ceil(b.fromFloor / cfg.bossEvery) * cfg.bossEvery;
    layout = b.bossLayouts[((n - firstBoss) / cfg.bossEvery) % b.bossLayouts.length];
  } else {
    layout = b.layouts[(n - b.fromFloor) % b.layouts.length];
  }
  const growth = cfg.baseMult * Math.pow(1 + cfg.statGrowthPerFloor, n - 1);
  const enemies = layout.map((e, slot): UnitDef | null => {
    if (!e) return null;
    const base = ctx.content.units[e.unit];
    if (!base) throw new TowerError('invalid_config', `Башня, этаж ${n}: враг ${e.unit} не найден`);
    const k = e.mult * growth;
    return {
      ...base,
      id: `tower_f${n}_${slot}`,
      stats: {
        ...base.stats,
        hp: Math.max(1, Math.round(base.stats.hp * k)),
        atk: Math.round(base.stats.atk * k),
        def: Math.round(base.stats.def * k),
      },
    };
  });
  const r = cfg.rewards;
  const m = boss ? r.bossMultiplier : 1;
  const rewards: TowerRewards = {
    gold: Math.floor((r.gold.base + r.gold.perFloor * (n - 1)) * m),
    jobExp: Math.floor((r.jobExp.base + r.jobExp.perFloor * (n - 1)) * m),
    gems: boss ? r.bossGems : 0,
  };
  return { floor: n, boss, band, enemies, rewards };
}

/** Открыта ли башня: unlockAfterStage не задан или этап пройден. */
export function towerUnlocked(save: SaveState, ctx: TowerContext): boolean {
  const stage = ctx.tower.unlockAfterStage;
  return stage === null || save.campaign.cleared.includes(stage);
}

/** Состояние башни для экрана. */
export function towerStatus(save: SaveState, ctx: TowerContext): TowerStatus {
  const floor = save.tower.floor;
  return {
    unlocked: towerUnlocked(save, ctx),
    unlockAfterStage: ctx.tower.unlockAfterStage,
    floor,
    next: floor < ctx.tower.maxFloor ? floor + 1 : null,
    maxFloor: ctx.tower.maxFloor,
  };
}

/**
 * K4. Штурм следующего этажа (save.tower.floor + 1) отрядом save.squad. Чистая функция.
 * - TowerError('tower_locked') — не пройден unlockAfterStage; ('tower_completed') — пройден maxFloor;
 * - GameRuleError('unknown_hero') / ('empty_squad') — как у playStage;
 * - battleSeq + 1 всегда;
 * - победа: tower.floor + 1, золото и гемы в ресурсы, jobExp каждому герою отряда (addJobExp);
 *   события rewards, gems (если > 0), towerFloorCleared, события addJobExp;
 * - поражение: только battleSeq. Повторов этажей нет — награда за этаж даётся один раз.
 */
export function climbTower(save: SaveState, seed: number, ctx: TowerContext): TowerOutcome {
  if (!towerUnlocked(save, ctx)) {
    const stage = ctx.content.stages.find((s) => s.id === ctx.tower.unlockAfterStage);
    throw new TowerError('tower_locked', `Башня откроется после этапа «${stage?.name ?? ctx.tower.unlockAfterStage}»`);
  }
  const n = save.tower.floor + 1;
  if (n > ctx.tower.maxFloor) throw new TowerError('tower_completed', 'Башня пройдена до вершины');
  const floor = towerFloor(n, ctx);

  const heroIds: string[] = [];
  const squad = save.squad.map((heroId) => {
    if (heroId === null) return null;
    const hero = save.heroes.find((h) => h.id === heroId);
    if (!hero) throw new GameRuleError('unknown_hero', `Герой ${heroId} не найден`);
    if (!heroIds.includes(hero.id)) heroIds.push(hero.id);
    return buildUnit(hero, ctx);
  });
  if (heroIds.length === 0) throw new GameRuleError('empty_squad', 'В отряде нет героев');

  const result = simulateBattle(ctx.content, squad, floor.enemies, seed, { combat: ctx.combat });
  const next: SaveState = { ...save, battleSeq: save.battleSeq + 1 };
  const events: TowerEvent[] = [];
  if (result.winner !== 'A') return { save: next, floor: n, result, events };

  const { gold, gems, jobExp } = floor.rewards;
  next.tower = { ...save.tower, floor: n };
  next.resources = { ...save.resources, gold: save.resources.gold + gold };
  next.currency = { ...save.currency, gems: save.currency.gems + gems };
  events.push({ type: 'rewards', gold, jobExp, heroIds });
  if (gems > 0) events.push({ type: 'gems', amount: gems });
  events.push({ type: 'towerFloorCleared', floor: n, boss: floor.boss });
  next.heroes = save.heroes.map((h): HeroState => {
    if (!heroIds.includes(h.id)) return h;
    const r = addJobExp(h, jobExp, ctx);
    events.push(...r.events);
    return r.hero;
  });
  return { save: next, floor: n, result, events };
}
