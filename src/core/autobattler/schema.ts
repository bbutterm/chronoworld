import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9_]*$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().int().nonnegative();
const role = z.enum(['tank', 'damage', 'healer', 'support']);
const bonuses = z.object({ hp: z.number().min(0).max(1).optional(), atk: z.number().min(0).max(1).optional(), def: z.number().min(0).max(1).optional(), spd: z.number().min(0).max(0.3).optional() });

/** A match has its own economy. Campaign resources and equipment never enter combat. */
export const AutobattlerConfigSchema = z.object({
  $schema: z.string().optional(),
  $comment: z.string().optional(),
  version: z.literal(1),
  name: z.string().min(1),
  unlockAfterStage: id.nullable(),
  rounds: z.number().int().min(3).max(12),
  lives: z.number().int().min(1).max(5),
  starterPool: z.array(id).min(5).max(12),
  startingTeam: z.array(id).length(3),
  startingGold: money,
  heroCost: z.number().int().positive(),
  rerollCost: z.number().int().positive(),
  shopSize: z.literal(3),
  reserveLimit: z.number().int().min(5).max(12),
  sellRefund: z.number().min(0).max(0.75),
  income: z.number().int().positive(),
  winIncome: money,
  interestEvery: z.number().int().positive(),
  interestCap: z.number().int().min(0).max(5),
  training: z.array(z.object({ cost: money, level: z.number().int().min(10).max(65), capacity: z.number().int().min(3).max(5), rarity: z.enum(['blue', 'purple']) })).min(2).max(5),
  starMultiplier: z.tuple([z.literal(1), z.number().min(1).max(2), z.number().min(1).max(3)]),
  opponents: z.array(z.object({ id, name: z.string().min(1), hint: z.string().min(1).max(140), team: z.array(id).length(5), branches: z.record(id, id).optional() })).min(3),
  difficulty: z.array(z.object({ level: z.number().int().min(1).max(65), count: z.number().int().min(3).max(5), mult: z.number().min(0.1).max(2), rarity: z.enum(['blue', 'purple']) })),
  synergies: z.array(z.object({ id, name: z.string().min(1), description: z.string().min(1).max(120), need: z.number().int().min(2).max(5), lines: z.array(id).optional(), roles: z.array(role).optional(), distinctRoles: z.boolean().optional(), bonuses })),
  rewards: z.object({ gold: money, heroExp: money, gems: money, minWins: z.number().int().min(1).max(12) }),
}).superRefine((c, ctx) => {
  if (c.difficulty.length !== c.rounds) ctx.addIssue({ code: 'custom', path: ['difficulty'], message: 'Для каждого раунда нужна сложность' });
  if (c.rewards.minWins > c.rounds) ctx.addIssue({ code: 'custom', path: ['rewards', 'minWins'], message: 'Порог награды выше числа раундов' });
  if (c.training[0].cost !== 0 || c.training[0].capacity !== 3) ctx.addIssue({ code: 'custom', path: ['training', 0], message: 'Начальная подготовка бесплатна и даёт три места' });
  for (let i = 1; i < c.training.length; i++) {
    if (c.training[i].cost <= 0 || c.training[i].level < c.training[i - 1].level || c.training[i].capacity < c.training[i - 1].capacity) ctx.addIssue({ code: 'custom', path: ['training', i], message: 'Подготовка должна повышать уровень и сохранять места' });
  }
  for (let i = 0; i < c.synergies.length; i++) if (!c.synergies[i].lines?.length && !c.synergies[i].roles?.length && !c.synergies[i].distinctRoles) ctx.addIssue({ code: 'custom', path: ['synergies', i], message: 'Связке нужны классы или роли' });
});
export type AutobattlerConfig = z.infer<typeof AutobattlerConfigSchema>;

export const AutobattlerHeroSchema = z.object({
  id: id,
  templateId: id,
  /** Three copies make two stars; nine make three. There is only one identity per template. */
  copies: z.number().int().min(1).max(9),
  /** Free companions have no sale value. Prevents repeated starter resale. */
  paidCopies: z.number().int().min(0).max(9),
  branch: id.optional(),
}).superRefine((h, ctx) => {
  if (h.paidCopies > h.copies) ctx.addIssue({ code: 'custom', path: ['paidCopies'], message: 'Оплаченных копий не может быть больше общего числа' });
});
export type AutobattlerHero = z.infer<typeof AutobattlerHeroSchema>;

export const AutobattlerRunSchema = z.object({
  version: z.literal(1),
  id: z.number().int().positive(),
  seed: z.number().int().min(0).max(0xffffffff),
  day,
  round: z.number().int().min(1).max(12),
  wins: z.number().int().min(0).max(12),
  lives: z.number().int().min(1).max(5),
  gold: money,
  training: z.number().int().min(0).max(4),
  shopSeq: money,
  shop: z.array(id.nullable()).length(3),
  pool: z.array(id).min(3).max(32),
  branchChoices: z.record(id, id),
  heroes: z.array(AutobattlerHeroSchema).min(1).max(12),
  squad: z.array(id.nullable()).length(5),
}).superRefine((r, ctx) => {
  const active = r.squad.filter((id) => id !== null);
  if (r.wins >= r.round) ctx.addIssue({ code: 'custom', path: ['wins'], message: 'Побед больше завершённых раундов' });
  if (new Set(r.heroes.map((h) => h.id)).size !== r.heroes.length || new Set(r.heroes.map((h) => h.templateId)).size !== r.heroes.length) ctx.addIssue({ code: 'custom', path: ['heroes'], message: 'Товарищ повторяется в составе' });
  if (new Set(active).size !== active.length || active.some((id) => !r.heroes.some((h) => h.id === id))) ctx.addIssue({ code: 'custom', path: ['squad'], message: 'Неверный отряд матча' });
  if (new Set(r.pool).size !== r.pool.length || r.shop.some((id) => id && !r.pool.includes(id))) ctx.addIssue({ code: 'custom', path: ['pool'], message: 'Неверный набор героев лавки' });
});
export type AutobattlerRun = z.infer<typeof AutobattlerRunSchema>;

const reward = z.object({ gold: money, heroExp: money, gems: money });
export type AutobattlerRewards = z.infer<typeof reward>;
export const AutobattlerSaveSchema = z.object({
  seq: money,
  bestWins: z.number().int().min(0).max(12),
  completed: money,
  /** Monotonic day + highest result: replays can improve the same reward, never duplicate it. */
  rewardDay: day.optional(),
  rewardWins: z.number().int().min(0).max(12).optional(),
  run: AutobattlerRunSchema.optional(),
  last: z.object({ runId: z.number().int().positive(), rounds: z.number().int().min(0).max(12), wins: z.number().int().min(0).max(12), reason: z.enum(['completed', 'defeated', 'abandoned']), rewards: reward }).optional(),
});
export type AutobattlerState = z.infer<typeof AutobattlerSaveSchema>;

export function parseAutobattlerConfig(raw: unknown): AutobattlerConfig {
  const r = AutobattlerConfigSchema.safeParse(raw);
  if (!r.success) throw new Error(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}
