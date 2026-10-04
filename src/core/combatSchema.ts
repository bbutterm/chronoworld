import { z } from 'zod';
import { BehaviorProfileSchema, EnrageSchema, SustainSchema } from './behavior';
import { ElementsConfigSchema } from './elements';
import type { CombatConfig } from './types';

const positive = z.number().positive();
const nonnegative = z.number().nonnegative();
const fraction = z.number().min(0).max(1);
const slot = z.number().int().nonnegative();
const point = z.tuple([z.number(), z.number()]);

/** Проверка авторских чисел до создания боя; новые независимые блоки контента сохраняются. */
export const CombatConfigSchema = z.object({
  actionThreshold: positive,
  tickSeconds: positive,
  timeLimitSeconds: positive,
  damage: z.object({ defScale: positive, varianceMin: positive, varianceMax: positive, minDamage: positive }).passthrough(),
  energy: z.object({
    max: positive,
    perBasicAction: nonnegative,
    perHitTaken: nonnegative,
    hitIntervalSeconds: nonnegative.optional(),
    hero: z.object({ perSecond: nonnegative, perBasicAction: nonnegative, perHitTaken: nonnegative }).passthrough().optional(),
  }).passthrough(),
  skills: z.object({ defaultCooldown: nonnegative }).passthrough().optional(),
  projectileSeconds: nonnegative.optional(),
  statusTurnSeconds: positive.optional(),
  shieldCapPctMaxHp: fraction.optional(),
  movement: z.object({
    meleeRange: positive,
    moveSpeed: positive,
    dashSeconds: nonnegative,
    stackAngles: z.array(z.number()).min(1),
    retargetSeconds: nonnegative,
    crowdSquash: positive.optional(),
    bodyRadius: z.object({ hero: nonnegative.optional(), monster: nonnegative.optional(), boss: nonnegative.optional() }).passthrough().optional(),
    minSeparation: nonnegative.optional(),
    meleeAoeRadius: positive.optional(),
    maxMeleePerTarget: z.number().int().positive().optional(),
    diveReturnSeconds: nonnegative.optional(),
  }).passthrough(),
  slots: z.object({ count: z.number().int().positive(), front: z.array(slot), back: z.array(slot) }).passthrough(),
  field: z.object({
    width: positive,
    slotsA: z.array(point).min(1),
    bounds: z.object({ minX: z.number(), maxX: z.number(), minY: z.number(), maxY: z.number() }).passthrough().optional(),
  }).passthrough(),
  behaviors: z.record(z.string(), BehaviorProfileSchema).optional(),
  behaviorDefaults: z.record(z.string(), z.string()).optional(),
  enrage: EnrageSchema.optional(),
  sustain: SustainSchema.optional(),
  elements: ElementsConfigSchema.optional(),
  manual: z.object({ minCooldown: nonnegative }).passthrough().optional(),
  charge: z.object({ stunTurns: nonnegative, firstDelaySeconds: nonnegative.optional() }).passthrough().optional(),
}).passthrough().superRefine((cfg, ctx) => {
  const problem = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  const ticks = cfg.timeLimitSeconds / cfg.tickSeconds;
  if (cfg.tickSeconds > cfg.timeLimitSeconds || Math.abs(ticks - Math.round(ticks)) > 1e-7) {
    problem(['timeLimitSeconds'], 'Лимит должен содержать целое положительное число тиков боя');
  }
  if (cfg.damage.varianceMin > cfg.damage.varianceMax) problem(['damage', 'varianceMax'], 'Верхняя граница разброса меньше нижней');
  const slots = [...cfg.slots.front, ...cfg.slots.back];
  if (slots.length !== cfg.slots.count || new Set(slots).size !== cfg.slots.count || slots.some((n) => n >= cfg.slots.count)) {
    problem(['slots'], 'Передний и задний ряды должны без повторов покрывать все слоты');
  }
  if (cfg.field.slotsA.length !== cfg.slots.count) problem(['field', 'slotsA'], 'Нужна одна позиция на каждый слот');
  const bounds = cfg.field.bounds;
  if (bounds && (bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY || bounds.minX < 0 || bounds.maxX > cfg.field.width)) {
    problem(['field', 'bounds'], 'Границы поля должны образовывать область внутри его ширины');
  }
  for (const [i, [x, y]] of cfg.field.slotsA.entries()) {
    if (x < 0 || x > cfg.field.width || (bounds && (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY))) {
      problem(['field', 'slotsA', i], 'Позиция слота находится за пределами поля');
    }
  }
  for (const [key, id] of Object.entries(cfg.behaviorDefaults ?? {})) {
    if (!cfg.behaviors?.[id]) problem(['behaviorDefaults', key], `Неизвестный профиль поведения: ${id}`);
  }
});

export function parseCombatConfig(raw: unknown): CombatConfig {
  return CombatConfigSchema.parse(raw);
}
