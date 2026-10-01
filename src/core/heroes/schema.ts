import { z } from 'zod';
import { UnitSchema } from '../content/schema';
import { GenderSchema } from '../progression/schema';

/**
 * Герои v2 (docs/design/heroes-v2.md): шаблон героя `data/heroes/<id>.json` — первая профессия и две ветки второй
 * профессии (выбор на фиолетовом), редкости и правила вознесения `data/cards.json`, призыв `data/summon.json`.
 * Экземпляр героя игрока — save.heroes[] (save/schema.ts).
 */

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id: латиница в нижнем регистре, цифры и _');

/** Редкости по возрастанию. Набор фиксирован кодом, числа каждой — в data/cards.json → rarities. */
export const CARD_RARITIES = ['green', 'blue', 'purple', 'gold', 'red'] as const;
export const CardRaritySchema = z.enum(CARD_RARITIES);
export type CardRarity = z.infer<typeof CardRaritySchema>;

/** Предел строк-комментариев героя (Таверна, вознесение). */
export const HERO_LINE_MAX = 120;
const heroLine = (what: string) => z.string().min(1).max(HERO_LINE_MAX, `${what}: не длиннее ${HERO_LINE_MAX} символов`);

/** Номер редкости (0 — зелёный … 4 — красный). */
export const rarityIndex = (r: CardRarity): number => CARD_RARITIES.indexOf(r);

/** Редкость, с которой герой выбирает ветку второй профессии (форма ветки действует с неё и выше). */
export const BRANCH_RARITY: CardRarity = 'purple';

/**
 * Выпадение карт героя из источников (этапы, сундук, охота, поручения, достижения, награды событий;
 * docs/design/heroes-v2.md, раздел 2.3): ожидаемое число карт каждой редкости. Каждая карта — экземпляр СЛУЧАЙНОГО
 * героя этой редкости (копия ему в рост). Целая часть — выдаётся всегда, дробная — шанс ещё одной
 * (0.05 — 5%; 1.5 — одна точно и 50% второй). Нет поля — 0.
 */
export const HeroCardDropSchema = z.object({
  blue: z.number().nonnegative().optional(),
  purple: z.number().nonnegative().optional(),
});
export type HeroCardDrop = z.infer<typeof HeroCardDropSchema>;

/** Множители к статам линии {hp, atk, def, spd}; не указанный — 1. */
export const CardStatModsSchema = z
  .object({ hp: z.number().positive(), atk: z.number().positive(), def: z.number().positive(), spd: z.number().positive() })
  .partial()
  .default({});

/** Навык героя: открывается на уровне level (уровни возрастают, не больше одного навыка на уровень). */
export const CardSkillSchema = z.object({ level: z.number().int().positive(), skill: id });

/**
 * Ветка второй профессии (форма на фиолетовом и выше, выбирает игрок): класс, роль, статы, 4 навыка, лист спрайта,
 * строка возвышения. Пол героя сохраняется (Лучник-парень → Бард, девушка → Танцовщица).
 */
export const HeroBranchSchema = z.object({
  /** Вторая профессия (id из data/jobs, tier 2 линии героя). Это же значение хранится в save.heroes[].branch. */
  job: id,
  role: UnitSchema.shape.role,
  statMods: CardStatModsSchema,
  skills: z.array(CardSkillSchema).min(1),
  /**
   * Ульта формы (docs/design/battle-decisions.md §1): навык из data/skills, открыт с 1-го уровня, срабатывает на полной
   * энергии (в бою — skills.ult юнита). Не совпадает с навыками формы. Нет — ультой станет навык с самой долгой
   * перезарядкой (ultSkillOf); у героев data/heroes есть у каждой формы (tests/hero-ults.test.ts).
   */
  ult: id.optional(),
  /** Строка возвышения: экран выбора ветки и вознесения (≤ 160 символов). */
  promotion: z.string().max(160),
  /**
   * История формы (2–3 предложения, ≤ 300 символов): кем герой стал после возвышения — вкладка «История» карточки.
   * Нет — content:check предупреждает (во вкладке останется только строка возвышения).
   */
  bio: z.string().max(300).optional(),
  /** Лист спрайта формы (id из assets/sprites/sprites.json, например knight_m); нет листа — лист класса по полу. */
  visual: z.object({ sprite: z.string().optional() }).default({}),
  /** Профиль поведения формы в бою (id из data/combat.json → behaviors), если отличается от профиля профессии. */
  behavior: id.optional(),
});

export const HeroTemplateSchema = z.object({
  $schema: z.string().optional(),
  $comment: z.string().optional(),
  id,
  name: z.string().min(1),
  gender: GenderSchema,
  /** Первая профессия — id из data/jobs (tier 1): обычная атака, спрайт до выбора ветки. */
  job: id,
  /** Линия — первая профессия ветки (swordman, archer, mage, thief, acolyte, merchant); статы растут по ней. */
  line: id,
  role: UnitSchema.shape.role,
  /**
   * story — приходит по сюжету (progression.heroes); summon — только из Таверны. На правила роста не влияет:
   * все герои растут копиями одной дорожкой (раздел 2.2).
   */
  source: z.enum(['story', 'summon']),
  baseRarity: CardRaritySchema,
  maxRarity: CardRaritySchema,
  statMods: CardStatModsSchema,
  skills: z.array(CardSkillSchema).min(1),
  /**
   * Ульта формы (docs/design/battle-decisions.md §1): навык из data/skills, открыт с 1-го уровня, срабатывает на полной
   * энергии (в бою — skills.ult юнита). Не совпадает с навыками формы. Нет — ультой станет навык с самой долгой
   * перезарядкой (ultSkillOf); у героев data/heroes есть у каждой формы (tests/hero-ults.test.ts).
   */
  ult: id.optional(),
  /** Профиль поведения первой профессии в бою (id из data/combat.json → behaviors), если отличается от профиля профессии. */
  behavior: id.optional(),
  /** Две ветки второй профессии: выбор на фиолетовом (hero.branch = job ветки). */
  branches: z.array(HeroBranchSchema).length(2),
  /**
   * Вид первой профессии: sprite — свой лист (id из assets/sprites/sprites.json, например swordman_m); нет листа в реестре
   * или поля — лист класса по полу (`<лист класса>_<m|f>`, иначе базовый). Портрет — по листу.
   */
  visual: z.object({ sprite: z.string().optional(), portrait: z.string().optional() }).default({}),
  bio: z.string().max(160),
  hook: z.string().max(200),
  /**
   * Строка при выпадении героя в Таверне (docs/design/lore-route.md §5.8): кто-то что-то делает — одна фраза, без кавычек
   * (UI ставит «»). Показ — крупная карта и итог призыва.
   */
  tavernLine: heroLine('строка Таверны').optional(),
  /**
   * Строки вознесения по редкости, на которую герой поднялся (blue, purple, gold, red): экран результата вознесения,
   * как строка возвышения ветки. Нет строки редкости — ничего не показывается.
   */
  ascendLines: z
    .object({ blue: heroLine('строка вознесения').optional(), purple: heroLine('строка вознесения').optional(), gold: heroLine('строка вознесения').optional(), red: heroLine('строка вознесения').optional() })
    .strict()
    .optional(),
});

export type HeroTemplate = z.infer<typeof HeroTemplateSchema>;
export type HeroBranch = z.infer<typeof HeroBranchSchema>;
export type CardStatMods = z.infer<typeof CardStatModsSchema>;
export type CardSkill = z.infer<typeof CardSkillSchema>;

const FodderSlotSchema = z.object({
  /** same — копия того же героя; any — копия любого героя. */
  kind: z.enum(['same', 'any']),
  /** Редкость корма (ровно такая). */
  rarity: CardRaritySchema,
  count: z.number().int().positive(),
});

/** Переход на следующую редкость — одна дорожка для всех героев. */
export const MergeRuleSchema = z.object({
  from: CardRaritySchema,
  to: CardRaritySchema,
  gold: z.number().int().nonnegative(),
  fodder: z.array(FodderSlotSchema).min(1),
  /** На этом переходе игрок выбирает ветку второй профессии. */
  branch: z.boolean().optional(),
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
    $schema: z.string().optional(),
    $comment: z.string().optional(),
    rarities: z.array(RarityDefSchema),
    /** Стоимость уровня L → L+1: опыт floor(exp.base × L^exp.power), золото floor(gold.base × L^gold.power). */
    level: z.object({
      exp: z.object({ base: z.number().positive(), power: z.number().positive() }),
      gold: z.object({ base: z.number().nonnegative(), power: z.number().positive() }),
    }),
    merge: z.array(MergeRuleSchema),
    /** Смена ветки второй профессии: цена в гемах; firstFree — первая смена у экземпляра бесплатно. */
    branchChange: z.object({ gems: z.number().int().nonnegative(), firstFree: z.boolean() }),
    /** Карты случайных героев за этапы кампании (ожидаемое число, см. HeroCardDropSchema). */
    heroCards: z.object({
      /** Первое прохождение обычного этапа. */
      firstClear: HeroCardDropSchema,
      /** Первое прохождение этапа-босса главы. */
      bossFirstClear: HeroCardDropSchema,
      /** Победа на уже пройденном этапе. */
      replay: HeroCardDropSchema,
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
      if (seen.has(m.from)) c.addIssue({ code: 'custom', path: ['merge', i], message: `правило ${m.from} → … встречается дважды` });
      seen.add(m.from);
      if (rarityIndex(m.to) !== rarityIndex(m.from) + 1) c.addIssue({ code: 'custom', path: ['merge', i, 'to'], message: `${m.from} → ${m.to}: переход только на следующую редкость` });
      if (m.branch && m.to !== BRANCH_RARITY) c.addIssue({ code: 'custom', path: ['merge', i, 'branch'], message: `ветка выбирается при переходе на ${BRANCH_RARITY}` });
      if (m.fodder.some((f) => rarityIndex(f.rarity) > rarityIndex(m.from))) c.addIssue({ code: 'custom', path: ['merge', i, 'fodder'], message: 'корм не может быть выше редкости цели' });
    });
    if (!cfg.merge.some((m) => m.branch)) c.addIssue({ code: 'custom', path: ['merge'], message: 'нет перехода с выбором ветки (branch: true)' });
  });

export type RarityDef = z.infer<typeof RarityDefSchema>;
export type MergeRule = z.infer<typeof MergeRuleSchema>;
export type FodderSlot = z.infer<typeof FodderSlotSchema>;
export type CardsConfig = z.infer<typeof CardsConfigSchema>;

/** data/summon.json — Таверна. */
export const SummonConfigSchema = z
  .object({
    $schema: z.string().optional(),
    $comment: z.string().optional(),
    /**
     * Этап открытия Таверны (и подарка welcome) — теперь в data/unlocks.json (строка tavern). Здесь — только для
     * контекстов без таблицы открытий; задан и там, и тут — ошибка.
     */
    unlockAfterStage: id.optional(),
    costs: z.object({ single: z.number().int().nonnegative(), ten: z.number().int().nonnegative() }),
    /** Шансы редкостей (сумма 1). Внутри редкости — равновероятно среди героев пула (все шаблоны, сюжетные — после присоединения). */
    rates: z.array(z.object({ rarity: CardRaritySchema, chance: z.number().min(0).max(1) })).min(1),
    /**
     * Гаранты по возрастанию редкости: призыв номер every подряд без этой редкости или выше — эта редкость
     * (счётчики save.summon.sinceBlue / sincePurple).
     */
    pity: z.array(z.object({ rarity: z.enum(['blue', 'purple']), every: z.number().int().positive() })).min(1),
    /** Первый призыв ×10 содержит не меньше count карт этой редкости или выше (один раз). */
    firstTen: z.object({ rarity: CardRaritySchema, count: z.number().int().positive().max(10) }),
    freePerDay: z.number().int().nonnegative(),
    welcome: z.object({
      gems: z.number().int().nonnegative(),
      scrolls: z.number().int().nonnegative(),
      /** Счётчик гаранта фиолетовой при подарке (решение владельца 28.09: 40 из 50 — первый ×10 даёт фиолетовую). */
      purplePity: z.number().int().nonnegative().optional(),
    }),
  })
  .superRefine((cfg, c) => {
    const sum = cfg.rates.reduce((s, r) => s + r.chance, 0);
    if (Math.abs(sum - 1) > 1e-9) c.addIssue({ code: 'custom', path: ['rates'], message: `сумма шансов ${sum}, а должна быть 1` });
    cfg.pity.forEach((p, i) => {
      if (p.every < 10) c.addIssue({ code: 'custom', path: ['pity', i, 'every'], message: 'гарант не меньше 10 призывов' });
      if (!cfg.rates.some((r) => r.rarity === p.rarity)) c.addIssue({ code: 'custom', path: ['pity', i, 'rarity'], message: 'редкости гаранта нет среди rates' });
      if (cfg.pity.findIndex((x) => x.rarity === p.rarity) !== i) c.addIssue({ code: 'custom', path: ['pity', i, 'rarity'], message: 'гарант этой редкости указан дважды' });
    });
    if (!cfg.rates.some((r) => r.rarity === cfg.firstTen.rarity)) c.addIssue({ code: 'custom', path: ['firstTen', 'rarity'], message: 'редкости первого ×10 нет среди rates' });
  });

/** Таверна после сборки: этап открытия известен всегда (из data/unlocks.json или из summon.json). */
export type SummonConfig = Omit<z.infer<typeof SummonConfigSchema>, 'unlockAfterStage'> & { unlockAfterStage: string };

/** Конфиги карточек в контексте игры. */
export interface HeroesConfig {
  cards: CardsConfig;
  summon: SummonConfig;
}
