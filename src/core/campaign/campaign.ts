import { beginCampaignStage, resolveStageEnemies, type CampaignChoices } from './choices';
import type { BattleResult } from '../types';
import { simulateBattle } from '../battle';
import type { UnitDef } from '../content/schema';
import type { HeroState, SaveState } from '../save/schema';
import { buildUnit } from '../heroes/card';
import { addHeroExp, paidHeroTraining } from '../heroes/level';
import { addHeroCard, catchUpLevel, duplicateCardsInSquad, placeInSquad, storyHero } from '../heroes/roster';
import { grantHeroCards, stageHeroCards } from '../heroes/cardDrops';
import { grantTavernWelcome } from '../heroes/summon';
import { GameRuleError, type GameContext, type ProgressEvent } from '../progression/types';
import type { StageInfo } from './schema';
import { withGear } from '../equipment/equipment';
import type { EquipmentConfig } from '../equipment/load';
import { grantBlessedOre } from '../equipment/refine';
import { bankOffline, lastClearedStage } from './offline';
import { rememberChapterSquad, withBondLinks } from '../tavern/tavern';
import { assertDay } from '../features/daily';

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
 * Ступень роста силы врагов этапа: сколько обычных (не вставных, `inserted`) этапов стоит перед ним в кампании.
 * У вставного этапа — ступень предыдущего обычного (не меньше 0). Без вставных этапов — globalIndex.
 * Так вставка этапов в выпущенную главу 1 (ch1_s11…s18) не усилила враги глав 2–7.
 */
export function growthStep(stage: StageInfo, ctx: GameContext): number {
  let n = 0;
  for (const s of ctx.content.stages) {
    if (s.globalIndex >= stage.globalIndex) break;
    if (!s.inserted) n++;
  }
  return stage.inserted ? Math.max(0, n - 1) : n;
}

/**
 * T-B. Отряд врагов этапа: UnitDef монстров со статами hp/atk/def × mult × (1 + growth)^N, N — ступень этапа
 * (growthStep: сквозной номер без вставных этапов; growth = progression.campaign.enemyStatGrowthPerStage; spd не растёт),
 * округление до целых. id юнита — `${stage.id}_${slot}` (у разных слотов разные id), остальное — из data/units.
 */
export function enemySquad(stageId: string, ctx: GameContext, choices?: CampaignChoices): (UnitDef | null)[] {
  const stage = getStage(ctx, stageId);
  const growth = Math.pow(1 + ctx.progression.campaign.enemyStatGrowthPerStage, growthStep(stage, ctx));
  return resolveStageEnemies(stage, choices).map((e, slot) => {
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
  /** Повтор: награда ограничена общим суточным бюджетом; тренировка всегда доступна. */
  replay?: { rewarded: boolean; used: number; limit: number };
}

/** Число победных повторов с добычей за день. Первые прохождения бюджет не расходуют. */
export function replayRewardLimit(ctx: GameContext): number {
  return ctx.progression.campaign.replayDailyWins ?? 6;
}

/**
 * Остаток наград повторов. UI передаёт день явно; без дня повтор — тренировка без добычи.
 * Дата раньше уже использованной не сбрасывает бюджет (перевод часов назад не даёт новых наград).
 */
export function replayAllowance(save: SaveState, day: string | undefined, ctx: GameContext): { used: number; limit: number; remaining: number } {
  const limit = replayRewardLimit(ctx);
  if (day === undefined) return { used: limit, limit, remaining: 0 };
  assertDay(day);
  const farm = save.campaignFarm;
  const used = farm && day <= farm.day ? (day === farm.day ? farm.wins : limit) : 0;
  return { used, limit, remaining: Math.max(0, limit - used) };
}

/**
 * Отряд игрока для боя: save.squad → buildUnit (null — пустой слот). GameRuleError: unknown_hero, empty_squad,
 * duplicate_card (две копии одной карточки в отряде). heroIds — герои отряда по порядку слотов.
 */
export function squadUnits(save: SaveState, ctx: GameContext): { squad: (UnitDef | null)[]; heroIds: string[] } {
  const heroIds: string[] = [];
  const squad = save.squad.map((heroId) => {
    if (heroId === null) return null;
    const hero = save.heroes.find((h) => h.id === heroId);
    if (!hero) throw new GameRuleError('unknown_hero', `Герой ${heroId} не найден`);
    if (!heroIds.includes(hero.id)) heroIds.push(hero.id);
    return buildUnit(hero, ctx);
  });
  if (heroIds.length === 0) throw new GameRuleError('empty_squad', 'В отряде нет героев');
  if (duplicateCardsInSquad(save, save.squad).length) throw new GameRuleError('duplicate_card', 'В отряде может быть только одна копия каждой карточки');
  // Связки близости (вечера в таверне): +% к стату обоим героям пары в отряде.
  return { squad: withBondLinks(squad, save, ctx), heroIds };
}

/**
 * T-B. Сыграть этап. Чистая функция: исходный save не меняется.
 * - GameRuleError('unknown_stage') / ('stage_locked') / ('empty_squad') / ('duplicate_card');
 * - отряд игрока: save.squad → buildUnit(hero) (null — пустой слот);
 * - бой: simulateBattle(ctx.content, squad, enemySquad, seed, { combat: ctx.combat });
 * - battleSeq + 1 всегда;
 * - победа: награда целиком при первом прохождении, × replayRewardMultiplier при повторе (floor); золото в resources,
 *   опыт (rewards.jobExp) — в общий пул героев resources.heroExp (уровни поднимает игрок: heroes/level.ts);
 *   карты случайных героев (heroes/cardDrops.ts: первое прохождение — cards.heroCards.firstClear/bossFirstClear, повтор — replay; бросок от seed);
 *   рекрут (progression.heroes.recruits; первый экземпляр — с догоняющим уровнем roster.catchUpLevel) и подарок Таверны (summon.unlockAfterStage) при первом прохождении;
 *   босс главы при первой победе — «Благословенная руда» (refine.blessedOre, бросок от seed боя, событие blessedOre);
 *   события rewards, heroCard, stageCleared, stageUnlocked, heroJoined (copy — пришла копия уже имеющегося), tavernUnlocked;
 * - поражение: только battleSeq;
 * - P9 (T1-15): первая победа в кампании (cleared был пуст) при переданном now ставит offline.lastClaimAt = now —
 *   сундук копит время с первого пройденного этапа, а не с создания сохранения. Без now lastClaimAt не меняется.
 * - P11 (T4-10): первая победа на этапе новее последнего пройденного при переданном now — bankOffline:
 *   накопленное в сундуке фиксируется по прежней ставке.
 */
export function playStage(save: SaveState, stageId: string, seed: number, ctx: GameContext, now?: number, day?: string): StageOutcome {
  // Экипировка героев из сохранения (если в контексте есть предметы).
  ctx = withGear(ctx, save);
  const stage = getStage(ctx, stageId);
  if (stageStatus(save, stageId, ctx) === 'locked') throw new GameRuleError('stage_locked', `Этап ${stage.name} ещё закрыт`);
  const { squad } = squadUnits(save, ctx);
  const firstTime = !save.campaign.cleared.includes(stage.id);
  const allowance = firstTime ? undefined : replayAllowance(save, day, ctx);

  save = beginCampaignStage(save, stageId, ctx);
  const result = simulateBattle(ctx.content, squad, enemySquad(stageId, ctx, save.campaignChoices), seed, { combat: ctx.combat });
  let next: SaveState = { ...save, battleSeq: save.battleSeq + 1 };
  const events: ProgressEvent[] = [];
  if (result.winner !== 'A') return { save: next, result, events, ...(allowance ? { replay: { rewarded: false, used: allowance.used, limit: allowance.limit } } : {}) };

  const rewarded = firstTime || allowance!.remaining > 0;
  const mult = firstTime ? 1 : rewarded ? ctx.progression.campaign.replayRewardMultiplier : 0;
  const gold = Math.floor(stage.rewards.gold * mult);
  const heroExp = Math.floor(stage.rewards.jobExp * mult);

  // P11 (T4-10): этап новее последнего пройденного меняет ставку сундука — накопленное до сих пор
  // фиксируется по старой ставке (offline.banked), дальше копится по новой.
  const prevLast = lastClearedStage(save, ctx);
  if (firstTime && prevLast && stage.globalIndex > prevLast.globalIndex && now !== undefined) next.offline = bankOffline(save, now, ctx).offline;
  next.resources = { ...save.resources, gold: save.resources.gold + gold };
  next = addHeroExp(next, heroExp);
  if (!firstTime && rewarded) next.campaignFarm = { day: day!, wins: allowance!.used + 1 };
  if (firstTime) {
    next.campaign = { ...save.campaign, cleared: [...save.campaign.cleared, stage.id] };
    if (ctx.content.stages.filter(s => s.chapter === stage.chapter).at(-1)?.id === stage.id) {
      const participants = squad.flatMap(unit => {
        const hero = unit && save.heroes.find(h => h.id === unit.id);
        return hero ? [hero.templateId] : [];
      });
      next = rememberChapterSquad(next, stage.chapter, participants, ctx);
    }
  }
  if (firstTime && save.campaign.cleared.length === 0 && now !== undefined) next.offline = { ...save.offline, lastClaimAt: now };

  events.push({ type: 'rewards', gold, heroExp });
  // Карты случайных героев: первое прохождение (босс главы — больше) и повтор — по шансам (от seed боя).
  if (rewarded) {
    const cards = grantHeroCards(next, stageHeroCards(stage, firstTime, seed, ctx), ctx);
    next = cards.save;
    events.push(...cards.events);
  }
  if (firstTime && stage.boss) {
    const ore = grantBlessedOre(next, seed, ctx as { equipment?: EquipmentConfig });
    next = ore.save;
    if (ore.count) events.push({ type: 'blessedOre', count: ore.count });
  }
  events.push({ type: 'stageCleared', stageId: stage.id, firstTime });
  const following = ctx.content.stages[stage.globalIndex + 1];
  if (firstTime && following) events.push({ type: 'stageUnlocked', stageId: following.id });

  if (firstTime) {
    for (const rc of ctx.progression.heroes.recruits) {
      if (rc.afterStage !== stage.id) continue;
      const t = ctx.content.heroes[rc.template];
      if (!t) continue;
      // Герой уже есть (из Таверны или миграции) — приходит его зелёная копия (корм для вознесения).
      const had = storyHero(next, rc.template);
      if (had) {
        // RR-01: догоняющий уровень — и сильнейшему экземпляру, если он ниже среднего по отряду (Грета из Таверны ур. 1
        // на «Глава пройдена» — ур. отряда). Уровни до него — дар (grantedLevel), в отряд — на свободное место.
        const lvl = catchUpLevel(next, had.rarity, ctx);
        const raised = lvl > had.level;
        // В старых сохранениях ledger ещё нет: зафиксировать оплату до того, как подарок поднимет её нижнюю границу.
        const best: HeroState = raised ? { ...had, level: lvl, grantedLevel: Math.max(had.grantedLevel ?? 1, lvl), training: paidHeroTraining(had, ctx) } : had;
        const r = addHeroCard(raised ? { ...next, heroes: next.heroes.map((h) => (h.id === had.id ? best : h)) } : next, rc.template, t.baseRarity);
        next = { ...r.save, squad: placeInSquad(r.save.squad, best, r.save, ctx) };
        const benched = !next.squad.includes(best.id);
        events.push({ type: 'heroJoined', heroId: best.id, templateId: rc.template, name: t.name, level: best.level, copy: true, ...(raised ? { caughtUp: true } : {}), ...(benched ? { benched: true } : {}) });
        continue;
      }
      // RN-02: первый экземпляр приходит с догоняющим уровнем (средний по отряду, в пределах редкости) — даром, без возврата в корм.
      const r = addHeroCard(next, rc.template, t.baseRarity, { level: catchUpLevel(next, t.baseRarity, ctx), granted: true });
      // В отряд — на свободное место (передние — с первого слота, задние — с последнего), если есть.
      next = { ...r.save, squad: placeInSquad(r.save.squad, r.hero, r.save, ctx) };
      // benched — отряд полон, герой ждёт в коллекции (UI зовёт поставить его в отряд).
      const benched = !next.squad.includes(r.hero.id);
      events.push({ type: 'heroJoined', heroId: r.hero.id, templateId: rc.template, name: t.name, level: r.hero.level, ...(benched ? { benched: true } : {}) });
    }
    const w = grantTavernWelcome(next, ctx);
    next = w.save;
    events.push(...w.events);
  }
  return { save: next, result, events, ...(allowance ? { replay: { rewarded, used: allowance.used + (rewarded ? 1 : 0), limit: allowance.limit } } : {}) };
}
