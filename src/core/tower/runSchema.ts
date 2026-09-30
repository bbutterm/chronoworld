import { z } from 'zod';
import { ElementSchema } from '../elements';

/** Забег-рогалик Башни (docs/design/tower-roguelite.md): карты-благословения, события, улучшения, забег в сохранении. */

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id: латиница в нижнем регистре, цифры и _');

export const BLESSING_RARITIES = ['common', 'rare', 'legendary'] as const;
export const BlessingRaritySchema = z.enum(BLESSING_RARITIES);
export type BlessingRarity = z.infer<typeof BlessingRaritySchema>;

const pct = z.number().min(0).max(5);

/**
 * Эффект карты-благословения. Боевые меняют правила боя (хуки src/core/tower/blessings.ts); забеговые — recruit, reviveRun
 * (сразу при выборе), afterHeal, greed (весь забег). Одинаковые эффекты складываются.
 */
export const BlessingEffectSchema = z.discriminatedUnion('kind', [
  /** Первый удар отряда по каждому врагу — ×mult («крит»). */
  z.object({ kind: z.literal('firstStrike'), mult: z.number().min(1) }),
  /** Щит в начале боя: pct макс. ОЗ каждому герою. */
  z.object({ kind: z.literal('startShield'), pct }),
  /** Убийство врага лечит весь отряд на pct макс. ОЗ. */
  z.object({ kind: z.literal('killHeal'), pct }),
  /** Раз за бой павший герой встаёт с hpPct ОЗ; healer — только если жив лекарь/поддержка (он и поднимает). */
  z.object({ kind: z.literal('reviveOnce'), hpPct: pct, healer: z.boolean().default(false) }),
  /** Удар задевает врагов в radius от цели на pct урона. on: basic — обычные атаки, skill — навыки; element — только навыки этой стихии. */
  z.object({ kind: z.literal('splash'), pct, radius: z.number().positive().default(250), on: z.enum(['basic', 'skill']), element: ElementSchema.optional() }),
  /** Навык (не обычная атака) перескакивает на ещё одного случайного врага с pct урона. */
  z.object({ kind: z.literal('echo'), pct }),
  /** Павший союзник: остальным героям +atkPct атаки до конца боя. */
  z.object({ kind: z.literal('allyDeathRage'), atkPct: pct }),
  /** Враг-трус на пороге бегства взрывается: pct его макс. ОЗ урона соседям в radius. */
  z.object({ kind: z.literal('cowardBomb'), pct, radius: z.number().positive().default(260) }),
  /** Нейтральные удары героев получают стихию element (таблица стихий боя). */
  z.object({ kind: z.literal('element'), element: ElementSchema }),
  /** Враг ниже pct ОЗ падает от любого удара героя. */
  z.object({ kind: z.literal('execute'), pct: z.number().min(0).max(0.9) }),
  /** Каждые every секунд живые герои лечатся на pct макс. ОЗ. */
  z.object({ kind: z.literal('regen'), pct, every: z.number().positive() }),
  /** Атака героев × (1 + pct) на весь бой. */
  z.object({ kind: z.literal('atk'), pct: z.number().min(-0.9).max(5) }),
  /** Лечение и щиты, полученные героями, × (1 + pct) (цена карты — отрицательный pct). */
  z.object({ kind: z.literal('healTaken'), pct: z.number().min(-0.9).max(5) }),
  /** В начале боя герои теряют pct текущих ОЗ (не ниже 1). */
  z.object({ kind: z.literal('startHpLoss'), pct: z.number().min(0).max(0.9) }),
  /** Последний живой герой: +atkPct атаки и щит shieldPct макс. ОЗ. */
  z.object({ kind: z.literal('lastStand'), atkPct: pct, shieldPct: pct }),
  /** Ряд героев (front — слоты 0–1, back — 2–4) получает урон × (1 − pct). */
  z.object({ kind: z.literal('rowGuard'), row: z.enum(['front', 'back']), pct: z.number().min(0).max(0.9) }),
  /** В начале боя шкала хода героев полная — первый ход за отрядом. */
  z.object({ kind: z.literal('swiftStart') }),
  /** Обычная атака героя с шансом chance отравляет цель (k × ATK каждый ход, turns ходов). */
  z.object({ kind: z.literal('poison'), chance: z.number().min(0).max(1), k: z.number().positive(), turns: z.number().int().positive() }),
  /** Обычная атака героя с шансом chance оглушает цель (сбивает и заряд босса). */
  z.object({ kind: z.literal('stun'), chance: z.number().min(0).max(1), turns: z.number().int().positive() }),
  /** Урон навыков врагов (не обычных атак) × (1 − pct). */
  z.object({ kind: z.literal('skillShield'), pct: z.number().min(0).max(0.9) }),
  /** Первый удар по каждому герою в бою — промах. */
  z.object({ kind: z.literal('dodgeFirst') }),
  /** Обычная атака героя с шансом chance бьёт дважды (×2 урона). */
  z.object({ kind: z.literal('doubleHit'), chance: z.number().min(0).max(1) }),
  /** Первая ульта каждого героя за бой сразу снова готова. */
  z.object({ kind: z.literal('ultReset') }),
  /** Удар по герою с шансом chance обрушивает метеоры на всех врагов: k × ATK героя. */
  z.object({ kind: z.literal('meteor'), chance: z.number().min(0).max(1), k: z.number().positive() }),
  /** Убийца врага сразу получает ход (полная шкала). */
  z.object({ kind: z.literal('killHaste') }),
  /** После ульты героя остальные герои получают pct шкалы хода. */
  z.object({ kind: z.literal('ultHaste'), pct: z.number().min(0).max(1) }),
  // --- забеговые ---
  /** Сразу: все павшие в забеге встают с hpPct ОЗ. */
  z.object({ kind: z.literal('reviveRun'), hpPct: pct }),
  /** Сразу: в свободный слот отряда встаёт сильнейший герой из запаса (не был в забеге). */
  z.object({ kind: z.literal('recruit') }),
  /** Весь забег: после каждого боя отряд лечится ещё на pct. */
  z.object({ kind: z.literal('afterHeal'), pct }),
  /** Весь забег: осколки × (1 + shards), враги × (1 + enemies). */
  z.object({ kind: z.literal('greed'), shards: pct, enemies: pct }),
]);
export type BlessingEffect = z.infer<typeof BlessingEffectSchema>;

/** Карта-благословение (карта монстра RO). */
export const BlessingSchema = z.object({
  id,
  name: z.string().min(1).max(28),
  rarity: BlessingRaritySchema,
  /** Вид карты: need карт одного вида дают бонус вида (families). */
  family: id,
  /** Иллюстрация: портрет юнита data/units (монстр карты); нет — значок скина icon. */
  monster: id.optional(),
  icon: z.string().optional(),
  /** 1–2 строки для игрока. */
  text: z.string().min(1).max(110),
  /** Карта с ценой (что-то отнимает) — подпись «Цена». */
  cost: z.boolean().default(false),
  /** Предлагать только если есть смысл: fallen — есть павшие, slot — есть свободный слот и герой в запасе. */
  requires: z.enum(['fallen', 'slot']).optional(),
  effects: z.array(BlessingEffectSchema).min(1),
});
export type Blessing = z.infer<typeof BlessingSchema>;

export const BlessingFamilySchema = z.object({
  id,
  name: z.string().min(1).max(20),
  /** Цвет вида (#rrggbb). */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  need: z.number().int().min(2).default(2),
  bonusText: z.string().min(1).max(90),
  bonus: z.array(BlessingEffectSchema).min(1),
});
export type BlessingFamily = z.infer<typeof BlessingFamilySchema>;

export const NODE_KINDS = ['battle', 'elite', 'event', 'rest', 'boss'] as const;
export const TowerNodeKindSchema = z.enum(NODE_KINDS);
export type TowerNodeKind = z.infer<typeof TowerNodeKindSchema>;

/** Исход варианта события (без вложенных бросков). */
export const EventOutcomeBaseSchema = z.discriminatedUnion('kind', [
  /** ОЗ живых героев ± pct макс. (урон не убивает — остаётся не меньше 5%). */
  z.object({ kind: z.literal('hp'), pct: z.number().min(-0.9).max(1) }),
  /** Выбор карты: не ниже rarity. */
  z.object({ kind: z.literal('card'), rarity: BlessingRaritySchema.default('common') }),
  /** Осколки забега ± n. */
  z.object({ kind: z.literal('shards'), n: z.number().int() }),
  /** Поднять одного павшего (первого) с hpPct. */
  z.object({ kind: z.literal('revive'), hpPct: pct }),
  /** Отдать последнюю взятую карту — выбор из карт на ступень выше. */
  z.object({ kind: z.literal('upgradeCard') }),
]);
export const EventOutcomeSchema = z.union([
  EventOutcomeBaseSchema,
  z.object({ kind: z.literal('gamble'), chance: z.number().min(0).max(1), win: z.array(EventOutcomeBaseSchema), lose: z.array(EventOutcomeBaseSchema) }),
]);
export type EventOutcome = z.infer<typeof EventOutcomeSchema>;

export const TowerEventSchema = z.object({
  id,
  title: z.string().min(1).max(30),
  /** Короткий текст (2–3 строки). */
  text: z.string().min(1).max(240),
  monster: id.optional(),
  icon: z.string().optional(),
  options: z
    .array(
      z.object({
        label: z.string().min(1).max(30),
        /** Что будет — короткая строка под кнопкой. */
        hint: z.string().max(60).default(''),
        /** Итог для игрока после выбора (при броске — result выигрыша, resultLose — проигрыша). */
        result: z.string().min(1).max(140),
        resultLose: z.string().max(140).optional(),
        requires: z.object({ shards: z.number().int().positive().optional(), fallen: z.boolean().optional(), cards: z.boolean().optional() }).optional(),
        outcomes: z.array(EventOutcomeSchema),
      }),
    )
    .min(1)
    .max(3),
});
export type TowerEventDef = z.infer<typeof TowerEventSchema>;

export const TOWER_UPGRADE_EFFECTS = ['startBlessing', 'extraChoice', 'restHeal', 'afterHeal', 'reroll', 'shards', 'secondWind'] as const;

/** Постоянное улучшение за осколки башни. value — сила за уровень. */
export const TowerUpgradeSchema = z.object({
  id,
  name: z.string().min(1).max(24),
  text: z.string().min(1).max(90),
  effect: z.enum(TOWER_UPGRADE_EFFECTS),
  value: z.number().nonnegative().default(1),
  /** Цена уровней по порядку (длина = число уровней). */
  costs: z.array(z.number().int().positive()).min(1),
});
export type TowerUpgrade = z.infer<typeof TowerUpgradeSchema>;

const Weights = z.partialRecord(BlessingRaritySchema, z.number().nonnegative());

export const TowerRunConfigSchema = z.object({
  $comment: z.string().optional(),
  /** Сила врагов по ступени игрока (номер главы фронта кампании, с 1): tierMult[ступень − 1], дальше — последняя. */
  tierMult: z.array(z.number().positive()).min(1),
  /** Рост силы врагов от этажа к этажу (сложный процент). */
  growthPerFloor: z.number().nonnegative(),
  eliteMult: z.number().positive(),
  bossMult: z.number().positive(),
  /** Босс — каждый bossEvery-й этаж забега. */
  bossEvery: z.number().int().positive(),
  /** Выбор карты после каждого blessingEvery-го этажа (и после элиты/босса). */
  blessingEvery: z.number().int().positive(),
  choices: z.number().int().min(2).max(5),
  /** Лечение после боя (доля макс. ОЗ) и на отдыхе. */
  afterBattleHeal: z.number().min(0).max(1),
  restHeal: z.number().min(0).max(1),
  /** Веса редкости карт по источнику выбора. */
  rarity: z.object({ floor: Weights, elite: Weights, boss: Weights, event: Weights, start: Weights }),
  /** Веса типов этажа на развилке и с какого этажа тип возможен. */
  paths: z.object({
    weights: z.partialRecord(TowerNodeKindSchema, z.number().nonnegative()),
    minFloor: z.partialRecord(TowerNodeKindSchema, z.number().int().positive()),
  }),
  /** Осколки: за пройденный бой + добавка элиты/босса. */
  shards: z.object({ floor: z.number().int().nonnegative(), elite: z.number().int().nonnegative(), boss: z.number().int().nonnegative() }),
  /** Добыча дня: за этаж — доля награды последнего пройденного этапа кампании; оплачиваются этажи выше уже оплаченных сегодня. */
  lootPerFloor: z.number().nonnegative(),
  /** Рекорд: за каждый новый лучший этаж — гемы; босс-этаж — ещё bossGems и бросок «Благословенной руды». */
  record: z.object({ gemsPerFloor: z.number().int().nonnegative(), bossGems: z.number().int().nonnegative() }),
  families: z.array(BlessingFamilySchema).min(1),
  blessings: z.array(BlessingSchema).min(3),
  events: z.array(TowerEventSchema).min(1),
  upgrades: z.array(TowerUpgradeSchema).min(1),
});
export type TowerRunConfig = z.infer<typeof TowerRunConfigSchema>;

/** Забег в сохранении (save.tower.run). ОЗ героев — в тысячных долях макс. ОЗ (0 — пал). */
export const TowerRunSchema = z.object({
  seed: z.number().int().nonnegative(),
  tier: z.number().int().positive(),
  /** Пройдено этажей в забеге. */
  floor: z.number().int().nonnegative(),
  squad: z.array(z.string().nullable()).length(5),
  hp: z.record(z.string(), z.number().int().min(0).max(1000)),
  fallen: z.array(z.string()),
  cards: z.array(z.string()),
  /** Развилка: варианты следующего этажа. */
  paths: z.array(TowerNodeKindSchema).min(1).max(3),
  /** Выбранный бой (ждёт штурма). */
  node: TowerNodeKindSchema.optional(),
  pending: z
    .discriminatedUnion('kind', [
      z.object({
        kind: z.literal('blessing'),
        options: z.array(z.string()),
        source: z.enum(['floor', 'elite', 'boss', 'event', 'start', 'upgrade']),
        rolls: z.number().int().nonnegative(),
      }),
      z.object({ kind: z.literal('event'), event: z.string() }),
    ])
    .optional(),
  /** Итог события/отдыха (одна строка) — до следующего шага. */
  note: z.string().optional(),
  shards: z.number().int().nonnegative(),
  rerolls: z.number().int().nonnegative(),
  /** «Второе дыхание»: сколько раз павший ещё встанет после боя. */
  lives: z.number().int().nonnegative(),
  /** Добыча за этаж (золото и опыт в пул) — от этапа кампании на старте забега. */
  loot: z.object({ gold: z.number().int().nonnegative(), jobExp: z.number().int().nonnegative() }),
  battles: z.number().int().nonnegative(),
  /** Рекорд (save.tower.floor) на старте забега и гемы за новые рекорды в этом забеге. */
  best: z.number().int().nonnegative(),
  gems: z.number().int().nonnegative(),
});
export type TowerRun = z.infer<typeof TowerRunSchema>;

/** Итог последнего забега (экран показывает). */
export const TowerRunSummarySchema = z.object({
  floor: z.number().int().nonnegative(),
  shards: z.number().int().nonnegative(),
  gold: z.number().int().nonnegative(),
  jobExp: z.number().int().nonnegative(),
  gems: z.number().int().nonnegative(),
  record: z.boolean(),
  won: z.boolean(),
  seen: z.boolean(),
});
export type TowerRunSummary = z.infer<typeof TowerRunSummarySchema>;

/**
 * save.tower. floor — лучший этаж (рекорд; в старых сохранениях — пройденный этаж старой лестницы, он и становится
 * рекордом). Остальное — необязательные поля забега, без смены версии сохранения.
 */
export const TowerSaveSchema = z.object({
  floor: z.number().int().nonnegative(),
  run: TowerRunSchema.optional(),
  /** Осколки башни (валюта постоянных улучшений). */
  shards: z.number().int().nonnegative().optional(),
  upgrades: z.record(z.string(), z.number().int().nonnegative()).optional(),
  runs: z.number().int().nonnegative().optional(),
  /** Добыча дня: день и сколько этажей уже оплачено. */
  lootDay: z.string().optional(),
  lootFloor: z.number().int().nonnegative().optional(),
  last: TowerRunSummarySchema.optional(),
});
export type TowerSave = z.infer<typeof TowerSaveSchema>;
