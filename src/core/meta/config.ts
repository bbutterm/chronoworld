import { z } from 'zod';
import { HeroCardDropSchema } from '../heroes/schema';
import type { GameContext } from '../progression/types';
import { MetaError } from './errors';

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id: латиница в нижнем регистре, цифры и _');

/** Счётчики достижений (K10) и их режим по умолчанию: add — копится, max — хранится максимум. */
export const ACHIEVEMENT_COUNTERS = {
  stages_cleared: 'max',
  tower_floor: 'max',
  items_equipped: 'add',
  /** Завершённых экспедиций (id исторический — раньше «поручения»; лежит в сохранениях). */
  bounties_done: 'add',
  battles_won: 'add',
  /** Наибольший уровень карточки героя (v4; раньше — hero_max_job_level). */
  hero_max_level: 'max',
  /** Призвано карточек в Таверне. */
  summons: 'add',
  /** Вознесений героев (копии и общие карты). */
  ascensions: 'add',
} as const;
export type AchievementCounter = keyof typeof ACHIEVEMENT_COUNTERS;
export const ACHIEVEMENT_COUNTER_KEYS = Object.keys(ACHIEVEMENT_COUNTERS) as [AchievementCounter, ...AchievementCounter[]];

export const MetaRewardsSchema = z.object({
  gold: z.number().int().nonnegative().default(0),
  gems: z.number().int().nonnegative().default(0),
  /** Опыт в общий пул героев. */
  jobExp: z.number().int().nonnegative().default(0),
  /**
   * Карты случайных героев: ожидаемое число (целая часть — точно, дробная — шанс; heroes/cardDrops.ts). В награде,
   * которую вернул claim*, — сколько реально выпало (целые); кто — в событиях heroCard.
   */
  heroCards: HeroCardDropSchema.optional(),
});

/** Длительность экспедиции: часы и надбавка к добыче (longer = выгоднее в час). */
export const ExpeditionDurationSchema = z.object({
  hours: z.number().int().positive(),
  /** Надбавка к добыче за час: 0.1 — +10% (добыча = почасовая × hours × (1 + bonus)). */
  bonus: z.number().min(0).max(2).default(0),
});

/** Строка таблицы добычи локации: бросок за каждый «час добычи» (hours × (1 + bonus)). */
export const ExpeditionLootSchema = z
  .object({
    /** item — предмет из items (равновероятно), gems / scrolls — count штук, heroCard — count карт случайного героя редкости rarity. */
    kind: z.enum(['item', 'gems', 'heroCard', 'scrolls']),
    /** kind heroCard: редкость карты (blue / purple). */
    rarity: z.enum(['blue', 'purple']).optional(),
    /** Шанс за час добычи (0…1). */
    chance: z.number().min(0).max(1),
    /** Сколько за удачный бросок (для item — всегда 1 предмет). */
    count: z.number().int().positive().default(1),
    /** kind item: id предметов из data/items (тема локации). */
    items: z.array(id).optional(),
  })
  .superRefine((l, c) => {
    if (l.kind === 'item' && !l.items?.length) c.addIssue({ code: 'custom', path: ['items'], message: 'для kind item нужен непустой список items' });
    if (l.kind !== 'item' && l.items) c.addIssue({ code: 'custom', path: ['items'], message: 'items — только для kind item' });
    if (l.kind === 'heroCard' && !l.rarity) c.addIssue({ code: 'custom', path: ['rarity'], message: 'для kind heroCard нужна редкость (blue / purple)' });
    if (l.kind !== 'heroCard' && l.rarity) c.addIssue({ code: 'custom', path: ['rarity'], message: 'rarity — только для kind heroCard' });
  });

/** Локация экспедиций. */
export const ExpeditionLocationSchema = z.object({
  id,
  name: z.string().min(1),
  /** Короткий текст о месте (карточка локации). */
  description: z.string().min(1),
  /** Этап кампании, после первой победы на котором локация открыта. */
  stage: id,
  /** Порог мощи отряда экспедиции (сумма мощи героев). */
  power: z.number().int().positive(),
  /** Цвет карточки (заглушка арта): '#rrggbb'. */
  tint: z.string().regex(/^#[0-9a-fA-F]{6}$/, "цвет '#rrggbb'"),
  /** Монстр места (id из data/units) — портрет на карточке, пока нет арта локации. */
  monster: id.optional(),
  /** Размер монстра на карточке (1 — обычный; широким, как жук, — меньше). */
  monsterScale: z.number().min(0.3).max(2).optional(),
  /** Золото и опыт (в общий пул) за час добычи. */
  perHour: z.object({ gold: z.number().int().nonnegative(), jobExp: z.number().int().nonnegative() }),
  /** Находки: предметы темы, гемы, карты случайных героев, свитки. */
  loot: z.array(ExpeditionLootSchema).default([]),
});

/** data/expeditions.json */
export const ExpeditionsConfigSchema = z
  .object({
    $schema: z.string().optional(),
    $comment: z.string().optional(),
    /** Героев в отряде экспедиции — не больше. */
    maxHeroes: z.number().int().min(1).max(10),
    /** Варианты длительности (в порядке кнопок). */
    durations: z.array(ExpeditionDurationSchema).min(1),
    locations: z.array(ExpeditionLocationSchema).min(1),
    /** K8: лимиты пресетов отряда (временно здесь, как раньше в data/bounties.json — см. docs/content/meta.md). */
    presets: z.object({ max: z.number().int().positive(), nameMaxLength: z.number().int().positive() }),
  })
  .superRefine((cfg, c) => {
    const seen = new Set<string>();
    cfg.locations.forEach((l, i) => {
      if (seen.has(l.id)) c.addIssue({ code: 'custom', path: ['locations', i, 'id'], message: `локация ${l.id} встречается дважды` });
      seen.add(l.id);
    });
    const hours = new Set<number>();
    cfg.durations.forEach((d, i) => {
      if (hours.has(d.hours)) c.addIssue({ code: 'custom', path: ['durations', i, 'hours'], message: `длительность ${d.hours} ч встречается дважды` });
      hours.add(d.hours);
    });
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
export type ExpeditionDuration = z.infer<typeof ExpeditionDurationSchema>;
export type ExpeditionLoot = z.infer<typeof ExpeditionLootSchema>;
export type ExpeditionLocation = z.infer<typeof ExpeditionLocationSchema>;
export type ExpeditionsConfig = z.infer<typeof ExpeditionsConfigSchema>;
export type AchievementDef = z.infer<typeof AchievementDefSchema>;
export type AchievementsConfig = z.infer<typeof AchievementsConfigSchema>;

export interface MetaConfig {
  expeditions: ExpeditionsConfig;
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

/** Разобрать data/expeditions.json и data/achievements.json (ядро файлы не читает). Ошибка → MetaError('invalid_config'). */
export function parseMetaConfig(expeditionsJson: unknown, achievementsJson: unknown): MetaConfig {
  const b = ExpeditionsConfigSchema.safeParse(expeditionsJson);
  if (!b.success) throw new MetaError('invalid_config', `data/expeditions.json: ${describe(b.error)}`);
  const a = AchievementsConfigSchema.safeParse(achievementsJson);
  if (!a.success) throw new MetaError('invalid_config', `data/achievements.json: ${describe(a.error)}`);
  return { expeditions: b.data, achievements: a.data };
}

/** ctx → ctx + meta (UI: `withMeta(featureCtx, expeditionsJson, achievementsJson)`). Тип исходного контекста сохраняется. */
export function withMeta<C extends GameContext>(ctx: C, expeditionsJson: unknown, achievementsJson: unknown): C & MetaContext {
  return { ...ctx, meta: parseMetaConfig(expeditionsJson, achievementsJson) };
}
