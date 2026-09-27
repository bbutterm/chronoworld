import { z } from 'zod';
import { UnitSchema } from '../content/schema';
import type { GameContext } from '../progression/types';
import { MetaError } from './errors';

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id: латиница в нижнем регистре, цифры и _');

/** Счётчики достижений (K10) и их режим по умолчанию: add — копится, max — хранится максимум. */
export const ACHIEVEMENT_COUNTERS = {
  stages_cleared: 'max',
  tower_floor: 'max',
  items_equipped: 'add',
  bounties_done: 'add',
  battles_won: 'add',
  /** Наибольший уровень карточки героя (v4; раньше — hero_max_job_level). */
  hero_max_level: 'max',
  /** Призвано карточек в Таверне. */
  summons: 'add',
  /** Вознесений карточек (корм или осколки). */
  ascensions: 'add',
} as const;
export type AchievementCounter = keyof typeof ACHIEVEMENT_COUNTERS;
export const ACHIEVEMENT_COUNTER_KEYS = Object.keys(ACHIEVEMENT_COUNTERS) as [AchievementCounter, ...AchievementCounter[]];

export const MetaRewardsSchema = z.object({
  gold: z.number().int().nonnegative().default(0),
  gems: z.number().int().nonnegative().default(0),
  /** Опыт в общий пул героев. */
  jobExp: z.number().int().nonnegative().default(0),
  /** Осколки «отстающего» сюжетного героя (heroes/shards.ts shardTarget). */
  shards: z.number().int().nonnegative().default(0),
});

export const BountyTemplateSchema = z.object({
  id,
  name: z.string(),
  /** Ключ из rarities. */
  rarity: id,
  durationMinutes: z.number().positive(),
  /** Сколько героев нужно отправить (ровно). */
  heroCount: z.number().int().min(1).max(5),
  /** Хотя бы один герой этой роли (по карточке); null или нет поля — любая группа. */
  role: UnitSchema.shape.role.nullable().default(null),
  rewards: MetaRewardsSchema,
});

/** data/bounties.json */
export const BountiesConfigSchema = z
  .object({
    $comment: z.string().optional(),
    /** Поручений на доске после обновления. */
    boardSize: z.number().int().positive(),
    /** Ручных обновлений доски в день (обновление при смене дня — бесплатно и сверх этого). */
    dailyRefreshes: z.number().int().nonnegative(),
    /** Редкость → вес выпадения на доске. */
    rarities: z.record(id, z.number().nonnegative()),
    templates: z.array(BountyTemplateSchema).min(1),
    /** K8: лимиты пресетов отряда (временно здесь — см. docs/content/meta.md). */
    presets: z.object({ max: z.number().int().positive(), nameMaxLength: z.number().int().positive() }),
  })
  .superRefine((cfg, c) => {
    const seen = new Set<string>();
    cfg.templates.forEach((t, i) => {
      if (seen.has(t.id)) c.addIssue({ code: 'custom', path: ['templates', i, 'id'], message: `шаблон ${t.id} встречается дважды` });
      seen.add(t.id);
      if (!(t.rarity in cfg.rarities)) c.addIssue({ code: 'custom', path: ['templates', i, 'rarity'], message: `редкости ${t.rarity} нет в rarities` });
    });
    let total = 0;
    for (const [r, w] of Object.entries(cfg.rarities)) {
      total += w;
      if (w > 0 && !cfg.templates.some((t) => t.rarity === r)) c.addIssue({ code: 'custom', path: ['rarities', r], message: `у редкости ${r} вес > 0, но нет шаблонов` });
    }
    if (!(total > 0)) c.addIssue({ code: 'custom', path: ['rarities'], message: 'сумма весов редкостей должна быть > 0' });
  });

export const AchievementDefSchema = z.object({
  id,
  name: z.string(),
  description: z.string(),
  counter: z.enum(ACHIEVEMENT_COUNTER_KEYS),
  target: z.number().int().positive(),
  rewards: MetaRewardsSchema,
});

/** data/achievements.json */
export const AchievementsConfigSchema = z
  .object({
    $comment: z.string().optional(),
    achievements: z.array(AchievementDefSchema),
  })
  .superRefine((cfg, c) => {
    const seen = new Set<string>();
    cfg.achievements.forEach((a, i) => {
      if (seen.has(a.id)) c.addIssue({ code: 'custom', path: ['achievements', i, 'id'], message: `достижение ${a.id} встречается дважды` });
      seen.add(a.id);
    });
  });

export type MetaRewards = z.infer<typeof MetaRewardsSchema>;
export type BountyTemplate = z.infer<typeof BountyTemplateSchema>;
export type BountiesConfig = z.infer<typeof BountiesConfigSchema>;
export type AchievementDef = z.infer<typeof AchievementDefSchema>;
export type AchievementsConfig = z.infer<typeof AchievementsConfigSchema>;

export interface MetaConfig {
  bounties: BountiesConfig;
  achievements: AchievementsConfig;
}

/** GameContext + конфиги K8/K9/K10. */
export interface MetaContext extends GameContext {
  meta: MetaConfig;
}

function describe(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.length ? i.path.map(String).join('.') : '(корень)'}: ${i.message}`)
    .join('; ');
}

/** Разобрать data/bounties.json и data/achievements.json (ядро файлы не читает). Ошибка → MetaError('invalid_config'). */
export function parseMetaConfig(bountiesJson: unknown, achievementsJson: unknown): MetaConfig {
  const b = BountiesConfigSchema.safeParse(bountiesJson);
  if (!b.success) throw new MetaError('invalid_config', `data/bounties.json: ${describe(b.error)}`);
  const a = AchievementsConfigSchema.safeParse(achievementsJson);
  if (!a.success) throw new MetaError('invalid_config', `data/achievements.json: ${describe(a.error)}`);
  return { bounties: b.data, achievements: a.data };
}

/** ctx → ctx + meta (UI: `withMeta(featureCtx, bountiesJson, achievementsJson)`). Тип исходного контекста сохраняется. */
export function withMeta<C extends GameContext>(ctx: C, bountiesJson: unknown, achievementsJson: unknown): C & MetaContext {
  return { ...ctx, meta: parseMetaConfig(bountiesJson, achievementsJson) };
}
