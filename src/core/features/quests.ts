import { z } from 'zod';
import { syncAchievementCounters } from '../meta/achievements';
import { addJobExp } from '../progression/exp';
import type { HeroState, SaveState } from '../save/schema';
import type { FeatureContext, FeatureEvent } from './config';
import { rollDay } from './daily';
import { FeatureError } from './errors';

/** Виды событий, из которых считаются ежедневные задания. */
export const ACTIVITY_KINDS = ['stage_win', 'stage_attempt', 'offline_claim', 'fast_rewards', 'job_change', 'hero_level_up', 'tower_attempt'] as const;
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
});

export const MilestoneRewardsSchema = z.object({
  gold: z.number().int().nonnegative().default(0),
  gems: z.number().int().nonnegative().default(0),
  /** Опыт каждому герою (как у офлайн-сундука). */
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
export function recordActivity(save: SaveState, day: string, kind: ActivityKind, amount = 1): SaveState {
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
  return {
    day: s.daily.day,
    quests: cfg.quests.map((q) => {
      const raw = s.daily.quests[q.event] ?? 0;
      return { ...q, progress: Math.min(raw, q.target), done: raw >= q.target, claimed: claimed.has(q.id) };
    }),
    activity,
    maxActivity: cfg.quests.reduce((sum, q) => sum + q.points, 0),
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
  if (s.daily.claimedQuests.includes(q.id)) throw new FeatureError('quest_already_claimed', `Награда за задание «${q.name}» уже получена`);
  const progress = s.daily.quests[q.event] ?? 0;
  if (progress < q.target) throw new FeatureError('quest_not_done', `Задание «${q.name}» ещё не выполнено (${progress}/${q.target})`);
  const next: SaveState = { ...s, daily: { ...s.daily, claimedQuests: [...s.daily.claimedQuests, q.id] } };
  return { save: next, points: q.points, events: [{ type: 'questClaimed', questId: q.id, points: q.points, activity: activityPoints(next, ctx) }] };
}

/**
 * Забрать награду порога активности milestone (значение points из data/quests.json).
 * Золото и гемы — в ресурсы, jobExp — каждому герою через addJobExp. rollDay первым делом.
 * K10: как и другие награды с опытом (claimBounty, claimAchievement), обновляет счётчики-«максимумы» достижений.
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
  const next: SaveState = {
    ...s,
    resources: { ...s.resources, gold: s.resources.gold + gold },
    currency: { ...s.currency, gems: s.currency.gems + gems },
    daily: { ...s.daily, activityClaimed: [...s.daily.activityClaimed, m.points] },
  };
  const events: FeatureEvent[] = [{ type: 'activityClaimed', milestone: m.points }];
  if (gold > 0 || jobExp > 0) events.push({ type: 'rewards', gold, jobExp, heroIds: s.heroes.map((h) => h.id) });
  if (gems > 0) events.push({ type: 'gems', amount: gems });
  if (jobExp > 0) {
    next.heroes = s.heroes.map((h): HeroState => {
      const r = addJobExp(h, jobExp, ctx);
      events.push(...r.events);
      return r.hero;
    });
  }
  return { save: syncAchievementCounters(next), rewards: { gold, gems, jobExp }, events };
}
