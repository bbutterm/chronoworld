import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id: латиница в нижнем регистре, цифры и _');

const Reward = z.object({ jobExp: z.number().int().nonnegative(), gold: z.number().int().nonnegative() });

export const StageSchema = z.object({
  id,
  name: z.string(),
  boss: z.boolean().default(false),
  /** 5 слотов (0–1 фронт, 2–4 тыл): id юнита из data/units (kind monster/boss) или null. */
  enemies: z
    .array(z.object({ unit: id, mult: z.number().positive().default(1) }).nullable())
    .length(5),
  /** Награда за победу (jobExp — в общий пул опыта героев, v4). */
  rewards: Reward,
  /** Доход офлайн-сундука в минуту, пока это последний пройденный этап. */
  offlinePerMinute: Reward,
});

/** data/campaign/<chapter>.json — глава; порядок глав — по полю order. */
export const ChapterSchema = z.object({
  $schema: z.string().optional(),
  id,
  name: z.string(),
  order: z.number().int().positive(),
  stages: z.array(StageSchema).min(1),
});

export type StageDef = z.infer<typeof StageSchema>;
export type ChapterDef = z.infer<typeof ChapterSchema>;

/** Этап с положением в кампании (вычисляется при сборке контента). */
export interface StageInfo extends StageDef {
  chapter: string;
  /** Номер внутри главы, с 0. */
  index: number;
  /** Сквозной номер по всей кампании, с 0 — по нему растёт сила врагов. */
  globalIndex: number;
}
