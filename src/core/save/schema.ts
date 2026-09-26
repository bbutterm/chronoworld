import { z } from 'zod';

export const SAVE_VERSION = 1;

export const HeroStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  job: z.string(),
  jobLevel: z.number().int().positive(),
  /** Опыт внутри текущего уровня. */
  jobExp: z.number().int().nonnegative(),
  /** Пройденные профессии и уровень, на котором с них ушли (для навыков при keepSkillsOnJobChange). */
  jobHistory: z.array(z.object({ job: z.string(), jobLevel: z.number().int().positive() })).default([]),
});

export const SaveStateSchema = z.object({
  version: z.literal(SAVE_VERSION),
  createdAt: z.number(),
  heroes: z.array(HeroStateSchema).min(1),
  /** 5 слотов отряда: id героя или null. */
  squad: z.array(z.string().nullable()).length(5),
  campaign: z.object({ cleared: z.array(z.string()) }),
  resources: z.object({ gold: z.number().int().nonnegative() }),
  offline: z.object({ lastClaimAt: z.number() }),
  /** Счётчик боёв — из него UI делает seed следующего боя. */
  battleSeq: z.number().int().nonnegative(),
});

export type HeroState = z.infer<typeof HeroStateSchema>;
export type SaveState = z.infer<typeof SaveStateSchema>;
