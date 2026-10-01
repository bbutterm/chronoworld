/**
 * «Охота на босса» (аналог гильдейской охоты AFK Arena, одиночная): attemptsPerDay раз в день отряд бьёт босса дня
 * timeLimitSeconds секунд; награда — по сумме нанесённого урона (пороги data/hunt.json → tiers). «Зачистка» повторяет
 * лучший результат по сегодняшнему боссу без боя. Попытки сбрасываются сменой дня `day` (строка 'YYYY-MM-DD' от UI).
 *
 * MVP-охота (hunt.mvp, docs/design/mvp-hunt.md): босс дня — MVP из RO со стихией, фазами и зарядом, и он умирает за бой.
 * Уровень MVP (hunt.mvp.ranks) — ОЗ и сила; уровень i пробит, когда лучший урон ≥ его ОЗ (так читаются и старые сохранения:
 * их лучший урон сразу ставит уровень). Победа над MVP («MVP!») — награда порога по урону, шанс карты MVP (с гарантией) и
 * следующий уровень. Герои стихии, к которой MVP уязвим, бьют сильнее (+weaknessAtk АТК).
 *
 * Всё детерминировано: seed боя, предмета и карты — от сохранения (createdAt), дня и номера попытки. Ни Date, ни Math.random.
 */
import type { z } from 'zod';
import { simulateBattle } from '../battle';
import { squadUnits } from '../campaign/campaign';
import type { UnitDef } from '../content/schema';
import { attackElement, defenseElement, weakTo, type Element } from '../elements';
import { cardDef } from '../equipment/cards';
import { itemPools, lootSeed } from '../equipment/chest';
import { progressChapter } from '../equipment/gates';
import { RARITIES, type CardDef } from '../equipment/schema';
import { dayNumber } from '../events/events';
import { addItems, withGear } from '../equipment/equipment';
import { grantBlessedOre } from '../equipment/refine';
import type { EquipmentConfig } from '../equipment/load';
import { buildUnit, heroName } from '../heroes/card';
import { addHeroExp } from '../heroes/level';
import { cardRng, grantHeroCards, rollHeroCards } from '../heroes/cardDrops';
import type { ProgressEvent } from '../progression/types';
import type { GameContext } from '../progression/types';
import { Rng } from '../rng';
import type { HuntState, ItemInstance, SaveState } from '../save/schema';
import type { BattleResult, Content } from '../types';
import { featureUnlocked, lockedText } from '../unlocks/unlocks';
import { HuntConfigSchema, type HuntConfig, type HuntReward, type HuntTier } from './schema';

export type HuntErrorCode = 'invalid_config' | 'hunt_locked' | 'no_attempts' | 'no_sweep';

/** Нарушение правил охоты. message — русский текст для игрока. */
export class HuntError extends Error {
  override name = 'HuntError';
  constructor(
    public code: HuntErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** GameContext + конфиг охоты (+ экипировка — для предметов наград и снаряжения героев). */
export interface HuntContext extends GameContext {
  hunt: HuntConfig;
  equipment?: EquipmentConfig;
}

/** id юнита босса в бою (описание — huntBoss(day).def). */
export const HUNT_BOSS_ID = 'hunt_boss';

export interface HuntBossView {
  /** Индекс в hunt.bosses (ротация по дням). */
  index: number;
  /** id исходного юнита из data/units. */
  unit: string;
  /** Описание босса для боя: статы × множители (MVP — статы уровня), id = HUNT_BOSS_ID. */
  def: UnitDef;
  title?: string;
  /** MVP: уровень (индекс hunt.mvp.ranks), для которого собран def. Нет — старая охота. */
  rank?: number;
  /** Стихия защиты босса. */
  element: Element;
  /** Стихии атаки, которые бьют его сильнее (слабость). */
  weakTo: Element[];
  legend?: string;
  /** Механики — по строке («Заряжает Тёмный удар — сбейте ультой»). */
  mechanics: string[];
  /** Карта MVP, которая может выпасть. */
  card?: CardDef;
}

/** Выданная награда (что реально получено). */
export interface HuntGrant {
  gold: number;
  jobExp: number;
  gems: number;
  /** Карты случайных героев (бросок по rewards.heroCards порога): события heroCard с id новых экземпляров. */
  heroCards: ProgressEvent[];
  /** Предметы (0 или 1). */
  items: ItemInstance[];
  /** «Благословенная руда»: только первая попытка дня (бой или зачистка) со взятым порогом, 1–3 штуки. */
  ore: number;
  /** Карта MVP (id из hunt.cards) — только за победу над MVP. */
  card?: string;
}

/** Герой игрока, чья стихия атаки бьёт MVP (подсказка состава). */
export interface HuntHeroHint {
  heroId: string;
  name: string;
  element: Element;
  inSquad: boolean;
}

export interface HuntStatus {
  unlocked: boolean;
  /** «Откроется на этапе 1-8» или ''. */
  lockedText: string;
  boss: HuntBossView;
  attemptsPerDay: number;
  used: number;
  attemptsLeft: number;
  /** Лучший урон по сегодняшнему боссу (за всё время; 0 — ещё не бились). */
  best: number;
  /** Индекс порога лучшего урона (−1 — ни одного). */
  bestTier: number;
  /** Можно ли сейчас «Зачистку». */
  canSweep: boolean;
  tiers: readonly HuntTier[];
  /** MVP-охота включена (hunt.mvp). */
  mvp: boolean;
  /** Высший доступный уровень MVP (индекс; следующий непробитый). 0 без mvp. */
  rank: number;
  /** Уровней всего (0 без mvp). */
  ranks: number;
  /** Побед над этим MVP. */
  kills: number;
  /** Герои игрока нужной стихии (порядок сохранения). */
  heroes: HuntHeroHint[];
  /** Карт MVP в запасе (всех, невставленных). */
  cardsOwned: number;
}

export interface HuntOutcome {
  save: SaveState;
  /** null — «Зачистка» (боя не было). */
  result: BattleResult | null;
  boss: HuntBossView;
  damage: number;
  /** Индекс достигнутого порога (−1 — ни одного, награды нет). */
  tier: number;
  grant: HuntGrant;
  /** Новый рекорд по этому боссу. */
  record: boolean;
  sweep: boolean;
  /** MVP убит в этом бою («MVP!»). */
  killed: boolean;
  /** MVP: победа открыла следующий уровень. */
  rankUp: boolean;
}

function describe(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.length ? i.path.map(String).join('.') : '(корень)'}: ${i.message}`)
    .join('; ');
}

/** Разобрать data/hunt.json. Ошибка схемы → HuntError('invalid_config'). */
export function parseHuntConfig(json: unknown): HuntConfig {
  const r = HuntConfigSchema.safeParse(json);
  if (!r.success) throw new HuntError('invalid_config', `data/hunt.json: ${describe(r.error)}`);
  return r.data;
}

/** Перекрёстные проверки: боссы существуют и это монстры/боссы; у MVP есть стихия (иначе нет слабости). */
export function validateHunt(cfg: HuntConfig, content: Content, problems: string[]): void {
  cfg.bosses.forEach((b, i) => {
    const u = content.units[b.unit];
    if (!u) problems.push(`data/hunt.json: bosses[${i}] — юнит ${b.unit} не найден в data/units`);
    else if (u.kind !== 'boss' && u.kind !== 'monster') problems.push(`data/hunt.json: bosses[${i}] — ${b.unit} не монстр (kind ${u.kind})`);
    else if (cfg.mvp && defenseElement(u) === 'neutral') problems.push(`data/hunt.json: bosses[${i}] — у MVP ${b.unit} нет стихии (element): слабости не будет`);
  });
}

/** GameContext → + hunt: схема и перекрёстные проверки (HuntError('invalid_config') со списком проблем). */
export function withHunt<C extends GameContext>(ctx: C, huntJson: unknown): C & { hunt: HuntConfig } {
  const hunt = parseHuntConfig(huntJson);
  const problems: string[] = [];
  validateHunt(hunt, ctx.content, problems);
  if (problems.length) throw new HuntError('invalid_config', problems.join('; '));
  return { ...ctx, hunt };
}

/**
 * Уровень MVP игрока (индекс hunt.mvp.ranks): сколько уровней пробито лучшим уроном по любому боссу (старые сохранения
 * тоже), не выше последнего. Без mvp — 0.
 */
export function huntRank(save: Pick<SaveState, 'hunt'>, ctx: HuntContext): number {
  const ranks = ctx.hunt.mvp?.ranks;
  if (!ranks) return 0;
  const best = Math.max(0, ...Object.values(save.hunt?.best ?? {}));
  const passed = ranks.filter((r) => r.hp <= best).length;
  return Math.min(ranks.length - 1, passed);
}

/**
 * Босс дня: bosses[dayNumber mod длина] (у всех игроков один). Старая охота — статы × множители (hpMult…); MVP — статы
 * уровня rank (0 по умолчанию): ОЗ ranks[rank].hp, АТК и ЗАЩ юнита × множители уровня.
 */
export function huntBoss(day: string, ctx: HuntContext, rank = 0): HuntBossView {
  const list = ctx.hunt.bosses;
  const n = dayNumber(day);
  const index = ((n % list.length) + list.length) % list.length;
  const b = list[index];
  const base = ctx.content.units[b.unit];
  if (!base) throw new HuntError('invalid_config', `Охота: юнит ${b.unit} не найден`);
  const ranks = ctx.hunt.mvp?.ranks;
  const r = ranks ? Math.max(0, Math.min(ranks.length - 1, Math.floor(rank))) : undefined;
  const stats =
    ranks && r !== undefined
      ? { ...base.stats, hp: ranks[r].hp, atk: Math.round(base.stats.atk * ranks[r].atk), def: Math.round(base.stats.def * ranks[r].def) }
      : {
          ...base.stats,
          hp: Math.max(1, Math.round(base.stats.hp * b.hpMult)),
          atk: Math.round(base.stats.atk * b.atkMult),
          def: Math.round(base.stats.def * b.defMult),
        };
  const def: UnitDef = {
    ...base,
    id: HUNT_BOSS_ID,
    ...(b.scale ? { visual: { ...base.visual, scale: b.scale } } : {}),
    stats,
  };
  const element = defenseElement(base);
  const card = b.card ? cardDef(ctx, b.card) : undefined;
  return {
    index,
    unit: b.unit,
    def,
    ...(b.title ? { title: b.title } : {}),
    ...(r !== undefined ? { rank: r } : {}),
    element,
    weakTo: element === 'neutral' ? [] : weakTo(ctx.combat.elements, element),
    ...(b.legend ? { legend: b.legend } : {}),
    mechanics: b.mechanics ?? [],
    ...(card ? { card } : {}),
  };
}

/** Стихия атаки героя — та же, что значок в бою (elements.attackElement). */
function heroElement(def: UnitDef, ctx: HuntContext): Element {
  return attackElement(def, ctx.content.skills);
}

/** Герои игрока, чья стихия атаки — в слабостях MVP (подсказка «кого взять»). */
export function huntHeroHints(save: SaveState, boss: Pick<HuntBossView, 'weakTo'>, ctx: HuntContext): HuntHeroHint[] {
  if (!boss.weakTo.length) return [];
  const out: HuntHeroHint[] = [];
  for (const hero of save.heroes) {
    let def: UnitDef;
    try {
      def = buildUnit(hero, ctx);
    } catch {
      continue;
    }
    const element = heroElement(def, ctx);
    if (boss.weakTo.includes(element)) out.push({ heroId: hero.id, name: heroName(hero, ctx), element, inSquad: save.squad.includes(hero.id) });
  }
  return out;
}

/**
 * Отряд для боя с MVP: героям стихии, к которой MVP уязвим, +weaknessAtk АТК, остальным −armorAtk («стихийная броня»).
 * В RO стихия оружия меняет и обычные атаки — здесь это приближено множителем АТК; навыки этой стихии вдобавок ×1.5 по
 * таблице боя (combat.json → elements).
 */
export function huntSquad(squad: readonly (UnitDef | null)[], boss: Pick<HuntBossView, 'weakTo'>, ctx: HuntContext): (UnitDef | null)[] {
  const mvp = ctx.hunt.mvp;
  if (!mvp || !boss.weakTo.length) return [...squad];
  return squad.map((d) => {
    if (!d) return d;
    const k = boss.weakTo.includes(heroElement(d, ctx)) ? 1 + mvp.weaknessAtk : 1 - mvp.armorAtk;
    return k === 1 ? d : { ...d, stats: { ...d.stats, atk: Math.round(d.stats.atk * k) } };
  });
}

/** Индекс высшего порога, которого достиг урон damage (−1 — ни одного). */
export function huntTier(damage: number, cfg: HuntConfig): number {
  let tier = -1;
  cfg.tiers.forEach((t, i) => {
    if (damage >= t.damage) tier = i;
  });
  return tier;
}

/** Награда порога (−1 — пусто). */
export function huntTierReward(tier: number, cfg: HuntConfig): HuntReward {
  return tier >= 0 ? cfg.tiers[tier].rewards : {};
}

/** Урон, нанесённый боссу за бой (урон по щиту — тоже урон). */
export function huntDamage(result: BattleResult): number {
  const boss = result.units.find((u) => u.side === 'B');
  return boss ? (result.report[boss.uid]?.damageTaken ?? 0) : 0;
}

/** Убит ли босс в бою (MVP-охота: «MVP!»). */
export function huntKilled(result: BattleResult): boolean {
  const boss = result.units.find((u) => u.side === 'B');
  return !!boss && result.report[boss.uid]?.alive === false;
}

/** Состояние охоты на день day: чужой (прошлый) день — попытки не тронуты. */
function stateOf(save: SaveState, day: string): { used: number; state: HuntState | undefined } {
  const h = save.hunt;
  // День назад (переведены часы) не даёт новых попыток: считаем попытки дня h.day.
  if (!h || day > h.day) return { used: 0, state: h };
  return { used: h.used, state: h };
}

/** Состояние охоты для экрана. */
export function huntStatus(save: SaveState, day: string, ctx: HuntContext): HuntStatus {
  const rank = huntRank(save, ctx);
  const boss = huntBoss(day, ctx, rank);
  const { used } = stateOf(save, day);
  const best = save.hunt?.best[boss.unit] ?? 0;
  const attemptsLeft = Math.max(0, ctx.hunt.attemptsPerDay - used);
  const unlocked = featureUnlocked(save, 'hunt', ctx);
  return {
    unlocked,
    lockedText: lockedText(save, 'hunt', ctx),
    boss,
    attemptsPerDay: ctx.hunt.attemptsPerDay,
    used,
    attemptsLeft,
    best,
    bestTier: huntTier(best, ctx.hunt),
    canSweep: unlocked && ctx.hunt.sweep && attemptsLeft > 0 && best > 0,
    tiers: ctx.hunt.tiers,
    mvp: !!ctx.hunt.mvp,
    rank,
    ranks: ctx.hunt.mvp?.ranks.length ?? 0,
    kills: save.hunt?.kills?.[boss.unit] ?? 0,
    heroes: ctx.hunt.mvp ? huntHeroHints(save, boss, ctx) : [],
    cardsOwned: Object.values(save.hunt?.cards ?? {}).reduce((a, b) => a + b, 0),
  };
}

/** seed попытки: сохранение, день, номер попытки за день (бой, предмет и карта MVP — разные потоки). */
export function huntSeed(save: Pick<SaveState, 'createdAt' | 'hunt'>, day: string, kind: 'battle' | 'loot' | 'card' = 'battle'): number {
  const used = save.hunt && day <= save.hunt.day ? save.hunt.used : 0;
  return lootSeed('hunt', kind, save.createdAt, day, used);
}

function check(save: SaveState, day: string, ctx: HuntContext): void {
  if (!featureUnlocked(save, 'hunt', ctx)) throw new HuntError('hunt_locked', `Охота на босса: ${lockedText(save, 'hunt', ctx) || 'пока закрыта'}`);
  const { used } = stateOf(save, day);
  if (used >= ctx.hunt.attemptsPerDay) throw new HuntError('no_attempts', 'Попытки охоты на сегодня закончились — босс вернётся завтра');
}

/** Выдать награду порога: золото, гемы, опыт в пул, карты случайных героев (бросок от seed добычи), предмет (случайный этой редкости среди открытых в главе игрока). */
function grant(save: SaveState, reward: HuntReward, lootSeedValue: number, ctx: HuntContext): { save: SaveState; grant: HuntGrant } {
  const gold = reward.gold ?? 0;
  const gems = reward.gems ?? 0;
  const jobExp = reward.jobExp ?? 0;
  let next: SaveState = {
    ...save,
    resources: { ...save.resources, gold: save.resources.gold + gold },
    currency: { ...save.currency, gems: save.currency.gems + gems },
  };
  next = addHeroExp(next, jobExp);
  const cards = grantHeroCards(next, rollHeroCards(reward.heroCards, cardRng(lootSeedValue), ctx), ctx);
  next = cards.save;
  let items: ItemInstance[] = [];
  if (reward.item && ctx.equipment) {
    // Только предметы, открытые в главе игрока (minChapter); нет таких этой редкости — редкостью ниже.
    const pools = itemPools(ctx.equipment.items, progressChapter(save, ctx));
    let r = RARITIES.indexOf(reward.item);
    while (r > 0 && !pools[RARITIES[r]].length) r--;
    const pool = pools[RARITIES[r]];
    if (pool.length) {
      const r = addItems(next, [pool[Math.floor(new Rng(lootSeedValue).next() * pool.length)]]);
      next = r.save;
      items = r.added;
    }
  }
  return { save: next, grant: { gold, gems, jobExp, heroCards: cards.events, items, ore: 0 } };
}

/**
 * «Благословенная руда» с босса охоты: раз в день — первая попытка дня (бой или зачистка), если взят хотя бы первый
 * порог. Бросок от seed добычи этой попытки. Так в день выходит 1–3 руды.
 */
function grantOre(save: SaveState, g: { save: SaveState; grant: HuntGrant }, day: string, tier: number, lootSeedValue: number, ctx: HuntContext): { save: SaveState; grant: HuntGrant } {
  if (tier < 0 || stateOf(save, day).used > 0) return g;
  const ore = grantBlessedOre(g.save, lootSeedValue, ctx);
  return { save: ore.save, grant: { ...g.grant, ore: ore.count } };
}

/** Записать попытку и лучший урон по боссу (поля MVP — победы, карты, гарантия — остаются как были). */
function spend(save: SaveState, day: string, unit: string, damage: number): SaveState {
  const { used, state } = stateOf(save, day);
  const best = { ...(state?.best ?? {}) };
  if (damage > (best[unit] ?? 0)) best[unit] = damage;
  // День не уходит назад: попытки считаются по самому позднему дню.
  const d = state && state.day > day ? state.day : day;
  return { ...save, hunt: { ...state, day: d, used: used + 1, best } };
}

/**
 * Победа над MVP: +1 победа над ним и бросок карты (шанс cardChance; после cardPity − 1 побед подряд без карты следующая
 * победа даёт её наверняка). seed — поток 'card' этой попытки.
 */
function mvpKill(save: SaveState, unit: string, cardId: string | undefined, seed: number, ctx: HuntContext): { save: SaveState; card?: string } {
  const mvp = ctx.hunt.mvp!;
  const h: HuntState = save.hunt ?? { day: '1970-01-01', used: 0, best: {} };
  const kills = { ...(h.kills ?? {}), [unit]: (h.kills?.[unit] ?? 0) + 1 };
  if (!cardId) return { save: { ...save, hunt: { ...h, kills } } };
  const dry = h.dry ?? 0;
  const drop = dry + 1 >= mvp.cardPity || new Rng(seed).next() < mvp.cardChance;
  if (!drop) return { save: { ...save, hunt: { ...h, kills, dry: dry + 1 } } };
  const cards = { ...(h.cards ?? {}), [cardId]: (h.cards?.[cardId] ?? 0) + 1 };
  return { save: { ...save, hunt: { ...h, kills, cards, dry: 0 } }, card: cardId };
}

/** Необязательные параметры боя охоты. */
export interface HuntFightOptions {
  /** Уровень MVP (0…huntRank): ниже — легче, но и награда порога меньше; шанс карты тот же. Нет — высший доступный. */
  rank?: number;
}

/**
 * Бой с боссом дня отрядом save.squad (с экипировкой): timeLimitSeconds секунд, награда — по нанесённому урону.
 * Чистая функция. HuntError('hunt_locked') / ('no_attempts'); GameRuleError('empty_squad') и др. — как у этапа.
 * seed боя — свой (huntSeed: сохранение, день, номер попытки), battleSeq не трогается; попытка тратится при любом
 * исходе (как в AFK). ctx.combat.player (ручная ульта сцены боя) проходит в бой как есть.
 */
export function fightHunt(save: SaveState, day: string, ctx: HuntContext, opts: HuntFightOptions = {}): HuntOutcome {
  check(save, day, ctx);
  const gctx = withGear(ctx, save);
  const top = huntRank(save, ctx);
  const rank = Math.max(0, Math.min(top, Math.floor(opts.rank ?? top)));
  const boss = huntBoss(day, ctx, rank);
  const { squad } = squadUnits(save, gctx);
  const enemies: (UnitDef | null)[] = [null, null, null, null, null];
  enemies[ctx.hunt.slot] = boss.def;
  const result = simulateBattle(ctx.content, ctx.hunt.mvp ? huntSquad(squad, boss, ctx) : squad, enemies, huntSeed(save, day), {
    combat: { ...ctx.combat, timeLimitSeconds: ctx.hunt.timeLimitSeconds },
  });
  const damage = huntDamage(result);
  const record = damage > (save.hunt?.best[boss.unit] ?? 0);
  const tier = huntTier(damage, ctx.hunt);
  const loot = huntSeed(save, day, 'loot');
  const g = grantOre(save, grant(save, huntTierReward(tier, ctx.hunt), loot, ctx), day, tier, loot, ctx);
  let next = spend(g.save, day, boss.unit, damage);
  const killed = !!ctx.hunt.mvp && huntKilled(result);
  let card: string | undefined;
  if (killed) {
    const k = mvpKill(next, boss.unit, boss.card?.id, huntSeed(save, day, 'card'), ctx);
    next = k.save;
    card = k.card;
  }
  const rankUp = killed && huntRank(next, ctx) > top;
  return { save: next, result, boss, damage, tier, grant: { ...g.grant, ...(card ? { card } : {}) }, record, sweep: false, killed, rankUp };
}

/**
 * «Зачистка»: награда за лучший урон по боссу дня без боя, тратит попытку. HuntError('no_sweep') — зачистка выключена
 * или по этому боссу ещё не бились. Победы над MVP и карт зачистка не даёт.
 */
export function sweepHunt(save: SaveState, day: string, ctx: HuntContext): HuntOutcome {
  check(save, day, ctx);
  const boss = huntBoss(day, ctx, huntRank(save, ctx));
  const best = save.hunt?.best[boss.unit] ?? 0;
  if (!ctx.hunt.sweep || best <= 0) throw new HuntError('no_sweep', 'Зачистка откроется после первого боя с этим боссом');
  const tier = huntTier(best, ctx.hunt);
  const loot = huntSeed(save, day, 'loot');
  const g = grantOre(save, grant(save, huntTierReward(tier, ctx.hunt), loot, ctx), day, tier, loot, ctx);
  const next = spend(g.save, day, boss.unit, best);
  return { save: next, result: null, boss, damage: best, tier, grant: g.grant, record: false, sweep: true, killed: false, rankUp: false };
}
