/**
 * Модель игрока для инструмента баланса (T7, v3 — карточки героев; герои v2 — копии, ветки, контракты). Только вызовы ядра (обёртки act* и функции K1–K10) —
 * правила здесь не повторяются. Меняйте PLAYER_MODEL (или передавайте свой конфиг в runBalance) — игровые данные не трогаем.
 *
 * v3: у сессии есть часы. Каждый бой занимает реальное время (длительность боя / скорость + «накладные» на экран
 * итогов, подготовку, сюжет), сессия длится sessionMinutes (первая — firstSessionMinutes). Сундук копится и во время
 * игры: застряв, игрок забирает его, берёт быстрые награды, поднимает уровни и пробует снова. Журнал боёв, повышений
 * уровня, вознесений и призывов — для сводок «по часам» (scripts/balance.ts, docs/content/balance.md).
 */
import {
  achievementStatus,
  actAscend,
  actClaimOffline,
  actClimbTower,
  fightHunt,
  huntStatus,
  sweepHunt,
  actEquip,
  actLevelUp,
  actPlayStage,
  actSummon,
  ascendRequirement,
  autoFodder,
  autoChain,
  chooseBranch,
  claimHeroPick,
  heroCopies,
  needsBranch,
  pickOptions,
  rarityIndex,
  BRANCH_RARITY,
  actUseFastRewards,
  autoFormation,
  arrangeSquad,
  maxLevelOf,
  canEquip,
  claimAchievement,
  claimActivity,
  claimAllMail,
  claimLogin,
  claimNewbieMilestone,
  claimNewbieTask,
  claimQuest,
  equip,
  fastRewardsPreview,
  fastRewardsStatus,
  getStage,
  heroPower,
  heroStats,
  heroTemplate,
  levelUpInfo,
  loginStatus,
  newbieStatus,
  offlineRewards,
  recommendedPower,
  simulateBattle,
  buildUnit,
  MAX_ENEMY_LEVEL,
  bossScale,
  recommendedFactor,
  type UnitDef,
  baselineHero,
  enemyScale,
  levelBand,
  stageLevels,
  enemySquad,
  CARD_RARITIES,
  summonStatus,
  newGame,
  questStatus,
  squadPower,
  stagePower,
  stageStatus,
  startExpedition,
  claimExpedition,
  autoParty,
  locationUnlocked,
  touchEvents,
  towerUnlocked,
  featureUnlocked,
  heroSlots,
  refineCost,
  refineItem,
  refineUnlocked,
  buyShopSlot,
  levelUpCost,
  refreshShop,
  shopStatus,
  type ShopContext,
  type HeroState,
  type CardRarity,
  type FullContext,
  type GameContext,
  type SaveState,
} from '../../src/core';
import { loadFullContext } from './content-node';

/** Полный контекст (тип из ядра) и его сборка из data/ — переэкспорт для scripts/balance.ts и тестов. */
export type { FullContext };
export { loadFullContext };

export interface PlayerModel {
  /** Сессий в день. */
  sessionsPerDay: number;
  /** Час первой сессии дня (от полуночи). */
  firstSessionHour: number;
  /** Часов между сессиями внутри дня (ночь — остаток суток). */
  hoursBetweenSessions: number;
  /** Длительность самой первой сессии (день 1, сессия 1), минут: новичок играет долго. */
  firstSessionMinutes: number;
  /** Длительность остальных сессий, минут (время кончилось — сессия заканчивается, даже если игрок не застрял). */
  sessionMinutes: number;
  /** Скорость просмотра боя (1 — ×1, 2 — ×2; среднее). Реальное время боя = duration / battleSpeed. */
  battleSpeed: number;
  /** Секунд на бой сверх самого боя: экран итогов, подготовка, «Улучшить», сюжетные сцены. */
  battleOverheadSec: number;
  /** Секунд на строку сюжетной сцены (сцены этапа читаются один раз, при первом прохождении). */
  storySecPerLine: number;
  /** Секунд интерфейса: одно повышение уровня, один призыв (×1 или ×10), одно вознесение. */
  levelUpSec: number;
  summonSec: number;
  ascendSec: number;
  /** Сколько поражений на одном этапе за сессию игрок терпит (после каждой — сундук, быстрые награды, уровни). */
  maxLossesPerSession: number;
  /** Башня: не больше стольких штурмов за сессию… */
  towerMaxAttemptsPerSession: number;
  /** …и не больше стольких поражений. */
  towerMaxLossesPerSession: number;
  /**
   * Сколько раз в день брать быстрые награды: сначала бесплатные, дальше — за гемы по fastRewards.gemCosts
   * (только если гемов хватает). Берутся, когда игрок застрял (или в последней сессии дня, если не брал).
   */
  fastRewardsPerDay: number;
  /** Застряв посреди сессии, забрать сундук, если в нём накопилось хотя бы столько минут. */
  midSessionClaimMinutes: number;
  /**
   * Экспедиции (data/expeditions.json): в каждой сессии забрать вернувшиеся и отправить отряд (autoParty) во все открытые
   * свободные локации — на самый долгий срок, который вернётся к следующей сессии (последняя сессия дня — самый долгий).
   */
  expeditions: boolean;
  /** Призыв за гемы (×10, когда гемов хватает на ×10); false — только бесплатный призыв и свитки. */
  summonWithGems: boolean;
  /**
   * «Охота на босса» (data/hunt.json): в первой сессии дня с попытками — бой, дальше «Зачистка» лучшего результата
   * (если доступна), иначе бой. false — не охотиться.
   */
  hunt: boolean;
  /** «Вход 7 дней», «7 дней новичка» и почта (data/events.json): забирать всё, что можно, в каждой сессии. */
  events: boolean;
  /**
   * Лавка (data/shop.json): покупать разумное на золото сверх запаса на уровни (опыт — когда упёрлись в опыт, предмет —
   * если он усиливает отряд, карта героя — с большим запасом), свиток — за гемы (не больше 1 в день), бесплатное обновление.
   */
  shop: boolean;
  /**
   * Заточка снаряжения (data/drops.json → refine): после подготовки — самый дешёвый шаг среди надетого на отряд, пока
   * золото сверх резерва (refineReserve: refineReserveLevels уровней на героя + золото на опыт пула). false — не точить.
   */
  refine: boolean;
  /** Сколько уровней вперёд на героя отряда заточка оставляет золота (на потолке уровней — 0). */
  refineReserveLevels: number;
  /** Секунд интерфейса на один шаг заточки. */
  refineSec: number;
  /**
   * Ветка второй профессии на фиолетовом (docs/design/heroes-v2.md, раздел 7): keep — сохранить роль первой профессии
   * (танк → ветка-танк, лекарь → Жрица; нет такой — первая ветка), alt — другая ветка, random — по id экземпляра.
   */
  branch: 'keep' | 'alt' | 'random';
  /** Сдвиг seed: seed боя = seedBase + save.battleSeq. */
  seedBase: number;
  /** Календарный день первого дня симуляции, 'YYYY-MM-DD'. */
  startDate: string;
}

export const PLAYER_MODEL: PlayerModel = {
  sessionsPerDay: 4,
  firstSessionHour: 8,
  hoursBetweenSessions: 4,
  firstSessionMinutes: 45,
  sessionMinutes: 15,
  battleSpeed: 1.5,
  battleOverheadSec: 30,
  storySecPerLine: 5,
  levelUpSec: 2,
  summonSec: 20,
  ascendSec: 20,
  maxLossesPerSession: 3,
  towerMaxAttemptsPerSession: 10,
  towerMaxLossesPerSession: 2,
  fastRewardsPerDay: 1,
  midSessionClaimMinutes: 10,
  expeditions: true,
  summonWithGems: true,
  hunt: true,
  events: true,
  shop: true,
  refine: true,
  refineReserveLevels: 5,
  refineSec: 1,
  branch: 'keep',
  seedBase: 1,
  startDate: '2026-01-01',
};

export const CSV_COLUMNS = [
  'day',
  'date',
  'session',
  'time_h',
  'chapter',
  'stage_reached',
  'cleared_count',
  'attempts',
  'wins',
  'losses',
  'tower_floor',
  'tower_attempts',
  'gold',
  'gems',
  'hero_exp',
  'items',
  'squad_power',
  'next_stage_power',
  'recommended_power',
  'power_ratio',
  'avg_level',
  'level_ups',
  'rarities',
  'heroes',
  'summons',
  'quests_claimed',
  'bounties_done',
  'active_min',
] as const;

export interface SessionRow {
  day: number;
  /** Календарный день 'YYYY-MM-DD'. */
  date: string;
  session: number;
  /** Часы с полуночи дня 1 (начало сессии). */
  time_h: number;
  /** Глава stage_reached (для "done" — последняя глава). */
  chapter: string;
  /** Следующий открытый этап (где игрок остановился) или "done", если кампания пройдена. */
  stage_reached: string;
  cleared_count: number;
  /** Бои кампании в сессии. */
  attempts: number;
  wins: number;
  losses: number;
  /** Последний пройденный этаж башни. */
  tower_floor: number;
  /** Штурмов башни в сессии. */
  tower_attempts: number;
  gold: number;
  gems: number;
  /** Опыт в общем пуле (не потрачен). */
  hero_exp: number;
  /** Предметов в инвентаре (надетые + лежащие). */
  items: number;
  /** Мощь отряда (core squadPower, с экипировкой). */
  squad_power: number;
  /** Мощь врагов stage_reached (core stagePower); 0, если всё пройдено. */
  next_stage_power: number;
  /** Рекомендуемая мощь stage_reached (core recommendedPower); 0, если всё пройдено. */
  recommended_power: number;
  /** squad_power / recommended_power (2 знака); 0, если всё пройдено. */
  power_ratio: number;
  /** Средний уровень карточек отряда. */
  avg_level: number;
  /** Повышений уровня за сессию (все герои). */
  level_ups: number;
  /** Отряд по редкостям: g/b/p/o/r — число зелёных/синих/фиолетовых/золотых/красных. */
  rarities: string;
  /** Отряд: шаблон:редкость:уровень через «|». */
  heroes: string;
  /** Призвано карточек всего (накопительно). */
  summons: number;
  /** Всего получено наград заданий (накопительно). */
  quests_claimed: number;
  /** Всего выполнено поручений (накопительно). */
  bounties_done: number;
  /** Сколько минут реально заняла сессия. */
  active_min: number;
}

export interface FirstClear {
  stageId: string;
  day: number;
  session: number;
  /** Часы с полуночи дня 1 — момент победы (с учётом времени внутри сессии). */
  time_h: number;
  /** Сколько боёв (всего, с победой) ушло на этап. */
  attempts: number;
  /** Активных минут с начала игры. */
  active_min: number;
  /** Отряд в момент победы: уровни и редкости героев в слотах (для калибровки уровней врагов, balance -- --levels). */
  squadLevels: number[];
  squadRarities: CardRarity[];
}

/** Бой в журнале: кампания или башня. */
export interface BattleLog {
  /** Часы с полуночи дня 1. */
  t: number;
  /** Активных минут с начала игры (к концу боя). */
  active_min: number;
  kind: 'stage' | 'tower';
  /** id этапа или номер этажа. */
  target: string;
  win: boolean;
  squadPower: number;
  /** Рекомендуемая мощь этапа (для башни — 0). */
  recommended: number;
}

/** Повышение уровня героя. */
export interface LevelLog {
  t: number;
  active_min: number;
  heroId: string;
  level: number;
  /** Мощь героя до и после (heroPower). */
  before: number;
  after: number;
  /** «Боевая сила» до и после: hp × atk без экипировки (по Ланчестеру исход боя ~ произведению живучести и урона). */
  effBefore: number;
  effAfter: number;
}

/** Источники доходов/расходов золота, гемов и опыта. */
export const SOURCES = ['offline', 'fast_rewards', 'campaign', 'tower', 'hunt', 'expeditions', 'quests', 'achievements', 'events', 'mail', 'heroes', 'summon', 'shop', 'refine'] as const;
export type Source = (typeof SOURCES)[number];
export type Ledger = Record<Source, { gold: number; gems: number; exp: number }>;

export interface BalanceResult {
  model: PlayerModel;
  rows: SessionRow[];
  firstClears: FirstClear[];
  save: SaveState;
  /** Боёв на каждом этапе (до первой победы включительно). */
  stageAttempts: Record<string, number>;
  /** Доход по источникам. */
  income: Ledger;
  /** Расход по источникам. */
  spend: Ledger;
  /** Сколько раз получена награда каждого задания. */
  questClaims: Record<string, number>;
  /** Сколько дней выполнен каждый порог активности. */
  milestoneClaims: Record<string, number>;
  /** Штурмов каждого этажа башни (до победы включительно). */
  towerAttempts: Record<number, number>;
  /** Сколько раз надевались предметы. */
  equips: number;
  /** Вознесения: день, время, герой, шаблон, новая редкость. */
  ascensions: { day: number; t: number; active_min: number; heroId: string; templateId: string; rarity: string }[];
  /** Призвано карточек. */
  summons: number;
  /** Призывы: время, способ, сколько карточек, их редкости. */
  summonLog: { t: number; active_min: number; pay: 'gems' | 'scroll' | 'free'; count: number; rarities: CardRarity[] }[];
  battles: BattleLog[];
  levels: LevelLog[];
  /** Гемы по дням: доход и расход (индекс 0 — день 1). */
  gemsByDay: { income: number; spend: number }[];
  /** Свитки призыва по источникам (доход; тратятся в Таверне). */
  scrollsIn: Partial<Record<Source, number>>;
  /** Предметы по источникам (выпадение за победу — campaign, трофеи сундука — offline и fast_rewards). */
  itemsIn: Partial<Record<Source, number>>;
  /** Копии героев (новые экземпляры) по источникам: Таверна, сюжет, карты героя из наград, контракты. */
  cardsIn: Partial<Record<Source, number>>;
  /** Выбор веток: день, час, герой, ветка; via — вознесение, карта (Таверна, трофеи — фиолетовый без ветки) или «Контракт героя». */
  branches: { day: number; t: number; templateId: string; branch: string; via: 'ascend' | 'card' | 'contract' }[];
  /** Фиолетовых (и выше) в отряде на конец каждого дня (индекс 0 — день 1). */
  purplesByDay: number[];
  /** Запас копий (экземпляров не в отряде) на конец каждого дня. */
  spareByDay: number[];
  /** События новичка: когда получена каждая награда (день модели, час от начала). */
  eventClaims: { kind: 'login' | 'newbie_task' | 'newbie_chest' | 'mail'; id: string; day: number; t: number }[];
  /** Активных минут всего. */
  activeMinutes: number;
  /** Охота на босса: каждая попытка (день модели, урон, порог — индекс, −1 нет; зачистка). */
  huntLog: { day: number; damage: number; tier: number; sweep: boolean }[];
  /** Покупки в Лавке: id товара → сколько раз. */
  shopBuys: Record<string, number>;
  /** Шагов заточки (всего) и уровни заточки надетого на отряд на конец каждого дня (средний, максимум). */
  refines: number;
  refineByDay: { avg: number; max: number }[];
}

const HOUR = 3_600_000;
const MINUTE = 60_000;

/** День номер dayNo (с 1) от startDate. */
export function dateOf(startDate: string, dayNo: number): string {
  const t = Date.parse(`${startDate}T00:00:00Z`) + (dayNo - 1) * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Следующий открытый (ещё не пройденный) этап или null, если всё пройдено. */
export function nextOpenStage(save: SaveState, ctx: GameContext): string | null {
  for (const s of ctx.content.stages) if (stageStatus(save, s.id, ctx) === 'open') return s.id;
  return null;
}

function emptyLedger(): Ledger {
  return Object.fromEntries(SOURCES.map((s) => [s, { gold: 0, gems: 0, exp: 0 }])) as Ledger;
}

const RARITY_LETTER: Record<CardRarity, string> = { green: 'g', blue: 'b', purple: 'p', gold: 'o', red: 'r' };

/** Одна симуляция: состояние + учёт. Все шаги — через функции ядра. */
class Sim {
  save: SaveState;
  income = emptyLedger();
  spend = emptyLedger();
  questClaims: Record<string, number> = {};
  milestoneClaims: Record<string, number> = {};
  equips = 0;
  ascensions: BalanceResult['ascensions'] = [];
  summons = 0;
  summonLog: BalanceResult['summonLog'] = [];
  levels: LevelLog[] = [];
  gemsByDay: BalanceResult['gemsByDay'] = [];
  scrollsIn: BalanceResult['scrollsIn'] = {};
  itemsIn: BalanceResult['itemsIn'] = {};
  cardsIn: BalanceResult['cardsIn'] = {};
  branches: BalanceResult['branches'] = [];
  eventClaims: BalanceResult['eventClaims'] = [];
  shopBuys: Record<string, number> = {};
  refines = 0;
  dayNo = 1;
  day: string;
  /** Текущее время, мс от полуночи дня 1. */
  now = 0;
  /** Активное время всего, мс. */
  activeMs = 0;
  /** Повышений уровня в текущей сессии. */
  sessionLevelUps = 0;

  constructor(
    public ctx: FullContext,
    public model: PlayerModel,
  ) {
    this.day = model.startDate;
    // createdAt — часть seed Таверны, сундука, Лавки и карт героя: разные seedBase — разные выдачи (seed 1 — как раньше, 0).
    this.save = { ...newGame(ctx, 0, model.startDate), createdAt: (model.seedBase - 1) * 1_000_003 };
  }

  get t(): number {
    return this.now / HOUR;
  }
  get activeMin(): number {
    return Math.round(this.activeMs / MINUTE);
  }

  /** Применить шаг и разнести изменение золота/гемов/опыта по источнику. */
  step(source: Source, next: SaveState): void {
    const d = {
      gold: next.resources.gold - this.save.resources.gold,
      gems: next.currency.gems - this.save.currency.gems,
      exp: next.resources.heroExp - this.save.resources.heroExp,
    };
    for (const k of ['gold', 'gems', 'exp'] as const) {
      if (d[k] > 0) this.income[source][k] += d[k];
      else this.spend[source][k] -= d[k];
    }
    const scrolls = next.currency.scrolls - this.save.currency.scrolls;
    if (scrolls > 0) this.scrollsIn[source] = (this.scrollsIn[source] ?? 0) + scrolls;
    const items = next.inventory.items.length - this.save.inventory.items.length;
    if (items > 0) this.itemsIn[source] = (this.itemsIn[source] ?? 0) + items;
    const dCards = next.heroes.length - this.save.heroes.length;
    if (dCards > 0) this.cardsIn[source] = (this.cardsIn[source] ?? 0) + dCards;
    const g = (this.gemsByDay[this.dayNo - 1] ??= { income: 0, spend: 0 });
    if (d.gems > 0) g.income += d.gems;
    else g.spend -= d.gems;
    this.save = next;
  }

  /** Потратить время (мс) внутри сессии. */
  spendTime(ms: number): void {
    this.now += ms;
    this.activeMs += ms;
  }

  pull(count: number, pay: 'gems' | 'scroll' | 'free'): void {
    const r = actSummon(this.save, this.day, count, pay, this.ctx);
    this.step('summon', r.save);
    this.summons += r.results.length;
    this.spendTime(this.model.summonSec * 1000);
    this.summonLog.push({ t: this.t, active_min: this.activeMin, pay, count, rarities: r.results.map((x) => x.rarity) });
  }

  /**
   * Герои (через act* — засчитываются заданиям и достижениям): Таверна (бесплатный призыв, свитки, при
   * summonWithGems — ×10 за гемы), контракты героя, ветки фиолетовых без ветки, вознесение (цель — сильнейший
   * экземпляр героя; сначала отряд, ближе всех к следующей редкости; копии — самые слабые; не хватает синих копий —
   * цепочка «3 зелёные → синяя»), «Улучшить» — по уровню самому низкому герою отряда, пока хватает опыта и золота.
   */
  develop(): void {
    const st = summonStatus(this.save, this.day, this.ctx);
    if (st.unlocked) {
      if (st.can.free) this.pull(1, 'free');
      while (this.save.currency.scrolls >= 10) this.pull(10, 'scroll');
      if (this.model.summonWithGems) while (this.save.currency.gems >= this.ctx.summon.costs.ten) this.pull(10, 'gems');
      while (this.save.currency.scrolls > 0) this.pull(1, 'scroll');
    }
    this.claimPicks();
    this.pickBranches();
    // Вознесение: цель — сильнейший экземпляр героя; сначала отряд, остальные — только если золота с запасом ×3.
    for (let guard = 0; guard < 50; guard++) {
      const squad = new Set(this.save.squad.filter((id): id is string => id !== null));
      // Цель — прокачанный экземпляр героя: из отряда, иначе самый сильный (heroPower); копии — корм.
      const tops = [...new Set(this.save.heroes.map((h) => h.templateId))].map((t) => {
        const copies = heroCopies(this.save, t);
        return copies.find((h) => squad.has(h.id)) ?? [...copies].sort((a, b) => heroPower(b, this.ctx, this.save) - heroPower(a, this.ctx, this.save))[0];
      });
      const ok = (h: SaveState['heroes'][number]) => {
        const req = ascendRequirement(this.save, h.id, this.ctx);
        if (!req || req.blockers.length > 0) return false;
        return squad.has(h.id) || this.save.resources.gold >= 3 * req.gold;
      };
      const order = tops.filter(ok).sort((a, b) => Number(squad.has(b.id)) - Number(squad.has(a.id)) || rarityIndex(b.rarity) - rarityIndex(a.rarity));
      let hero = order.find((h) => autoFodder(this.save, h.id, this.ctx));
      if (!hero) {
        // Цепочка «Авто»: слить свободные копии вверх (3 зелёные → синяя), если это закрывает слоты.
        for (const h of order) {
          const steps = autoChain(this.save, h.id, this.ctx);
          if (!steps.length) continue;
          for (const st of steps) this.ascend(st.targetId, st.fodderIds);
          if (autoFodder(this.save, h.id, this.ctx) && ok(this.save.heroes.find((x) => x.id === h.id)!)) {
            hero = this.save.heroes.find((x) => x.id === h.id);
            break;
          }
        }
      }
      if (!hero) break;
      this.ascend(hero.id, autoFodder(this.save, hero.id, this.ctx) ?? []);
      this.save = { ...this.save, squad: this.formation() };
    }
    this.levelSquad();
  }

  /** Вознесение с политикой ветки (если переход с выбором ветки). */
  ascend(heroId: string, fodder: string[]): void {
    const hero = this.save.heroes.find((h) => h.id === heroId)!;
    const req = ascendRequirement(this.save, heroId, this.ctx)!;
    const branch = req.branch && !hero.branch ? this.branchFor(hero.templateId, hero.id) : undefined;
    const r = actAscend(this.save, this.day, heroId, fodder, this.ctx, branch ? { branch } : {});
    this.step('heroes', r.save);
    if (branch) this.branches.push({ day: this.dayNo, t: this.t, templateId: hero.templateId, branch, via: 'ascend' });
    const e = r.events.find((x) => x.type === 'ascended');
    this.spendTime(this.model.ascendSec * 1000);
    if (e && e.type === 'ascended') this.ascensions.push({ day: this.dayNo, t: this.t, active_min: this.activeMin, heroId, templateId: hero.templateId, rarity: e.to });
  }

  /** Ветка по политике модели. */
  branchFor(templateId: string, heroId: string): string {
    const t = heroTemplate(this.ctx, templateId);
    const keep = t.branches.find((b) => b.role === t.role) ?? t.branches[0];
    const alt = t.branches.find((b) => b !== keep) ?? keep;
    if (this.model.branch === 'alt') return alt.job;
    if (this.model.branch === 'random') return t.branches[[...heroId].reduce((a, c) => a + c.charCodeAt(0), 0) % t.branches.length].job;
    return keep.job;
  }

  /** Фиолетовые без ветки (Таверна, миграция) — выбрать ветку по политике (бесплатно). */
  pickBranches(): void {
    for (const h of this.save.heroes) {
      if (!needsBranch(h, this.ctx)) continue;
      const branch = this.branchFor(h.templateId, h.id);
      this.step('heroes', chooseBranch(this.save, h.id, branch, this.ctx).save);
      this.branches.push({ day: this.dayNo, t: this.t, templateId: h.templateId, branch, via: 'card' });
    }
  }

  /**
   * «Контракт героя»: в отряде нет лекаря — Вика (ветка по политике); иначе — герой отряда, которому дальше всех до
   * фиолетового (самая низкая редкость, затем уровень).
   */
  claimPicks(): void {
    for (let guard = 0; guard < 10 && (this.save.pendingPicks?.length ?? 0) > 0; guard++) {
      const pick = this.save.pendingPicks![0];
      const opts = pickOptions(pick, this.ctx);
      const squad = this.save.squad.map((id) => this.save.heroes.find((h) => h.id === id)).filter((h): h is SaveState['heroes'][number] => !!h);
      const healer = squad.some((h) => heroTemplate(this.ctx, h.templateId).role === 'healer' || (h.branch && heroTemplate(this.ctx, h.templateId).branches.find((b) => b.job === h.branch)?.role === 'healer'));
      const farthest = [...squad].sort((a, b) => rarityIndex(a.rarity) - rarityIndex(b.rarity) || a.level - b.level)[0]?.templateId;
      const templateId = !healer && opts.includes('vika') ? 'vika' : farthest && opts.includes(farthest) ? farthest : opts[0];
      const withBranch = rarityIndex(pick.rarity) >= rarityIndex(BRANCH_RARITY);
      const branch = withBranch ? (templateId === 'vika' && !healer ? 'priest' : this.branchFor(templateId, `pick${guard}`)) : undefined;
      this.step('events', claimHeroPick(this.save, 0, templateId, branch, this.ctx).save);
      if (branch) this.branches.push({ day: this.dayNo, t: this.t, templateId, branch, via: 'contract' });
    }
  }

  /**
   * Отряд модели (герои v2): autoFormation (5 сильнейших разных героев), затем — как живой игрок — герой вне отряда
   * с высокой редкостью встаёт в отряд, даже если у него пока низкий уровень: фиолетовый из Таверны, контракта или
   * вознесения ур. 1 слабее синего ур. 20, но «Улучшить» идёт самому низкому, и он быстро догонит. Сравнение — по
   * «потенциалу»: мощь при уровне не ниже самого низкого в отряде (не выше предела редкости). Замена — только если
   * потенциал ≥ ×1.1 заменяемого: вложенный в героя опыт не возвращается, мелкие перестановки игроку невыгодны.
   * Без этого модель годами держала фиолетовых на скамейке (autoFormation смотрит только на нынешнюю мощь).
   */
  formation(): (string | null)[] {
    const base = autoFormation(this.save, this.ctx);
    const members = base.flatMap((id) => this.save.heroes.filter((h) => h.id === id));
    if (members.length === 0) return base;
    const floor = Math.min(...members.map((h) => h.level));
    const pot = (h: SaveState['heroes'][number]) =>
      heroPower({ ...h, level: Math.max(h.level, Math.min(floor, maxLevelOf(this.ctx, h.rarity))) }, this.ctx, this.save);
    const squad = members.map((h) => ({ hero: h, pot: pot(h) }));
    const inSquad = new Set(members.map((h) => h.templateId));
    const bench = [...new Set(this.save.heroes.map((h) => h.templateId))]
      .filter((t) => !inSquad.has(t))
      .map((t) => heroCopies(this.save, t).map((h) => ({ hero: h, pot: pot(h) })).sort((a, b) => b.pot - a.pot)[0])
      .sort((a, b) => b.pot - a.pot);
    let changed = false;
    for (const c of bench) {
      if (squad.length < base.length) {
        squad.push(c);
        changed = true;
        continue;
      }
      const weakest = squad.reduce((w, x) => (x.pot < w.pot ? x : w));
      if (c.pot < weakest.pot * 1.1) break;
      squad[squad.indexOf(weakest)] = c;
      changed = true;
    }
    if (!changed) return base;
    const ids: (string | null)[] = squad.map((x) => x.hero.id);
    while (ids.length < base.length) ids.push(null);
    return arrangeSquad({ ...this.save, squad: ids }, this.ctx);
  }

  /** «Улучшить» отряд по одному уровню самому низкому, пока хватает. Новичок из Таверны сильнее — он встанет в отряд. */
  levelSquad(): void {
    for (let round = 0; round < 3; round++) {
      const squad = () => this.save.squad.filter((id): id is string => id !== null);
      let any = false;
      for (let guard = 0; guard < 2000; guard++) {
        const ready = squad()
          .map((id) => this.save.heroes.find((h) => h.id === id)!)
          .filter((h) => levelUpInfo(this.save, h.id, this.ctx).canLevel)
          .sort((a, b) => a.level - b.level);
        if (!ready.length) break;
        const hero = ready[0];
        const before = heroPower(hero, this.ctx, this.save);
        const sb = heroStats(hero, this.ctx);
        this.step('heroes', actLevelUp(this.save, this.day, hero.id, this.ctx).save);
        const leveled = this.save.heroes.find((h) => h.id === hero.id)!;
        const after = heroPower(leveled, this.ctx, this.save);
        const sa = heroStats(leveled, this.ctx);
        this.levels.push({ t: this.t, active_min: this.activeMin, heroId: hero.id, level: hero.level + 1, before, after, effBefore: sb.hp * sb.atk, effAfter: sa.hp * sa.atk });
        this.sessionLevelUps++;
        this.spendTime(this.model.levelUpSec * 1000);
        any = true;
      }
      const f = this.formation();
      const same = f.every((id, i) => id === this.save.squad[i]);
      this.save = { ...this.save, squad: f };
      if (!any || same) break;
    }
  }

  /** Каждому герою (в порядке отряда) надевать свободный предмет с наибольшим приростом heroPower, пока прирост > 0. */
  autoEquip(): void {
    const order = [...this.save.squad.filter((id): id is string => id !== null), ...this.save.heroes.map((h) => h.id)];
    for (const heroId of new Set(order)) {
      for (let guard = 0; guard < 16; guard++) {
        const hero = this.save.heroes.find((h) => h.id === heroId)!;
        const base = heroPower(hero, this.ctx, this.save);
        let best: { id: string; gain: number } | null = null;
        const tried = new Set<string>();
        for (const it of this.save.inventory.items) {
          const key = `${it.itemId}+${it.refine ?? 0}`;
          if (it.equippedBy !== null || tried.has(key)) continue;
          tried.add(key);
          const def = this.ctx.equipment.items[it.itemId];
          if (!def || !canEquip(hero, def, this.ctx)) continue;
          const gain = heroPower(hero, this.ctx, equip(this.save, heroId, it.id, this.ctx)) - base;
          if (gain > 0 && (!best || gain > best.gain)) best = { id: it.id, gain };
        }
        if (!best) break;
        this.save = actEquip(this.save, heroId, best.id, this.ctx);
        this.equips++;
      }
    }
  }

  /** Авто-расстановка → карточки (призыв, вознесение, «Улучшить» отряда) → экипировка → авто-расстановка. */
  prepare(): void {
    this.save = { ...this.save, squad: this.formation() };
    this.develop();
    this.shop();
    this.autoEquip();
    this.save = { ...this.save, squad: this.formation() };
    this.refine();
  }

  /**
   * Золото, которое заточка не трогает: уровни отряда вперёд (refineReserveLevels на героя, не выше предела редкости)
   * и золото на уровни, которые откроет уже накопленный опыт пула. На потолке уровней резерв — ноль: всё золото сверх
   * него уходит в заточку. Так главы 1–3 (золото там идёт на уровни) почти не меняются.
   */
  refineReserve(): number {
    let sum = 0;
    for (const id of this.save.squad) {
      const h = id ? this.save.heroes.find((x) => x.id === id) : undefined;
      if (!h) continue;
      const max = levelUpInfo(this.save, h.id, this.ctx).maxLevel;
      for (let l = h.level; l < Math.min(max, h.level + this.model.refineReserveLevels); l++) sum += levelUpCost(l, this.ctx).gold;
    }
    return Math.max(sum, this.goldForExp(0));
  }

  /** Заточка надетого на отряд: сначала самый дешёвый шаг, только золото сверх refineReserve. */
  refine(): void {
    if (!this.model.refine || !refineUnlocked(this.save, this.ctx)) return;
    const reserve = this.refineReserve();
    for (let guard = 0; guard < 500; guard++) {
      let best: { id: string; gold: number } | null = null;
      for (const id of this.save.squad) {
        if (!id) continue;
        for (const s of Object.values(heroSlots(this.save, id, this.ctx))) {
          const c = refineCost(s.instance, s.def, this.ctx);
          if (c && (!best || c.gold < best.gold)) best = { id: s.instance.id, gold: c.gold };
        }
      }
      if (!best || this.save.resources.gold - best.gold < reserve) break;
      this.step('refine', refineItem(this.save, best.id, this.ctx).save);
      this.refines++;
      this.spendTime(this.model.refineSec * 1000);
    }
  }

  /**
   * Золото, которое игрок держит на уровни: стоимость следующих reserveLevels уровней каждого героя отряда.
   * Лавка тратит только золото сверх него — сток не должен отнимать золото у «Улучшить».
   */
  goldReserve(reserveLevels = 1): number {
    let sum = 0;
    for (const id of this.save.squad) {
      const h = id ? this.save.heroes.find((x) => x.id === id) : undefined;
      if (!h) continue;
      for (let l = h.level; l < h.level + reserveLevels; l++) sum += levelUpCost(l, this.ctx).gold;
    }
    return sum;
  }

  /**
   * Сколько золота съедят уровни, которые отряд купит на опыт пула + extraExp (как levelSquad: по одному уровню самому
   * низкому). Опыт из Лавки покупается, только если после покупки этого золота хватит — иначе опыт лежит без дела.
   */
  goldForExp(extraExp: number): number {
    const heroes = this.save.squad
      .filter((id): id is string => id !== null)
      .map((id) => ({ level: this.save.heroes.find((h) => h.id === id)!.level, max: levelUpInfo(this.save, id, this.ctx).maxLevel }));
    let exp = this.save.resources.heroExp + extraExp;
    let gold = 0;
    for (let guard = 0; guard < 2000; guard++) {
      const h = heroes.filter((x) => x.level < x.max).sort((a, b) => a.level - b.level)[0];
      if (!h) break;
      const c = levelUpCost(h.level, this.ctx);
      if (c.exp > exp) break;
      exp -= c.exp;
      gold += c.gold;
      h.level++;
    }
    return gold;
  }

  /** Лучший прирост мощи отряда от предмета itemId (0 — никому не нужен). */
  itemGain(itemId: string): number {
    const def = this.ctx.equipment.items[itemId];
    if (!def) return 0;
    let best = 0;
    for (const id of this.save.squad) {
      const hero = id ? this.save.heroes.find((h) => h.id === id) : undefined;
      if (!hero || !canEquip(hero, def, this.ctx)) continue;
      const cur = this.save.inventory.items.find((it) => it.equippedBy === hero.id && this.ctx.equipment.items[it.itemId]?.slot === def.slot);
      const curDef = cur ? this.ctx.equipment.items[cur.itemId] : undefined;
      const score = (d: typeof def | undefined) => (d ? (d.stats.hp ?? 0) / 10 + (d.stats.atk ?? 0) + (d.stats.def ?? 0) + (d.stats.spd ?? 0) : 0);
      best = Math.max(best, score(def) - score(curDef));
    }
    return best;
  }

  /**
   * Лавка: покупки, затем бесплатное обновление и снова покупки. Золото тратится только сверх запаса на уровни
   * (goldReserve): предмет — если усиливает отряд; карта героя — при двойном запасе; опыт — если хватит золота и на уровни,
   * которые он откроет (goldForExp), и на 2 уровня сверху. Свиток — за гемы (не больше одного в день — лимит товара).
   * Золото за гемы, эпики и карты героя за гемы не покупаются: гемы модели идут на ×10.
   */
  shop(): void {
    if (!this.model.shop || !this.ctx.shop || !featureUnlocked(this.save, 'shop', this.ctx)) return;
    const ctx = this.ctx as FullContext & ShopContext;
    for (let pass = 0; pass < 2; pass++) {
      for (let guard = 0; guard < 20; guard++) {
        const st = shopStatus(this.save, this.day, ctx);
        const reserve = this.goldReserve();
        const gold = this.save.resources.gold;
        const pick = st.slots.find((x) => {
          if (x.soldOut || x.dayLimited || !x.affordable) return false;
          if (x.currency === 'gems') return x.kind === 'scrolls' && this.save.currency.gems - x.price >= 0;
          const spare = gold - x.price;
          // Опыт — только если золота хватит и на уровни, которые он откроет, и ещё на 2 уровня каждому сверху:
          // без запаса (проверено) опыт мид-гейма съедает золото, которого потом не хватает в главе 3.
          if (x.kind === 'heroExp') return spare >= this.goldForExp(x.count) + this.goldReserve(2);
          if (x.kind === 'item') return spare >= reserve && this.itemGain(x.itemId!) > 0;
          if (x.kind === 'heroCard') return spare >= 2 * reserve;
          return false;
        });
        if (!pick) break;
        this.step('shop', buyShopSlot(this.save, this.day, pick.index, ctx).save);
        this.shopBuys[pick.good] = (this.shopBuys[pick.good] ?? 0) + 1;
        if (pick.kind === 'heroExp') this.levelSquad();
        if (pick.kind === 'item') this.autoEquip();
      }
      // Бесплатное обновление — один раз, после покупок (как игрок: сначала раскупить, потом обновить).
      const st = shopStatus(this.save, this.day, ctx);
      if (pass > 0 || st.nextRefreshCost !== 0) break;
      this.step('shop', refreshShop(this.save, this.day, ctx));
    }
  }

  claimOffline(): void {
    this.step('offline', actClaimOffline(this.save, this.now, this.day, this.ctx).save);
  }

  /** Минут накоплено в сундуке сейчас. */
  chestMinutes(): number {
    return offlineRewards(this.save, this.now, this.ctx).minutes;
  }

  /** Быстрые награды, если сегодня использовано меньше fastRewardsPerDay. true — взяты. */
  fastRewards(): boolean {
    let used = false;
    // Открытия функций (data/unlocks.json): до своего этапа кнопки на главной закрыты — модель тоже ждёт.
    if (!featureUnlocked(this.save, 'fast_rewards', this.ctx)) return false;
    for (let guard = 0; guard < 100; guard++) {
      const st = fastRewardsStatus(this.save, this.day, this.ctx);
      if (st.used >= this.model.fastRewardsPerDay || st.nextCost === null || st.nextCost > this.save.currency.gems) break;
      const preview = fastRewardsPreview(this.save, this.ctx);
      if (preview.gold <= 0 && preview.jobExp <= 0) break;
      this.step('fast_rewards', actUseFastRewards(this.save, this.day, this.ctx).save);
      used = true;
      if (!this.model.fastRewardsPerDay) break;
    }
    return used;
  }

  claimExpeditions(): void {
    if (!featureUnlocked(this.save, 'bounties', this.ctx)) return;
    for (const e of this.save.bounties.active) {
      if (this.now >= e.endsAt) this.step('expeditions', claimExpedition(this.save, e.location, this.now, this.ctx).save);
    }
  }

  /**
   * Отправить отряд во все открытые свободные локации (как игрок: одно нажатие «Отправить», отряд — autoParty).
   * Срок — самый долгий, что вернётся к следующей сессии (nextSessionAt, мс); не успевает ни один — самый короткий.
   */
  startExpeditions(nextSessionAt: number): void {
    if (!featureUnlocked(this.save, 'bounties', this.ctx)) return;
    const durations = this.ctx.meta.expeditions.durations.map((d) => d.hours).sort((a, b) => a - b);
    const fit = durations.filter((h) => this.now + h * HOUR <= nextSessionAt);
    const hours = fit.length ? fit[fit.length - 1] : durations[0];
    for (const loc of this.ctx.meta.expeditions.locations) {
      if (!locationUnlocked(this.save, loc) || this.save.bounties.active.some((e) => e.location === loc.id)) continue;
      if (!autoParty(this.save, loc.id, this.ctx).ok) continue;
      this.save = startExpedition(this.save, loc.id, hours, this.now, this.ctx);
    }
  }

  /**
   * События новичка и почта: засчитать вход (touchEvents), забрать дни входа, письма, задания и сундуки новичка.
   * true — что-то получено.
   */
  claimEvents(): boolean {
    if (!this.model.events) return false;
    this.save = touchEvents(this.save, this.day, this.ctx);
    let changed = false;
    const log = (kind: BalanceResult['eventClaims'][number]['kind'], id: string) => {
      this.eventClaims.push({ kind, id, day: this.dayNo, t: this.t });
      changed = true;
    };
    for (const d of loginStatus(this.save, this.day, this.ctx).days) {
      if (!d.ready) continue;
      this.step('events', claimLogin(this.save, this.day, d.day, this.ctx).save);
      log('login', String(d.day));
    }
    const mail = claimAllMail(this.save, this.ctx);
    if (mail.count) {
      this.step('mail', mail.save);
      log('mail', String(mail.count));
    }
    for (const t of newbieStatus(this.save, this.day, this.ctx).days.flatMap((d) => d.tasks)) {
      if (!t.ready) continue;
      this.step('events', claimNewbieTask(this.save, this.day, t.id, this.ctx).save);
      log('newbie_task', t.id);
    }
    for (const m of newbieStatus(this.save, this.day, this.ctx).milestones) {
      if (!m.ready) continue;
      this.step('events', claimNewbieMilestone(this.save, this.day, m.points, this.ctx).save);
      log('newbie_chest', String(m.points));
    }
    return changed;
  }

  /** Задания, пороги активности, достижения, события новичка и почта — всё, что можно забрать. */
  claimRewards(): void {
    for (let guard = 0; guard < 10; guard++) {
      let changed = this.claimEvents();
      const quests = featureUnlocked(this.save, 'quests', this.ctx);
      const qs = questStatus(this.save, this.ctx, this.day);
      for (const q of quests ? qs.quests : []) {
        if (q.done && !q.claimed) {
          this.step('quests', claimQuest(this.save, this.day, q.id, this.ctx).save);
          this.questClaims[q.id] = (this.questClaims[q.id] ?? 0) + 1;
          changed = true;
        }
      }
      for (const m of quests ? questStatus(this.save, this.ctx, this.day).milestones : []) {
        if (m.reached && !m.claimed) {
          this.step('quests', claimActivity(this.save, this.day, m.points, this.ctx).save);
          this.milestoneClaims[m.points] = (this.milestoneClaims[m.points] ?? 0) + 1;
          changed = true;
        }
      }
      for (const a of featureUnlocked(this.save, 'achievements', this.ctx) ? achievementStatus(this.save, this.ctx) : []) {
        if (a.done && !a.claimed) {
          this.step('achievements', claimAchievement(this.save, a.id, this.ctx).save);
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  /** Застрял: сундук (если накопилось), быстрые награды, задания — и снова «Улучшить». true — что-то получено. */
  boost(allowFast: boolean): boolean {
    const before = squadPower(this.save, this.ctx);
    if (this.chestMinutes() >= this.model.midSessionClaimMinutes) this.claimOffline();
    if (allowFast) this.fastRewards();
    this.claimRewards();
    this.prepare();
    return squadPower(this.save, this.ctx) > before;
  }
}

/** Прогнать модель игрока на days дней. Детерминирована: одинаковые входы — одинаковый результат. */
export function runBalance(ctx: FullContext, days: number, model: PlayerModel = PLAYER_MODEL): BalanceResult {
  const sim = new Sim(ctx, model);
  const rows: SessionRow[] = [];
  const firstClears: FirstClear[] = [];
  const battles: BattleLog[] = [];
  const stageAttempts = new Map<string, number>();
  const towerByFloor = new Map<number, number>();
  const huntLog: BalanceResult['huntLog'] = [];
  const purplesByDay: number[] = [];
  const refineByDay: BalanceResult['refineByDay'] = [];
  const spareByDay: number[] = [];
  const lastChapter = ctx.content.stages[ctx.content.stages.length - 1]?.chapter ?? '';
  // Скорость ×2 открывается этапом (data/unlocks.json → speed_x2): до него бои смотрят на ×1.
  const battleMs = (duration: number) =>
    Math.round((duration / (featureUnlocked(sim.save, 'speed_x2', ctx) ? model.battleSpeed : 1) + model.battleOverheadSec) * 1000);
  // Строк сюжета на этапе: сцены до/после этапа и начало главы (для первого этапа главы).
  const storyLines = new Map<string, number>();
  for (const st of ctx.content.stages) {
    const lines = ctx.story.scenes
      .filter((sc) => sc.stageId === st.id || (sc.trigger === 'chapterStart' && sc.chapter === st.chapter && st.index === 0))
      .reduce((a, sc) => a + sc.lines.length, 0);
    storyLines.set(st.id, lines);
  }

  for (let day = 1; day <= days; day++) {
    sim.dayNo = day;
    sim.day = dateOf(model.startDate, day);
    sim.gemsByDay[day - 1] ??= { income: 0, spend: 0 };
    for (let session = 1; session <= model.sessionsPerDay; session++) {
      const time_h = (day - 1) * 24 + model.firstSessionHour + (session - 1) * model.hoursBetweenSessions;
      sim.now = time_h * HOUR;
      const start = sim.now;
      const activeStart = sim.activeMs;
      const end = start + (day === 1 && session === 1 ? model.firstSessionMinutes : model.sessionMinutes) * MINUTE;
      const lastSession = session === model.sessionsPerDay;
      // Начало следующей сессии (последняя сессия дня — первая сессия завтра): до него должна вернуться экспедиция.
      const nextSessionAt = (lastSession ? day * 24 + model.firstSessionHour : time_h + model.hoursBetweenSessions) * HOUR;
      sim.sessionLevelUps = 0;
      sim.claimOffline();
      // Экспедиции — сразу при входе: забрать вернувшиеся и отправить заново (4-часовая вернётся к следующей сессии).
      if (model.expeditions) {
        sim.claimExpeditions();
        sim.startExpeditions(nextSessionAt);
      }
      sim.claimRewards();
      sim.prepare();

      // Кампания: бой → победа — дальше; поражение — сундук/быстрые награды/уровни и повтор, до maxLosses.
      let wins = 0;
      let losses = 0;
      let stageLosses = 0;
      for (;;) {
        const stageId = nextOpenStage(sim.save, ctx);
        if (!stageId || stageLosses >= model.maxLossesPerSession || sim.now >= end) break;
        const power = squadPower(sim.save, ctx);
        if (!stageAttempts.has(stageId)) sim.spendTime((storyLines.get(stageId) ?? 0) * model.storySecPerLine * 1000);
        const out = actPlayStage(sim.save, sim.day, stageId, model.seedBase + sim.save.battleSeq, ctx, sim.now);
        sim.spendTime(battleMs(out.result.duration));
        sim.step('campaign', out.save);
        stageAttempts.set(stageId, (stageAttempts.get(stageId) ?? 0) + 1);
        const win = out.result.winner === 'A';
        battles.push({ t: sim.t, active_min: sim.activeMin, kind: 'stage', target: stageId, win, squadPower: power, recommended: recommendedPower(stageId, ctx) });
        if (win) {
          wins++;
          stageLosses = 0;
          const squadHeroes = sim.save.squad.map((id) => sim.save.heroes.find((h) => h.id === id)).filter((h): h is HeroState => !!h);
          firstClears.push({
            stageId,
            day,
            session,
            time_h: Math.round(sim.t * 100) / 100,
            attempts: stageAttempts.get(stageId)!,
            active_min: sim.activeMin,
            squadLevels: squadHeroes.map((h) => h.level),
            squadRarities: squadHeroes.map((h) => h.rarity),
          });
          sim.claimRewards();
          sim.prepare();
        } else {
          losses++;
          stageLosses++;
          sim.boost(true);
        }
      }

      // Башня.
      let towerAttempts = 0;
      let towerLosses = 0;
      while (
        towerUnlocked(sim.save, ctx) &&
        sim.save.tower.floor < ctx.tower.maxFloor &&
        towerAttempts < model.towerMaxAttemptsPerSession &&
        towerLosses < model.towerMaxLossesPerSession &&
        sim.now < end
      ) {
        const power = squadPower(sim.save, ctx);
        const out = actClimbTower(sim.save, sim.day, model.seedBase + sim.save.battleSeq, ctx);
        sim.spendTime(battleMs(out.result.duration));
        sim.step('tower', out.save);
        towerByFloor.set(out.floor, (towerByFloor.get(out.floor) ?? 0) + 1);
        battles.push({ t: sim.t, active_min: sim.activeMin, kind: 'tower', target: String(out.floor), win: out.result.winner === 'A', squadPower: power, recommended: 0 });
        towerAttempts++;
        if (out.result.winner === 'A') sim.prepare();
        else towerLosses++;
      }

      // Охота на босса: сначала бой (рекорд), потом «Зачистка»; каждая попытка — одна за сессию.
      if (model.hunt && sim.now < end) {
        const hs = huntStatus(sim.save, sim.day, ctx);
        if (hs.unlocked && hs.attemptsLeft > 0) {
          const out = hs.canSweep && hs.used > 0 ? sweepHunt(sim.save, sim.day, ctx) : fightHunt(sim.save, sim.day, ctx);
          sim.spendTime(out.result ? battleMs(out.result.duration) : model.battleOverheadSec * 1000);
          sim.step('hunt', out.save);
          huntLog.push({ day, damage: out.damage, tier: out.tier, sweep: out.sweep });
          sim.prepare();
        }
      }

      if (model.expeditions) {
        sim.claimExpeditions();
        sim.startExpeditions(nextSessionAt);
      }
      if (lastSession) sim.fastRewards();
      sim.claimRewards();
      sim.prepare();

      const s = sim.save;
      const next = nextOpenStage(s, ctx);
      const heroes = s.squad.map((id) => s.heroes.find((h) => h.id === id)).filter((h) => !!h);
      const sp = squadPower(s, ctx);
      const rec = next ? recommendedPower(next, ctx) : 0;
      const counts: Record<string, number> = {};
      for (const h of heroes) counts[h.rarity] = (counts[h.rarity] ?? 0) + 1;
      rows.push({
        day,
        date: sim.day,
        session,
        time_h,
        chapter: next ? getStage(ctx, next).chapter : lastChapter,
        stage_reached: next ?? 'done',
        cleared_count: s.campaign.cleared.length,
        attempts: wins + losses,
        wins,
        losses,
        tower_floor: s.tower.floor,
        tower_attempts: towerAttempts,
        gold: s.resources.gold,
        gems: s.currency.gems,
        hero_exp: s.resources.heroExp,
        items: s.inventory.items.length,
        squad_power: sp,
        next_stage_power: next ? stagePower(next, ctx) : 0,
        recommended_power: rec,
        power_ratio: rec ? Math.round((sp / rec) * 100) / 100 : 0,
        avg_level: Math.round((heroes.reduce((a, h) => a + h.level, 0) / Math.max(1, heroes.length)) * 10) / 10,
        level_ups: sim.sessionLevelUps,
        rarities: (Object.keys(RARITY_LETTER) as CardRarity[]).filter((r) => counts[r]).map((r) => `${counts[r]}${RARITY_LETTER[r]}`).join(''),
        heroes: heroes.map((h) => `${h.templateId}:${h.rarity}:${h.level}`).join('|'),
        summons: sim.summons,
        quests_claimed: Object.values(sim.questClaims).reduce((a, n) => a + n, 0),
        bounties_done: s.achievements.counters.bounties_done ?? 0,
        active_min: Math.round((sim.activeMs - activeStart) / MINUTE),
      });
    }
    const sq = new Set(sim.save.squad.filter((id): id is string => id !== null));
    purplesByDay.push(sim.save.heroes.filter((h) => sq.has(h.id) && rarityIndex(h.rarity) >= rarityIndex('purple')).length);
    spareByDay.push(sim.save.heroes.filter((h) => !sq.has(h.id)).length);
    const worn = sim.save.inventory.items.filter((i) => i.equippedBy !== null && sq.has(i.equippedBy));
    refineByDay.push({
      avg: Math.round((worn.reduce((a, i) => a + (i.refine ?? 0), 0) / Math.max(1, worn.length)) * 10) / 10,
      max: worn.reduce((a, i) => Math.max(a, i.refine ?? 0), 0),
    });
  }
  return {
    model,
    rows,
    firstClears,
    save: sim.save,
    stageAttempts: Object.fromEntries(stageAttempts),
    income: sim.income,
    spend: sim.spend,
    towerAttempts: Object.fromEntries(towerByFloor),
    huntLog,
    questClaims: sim.questClaims,
    milestoneClaims: sim.milestoneClaims,
    equips: sim.equips,
    ascensions: sim.ascensions,
    summons: sim.summons,
    summonLog: sim.summonLog,
    battles,
    levels: sim.levels,
    gemsByDay: sim.gemsByDay,
    scrollsIn: sim.scrollsIn,
    itemsIn: sim.itemsIn,
    cardsIn: sim.cardsIn,
    branches: sim.branches,
    purplesByDay,
    spareByDay,
    eventClaims: sim.eventClaims,
    shopBuys: sim.shopBuys,
    refines: sim.refines,
    refineByDay,
    activeMinutes: sim.activeMin,
  };
}

export function toCsv(rows: SessionRow[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => String(r[c])).join(','));
  return lines.join('\n') + '\n';
}

export interface Wall {
  stageId: string;
  /** Часы от предыдущего первого прохождения (или от старта) до прохождения / конца симуляции. */
  hours: number;
  attempts: number;
  cleared: boolean;
}

/** «Стены»: время застревания на каждом этапе, от худшего к лучшему. */
export function findWalls(res: BalanceResult, ctx: GameContext): Wall[] {
  const walls: Wall[] = [];
  let prevH = res.rows[0]?.time_h ?? 0; // отсчёт — с первой сессии, а не с полуночи
  for (const fc of res.firstClears) {
    walls.push({ stageId: fc.stageId, hours: Math.round((fc.time_h - prevH) * 10) / 10, attempts: fc.attempts, cleared: true });
    prevH = fc.time_h;
  }
  const next = nextOpenStage(res.save, ctx);
  const last = res.rows[res.rows.length - 1];
  if (next && last) {
    walls.push({ stageId: next, hours: Math.round((last.time_h - prevH) * 10) / 10, attempts: res.stageAttempts[next] ?? 0, cleared: false });
  }
  return walls.sort((a, b) => b.hours - a.hours || b.attempts - a.attempts);
}

/** Этаж башни и число пройденных этапов на конец каждого дня. */
export function perDay(res: BalanceResult): { day: number; date: string; tower_floor: number; cleared_count: number; gold: number; gems: number; stage_reached: string; rarities: string; avg_level: number; summons: number; squad_power: number }[] {
  const out = new Map<number, SessionRow>();
  for (const r of res.rows) out.set(r.day, r);
  return [...out.values()].map((r) => ({
    day: r.day,
    date: r.date,
    tower_floor: r.tower_floor,
    cleared_count: r.cleared_count,
    gold: r.gold,
    gems: r.gems,
    stage_reached: r.stage_reached,
    rarities: r.rarities,
    avg_level: r.avg_level,
    summons: r.summons,
    squad_power: r.squad_power,
  }));
}

export function total(ledger: Ledger): { gold: number; gems: number; exp: number } {
  return SOURCES.reduce((a, s) => ({ gold: a.gold + ledger[s].gold, gems: a.gems + ledger[s].gems, exp: a.exp + ledger[s].exp }), { gold: 0, gems: 0, exp: 0 });
}

/** Метрики-«крючки» (docs/content/balance.md, «Цели»). Всё считается по журналам runBalance. */
export interface HookMetrics {
  /** Активных минут до победы над боссом главы (по главам); null — не пройдена. */
  chapterActiveMin: (number | null)[];
  /** Часов от начала игры (первой сессии) до победы над боссом главы. */
  chapterHours: (number | null)[];
  /** Первые 30 активных минут: боёв кампании, повышений уровня, боёв на одно повышение. */
  first30: { battles: number; levelUps: number; battlesPerLevelUp: number };
  /** Средний прирост за уровень, % — уровни 1–10, 11–20, 21–40, 41+: мощи героя (heroPower) и «боевой силы» (hp × atk). */
  levelGainPct: { band: string; pct: number; effPct: number; n: number }[];
  /** Первые 30 мин: средний прирост мощи отряда между соседними боями кампании, в которых были повышения, %. */
  first30BurstPct: number;
  /** Повышений уровня за активный час (по дням). */
  levelUpsPerActiveHour: number[];
  /** Первое вознесение: активные минуты / часы от начала, шаблон и новая редкость. */
  firstAscend: { active_min: number; hours: number; templateId: string; rarity: string } | null;
  /** Первый фиолетовый в отряде (вознесение или контракт): день, часы от начала. Ц11. */
  firstPurple: { day: number; hours: number; templateId: string; via: 'ascend' | 'branch' } | null;
  /** Второй фиолетовый (другой герой). */
  secondPurple: { day: number; hours: number; templateId: string } | null;
  /** Фиолетовых в отряде на конец дня (Ц11: к 7-му дню 2–3). */
  purplesByDay: number[];
  /** Новые фиолетовые за первые 7 дней по источникам: вознесение, карта (Таверна, трофеи), «Контракт героя». */
  purples7: { ascend: number; card: number; contract: number };
  /** Первый ×10 призыв: активные минуты / часы, способ. */
  firstTen: { active_min: number; hours: number; pay: string } | null;
  /** ×10 призывов за гемы по дням. */
  tenPullsByDay: number[];
  /** Стены ≥ wallHours: этап, часы ожидания. */
  walls: Wall[];
  /** Поражения по отношению мощь / рекомендуемая: <0.85, 0.85–0.95, 0.95–1.05, ≥1.05. */
  lossRatio: { band: string; n: number }[];
  /** Победы (первые прохождения) по отношению мощь / рекомендуемая. */
  winRatio: { band: string; n: number }[];
}

const RATIO_BANDS: [string, number, number][] = [
  ['<0.85', 0, 0.85],
  ['0.85–0.95', 0.85, 0.95],
  ['0.95–1.05', 0.95, 1.05],
  ['≥1.05', 1.05, Infinity],
];

export function hookMetrics(res: BalanceResult, ctx: GameContext, wallHours = 4): HookMetrics {
  const t0 = res.rows[0]?.time_h ?? 0;
  const bosses = ctx.content.chapters.map((c) => ctx.content.stages.filter((s) => s.chapter === c.id).slice(-1)[0]?.id);
  const fc = new Map(res.firstClears.map((f) => [f.stageId, f]));
  const chapterActiveMin = bosses.map((b) => (b && fc.get(b) ? fc.get(b)!.active_min : null));
  const chapterHours = bosses.map((b) => (b && fc.get(b) ? Math.round((fc.get(b)!.time_h - t0) * 10) / 10 : null));
  const b30 = res.battles.filter((b) => b.kind === 'stage' && b.active_min <= 30).length;
  const l30 = res.levels.filter((l) => l.active_min <= 30).length;
  const bands: [string, number, number][] = [
    ['1–10', 1, 10],
    ['11–20', 11, 20],
    ['21–40', 21, 40],
    ['41+', 41, Infinity],
  ];
  const levelGainPct = bands.map(([band, lo, hi]) => {
    const ls = res.levels.filter((l) => l.level - 1 >= lo && l.level - 1 <= hi && l.before > 0);
    const pct = ls.length ? ls.reduce((a, l) => a + (l.after / l.before - 1), 0) / ls.length : 0;
    const eff = ls.length ? ls.reduce((a, l) => a + (l.effAfter / l.effBefore - 1), 0) / ls.length : 0;
    return { band, pct: Math.round(pct * 1000) / 10, effPct: Math.round(eff * 1000) / 10, n: ls.length };
  });
  const early = res.battles.filter((b) => b.kind === 'stage' && b.active_min <= 30);
  const bursts: number[] = [];
  for (let i = 1; i < early.length; i++) {
    const g = early[i].squadPower / early[i - 1].squadPower - 1;
    if (res.levels.some((l) => l.t > early[i - 1].t && l.t <= early[i].t) && g > 0) bursts.push(g);
  }
  const first30BurstPct = bursts.length ? Math.round((bursts.reduce((a, b) => a + b, 0) / bursts.length) * 1000) / 10 : 0;
  const daysN = Math.max(1, ...res.rows.map((r) => r.day));
  const levelUpsPerActiveHour = Array.from({ length: daysN }, (_, i) => {
    const rows = res.rows.filter((r) => r.day === i + 1);
    const min = rows.reduce((a, r) => a + r.active_min, 0);
    const n = rows.reduce((a, r) => a + r.level_ups, 0);
    return min ? Math.round((n / (min / 60)) * 10) / 10 : 0;
  });
  const a = res.ascensions[0];
  const firstAscend = a ? { active_min: a.active_min, hours: Math.round((a.t - t0) * 10) / 10, templateId: a.templateId, rarity: a.rarity } : null;
  // Первые фиолетовые: вознесение в фиолетовый или выбор ветки (контракт / Таверна) — по разным героям.
  const purpleEvents = [
    ...res.ascensions.filter((x) => x.rarity === 'purple').map((x) => ({ day: x.day, t: x.t, templateId: x.templateId, via: 'ascend' as const })),
    ...res.branches.map((x) => ({ day: x.day, t: x.t, templateId: x.templateId, via: 'branch' as const })),
  ].sort((x, y) => x.t - y.t);
  const firstP = purpleEvents[0];
  const secondP = purpleEvents.find((x) => firstP && x.templateId !== firstP.templateId);
  const firstPurple = firstP ? { day: firstP.day, hours: Math.round((firstP.t - t0) * 10) / 10, templateId: firstP.templateId, via: firstP.via } : null;
  const secondPurple = secondP ? { day: secondP.day, hours: Math.round((secondP.t - t0) * 10) / 10, templateId: secondP.templateId } : null;
  const ten = res.summonLog.find((s) => s.count === 10);
  const firstTen = ten ? { active_min: ten.active_min, hours: Math.round((ten.t - t0) * 10) / 10, pay: ten.pay } : null;
  const days = Math.max(1, ...res.rows.map((r) => r.day));
  const tenPullsByDay = Array.from({ length: days }, (_, i) => res.summonLog.filter((s) => s.count === 10 && s.pay === 'gems' && Math.floor(s.t / 24) === i).length);
  const walls = findWalls(res, ctx).filter((w) => w.hours >= wallHours);
  const stageBattles = res.battles.filter((b) => b.kind === 'stage' && b.recommended > 0);
  const band = (list: BattleLog[]) => RATIO_BANDS.map(([name, lo, hi]) => ({ band: name, n: list.filter((b) => b.squadPower / b.recommended >= lo && b.squadPower / b.recommended < hi).length }));
  return {
    chapterActiveMin,
    chapterHours,
    first30: { battles: b30, levelUps: l30, battlesPerLevelUp: l30 ? Math.round((b30 / l30) * 100) / 100 : Infinity },
    levelGainPct,
    first30BurstPct,
    levelUpsPerActiveHour,
    firstAscend,
    firstPurple,
    secondPurple,
    purplesByDay: res.purplesByDay,
    purples7: { ascend: res.branches.filter((b) => b.day <= 7 && b.via === 'ascend').length, card: res.branches.filter((b) => b.day <= 7 && b.via === 'card').length, contract: res.branches.filter((b) => b.day <= 7 && b.via === 'contract').length },
    firstTen,
    tenPullsByDay,
    walls,
    lossRatio: band(stageBattles.filter((b) => !b.win)),
    winRatio: band(stageBattles.filter((b) => b.win)),
  };
}

/** Состояние на отметках времени (часы от начала игры): для таблицы «по часам». */
export function timeline(res: BalanceResult, ctx: FullContext, marksH: number[]): { h: number; stage: string; cleared: number; power: number; rec: number; ratio: number; levelUps: number; avgLevel: number; rarities: string; gemsIn: number; summons: number }[] {
  const t0 = res.rows[0]?.time_h ?? 0;
  return marksH.map((h) => {
    const t = t0 + h;
    const cleared = res.firstClears.filter((f) => f.time_h <= t);
    const lastBattle = [...res.battles].reverse().find((b) => b.t <= t);
    const row = [...res.rows].reverse().find((r) => r.time_h <= t) ?? res.rows[0];
    const nextId = ctx.content.stages[cleared.length]?.id ?? 'done';
    const rec = nextId !== 'done' ? recommendedPower(nextId, ctx) : 0;
    const power = lastBattle ? lastBattle.squadPower : row.squad_power;
    const gemsIn = res.gemsByDay.slice(0, Math.floor(t / 24)).reduce((a, g) => a + g.income, 0);
    return {
      h,
      stage: nextId,
      cleared: cleared.length,
      power,
      rec,
      ratio: rec ? Math.round((power / rec) * 100) / 100 : 0,
      levelUps: res.levels.filter((l) => l.t <= t).length,
      avgLevel: row.avg_level,
      rarities: row.rarities,
      gemsIn,
      summons: res.summonLog.filter((s) => s.t <= t).reduce((a, s) => a + s.count, 0),
    };
  });
}

/** Короткие наблюдения для владельца (по-русски). Эвристики — см. docs/content/balance.md. */
export function signals(res: BalanceResult, ctx: FullContext): string[] {
  const out: string[] = [];
  const days = perDay(res);
  const last = res.rows[res.rows.length - 1];
  if (!last) return out;
  const inc = total(res.income);
  const sp = total(res.spend);

  if (sp.gold < inc.gold / 3 && last.gold > 0) out.push(`Золото копится: ${last.gold} на руках (доход ${inc.gold}, расход ${sp.gold}).`);
  if (last.gems > 0 && sp.gems < inc.gems / 4) {
    out.push(`Гемы почти не тратятся: ${last.gems} на руках (доход ${inc.gems}, расход ${sp.gems}).`);
  }
  if (last.hero_exp > inc.exp / 4) out.push(`Опыт копится в пуле: ${last.hero_exp} не потрачено (не хватает золота или все на пределе редкости).`);

  const walls = findWalls(res, ctx).filter((w) => w.hours >= 12);
  for (const w of walls.slice(0, 3)) {
    out.push(`Стена на ${w.stageId}: ${w.hours} ч, ${w.attempts} боёв${w.cleared ? '' : ' — не пройден к концу'}.`);
  }
  const jumps: string[] = [];
  const st = ctx.content.stages;
  for (let i = 1; i < st.length; i++) {
    const a = stagePower(st[i - 1].id, ctx);
    const b = stagePower(st[i].id, ctx);
    if (a > 0 && b / a >= 1.3) jumps.push(`${st[i].id} ×${(b / a).toFixed(2)}`);
  }
  if (jumps.length) out.push(`Скачки мощи врагов между соседними этапами (≥ ×1.3): ${jumps.join(', ')}.`);
  if (last.stage_reached === 'done') {
    const fc = res.firstClears[res.firstClears.length - 1];
    out.push(`Кампания пройдена целиком на ${fc?.day ?? '?'}-й день — контента кампании не хватает на ${days.length} дн.`);
  }

  if (res.save.tower.floor === 0) out.push(`Башня за ${days.length} дн. не пройдена ни на этаж (открывается после ${ctx.tower.unlockAfterStage ?? '—'}).`);
  else {
    const top = days[days.length - 1].tower_floor;
    const since = days.find((d) => d.tower_floor === top)!;
    if (days.length - since.day >= 3) out.push(`Башня стоит на ${top} этаже с ${since.day}-го дня.`);
    const hard = Object.entries(res.towerAttempts)
      .map(([f, n]) => ({ floor: Number(f), n }))
      .filter((x) => x.n >= 4)
      .sort((a, b) => b.n - a.n || a.floor - b.floor)
      .slice(0, 5);
    if (hard.length) {
      const bosses = hard.filter((x) => x.floor % ctx.tower.bossEvery === 0).length;
      out.push(
        `Трудные этажи башни (штурмов): ${hard.map((x) => `${x.floor} (${x.n})`).join(', ')}` +
          (bosses === hard.length ? ' — все босс-этажи.' : '.'),
      );
    }
    if (top >= ctx.tower.maxFloor) out.push(`Башня пройдена до вершины (${top}) за ${since.day} дн.`);
  }

  const free = res.save.inventory.items.filter((i) => i.equippedBy === null).length;
  if (free >= 10) out.push(`Лишние предметы копятся: ${free} в инвентаре не надеты (разбора/продажи нет).`);

  const never = ctx.features.quests.quests.filter((q) => !res.questClaims[q.id]).map((q) => q.id);
  if (never.length) out.push(`Задания ни разу не выполнены: ${never.join(', ')}.`);
  const topMs = ctx.features.quests.milestones[ctx.features.quests.milestones.length - 1];
  if (topMs && !res.milestoneClaims[topMs.points]) out.push(`Верхний порог активности (${topMs.points}) не взят ни разу — максимум очков за день недостижим моделью.`);

  const incGold = SOURCES.map((s) => ({ s, g: res.income[s].gold })).sort((a, b) => b.g - a.g)[0];
  if (inc.gold > 0 && incGold.g / inc.gold >= 0.6) {
    out.push(`Золото на ${Math.round((incGold.g / inc.gold) * 100)}% из одного источника: ${incGold.s}.`);
  }

  const maxLevel = Math.max(...res.save.heroes.map((h) => h.level));
  const story = res.save.heroes.filter((h) => heroTemplate(ctx, h.templateId).source === 'story').map((h) => `${h.templateId} ${h.rarity}`);
  out.push(`Карточки: наибольший уровень ${maxLevel}, призвано ${res.summons}, вознесений ${res.ascensions.length}, опыт в запасе ${res.save.resources.heroExp}; сюжетные: ${story.join(', ')}.`);

  const achDone = res.save.achievements.claimed.length;
  out.push(`Достижений получено: ${achDone} из ${ctx.meta.achievements.achievements.length}.`);
  return out;
}

/**
 * Подбор коэффициентов «рекомендуемой мощи» (data/progression.json → power.recommendedStages): несколько моделей игрока
 * (2–6 сессий в день × seed 1–6: выдачи Таверны разные) → по каждому этапу мощь отряда при последнем поражении и первой победе (доля от
 * stagePower). Порог — середина между ними; предложение = порог × margin (с мощью ≥ рекомендуемой почти всегда победа).
 * Герои v2: отряды разных выдач Таверны при той же мощи то выигрывают, то проигрывают (фиолетовый ур. 1 в отряде,
 * ветки), поэтому предложение ещё ограничено «полом» Ц8: самое слабое поражение и самая слабая победа всех моделей —
 * не ниже floor (0.86) рекомендуемой (tests/balance.test.ts проверяет 0.85). Этап без поражений подбирается только по
 * полу побед (если какая-то победа ниже floor), иначе не подбирается (порог неизвестен — только верхняя оценка).
 */
export function fitRecommended(
  ctx: FullContext,
  days = 8,
  margin = 1.03,
  floor = 0.86,
): { stageId: string; loss: number; win: number; threshold: number; suggested: number; current: number; n: number }[] {
  const per = new Map<string, { lo: number[]; hi: number[]; minLoss: number; minWin: number }>();
  for (const sessionsPerDay of [2, 3, 4, 6]) {
    for (const seedBase of [1, 2, 3, 4, 5, 6]) {
      const res = runBalance(ctx, days, { ...PLAYER_MODEL, sessionsPerDay, hoursBetweenSessions: sessionsPerDay >= 6 ? 2.5 : 4, seedBase });
      for (const s of ctx.content.stages) {
        const bs = res.battles.filter((b) => b.kind === 'stage' && b.target === s.id);
        const win = bs.find((b) => b.win);
        if (!win) continue;
        const losses = bs.filter((b) => !b.win);
        const sp = stagePower(s.id, ctx);
        const r = per.get(s.id) ?? { lo: [], hi: [], minLoss: Infinity, minWin: Infinity };
        r.minWin = Math.min(r.minWin, win.squadPower / sp);
        if (losses.length) {
          r.lo.push(Math.max(...losses.map((b) => b.squadPower)) / sp);
          r.hi.push(win.squadPower / sp);
          r.minLoss = Math.min(r.minLoss, ...losses.map((b) => b.squadPower / sp));
        }
        per.set(s.id, r);
      }
    }
  }
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const out = [];
  for (const s of ctx.content.stages) {
    const r = per.get(s.id);
    if (!r) continue;
    const current = recommendedPower(s.id, ctx) / stagePower(s.id, ctx);
    const cap = Math.min(r.minLoss, r.minWin) / floor;
    if (!r.lo.length) {
      if (r.minWin / current >= floor) continue;
      out.push({ stageId: s.id, loss: NaN, win: r.minWin, threshold: NaN, suggested: Math.round(cap * 100) / 100, current: Math.round(current * 100) / 100, n: 0 });
      continue;
    }
    const loss = med(r.lo);
    const win = med(r.hi);
    const threshold = (loss + Math.min(win, loss * 1.3)) / 2;
    const suggested = Math.min(threshold * margin, cap);
    out.push({ stageId: s.id, loss, win, threshold, suggested: Math.round(suggested * 100) / 100, current: Math.round(current * 100) / 100, n: r.lo.length });
  }
  return out;
}

/** Замер для power.levels (npm run balance -- --levels): по каждому этапу — модель игрока, эталонные отряды и что показывает ядро. */
export interface LevelFitRow {
  stageId: string;
  /** Моделей, прошедших этап. */
  n: number;
  /** Медиана по моделям среднего уровня отряда при первой победе (с экипировкой и лучшими героями — верхняя оценка). */
  modelLevel: number;
  /** Медиана по моделям медианной редкости отряда и числа героев. */
  modelRarity: CardRarity;
  modelSquad: number;
  /** «Уровень по бою» (referenceLevel): эталонный отряд полосы без экипировки выигрывает ≥ половины боёв. */
  battleLevel: number;
  /** Что показывает ядро: рекомендуемый уровень и редкость, медиана уровней врагов (без босса), уровень босса. */
  recommended: number;
  recommendedRarity: CardRarity;
  typical: number;
  boss?: number;
  /** enemyScale, при котором медианный враг (без босса) — ровно battleLevel. */
  scale: number;
  /** bossScale, при котором босс — ровно battleLevel (при текущем enemyScale). */
  bossScale?: number;
}

const medianOf = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Эталонные отряды для «уровня по бою»: танк, лекарь/поддержка и трое бойцов (первые трое — стартовый отряд главы 1). */
export const REFERENCE_SQUADS = [
  ['alan', 'vika', 'bran', 'kai', 'zara'],
  ['otto', 'teo', 'meilin', 'iris', 'lira'],
  ['alan', 'vika', 'bran', 'dorn', 'greta'],
];

/**
 * «Уровень по бою»: наименьший уровень, при котором эталонный отряд (squad героев редкости полосы этапа, с фиолетового —
 * первая ветка, без экипировки) выигрывает ≥ половины из `seeds` боёв этапа. Медиана по REFERENCE_SQUADS; двоичный поиск.
 */
export function referenceLevel(stageId: string, ctx: FullContext, seeds = 16): number {
  const band = levelBand(stageId, ctx);
  const enemies = enemySquad(stageId, ctx);
  const found = REFERENCE_SQUADS.map((ids) => {
    const wins = (level: number) => {
      const squad = ids.slice(0, band.squad).map((templateId, i) => {
        const t = ctx.content.heroes[templateId];
        const branch = rarityIndex(band.rarity) >= rarityIndex('purple') ? t?.branches[0]?.job : undefined;
        return buildUnit({ id: `ref${i}`, templateId, rarity: band.rarity, level, ...(branch ? { branch } : {}) }, ctx);
      });
      let n = 0;
      for (let seed = 1; seed <= seeds; seed++) if (simulateBattle(ctx.content, squad, enemies, seed, { combat: ctx.combat, log: false }).winner === 'A') n++;
      return n * 2 >= seeds;
    };
    if (wins(1)) return 1;
    let lo = 1;
    let hi = 128;
    if (!wins(hi)) return MAX_ENEMY_LEVEL;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (wins(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  });
  return medianOf(found);
}

/**
 * Калибровка power.levels (docs/content/balance.md, 4а): 9 моделей игрока (2/4/6 сессий × seed 1–3) — отряд при первой
 * победе; эталонные отряды — «уровень по бою». Предложения: enemyScale — медиана scale этапов с уровнем по бою ≥ 3 (раньше
 * уровни упираются в 1), bossScale — медиана по босс-этапам.
 */
export function fitLevels(ctx: FullContext, days = 8): { rows: LevelFitRow[]; suggestedScale: number; suggestedBossScale: number } {
  const per = new Map<string, { lv: number[]; rar: CardRarity[]; sq: number[] }>();
  for (const sessionsPerDay of [2, 4, 6]) {
    for (const seedBase of [1, 2, 3]) {
      const res = runBalance(ctx, days, { ...PLAYER_MODEL, sessionsPerDay, hoursBetweenSessions: sessionsPerDay >= 6 ? 2.5 : 4, seedBase });
      for (const fc of res.firstClears) {
        const r = per.get(fc.stageId) ?? { lv: [], rar: [], sq: [] };
        r.lv.push(fc.squadLevels.reduce((a, b) => a + b, 0) / Math.max(1, fc.squadLevels.length));
        const rr = [...fc.squadRarities].sort((a, b) => rarityIndex(a) - rarityIndex(b));
        r.rar.push(rr[Math.floor(rr.length / 2)] ?? 'green');
        r.sq.push(fc.squadLevels.length);
        per.set(fc.stageId, r);
      }
    }
  }
  const rows: LevelFitRow[] = [];
  const scale = enemyScale(ctx);
  for (const s of ctx.content.stages) {
    const r = per.get(s.id);
    if (!r) continue;
    const info = stageLevels(s.id, ctx);
    const band = levelBand(s.id, ctx);
    const battleLevel = referenceLevel(s.id, ctx);
    const units = enemySquad(s.id, ctx).filter((u): u is UnitDef => !!u);
    const mobs = units.filter((u) => u.kind !== 'boss');
    const boss = units.find((u) => u.kind === 'boss');
    const hero = baselineHero(battleLevel, band.rarity, ctx).hpAtk;
    const f2 = recommendedFactor(s.id, ctx) ** 2;
    const round2 = (x: number) => Math.round(x * 100) / 100;
    rows.push({
      stageId: s.id,
      n: r.lv.length,
      modelLevel: Math.round(medianOf(r.lv) * 10) / 10,
      modelRarity: CARD_RARITIES[medianOf(r.rar.map(rarityIndex))],
      modelSquad: medianOf(r.sq),
      battleLevel,
      recommended: info.recommended.level,
      recommendedRarity: info.recommended.rarity,
      typical: info.typical,
      ...(info.boss !== undefined ? { boss: info.boss } : {}),
      scale: mobs.length ? round2(medianOf(mobs.map((u) => u.stats.hp * u.stats.atk)) / hero) : NaN,
      ...(boss ? { bossScale: round2((boss.stats.hp * boss.stats.atk * f2) / (scale * hero)) } : {}),
    });
  }
  const fit = rows.filter((r) => r.battleLevel >= 3 && Number.isFinite(r.scale));
  const bosses = rows.filter((r) => r.bossScale !== undefined && r.battleLevel >= 2);
  return {
    rows,
    suggestedScale: fit.length ? medianOf(fit.map((r) => r.scale)) : scale,
    suggestedBossScale: bosses.length ? medianOf(bosses.map((r) => r.bossScale!)) : bossScale(ctx),
  };
}

/** Цели регулятора сложности (scripts/balance-fit.ts) для глав из data/campaign. */
export interface FitTargets {
  /** Главы с окнами — все главы по order, кроме balance.exclude; source — откуда окна (data, частично data, правило default). */
  chapters: { id: string; source: 'data' | 'partial' | 'default'; stages: string[] }[];
  /** Окно [с, по] каждого этапа этих глав (часы от начала первой сессии). */
  windows: Map<string, [number, number]>;
  /** Дней модели игрока: не меньше balance.fitDays и хватает на все окна (+12 ч запаса). */
  days: number;
  /** Ошибки целей: окна у несуществующих этапов, exclude с неизвестной главой. */
  problems: string[];
}

/** Правило окон для глав без своих окон, если в data/progression.json нет balance. */
export const DEFAULT_FIT_RULE = { gapHours: 12, spanHours: 42, wallEvery: 3, windowHours: 16.5 };

/**
 * Окна первого прохождения из data/progression.json → balance. Глава с окнами — окна из data (этап без окна берёт окно
 * предыдущего этапа, первые — первого заданного); глава без окон — правило default: начало = «с» окна босса прошлой главы
 * + gapHours, этапы группами по wallEvery (одно «с» на группу, между группами — стена «забери сундук»), «с» групп —
 * равномерно на spanHours (шаг 0.5 ч), «по» = «с» + windowHours. Новой главе хватает файла data/campaign/chapterN.json;
 * точные окна — в balance.windows.
 */
export function fitTargets(ctx: GameContext): FitTargets {
  const cfg = ctx.progression.balance ?? { fitDays: 7, exclude: [], windows: {}, default: DEFAULT_FIT_RULE };
  const problems: string[] = [];
  const stageIds = new Set(ctx.content.stages.map((s) => s.id));
  for (const id of Object.keys(cfg.windows)) if (!stageIds.has(id)) problems.push(`balance.windows.${id}: этапа нет в data/campaign`);
  const chapterIds = new Set(ctx.content.chapters.map((c) => c.id));
  for (const id of cfg.exclude) if (!chapterIds.has(id)) problems.push(`balance.exclude: главы ${id} нет в data/campaign`);

  const half = (x: number) => Math.round(x * 2) / 2;
  const windows = new Map<string, [number, number]>();
  const chapters: FitTargets['chapters'] = [];
  let prevBossLo: number | null = null;
  for (const ch of [...ctx.content.chapters].sort((a, b) => a.order - b.order)) {
    const stages = ctx.content.stages.filter((s) => s.chapter === ch.id).map((s) => s.id);
    if (cfg.exclude.includes(ch.id) || !stages.length) continue;
    const own = stages.map((id) => cfg.windows[id] as [number, number] | undefined);
    let source: FitTargets['chapters'][number]['source'];
    let list: [number, number][];
    if (own.some((w) => w)) {
      source = own.every((w) => w) ? 'data' : 'partial';
      let last = own.find((w) => w)!;
      list = own.map((w) => {
        if (w) last = w;
        return [last[0], last[1]];
      });
    } else {
      source = 'default';
      const d = cfg.default;
      const start = prevBossLo === null ? 0 : prevBossLo + d.gapHours;
      const groups = Math.ceil(stages.length / d.wallEvery);
      list = stages.map((_, i) => {
        const g = Math.floor(i / d.wallEvery);
        const lo = half(start + (groups > 1 ? (g * d.spanHours) / (groups - 1) : 0));
        return [lo, half(lo + d.windowHours)];
      });
    }
    stages.forEach((id, i) => windows.set(id, list[i]));
    prevBossLo = list[list.length - 1][0];
    chapters.push({ id: ch.id, source, stages });
  }
  const maxHi = Math.max(0, ...[...windows.values()].map((w) => w[1]));
  const days = Math.max(cfg.fitDays, Math.ceil((maxHi + 12) / 24));
  return { chapters, windows, days, problems };
}
