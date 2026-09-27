import { z } from 'zod';

/**
 * Схемы контента. Юниты и навыки — это данные: новый герой, монстр или умение
 * добавляется JSON-файлом в data/units или data/skills без правок кода.
 * Из этих схем генерируются data/schema/*.schema.json для подсказок в редакторе.
 */

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id: латиница в нижнем регистре, цифры и _');

export const StatsSchema = z.object({
  hp: z.number().positive(),
  atk: z.number().nonnegative(),
  def: z.number().nonnegative(),
  spd: z.number().positive(),
  /** Скорость бега, единиц поля в секунду. Если не задана — из combat.json. */
  moveSpeed: z.number().positive().optional(),
});

export const StatModsSchema = z
  .object({
    atk: z.number(),
    def: z.number(),
    spd: z.number(),
  })
  .partial()
  .describe('Модификаторы статов в долях: 0.2 = +20%, -0.3 = −30%');

export const TargetSchema = z.object({
  side: z.enum(['enemy', 'ally']),
  pick: z.enum(['nearest', 'lowestHp', 'lowestHpPct', 'random', 'all', 'self']),
  /** Ряд поля: фронт — слоты 0–1, тыл — 2–4. */
  row: z.enum(['front', 'back', 'any']).default('any'),
  /** Если в нужном ряду никого — брать из другого. */
  rowFallback: z.boolean().default(true),
  count: z.number().int().positive().default(1),
  includeSelf: z.boolean().default(false),
  /** Только раненые (для лечения). */
  onlyWounded: z.boolean().default(false),
});

export const StatusSchema = z.object({
  id,
  name: z.string(),
  /** Длительность в собственных ходах носителя. */
  turns: z.number().int().positive(),
  stats: StatModsSchema.optional(),
  /** Пропуск хода. */
  stun: z.boolean().optional(),
  /** Урон в начале каждого хода носителя: ATK наложившего × k. */
  dot: z.object({ k: z.number().positive() }).optional(),
});

export const EffectSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('damage'), k: z.number().positive() }),
  z.object({ type: z.literal('heal'), k: z.number().positive() }),
  z.object({ type: z.literal('shield'), pctMaxHp: z.number().positive() }),
  z.object({ type: z.literal('status'), status: StatusSchema, chance: z.number().min(0).max(1).default(1) }),
  z.object({ type: z.literal('energy'), amount: z.number() }),
  /** Рывок к первой цели (встать вплотную). */
  z.object({ type: z.literal('dash') }),
]);

export const SkillSchema = z.object({
  $schema: z.string().optional(),
  id,
  name: z.string(),
  description: z.string().optional(),
  /** Иконка навыка — id ассета из assets/manifest.json. */
  icon: z.string().optional(),
  /** melee — нужно стоять вплотную к цели сражения; ranged — с любого расстояния. */
  range: z.enum(['melee', 'ranged']).default('ranged'),
  target: TargetSchema,
  /** Сколько раз применить эффекты; при pick=random цель выбирается заново на каждый удар. */
  hits: z.number().int().positive().default(1),
  effects: z.array(EffectSchema).min(1),
  /** Если целей нет — использовать этот навык (например, лекарь бьёт, когда все здоровы). */
  fallback: id.optional(),
  /** Для пассивок: когда срабатывает. */
  trigger: z.enum(['battleStart', 'turnStart', 'hit', 'kill', 'allyDeath']).optional(),
  /** Для пассивок: шанс срабатывания. */
  chance: z.number().min(0).max(1).default(1),
  /**
   * Для активных навыков (skills.actives): перезарядка в секундах боя. Не задана — combat.json skills.defaultCooldown.
   * 0 — без перезарядки (например, «Огненная стрела» с долгим кастом).
   */
  cooldown: z.number().nonnegative().optional(),
  /** Время каста в секундах: юнит стоит и колдует, эффект — в конце. Оглушение сбивает каст. */
  castTime: z.number().nonnegative().default(0),
  /** Приоритет среди активных: больше — раньше. При равенстве — навык, открытый позже. */
  priority: z.number().default(0),
});

export const VisualSchema = z.object({
  /** id спрайта из реестра спрайтов (assets/sprites/sprites.json или assets/sprites.legacy.json). */
  sprite: z.string(),
  /** Снаряд обычной атаки дальнего боя (id ассета). */
  projectile: z.string().optional(),
  /** Эффект попадания (id ассета). */
  hitFx: z.string().optional(),
  /** Перекраска спрайта и портрета ('#rrggbb'): вариант монстра на том же листе (Дропс — оранжевый поринг). */
  tint: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const UnitSchema = z.object({
  $schema: z.string().optional(),
  id,
  name: z.string(),
  kind: z.enum(['hero', 'monster', 'boss']),
  role: z.enum(['tank', 'damage', 'healer', 'support']),
  stats: StatsSchema,
  skills: z.object({
    basic: id,
    ult: id.optional(),
    /** Активные навыки с перезарядкой: в свой ход юнит применяет готовый навык с наибольшим приоритетом, иначе — basic. */
    actives: z.array(id).default([]),
    passives: z.array(id).default([]),
  }),
  visual: VisualSchema,
  /** «Радиус тела» в единицах поля. Если не задан — из combat.json (movement.bodyRadius по kind). */
  bodyRadius: z.number().nonnegative().optional(),
});

export type Stats = z.infer<typeof StatsSchema>;
export type StatMods = z.infer<typeof StatModsSchema>;
export type TargetDef = z.infer<typeof TargetSchema>;
export type StatusDef = z.infer<typeof StatusSchema>;
export type Effect = z.infer<typeof EffectSchema>;
export type SkillDef = z.infer<typeof SkillSchema>;
export type UnitDef = z.infer<typeof UnitSchema>;
