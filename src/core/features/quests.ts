import { z } from 'zod';
import { syncAchievementCounters } from '../meta/achievements';
import { addHeroExp } from '../heroes/level';
import type { SaveState } from '../save/schema';
import type { FeatureContext, FeatureEvent } from './config';
import { rollDay } from './daily';
import { FeatureError } from './errors';
import { featureUnlocked } from '../unlocks/unlocks';
import { FEATURE_IDS } from '../unlocks/schema';

/**
 * Виды событий, которые обёртки actions.ts записывают в daily.quests (recordActivity).
 * expedition_claim — добыча экспедиций (actClaimExpedition / actClaimAllExpeditions, по числу экспедиций).
 */
export const RECORDED_KINDS = ['stage_win', 'stage_attempt', 'offline_claim', 'fast_rewards', 'summon', 'hero_level_up', 'hero_ascend', 'tower_attempt', 'expedition_claim'] as const;
export type RecordedKind = (typeof RECORDED_KINDS)[number];

/**
 * Виды, которые не записываются, а читаются из собственного суточного состояния системы (daily-loop-2026-10-10):
 * hunt_attempt — попыток Охоты сегодня (save.hunt.used, если save.hunt.day — сегодня; зачистка тоже попытка);
 * shop_buy — покупок в Лавке сегодня (сумма save.shop.boughtToday за сегодняшний ассортимент);
 * arena_wins — лучший итог побед Арены за сегодня (rewardWins дня награды или победы текущего матча, начатого сегодня).
 * Так задания видят Охоту, Лавку и Арену без новых полей сохранения и без правок их экранов.
 */
export const DERIVED_KINDS = ['hunt_attempt', 'shop_buy', 'arena_wins'] as const;
export type DerivedKind = (typeof DERIVED_KINDS)[number];

/** Все виды заданий дня (поле event в data/quests.json). */
export const ACTIVITY_KINDS = [...RECORDED_KINDS, ...DERIVED_KINDS] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id: латиница в нижнем регистре, цифры и _');

export const QuestDefSchema = z.object({
  id,
  name: z.string(),
  /** Какое событие двигает счётчик. */
  event: z.enum(ACTIVITY_KINDS),
  /** Сколько событий нужно за день. */
  target: z.number().int().positive(),
  /** Очки активности за получение награды задания. */
  points: z.number().int().nonnegative(),
  /**
   * Функция из data/unlocks.json, без которой задание не показывается (Охота, Арена, Лавка…): новичок не видит
   * невыполнимых заданий. Нет — задание видно сразу.
   */
  unlock: z.enum(FEATURE_IDS).optional(),
});

export const MilestoneRewardsSchema = z.object({
  gold: z.number().int().nonnegative().default(0),
  gems: z.number().int().nonnegative().default(0),
  /** Опыт в общий пул героев (как у офлайн-сундука). */
  jobExp: z.number().int().nonnegative().default(0),
});

export const MilestoneSchema = z.object({
  /** Порог очков активности. */
  points: z.number().int().positive(),
  rewards: MilestoneRewardsSchema,
});

/** data/quests.json */
export const QuestsConfigSchema = z
  .object({
    $comment: z.string().optional(),
    quests: z.array(QuestDefSchema),
    milestones: z.array(MilestoneSchema),
  })
  .superRefine((cfg, c) => {
    const seen = new Set<string>();
    cfg.quests.forEach((q, i) => {
      if (seen.has(q.id)) c.addIssue({ code: 'custom', path: ['quests', i, 'id'], message: `задание ${q.id} встречается дважды` });
      seen.add(q.id);
    });
    cfg.milestones.forEach((m, i) => {
      if (i > 0 && m.points <= cfg.milestones[i - 1].points) {
        c.addIssue({ code: 'custom', path: ['milestones', i, 'points'], message: 'пороги активности должны строго возрастать' });
      }
    });
  });

export type QuestDef = z.infer<typeof QuestDefSchema>;
export type Milestone = z.infer<typeof MilestoneSchema>;
export type MilestoneRewards = z.infer<typeof MilestoneRewardsSchema>;
export type QuestsConfig = z.infer<typeof QuestsConfigSchema>;

/**
 * Засчитать событие для ежедневных заданий: rollDay, затем daily.quests[kind] += amount.
 * amount ≤ 0 — ничего не меняет (но день всё равно переключается). Чистая функция.
 */
export function recordActivity(save: SaveState, day: string, kind: RecordedKind, amount = 1): SaveState {
  const s = rollDay(save, day);
  if (!(amount > 0)) return s;
  const n = Math.floor(amount);
  return { ...s, daily: { ...s.daily, quests: { ...s.daily.quests, [kind]: (s.daily.quests[kind] ?? 0) + n } } };
}

export interface QuestView extends QuestDef {
  /** Счётчик, не больше target. */
  progress: number;
  done: boolean;
  claimed: boolean;
}

export interface MilestoneView extends Milestone {
  reached: boolean;
  claimed: boolean;
}

export interface QuestStatus {
  day: string;
  quests: QuestView[];
  /** Очки активности = сумма points полученных заданий. */
  activity: number;
  /** Максимум очков за день (сумма points всех заданий). */
  maxActivity: number;
  milestones: MilestoneView[];
}

/**
 * Счётчик задания на сегодня (s.daily.day; rollDay — до вызова). Записываемые виды — из daily.quests,
 * производные (DERIVED_KINDS) — из суточного состояния Охоты, Лавки и Арены. Чистая функция.
 */
export function questCounter(s: SaveState, kind: ActivityKind): number {
  const day = s.daily.day;
  switch (kind) {
    case 'hunt_attempt':
      return s.hunt && s.hunt.day === day ? s.hunt.used : 0;
    case 'shop_buy':
      return s.shop && s.shop.day === day ? Object.values(s.shop.boughtToday).reduce((a, n) => a + n, 0) : 0;
    case 'arena_wins': {
      const ab = s.autobattler;
      if (!ab) return 0;
      const done = ab.rewardDay === day ? (ab.rewardWins ?? 0) : 0;
      const live = ab.run && ab.run.day === day ? ab.run.wins : 0;
      return Math.max(done, live);
    }
    default:
      return s.daily.quests[kind] ?? 0;
  }
}

/** Задание видно игроку: его функция открыта (unlock) или условия нет. */
export function questVisible(save: SaveState, q: QuestDef, ctx: FeatureContext): boolean {
  return !q.unlock || featureUnlocked(save, q.unlock, ctx);
}

/** Текущие очки активности. */
export function activityPoints(save: SaveState, ctx: FeatureContext): number {
  const claimed = new Set(save.daily.claimedQuests);
  return ctx.features.quests.quests.reduce((sum, q) => sum + (claimed.has(q.id) ? q.points : 0), 0);
}

/**
 * Состояние заданий для экрана. Если передан day — сначала rollDay (без него показываются счётчики
 * из сохранения как есть, даже если день уже сменился).
 */
export function questStatus(save: SaveState, ctx: FeatureContext, day?: string): QuestStatus {
  const s = day === undefined ? save : rollDay(save, day);
  const claimed = new Set(s.daily.claimedQuests);
  const activity = activityPoints(s, ctx);
  const cfg = ctx.features.quests;
  const visible = cfg.quests.filter((q) => questVisible(s, q, ctx));
  return {
    day: s.daily.day,
    quests: visible.map((q) => {
      const raw = questCounter(s, q.event);
      return { ...q, progress: Math.min(raw, q.target), done: raw >= q.target, claimed: claimed.has(q.id) };
    }),
    activity,
    maxActivity: visible.reduce((sum, q) => sum + q.points, 0),
    milestones: cfg.milestones.map((m) => ({ ...m, reached: activity >= m.points, claimed: s.daily.activityClaimed.includes(m.points) })),
  };
}

/**
 * Получить очки активности за выполненное задание. rollDay первым делом.
 * FeatureError: unknown_quest, quest_not_done, quest_already_claimed.
 */
export function claimQuest(save: SaveState, day: string, questId: string, ctx: FeatureContext): { save: SaveState; points: number; events: FeatureEvent[] } {
  const s = rollDay(save, day);
  const q = ctx.features.quests.quests.find((x) => x.id === questId);
  if (!q) throw new FeatureError('unknown_quest', `Неизвестное задание: ${questId}`);
  if (!questVisible(s, q, ctx)) throw new FeatureError('quest_locked', `Задание «${q.name}» откроется вместе со своей функцией`);
  if (s.daily.claimedQuests.includes(q.id)) throw new FeatureError('quest_already_claimed', `Награда за задание «${q.name}» уже получена`);
  const progress = questCounter(s, q.event);
  if (progress < q.target) throw new FeatureError('quest_not_done', `Задание «${q.name}» ещё не выполнено (${progress}/${q.target})`);
  const next: SaveState = { ...s, daily: { ...s.daily, claimedQuests: [...s.daily.claimedQuests, q.id] } };
  return { save: next, points: q.points, events: [{ type: 'questClaimed', questId: q.id, points: q.points, activity: activityPoints(next, ctx) }] };
}

/**
 * Забрать награду порога активности milestone (значение points из data/quests.json).
 * Золото и гемы — в ресурсы, jobExp — в общий пул опыта героев. rollDay первым делом.
 * K10: как и другие награды с опытом (claimExpedition, claimAchievement), обновляет счётчики-«максимумы» достижений.
 * FeatureError: unknown_milestone, not_enough_activity, milestone_already_claimed.
 */
export function claimActivity(
  save: SaveState,
  day: string,
  milestone: number,
  ctx: FeatureContext,
): { save: SaveState; rewards: MilestoneRewards; events: FeatureEvent[] } {
  const s = rollDay(save, day);
  const m = ctx.features.quests.milestones.find((x) => x.points === milestone);
  if (!m) throw new FeatureError('unknown_milestone', `Нет награды за ${milestone} очков активности`);
  if (s.daily.activityClaimed.includes(m.points)) throw new FeatureError('milestone_already_claimed', `Награда за ${m.points} очков активности уже получена`);
  const activity = activityPoints(s, ctx);
  if (activity < m.points) throw new FeatureError('not_enough_activity', `Нужно ${m.points} очков активности, сейчас ${activity}`);
  const { gold, gems, jobExp } = m.rewards;
  const next: SaveState = addHeroExp({
    ...s,
    resources: { ...s.resources, gold: s.resources.gold + gold },
    currency: { ...s.currency, gems: s.currency.gems + gems },
    daily: { ...s.daily, activityClaimed: [...s.daily.activityClaimed, m.points] },
  }, jobExp);
  const events: FeatureEvent[] = [{ type: 'activityClaimed', milestone: m.points }];
  if (gold > 0 || jobExp > 0) events.push({ type: 'rewards', gold, heroExp: jobExp });
  if (gems > 0) events.push({ type: 'gems', amount: gems });
  return { save: syncAchievementCounters(next), rewards: { gold, gems, jobExp }, events };
}

/**
 * «Забрать всё» на экране заданий: сначала все выполненные задания (очки активности), затем все достигнутые пороги
 * активности — в том числе те, до которых только что добрали очки. rollDay первым делом.
 * points — сумма очков, rewards — сумма наград порогов, quests / milestones — что забрано. Нечего забрать — те же
 * данные после rollDay и пустые списки.
 */
export function claimAllQuests(
  save: SaveState,
  day: string,
  ctx: FeatureContext,
): { save: SaveState; points: number; rewards: MilestoneRewards; events: FeatureEvent[]; quests: string[]; milestones: number[] } {
  let next = rollDay(save, day);
  let points = 0;
  const rewards: MilestoneRewards = { gold: 0, gems: 0, jobExp: 0 };
  const events: FeatureEvent[] = [];
  const quests: string[] = [];
  const milestones: number[] = [];
  for (const q of questStatus(next, ctx).quests) {
    if (!q.done || q.claimed) continue;
    const r = claimQuest(next, day, q.id, ctx);
    next = r.save;
    points += r.points;
    events.push(...r.events);
    quests.push(q.id);
  }
  for (const m of questStatus(next, ctx).milestones) {
    if (!m.reached || m.claimed) continue;
    const r = claimActivity(next, day, m.points, ctx);
    next = r.save;
    rewards.gold += r.rewards.gold;
    rewards.gems += r.rewards.gems;
    rewards.jobExp += r.rewards.jobExp;
    events.push(...r.events);
    milestones.push(m.points);
  }
  return { save: next, points, rewards, events, quests, milestones };
}
