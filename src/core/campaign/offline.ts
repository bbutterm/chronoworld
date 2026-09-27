import type { SaveState } from '../save/schema';
import type { StageInfo } from './schema';
import { addJobExp } from '../progression/exp';
import type { GameContext, ProgressEvent } from '../progression/types';

export interface OfflineRewards {
  /** Засчитанные минуты (с учётом лимита). */
  minutes: number;
  gold: number;
  jobExp: number;
}

const MINUTE = 60_000;

/** Последний пройденный этап (max globalIndex среди cleared); нет пройденных — undefined. */
export function lastClearedStage(save: SaveState, ctx: GameContext): StageInfo | undefined {
  const cleared = new Set(save.campaign.cleared);
  let last: StageInfo | undefined;
  for (const s of ctx.content.stages) if (cleared.has(s.id) && (!last || s.globalIndex > last.globalIndex)) last = s;
  return last;
}

/**
 * Доход «простоя» (сундук, быстрые награды) за minutes минут, пока stage — последний пройденный этап.
 * Золото — offlinePerMinute.gold × minutes. Опыт — offlinePerMinute.jobExp × minutes, а на первых
 * progression.offline.earlyExp.stages этапах кампании ещё и не больше
 * floor(rewards.jobExp × earlyExp.stageRewardsPerHour × minutes / 60) — чтобы быстрые награды в начале главы 1
 * не давали джоб 10 раньше этапа 4 (P9, T1-01). Дальше опыт растёт вместе со ставкой этапа.
 */
export function idleIncome(stage: StageInfo, minutes: number, ctx: GameContext): { gold: number; jobExp: number } {
  let jobExp = stage.offlinePerMinute.jobExp * minutes;
  const early = ctx.progression.offline.earlyExp;
  if (early && stage.globalIndex < early.stages) {
    jobExp = Math.min(jobExp, Math.floor((stage.rewards.jobExp * early.stageRewardsPerHour * minutes) / 60));
  }
  return { gold: stage.offlinePerMinute.gold * minutes, jobExp };
}

type OfflineState = SaveState['offline'];

const capMs = (ctx: GameContext) => ctx.progression.offline.capHours * 60 * MINUTE;

/**
 * P11 (T4-06, T4-09). Привести якорь сундука к часам now. Часы переведены назад (now < lastClaimAt) —
 * lastClaimAt = now, а debtMs += min(скачок, лимит сундука) (не больше лимита): выплаченное «из будущего»
 * отрабатывается реальным временем, но сундук не замирает на весь скачок. Иначе — тот же объект save.
 * UI зовёт при запуске (session) — сундук оживает и без нажатия «Собрать». Чистая функция.
 */
export function syncOfflineClock(save: SaveState, now: number, ctx: GameContext): SaveState {
  const o = save.offline;
  if (!(now < o.lastClaimAt)) return save;
  const cap = capMs(ctx);
  const debtMs = Math.min(cap, (o.debtMs ?? 0) + Math.min(o.lastClaimAt - now, cap));
  return { ...save, offline: { ...o, lastClaimAt: now, debtMs } };
}

/** Накопленное с lastClaimAt по ставке этапа last (после долга и лимита) + сколько долга погашено. */
function accrue(o: OfflineState, now: number, last: StageInfo | undefined, ctx: GameContext): { rewards: OfflineRewards; debtLeft: number } {
  const banked = o.banked ?? { minutes: 0, gold: 0, jobExp: 0 };
  const diff = now - o.lastClaimAt;
  const elapsed = diff > 0 ? diff : 0;
  const debt = o.debtMs ?? 0;
  const paid = Math.min(debt, elapsed);
  const roomMin = Math.max(0, ctx.progression.offline.capHours * 60 - banked.minutes);
  const minutes = last ? Math.floor(Math.min(elapsed - paid, roomMin * MINUTE) / MINUTE) : 0;
  const inc = last && minutes > 0 ? idleIncome(last, minutes, ctx) : { gold: 0, jobExp: 0 };
  return {
    rewards: { minutes: banked.minutes + minutes, gold: banked.gold + inc.gold, jobExp: banked.jobExp + inc.jobExp },
    debtLeft: debt - paid,
  };
}

/** Состояние сундука после расчёта на now: якорь = now, долг погашен на прошедшее время, banked — как передан. */
function settled(o: OfflineState, now: number, debtLeft: number, banked?: OfflineRewards): OfflineState {
  const { debtMs: _d, banked: _b, ...rest } = o;
  return { ...rest, lastClaimAt: now, ...(debtLeft > 0 ? { debtMs: debtLeft } : {}), ...(banked && banked.minutes > 0 ? { banked } : {}) };
}

/**
 * T-B. Сколько накопилось в сундуке к моменту now (мс).
 * P11 (T4-10): offline.banked (накоплено по ставке прежних этапов) + доход последнего пройденного этапа
 * (max globalIndex среди cleared) за время с lastClaimAt; нет пройденных — только banked.
 * minutes всего не больше capHours; сначала погашается долг debtMs (T4-09); now < lastClaimAt
 * (часы переведены назад) — копится ноль (якорь поправит syncOfflineClock / claimOffline).
 * Время копится с первой победы в кампании (P9, T1-15: playStage с now ставит lastClaimAt = now при первой победе).
 */
export function offlineRewards(save: SaveState, now: number, ctx: GameContext): OfflineRewards {
  const s = syncOfflineClock(save, now, ctx);
  return accrue(s.offline, now, lastClearedStage(s, ctx), ctx).rewards;
}

/**
 * P11 (T4-10). Зафиксировать накопленное по текущей ставке в offline.banked и начать отсчёт заново с now.
 * playStage зовёт перед тем, как новый пройденный этап поменяет ставку. Чистая функция.
 */
export function bankOffline(save: SaveState, now: number, ctx: GameContext): SaveState {
  if (!Number.isFinite(now)) return save;
  const s = syncOfflineClock(save, now, ctx);
  const { rewards, debtLeft } = accrue(s.offline, now, lastClearedStage(s, ctx), ctx);
  return { ...s, offline: settled(s.offline, now, debtLeft, rewards) };
}

/**
 * T-B. Забрать сундук: золото в ресурсы, jobExp каждому герою из save.heroes (через addJobExp),
 * lastClaimAt = now и banked очищается — всегда, даже при нулевой награде (UI обязан записать результат,
 * иначе якорь не сдвинется, T4-06). При часах назад — долг (см. syncOfflineClock). Чистая функция.
 */
export function claimOffline(save: SaveState, now: number, ctx: GameContext): { save: SaveState; rewards: OfflineRewards; events: ProgressEvent[] } {
  // Время не число (сбой часов) — ничего не начисляем и якорь не портим.
  if (!Number.isFinite(now)) return { save, rewards: { minutes: 0, gold: 0, jobExp: 0 }, events: [] };
  const s = syncOfflineClock(save, now, ctx);
  const { rewards, debtLeft } = accrue(s.offline, now, lastClearedStage(s, ctx), ctx);
  const events: ProgressEvent[] = [];
  const next: SaveState = {
    ...s,
    resources: { ...s.resources, gold: s.resources.gold + rewards.gold },
    offline: settled(s.offline, now, debtLeft),
  };
  if (rewards.gold > 0 || rewards.jobExp > 0) {
    events.push({ type: 'rewards', gold: rewards.gold, jobExp: rewards.jobExp, heroIds: s.heroes.map((h) => h.id) });
  }
  if (rewards.jobExp > 0) {
    next.heroes = s.heroes.map((h) => {
      const r = addJobExp(h, rewards.jobExp, ctx);
      events.push(...r.events);
      return r.hero;
    });
  }
  return { save: next, rewards, events };
}
