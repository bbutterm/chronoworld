import { z } from 'zod';
import { UnitSchema } from '../content/schema';
import { GenderSchema } from '../progression/schema';

/**
 * Карточки героев (docs/design/heroes.md): шаблон карточки `data/heroes/<id>.json`, редкости и правила вознесения
 * `data/cards.json`, призыв `data/summon.json`. Экземпляр карточки игрока — save.heroes[] (save/schema.ts).
 */

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id: латиница в нижнем регистре, цифры и _');

/** Редкости по возрастанию. Набор фиксирован кодом, числа каждой — в data/cards.json → rarities. */
export const CARD_RARITIES = ['green', 'blue', 'purple', 'gold', 'red'] as const;
export const CardRaritySchema = z.enum(CARD_RARITIES);
export type CardRarity = z.infer<typeof CardRaritySchema>;

/** Номер редкости (0 — зелёный … 4 — красный). */
export const rarityIndex = (r: CardRarity): number => CARD_RARITIES.indexOf(r);

/** Множители к статам линии {hp, atk, def, spd}; не указанный — 1. */
export const CardStatModsSchema = z
  .object({ hp: z.number().positive(), atk: z.number().positive(), def: z.number().positive(), spd: z.number().positive() })
  .partial()
  .default({});

/** Навык карточки: открывается на уровне level (уровни возрастают, не больше одного навыка на уровень). */
export const CardSkillSchema = z.object({ level: z.number().int().positive(), skill: id });

/** Форма сюжетной карточки: с редкости rarity (включительно) у героя другой класс — вторая профессия. */
export const HeroFormSchema = z.object({
  rarity: CardRaritySchema,
  job: id,
  role: UnitSchema.shape.role.optional(),
  statMods: CardStatModsSchema,
  skills: z.array(CardSkillSchema).min(1),
  /** Лист спрайта формы (id из assets/sprites/sprites.json, например knight_m); нет — лист класса по полу. */
  visual: z.object({ sprite: z.string().optional() }).default({}),
});

export const HeroTemplateSchema = z.object({
  $schema: z.string().optional(),
  $comment: z.string().optional(),
  id,
  name: z.string().min(1),
  gender: GenderSchema,
  /** Класс — id из data/jobs: обычная атака, спрайт по умолчанию. */
  job: id,
  /** Линия — первая профессия ветки (swordman, archer, mage, thief, acolyte, merchant); статы растут по ней. */
  line: id,
  role: UnitSchema.shape.role,
  /** story — выдаёт сюжет (в призыве нет, растёт осколками); summon — из Таверны (растёт копиями). */
  source: z.enum(['story', 'summon']),
  baseRarity: CardRaritySchema,
  maxRarity: CardRaritySchema,
  statMods: CardStatModsSchema,
  skills: z.array(CardSkillSchema).min(1),
  /** Только у сюжетных: вторая профессия на фиолетовой редкости и выше. */
  forms: z.array(HeroFormSchema).default([]),
  /**
   * Вид базовой формы: sprite — свой лист (id из assets/sprites/sprites.json, например swordman_m); нет листа в реестре
   * или поля — лист класса по полу (`<лист класса>_<m|f>`, иначе базовый). Портрет — по листу.
   */
  visual: z.object({ sprite: z.string().optional(), portrait: z.string().optional() }).default({}),
  bio: z.string().max(160),
  hook: z.string().max(200),
});

export type HeroTemplate = z.infer<typeof HeroTemplateSchema>;
export type HeroForm = z.infer<typeof HeroFormSchema>;
export type CardStatMods = z.infer<typeof CardStatModsSchema>;
export type CardSkill = z.infer<typeof CardSkillSchema>;

/** Дорожка роста: first — первые профессии призыва, second — вторые (призыв), story — сюжетные (осколки). */
export const TRACKS = ['first', 'second', 'story'] as const;
export type CardTrack = (typeof TRACKS)[number];

const FodderSlotSchema = z.object({
  /** same — тот же шаблон; line — любой призывной шаблон той же линии. */
  kind: z.enum(['same', 'line']),
  rarity: CardRaritySchema,
  count: z.number().int().positive(),
});

export const MergeRuleSchema = z.object({
  track: z.enum(TRACKS),
  from: CardRaritySchema,
  to: CardRaritySchema,
  gold: z.number().int().nonnegative(),
  /** Корм (призывные карточки). */
  fodder: z.array(FodderSlotSchema).default([]),
  /** Осколки героя (сюжетные карточки). */
  shards: z.number().int().nonnegative().default(0),
  /** Нужный уровень цели (например, ур. 40 для второй профессии сюжетного героя). */
  minLevel: z.number().int().positive().optional(),
});

export const RarityDefSchema = z.object({
  id: CardRaritySchema,
  name: z.string(),
  /** Цвет рамки '#rrggbb'. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  maxLevel: z.number().int().positive(),
  /** Множитель статов. */
  statMult: z.number().positive(),
  /** Множитель урона/лечения/щита навыков (Unit.skillPower). */
  skillPower: z.number().positive(),
});

/** data/cards.json */
export const CardsConfigSchema = z
  .object({
    $comment: z.string().optional(),
    rarities: z.array(RarityDefSchema),
    /** Стоимость уровня L → L+1: опыт floor(exp.base × L^exp.power), золото floor(gold.base × L^gold.power). */
    level: z.object({
      exp: z.object({ base: z.number().positive(), power: z.number().positive() }),
      gold: z.object({ base: z.number().nonnegative(), power: z.number().positive() }),
    }),
    merge: z.array(MergeRuleSchema),
    shards: z.object({
      /** Осколки за первое прохождение этапа кампании (обычного и босса главы). */
      firstClear: z.number().int().nonnegative(),
      bossFirstClear: z.number().int().nonnegative(),
      /** Победа на пройденном этапе: с шансом replayChance — replayCount осколков. */
      replayChance: z.number().min(0).max(1),
      replayCount: z.number().int().nonnegative(),
    }),
  })
  .superRefine((cfg, c) => {
    const ids = cfg.rarities.map((r) => r.id);
    if (ids.join() !== CARD_RARITIES.join()) c.addIssue({ code: 'custom', path: ['rarities'], message: `редкости по порядку: ${CARD_RARITIES.join(', ')}` });
    cfg.rarities.forEach((r, i) => {
      const prev = cfg.rarities[i - 1];
      if (prev && r.maxLevel <= prev.maxLevel) c.addIssue({ code: 'custom', path: ['rarities', i, 'maxLevel'], message: 'предел уровня должен расти с редкостью' });
    });
    const seen = new Set<string>();
    cfg.merge.forEach((m, i) => {
      const key = `${m.track}:${m.from}`;
      if (seen.has(key)) c.addIssue({ code: 'custom', path: ['merge', i], message: `правило ${m.track} ${m.from} → … встречается дважды` });
      seen.add(key);
      if (rarityIndex(m.to) !== rarityIndex(m.from) + 1) c.addIssue({ code: 'custom', path: ['merge', i, 'to'], message: `${m.from} → ${m.to}: переход только на следующую редкость` });
      if (m.track === 'story' && (m.fodder.length > 0 || m.shards <= 0)) c.addIssue({ code: 'custom', path: ['merge', i], message: 'сюжетные карточки растут только осколками (shards > 0, без fodder)' });
      if (m.track !== 'story' && (m.fodder.length === 0 || m.shards > 0)) c.addIssue({ code: 'custom', path: ['merge', i], message: 'призывные карточки растут кормом (fodder, без shards)' });
    });
  });

export type RarityDef = z.infer<typeof RarityDefSchema>;
export type MergeRule = z.infer<typeof MergeRuleSchema>;
export type CardsConfig = z.infer<typeof CardsConfigSchema>;

/** data/summon.json — Таверна. */
export const SummonConfigSchema = z
  .object({
    $comment: z.string().optional(),
    /** Этап кампании, после первой победы на котором открывается Таверна (и выдаётся welcome). */
    unlockAfterStage: id,
    costs: z.object({ single: z.number().int().nonnegative(), ten: z.number().int().nonnegative() }),
    /**
     * Шансы редкостей (сумма 1). baseRarities — какие шаблоны выпадают этой редкостью: призывные с baseRarity из списка
     * (синие — и зелёные шаблоны первых профессий, выпавшие сразу синими).
     */
    rates: z.array(z.object({ rarity: CardRaritySchema, chance: z.number().min(0).max(1), baseRarities: z.array(CardRaritySchema).min(1) })).min(1),
    /** Гарант: призыв номер every без этой редкости подряд — эта редкость. */
    pity: z.object({ rarity: CardRaritySchema, every: z.number().int().positive() }),
    /** Первый призыв ×10 обязательно содержит эту редкость (один раз). */
    firstTen: z.object({ rarity: CardRaritySchema }),
    freePerDay: z.number().int().nonnegative(),
    welcome: z.object({ gems: z.number().int().nonnegative(), scrolls: z.number().int().nonnegative() }),
    /** Каждый призыв с шансом chance приносит ещё count осколков «отстающего» сюжетного героя (shardTarget). */
    storyShard: z.object({ chance: z.number().min(0).max(1), count: z.number().int().nonnegative() }),
  })
  .superRefine((cfg, c) => {
    const sum = cfg.rates.reduce((s, r) => s + r.chance, 0);
    if (Math.abs(sum - 1) > 1e-9) c.addIssue({ code: 'custom', path: ['rates'], message: `сумма шансов ${sum}, а должна быть 1` });
    if (cfg.pity.every < 10) c.addIssue({ code: 'custom', path: ['pity', 'every'], message: 'гарант не меньше 10 призывов' });
    if (!cfg.rates.some((r) => r.rarity === cfg.pity.rarity)) c.addIssue({ code: 'custom', path: ['pity', 'rarity'], message: 'редкости гаранта нет среди rates' });
    if (!cfg.rates.some((r) => r.rarity === cfg.firstTen.rarity)) c.addIssue({ code: 'custom', path: ['firstTen', 'rarity'], message: 'редкости первого ×10 нет среди rates' });
  });

export type SummonConfig = z.infer<typeof SummonConfigSchema>;

/** Конфиги карточек в контексте игры. */
export interface HeroesConfig {
  cards: CardsConfig;
  summon: SummonConfig;
}
