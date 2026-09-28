/**
 * Модель игрока для инструмента баланса (T7, v3 — карточки героев). Только вызовы ядра (обёртки act* и функции K1–K10) —
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
  actEquip,
  actLevelUp,
  actPlayStage,
  actSummon,
  ascendRequirement,
  autoFodder,
  actUseFastRewards,
  autoFormation,
  busyHeroes,
  canEquip,
  claimAchievement,
  claimActivity,
  claimAllMail,
  claimBounty,
  claimLogin,
  claimNewbieMilestone,
  claimNewbieTask,
  claimQuest,
  ensureBoard,
  equip,
  fastRewardsPreview,
  fastRewardsStatus,
  getStage,
  heroPower,
  heroRole,
  heroStats,
  heroTemplate,
  levelUpInfo,
  loginStatus,
  newbieStatus,
  offlineRewards,
  recommendedPower,
  summonStatus,
  newGame,
  questStatus,
  squadPower,
  stagePower,
  stageStatus,
  startBounty,
  touchEvents,
  towerUnlocked,
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
  /** Отправлять героев на поручения. */
  bounties: boolean;
  /** Призыв за гемы (×10, когда гемов хватает на ×10); false — только бесплатный призыв и свитки. */
  summonWithGems: boolean;
  /** «Вход 7 дней», «7 дней новичка» и почта (data/events.json): забирать всё, что можно, в каждой сессии. */
  events: boolean;
  /** Сдвиг seed: seed боя = seedBase + save.battleSeq; seed доски поручений = seedBase. */
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
  bounties: true,
  summonWithGems: true,
  events: true,
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
export const SOURCES = ['offline', 'fast_rewards', 'campaign', 'tower', 'bounties', 'quests', 'achievements', 'events', 'mail', 'heroes', 'summon'] as const;
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
  /** Осколки сюжетных героев по источникам. */
  shardsIn: Partial<Record<Source, number>>;
  /** События новичка: когда получена каждая награда (день модели, час от начала). */
  eventClaims: { kind: 'login' | 'newbie_task' | 'newbie_chest' | 'mail'; id: string; day: number; t: number }[];
  /** Активных минут всего. */
  activeMinutes: number;
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
  shardsIn: BalanceResult['shardsIn'] = {};
  eventClaims: BalanceResult['eventClaims'] = [];
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
    this.save = newGame(ctx, 0, model.startDate);
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
    const shards = (x: SaveState) => Object.values(x.shards).reduce((a, n) => a + n, 0);
    const dShards = shards(next) - shards(this.save);
    if (dShards > 0) this.shardsIn[source] = (this.shardsIn[source] ?? 0) + dShards;
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
   * Карточки (через act* — засчитываются заданиям и достижениям): Таверна (бесплатный призыв, свитки, при
   * summonWithGems — ×10 за гемы), вознесение (сначала отряд; сюжетные — осколками, призывные — самым слабым кормом),
   * «Улучшить» — по уровню самому низкому герою отряда, пока хватает опыта пула и золота.
   */
  develop(): void {
    const st = summonStatus(this.save, this.day, this.ctx);
    if (st.unlocked) {
      if (st.can.free) this.pull(1, 'free');
      while (this.save.currency.scrolls >= 10) this.pull(10, 'scroll');
      if (this.model.summonWithGems) while (this.save.currency.gems >= this.ctx.summon.costs.ten) this.pull(10, 'gems');
      while (this.save.currency.scrolls > 0) this.pull(1, 'scroll');
    }
    // Вознесение: сначала герои отряда (лучшее применение золота), остальные — только если золота с запасом ×3.
    for (let guard = 0; guard < 50; guard++) {
      const squad = new Set(this.save.squad.filter((id): id is string => id !== null));
      const ready = (h: SaveState['heroes'][number]) => {
        const req = ascendRequirement(this.save, h.id, this.ctx);
        if (!req || req.blockers.length > 0) return false;
        if (req.fodder.length > 0 && !autoFodder(this.save, h.id, this.ctx)) return false;
        return squad.has(h.id) || this.save.resources.gold >= 3 * req.gold;
      };
      const hero = [...this.save.heroes].sort((a, b) => Number(squad.has(b.id)) - Number(squad.has(a.id))).find(ready);
      if (!hero) break;
      const r = actAscend(this.save, this.day, hero.id, autoFodder(this.save, hero.id, this.ctx) ?? [], this.ctx);
      this.step('heroes', r.save);
      const e = r.events.find((x) => x.type === 'ascended');
      this.spendTime(this.model.ascendSec * 1000);
      if (e && e.type === 'ascended') this.ascensions.push({ day: this.dayNo, t: this.t, active_min: this.activeMin, heroId: hero.id, templateId: hero.templateId, rarity: e.to });
      this.save = { ...this.save, squad: autoFormation(this.save, this.ctx) };
    }
    this.levelSquad();
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
      const f = autoFormation(this.save, this.ctx);
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
          if (it.equippedBy !== null || tried.has(it.itemId)) continue;
          tried.add(it.itemId);
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
    this.save = { ...this.save, squad: autoFormation(this.save, this.ctx) };
    this.develop();
    this.autoEquip();
    this.save = { ...this.save, squad: autoFormation(this.save, this.ctx) };
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

  claimBounties(): void {
    for (const b of this.save.bounties.active) {
      if (this.now >= b.endsAt) this.step('bounties', claimBounty(this.save, b.id, this.now, this.ctx).save);
    }
  }

  /** Доска на сегодня; поручения по убыванию ценности (гем = 10 золота), группа — из свободных героев вне отряда первыми. */
  startBounties(): void {
    this.save = ensureBoard(this.save, this.day, this.model.seedBase, this.ctx);
    const value = (b: { rewards: { gold: number; gems: number } }) => b.rewards.gold + 10 * b.rewards.gems;
    const board = [...this.save.bounties.board].sort((a, b) => value(b) - value(a) || (a.id < b.id ? -1 : 1));
    for (const b of board) {
      const busy = new Set(busyHeroes(this.save));
      const idle = this.save.heroes.filter((h) => !busy.has(h.id));
      if (idle.length < b.heroCount) continue;
      const group: string[] = [];
      if (b.role) {
        const r = idle.find((h) => heroRole(h, this.ctx) === b.role);
        if (!r) continue;
        group.push(r.id);
      }
      for (const h of idle) if (group.length < b.heroCount && !group.includes(h.id)) group.push(h.id);
      this.save = startBounty(this.save, b.id, group, this.now, this.ctx);
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
      const qs = questStatus(this.save, this.ctx, this.day);
      for (const q of qs.quests) {
        if (q.done && !q.claimed) {
          this.step('quests', claimQuest(this.save, this.day, q.id, this.ctx).save);
          this.questClaims[q.id] = (this.questClaims[q.id] ?? 0) + 1;
          changed = true;
        }
      }
      for (const m of questStatus(this.save, this.ctx, this.day).milestones) {
        if (m.reached && !m.claimed) {
          this.step('quests', claimActivity(this.save, this.day, m.points, this.ctx).save);
          this.milestoneClaims[m.points] = (this.milestoneClaims[m.points] ?? 0) + 1;
          changed = true;
        }
      }
      for (const a of achievementStatus(this.save, this.ctx)) {
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
  const lastChapter = ctx.content.stages[ctx.content.stages.length - 1]?.chapter ?? '';
  const battleMs = (duration: number) => Math.round((duration / model.battleSpeed + model.battleOverheadSec) * 1000);
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
      sim.sessionLevelUps = 0;
      sim.claimOffline();
      if (model.bounties) sim.claimBounties();
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
          firstClears.push({ stageId, day, session, time_h: Math.round(sim.t * 100) / 100, attempts: stageAttempts.get(stageId)!, active_min: sim.activeMin });
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

      if (model.bounties) {
        sim.claimBounties();
        sim.startBounties();
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
    shardsIn: sim.shardsIn,
    eventClaims: sim.eventClaims,
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
export function perDay(res: BalanceResult): { day: number; date: string; tower_floor: number; cleared_count: number; gold: number; gems: number; stage_reached: string; rarities: string; avg_level: number; summons: number }[] {
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
 * (2–6 сессий в день, разные seed) → по каждому этапу мощь отряда при последнем поражении и первой победе (доля от
 * stagePower). Порог — середина между ними; предложение = порог × margin (с мощью ≥ рекомендуемой почти всегда победа).
 * Этапы без поражений не подбираются (порог неизвестен — только верхняя оценка).
 */
export function fitRecommended(
  ctx: FullContext,
  days = 8,
  margin = 1.03,
): { stageId: string; loss: number; win: number; threshold: number; suggested: number; current: number; n: number }[] {
  const per = new Map<string, { lo: number[]; hi: number[] }>();
  for (const sessionsPerDay of [2, 3, 4, 6]) {
    for (const seedBase of [1, 1000, 2000]) {
      const res = runBalance(ctx, days, { ...PLAYER_MODEL, sessionsPerDay, hoursBetweenSessions: sessionsPerDay >= 6 ? 2.5 : 4, seedBase });
      for (const s of ctx.content.stages) {
        const bs = res.battles.filter((b) => b.kind === 'stage' && b.target === s.id);
        const win = bs.find((b) => b.win);
        const losses = bs.filter((b) => !b.win);
        if (!win || !losses.length) continue;
        const sp = stagePower(s.id, ctx);
        const r = per.get(s.id) ?? { lo: [], hi: [] };
        r.lo.push(Math.max(...losses.map((b) => b.squadPower)) / sp);
        r.hi.push(win.squadPower / sp);
        per.set(s.id, r);
      }
    }
  }
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const out = [];
  for (const s of ctx.content.stages) {
    const r = per.get(s.id);
    if (!r) continue;
    const loss = med(r.lo);
    const win = med(r.hi);
    const threshold = (loss + Math.min(win, loss * 1.3)) / 2;
    const current = recommendedPower(s.id, ctx) / stagePower(s.id, ctx);
    out.push({ stageId: s.id, loss, win, threshold, suggested: Math.round(threshold * margin * 100) / 100, current: Math.round(current * 100) / 100, n: r.lo.length });
  }
  return out;
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
