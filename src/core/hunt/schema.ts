import { z } from 'zod';
import { CardDefSchema, RaritySchema } from '../equipment/schema';
import { HeroCardDropSchema } from '../heroes/schema';

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id: латиница в нижнем регистре, цифры и _');

/**
 * Босс охоты: юнит из data/units (обычно kind boss) и множители его hp/atk/def. hp — огромный: босс не должен падать,
 * награда считается по нанесённому урону. Боссы сменяются по дням: день d берёт bosses[d mod bosses.length]
 * (d — номер дня с 1970-01-01, поэтому ротация одна у всех игроков).
 */
export const HuntBossSchema = z.object({
  unit: id,
  /** Множитель ОЗ (старая охота; у MVP ОЗ — из уровня hunt.mvp.ranks). */
  hpMult: z.number().positive().default(1),
  atkMult: z.number().positive().default(1),
  defMult: z.number().positive().default(1),
  /** Масштаб фигуры в бою (visual.scale юнита; только вид, на бой не влияет). Нет поля — как у юнита. */
  scale: z.number().positive().max(4).optional(),
  /** Подпись под именем босса на экране охоты (необязательно). */
  title: z.string().min(1).max(60).optional(),
  /** MVP: легенда в 1–2 строки (экран охоты). */
  legend: z.string().min(1).max(140).optional(),
  /** MVP: механики — по строке на каждую («Заряжает Тёмный удар — сбейте ультой»), до 4. */
  mechanics: z.array(z.string().min(1).max(56)).max(4).optional(),
  /** MVP: карта, которая может выпасть за победу (id из hunt.cards). */
  card: id.optional(),
});

/**
 * Уровень MVP (docs/design/mvp-hunt.md): ОЗ — абсолютные, АТК и ЗАЩ — множители статов юнита. Уровень i убит → урон ≥ hp,
 * поэтому hp[i] не меньше урона порога i (tiers[i]) — победа над уровнем i даёт награду порога i.
 */
export const HuntRankSchema = z.object({
  hp: z.number().int().positive(),
  atk: z.number().positive(),
  def: z.number().positive(),
});

/**
 * MVP-охота: босс умирает за бой. Уровень охоты — сколько уровней по ОЗ уже пробито (по лучшему урону), новичок начинает с 0.
 * Слабость: герои, чья стихия атаки бьёт стихию MVP (×1.5 по таблице), получают +weaknessAtk АТК в этом бою, остальные
 * теряют armorAtk («стихийная броня»).
 */
export const HuntMvpSchema = z.object({
  /** +доля АТК героям стихии, к которой MVP уязвим (только в бою охоты). */
  weaknessAtk: z.number().min(0).max(2),
  /** «Стихийная броня» MVP: остальные герои (не той стихии) теряют эту долю АТК в бою охоты. */
  armorAtk: z.number().min(0).max(0.9).default(0),
  /** Шанс карты MVP за победу. */
  cardChance: z.number().min(0).max(1),
  /** Гарантия: столько побед подряд без карты — следующая победа даёт карту. */
  cardPity: z.number().int().positive(),
  ranks: z.array(HuntRankSchema).min(1),
});

/** Награда порога. Нет поля — 0. item — редкость предмета экипировки (случайный предмет этой редкости из data/items). */
export const HuntRewardSchema = z.object({
  gold: z.number().int().nonnegative().optional(),
  /** Опыт в общий пул героев. */
  jobExp: z.number().int().nonnegative().optional(),
  gems: z.number().int().nonnegative().optional(),
  /** Карты случайных героев (ожидаемое число: целая часть — точно, дробная — шанс; heroes/cardDrops.ts). */
  heroCards: HeroCardDropSchema.optional(),
  item: RaritySchema.optional(),
});

/** Порог урона: набил за бой не меньше damage — награда rewards (выдаётся только высший достигнутый порог). */
export const HuntTierSchema = z.object({
  damage: z.number().int().positive(),
  rewards: HuntRewardSchema,
});

/** data/hunt.json — «Охота на босса» (аналог гильдейской охоты AFK Arena, одиночная). Этап открытия — data/unlocks.json (hunt). */
export const HuntConfigSchema = z
  .object({
    $schema: z.string().optional(),
    $comment: z.string().optional(),
    /** Попыток в день (бой или «Зачистка» — одна попытка). */
    attemptsPerDay: z.number().int().positive(),
    /** Длительность боя с боссом, секунд (обычный бой — combat.json timeLimitSeconds). */
    timeLimitSeconds: z.number().positive(),
    /** «Зачистка»: повторить лучший результат по этому боссу без боя (после первого боя с ним). */
    sweep: z.boolean().default(true),
    /** Слот босса в отряде врагов (0–1 фронт, 2–4 тыл). */
    slot: z.number().int().min(0).max(4).default(0),
    bosses: z.array(HuntBossSchema).min(1),
    tiers: z.array(HuntTierSchema).min(1),
    /** MVP-охота (нет поля — старая охота: босс не падает, награда по урону). */
    mvp: HuntMvpSchema.optional(),
    /** Карты MVP (вставляются в снаряжение: equipment/cards.ts). */
    cards: z.array(CardDefSchema).default([]),
  })
  .superRefine((cfg, c) => {
    const cardIds = new Set(cfg.cards.map((k) => k.id));
    if (cardIds.size !== cfg.cards.length) c.addIssue({ code: 'custom', path: ['cards'], message: 'повтор id карты' });
    cfg.bosses.forEach((b, i) => {
      if (b.card && !cardIds.has(b.card)) c.addIssue({ code: 'custom', path: ['bosses', i, 'card'], message: `карта ${b.card} не описана в cards` });
    });
    cfg.mvp?.ranks.forEach((r, i, ranks) => {
      if (i > 0 && r.hp <= ranks[i - 1].hp) c.addIssue({ code: 'custom', path: ['mvp', 'ranks', i, 'hp'], message: 'ОЗ уровней MVP должны строго возрастать' });
      const t = cfg.tiers[i];
      if (t && r.hp < t.damage) c.addIssue({ code: 'custom', path: ['mvp', 'ranks', i, 'hp'], message: `ОЗ уровня меньше урона порога ${i + 1} (${t.damage}) — победа не даст его награду` });
    });
    cfg.tiers.forEach((t, i) => {
      if (i === 0) return;
      if (t.damage <= cfg.tiers[i - 1].damage) {
        c.addIssue({ code: 'custom', path: ['tiers', i, 'damage'], message: 'пороги урона должны строго возрастать' });
      }
      const prev = cfg.tiers[i - 1].rewards;
      for (const k of ['gold', 'jobExp', 'gems'] as const) {
        if ((t.rewards[k] ?? 0) < (prev[k] ?? 0)) c.addIssue({ code: 'custom', path: ['tiers', i, 'rewards', k], message: `награда ${k} меньше, чем у предыдущего порога` });
      }
      for (const k of ['blue', 'purple'] as const) {
        if ((t.rewards.heroCards?.[k] ?? 0) < (prev.heroCards?.[k] ?? 0)) c.addIssue({ code: 'custom', path: ['tiers', i, 'rewards', 'heroCards', k], message: `карт героя (${k}) меньше, чем у предыдущего порога` });
      }
    });
  });

export type HuntBoss = z.infer<typeof HuntBossSchema>;
export type HuntReward = z.infer<typeof HuntRewardSchema>;
export type HuntTier = z.infer<typeof HuntTierSchema>;
export type HuntConfig = z.infer<typeof HuntConfigSchema>;
export type HuntRank = z.infer<typeof HuntRankSchema>;
export type HuntMvp = z.infer<typeof HuntMvpSchema>;
