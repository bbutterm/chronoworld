import type { SaveState } from '../save/schema';
import type { StageInfo } from './schema';
import { addHeroExp } from '../heroes/level';
import type { GameContext, ProgressEvent } from '../progression/types';
import { bankedChestLoot, chestAnchorAt, chestSeed, chestTicks, EMPTY_LOOT, grantChestLoot, lootEmpty, rollChestLoot, type ChestLoot, type ChestLootGrant } from '../equipment/chest';
import type { EquipmentConfig } from '../equipment/load';
import { grantChestIngredients, type Pantry } from '../kitchen/kitchen';

export interface OfflineRewards {
  /** Засчитанные минуты (с учётом лимита). */
  minutes: number;
  gold: number;
  /** Опыт в общий пул героев (resources.heroExp). */
  jobExp: number;
}

const MINUTE = 60_000;

/** GameContext + (необязательно) экипировка: с ней в сундуке ещё и трофеи (data/drops.json → chest). */
type ChestContext = GameContext & { equipment?: EquipmentConfig };

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
 * не обгоняли темп первых этапов (P9, T1-01). Дальше опыт растёт вместе со ставкой этапа.
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
export function syncOfflineClock(save: SaveState, now: number, ctx: ChestContext): SaveState {
  const o = save.offline;
  if (!(now < o.lastClaimAt)) return save;
  const cap = capMs(ctx);
  const debtMs = Math.min(cap, (o.debtMs ?? 0) + Math.min(o.lastClaimAt - now, cap));
  const loot = bankedChestLoot(save, ctx.equipment?.drops.chest?.tickMinutes);
  const { bankedLoot: _oldLoot, ...rest } = o;
  return { ...save, offline: { ...rest, lastClaimAt: now, lootAnchorAt: chestAnchorAt(o), lootStateAt: now,
    ...(loot.ticks > 0 ? { bankedLoot: loot } : {}), debtMs } };
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
function settled(o: OfflineState, now: number, debtLeft: number, banked?: OfflineRewards, loot?: ChestLoot): OfflineState {
  const { debtMs: _d, banked: _b, bankedLoot: _l, lootAnchorAt: _a, lootStateAt: _s, ...rest } = o;
  return { ...rest, lastClaimAt: now, ...(debtLeft > 0 ? { debtMs: debtLeft } : {}),
    ...(banked ? { lootAnchorAt: chestAnchorAt(o), lootStateAt: now, banked,
      ...(loot && loot.ticks > 0 ? { bankedLoot: loot } : {}) } : {}) };
}

/** Завершённые тики остаются снимком; только новые тики используют правило действующей главы. */
function accruedLoot(save: SaveState, minutes: number, last: StageInfo | undefined, ctx: ChestContext): ChestLoot {
  const banked = bankedChestLoot(save, ctx.equipment?.drops.chest?.tickMinutes);
  const ticks = Math.max(0, chestTicks(minutes, ctx) - banked.ticks);
  const fresh = last ? rollChestLoot(last.chapter, ticks, chestSeed(save), ctx, banked.ticks) : EMPTY_LOOT;
  return { ticks: banked.ticks + fresh.ticks, items: [...banked.items, ...fresh.items],
    cards: [...banked.cards, ...fresh.cards], gems: banked.gems + fresh.gems, scrolls: banked.scrolls + fresh.scrolls };
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
 * Трофеи сундука к моменту now (предметы, карты героя, гемы, свитки — equipment/chest.ts): по тику на каждые
 * chest.tickMinutes засчитанных минут (включая banked, в пределах лимита). Завершённые тики — из снимка,
 * новые — по правилу главы последнего пройденного этапа; seed — от сохранения и якоря цикла (chestSeed).
 * Новые этапы/главы не перебрасывают накопленные трофеи. Без конфига новые тики не бросаются.
 * Совпадает с тем, что даст claimOffline в тот же now.
 */
export function offlineLoot(save: SaveState, now: number, ctx: ChestContext): ChestLoot {
  if (!Number.isFinite(now)) return { ...EMPTY_LOOT, items: [] };
  const s = syncOfflineClock(save, now, ctx);
  const last = lastClearedStage(s, ctx);
  const { rewards } = accrue(s.offline, now, last, ctx);
  return accruedLoot(s, rewards.minutes, last, ctx);
}

/** Через сколько мс сундук заполнится (0 — уже полон; нет пройденных этапов — null: сундук не копится). */
export function offlineFullInMs(save: SaveState, now: number, ctx: GameContext): number | null {
  if (!Number.isFinite(now)) return null;
  const s = syncOfflineClock(save, now, ctx);
  if (!lastClearedStage(s, ctx)) return null;
  const o = s.offline;
  // Полон, когда время после погашения долга покроет свободное место (лимит минус banked).
  const roomMs = Math.max(0, ctx.progression.offline.capHours * 60 - (o.banked?.minutes ?? 0)) * MINUTE;
  return Math.max(0, (o.debtMs ?? 0) + roomMs - Math.max(0, now - o.lastClaimAt));
}

/**
 * P11 (T4-10). Зафиксировать доход по текущей ставке в offline.banked, трофеи — в bankedLoot.
 * Отсчёт ставки начинается заново с now, поток случайных трофеев продолжается до сбора сундука.
 * playStage зовёт перед тем, как новый пройденный этап поменяет ставку. Чистая функция.
 */
export function bankOffline(save: SaveState, now: number, ctx: ChestContext): SaveState {
  if (!Number.isFinite(now)) return save;
  const s = syncOfflineClock(save, now, ctx);
  const last = lastClearedStage(s, ctx);
  const { rewards, debtLeft } = accrue(s.offline, now, last, ctx);
  const loot = accruedLoot(s, rewards.minutes, last, ctx);
  return { ...s, offline: settled(s.offline, now, debtLeft, rewards, loot) };
}

/**
 * T-B. Забрать сундук: золото в ресурсы, jobExp — в общий пул опыта героев (resources.heroExp),
 * трофеи (offlineLoot на тот же now: предметы в инвентарь, гемы и свитки, карты случайных героев),
 * lastClaimAt = now и banked очищается — всегда, даже при нулевой награде (UI обязан записать результат,
 * иначе якорь не сдвинется, T4-06). При часах назад — долг (см. syncOfflineClock). Чистая функция.
 */
export function claimOffline(
  save: SaveState,
  now: number,
  ctx: ChestContext,
): { save: SaveState; rewards: OfflineRewards; loot: ChestLootGrant; events: ProgressEvent[]; ingredients?: Pantry } {
  const noLoot: ChestLootGrant = { ...EMPTY_LOOT, items: [], cards: [], added: [], heroEvents: [] };
  // Время не число (сбой часов) — ничего не начисляем и якорь не портим.
  if (!Number.isFinite(now)) return { save, rewards: { minutes: 0, gold: 0, jobExp: 0 }, loot: noLoot, events: [] };
  const s = syncOfflineClock(save, now, ctx);
  const last = lastClearedStage(s, ctx);
  const { rewards, debtLeft } = accrue(s.offline, now, last, ctx);
  const rolled = accruedLoot(s, rewards.minutes, last, ctx);
  const events: ProgressEvent[] = [];
  let next: SaveState = addHeroExp(
    {
      ...s,
      resources: { ...s.resources, gold: s.resources.gold + rewards.gold },
      offline: settled(s.offline, now, debtLeft),
    },
    rewards.jobExp,
  );
  if (rewards.gold > 0 || rewards.jobExp > 0) events.push({ type: 'rewards', gold: rewards.gold, heroExp: rewards.jobExp });
  let loot = noLoot;
  if (rolled && !lootEmpty(rolled)) {
    const g = grantChestLoot(next, rolled, ctx);
    next = g.save;
    loot = g.grant;
    events.push(...loot.heroEvents);
  }
  // Кухня: продукты за полные тики сундука (бросок от seed сундука до сбора).
  const food = grantChestIngredients(next, chestTicks(rewards.minutes, ctx), chestSeed(s), ctx);
  next = food.save;
  return { save: next, rewards, loot, events, ...(Object.keys(food.gained).length ? { ingredients: food.gained } : {}) };
}
