import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id: латиница в нижнем регистре, цифры и _');

/** 5 слотов (0–1 фронт, 2–4 тыл), как у этапа кампании: id монстра/босса и множитель hp/atk/def, либо null. */
export const TowerLayoutSchema = z.array(z.object({ unit: id, mult: z.number().positive().default(1) }).nullable()).length(5);

/**
 * Полоса этажей: с этажа fromFloor и до fromFloor следующей полосы действует свой набор составов.
 * Обычный этаж n берёт layouts[(n − fromFloor) mod layouts.length],
 * босс-этаж — bossLayouts[(номер босса внутри полосы) mod bossLayouts.length].
 */
export const TowerBandSchema = z.object({
  fromFloor: z.number().int().positive(),
  name: z.string().optional(),
  layouts: z.array(TowerLayoutSchema).min(1),
  bossLayouts: z.array(TowerLayoutSchema).min(1),
});

/** Линейная награда: base + perFloor × (n − 1), округление вниз. */
const Linear = z.object({ base: z.number().nonnegative(), perFloor: z.number().nonnegative() });

/** data/tower.json — башня испытаний (K4). Этажи не перечисляются, а строятся по правилу (см. docs/content/tower.md). */
export const TowerConfigSchema = z
  .object({
    $schema: z.string().optional(),
    $comment: z.string().optional(),
    /** id этапа кампании, после прохождения которого башня открыта; null — открыта сразу. */
    unlockAfterStage: id.nullable().default(null),
    /** Последний этаж башни. */
    maxFloor: z.number().int().positive(),
    /** Каждый bossEvery-й этаж — босс. */
    bossEvery: z.number().int().positive(),
    /** Сила врагов: hp/atk/def × mult слота × baseMult × (1 + statGrowthPerFloor)^(n − 1). */
    baseMult: z.number().positive().default(1),
    statGrowthPerFloor: z.number().nonnegative(),
    bands: z.array(TowerBandSchema).min(1),
    rewards: z.object({
      gold: Linear,
      jobExp: Linear,
      /** Множитель золота и jobExp на босс-этаже. */
      bossMultiplier: z.number().positive().default(1),
      /** Гемы — только на босс-этажах. */
      bossGems: z.number().int().nonnegative().default(0),
    }),
  })
  .superRefine((cfg, c) => {
    if (cfg.bands[0].fromFloor !== 1) c.addIssue({ code: 'custom', path: ['bands', 0, 'fromFloor'], message: 'первая полоса должна начинаться с 1 этажа' });
    cfg.bands.forEach((b, i) => {
      if (i > 0 && b.fromFloor <= cfg.bands[i - 1].fromFloor) {
        c.addIssue({ code: 'custom', path: ['bands', i, 'fromFloor'], message: 'fromFloor полос должен строго возрастать' });
      }
      [...b.layouts, ...b.bossLayouts].forEach((l, j) => {
        if (l.every((e) => e === null)) c.addIssue({ code: 'custom', path: ['bands', i, j < b.layouts.length ? 'layouts' : 'bossLayouts'], message: 'в составе нет ни одного врага' });
      });
    });
  });

export type TowerLayout = z.infer<typeof TowerLayoutSchema>;
export type TowerBand = z.infer<typeof TowerBandSchema>;
export type TowerConfig = z.infer<typeof TowerConfigSchema>;
