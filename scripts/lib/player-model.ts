/**
 * Модель игрока для инструмента баланса (T7, v2 — пакет L). Только вызовы ядра (обёртки act* и функции K1–K10) —
 * правила здесь не повторяются. Меняйте PLAYER_MODEL (или передавайте свой конфиг в runBalance) — игровые данные не трогаем.
 */
import {
  achievementStatus,
  actChangeJob,
  actClaimOffline,
  actClimbTower,
  actEquip,
  actPlayStage,
  actUseFastRewards,
  autoFormation,
  availableJobChanges,
  busyHeroes,
  canEquip,
  claimAchievement,
  claimActivity,
  claimBounty,
  claimQuest,
  ensureBoard,
  equip,
  fastRewardsPreview,
  fastRewardsStatus,
  getJob,
  getStage,
  heroPower,
  newGame,
  questStatus,
  squadPower,
  stagePower,
  stageStatus,
  startBounty,
  towerUnlocked,
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
  /** Сколько поражений в кампании за сессию игрок терпит, прежде чем перейти к башне. */
  maxLossesPerSession: number;
  /** Башня: не больше стольких штурмов за сессию… */
  towerMaxAttemptsPerSession: number;
  /** …и не больше стольких поражений. */
  towerMaxLossesPerSession: number;
  /**
   * Сколько раз в день брать быстрые награды: сначала бесплатные, дальше — за гемы по fastRewards.gemCosts
   * (только если гемов хватает). 1 — только бесплатная (при freePerDay = 1).
   */
  fastRewardsPerDay: number;
  /** Отправлять героев на поручения. */
  bounties: boolean;
  /**
   * Желаемая роль героя h1…h5 при смене профессии. Берётся первая по алфавиту профессия нужной роли,
   * если её нет — первая по алфавиту из доступных. (Привязка к герою, а не к слоту: слоты меняет autoFormation.)
   */
  roleByHero: string[];
  /** Сдвиг seed: seed боя = seedBase + save.battleSeq; seed доски поручений = seedBase. */
  seedBase: number;
  /** Календарный день первого дня симуляции, 'YYYY-MM-DD'. */
  startDate: string;
}

export const PLAYER_MODEL: PlayerModel = {
  sessionsPerDay: 4,
  firstSessionHour: 8,
  hoursBetweenSessions: 4,
  maxLossesPerSession: 3,
  towerMaxAttemptsPerSession: 10,
  towerMaxLossesPerSession: 2,
  fastRewardsPerDay: 1,
  bounties: true,
  roleByHero: ['tank', 'tank', 'damage', 'damage', 'healer'],
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
  'items',
  'squad_power',
  'next_stage_power',
  'avg_job_level',
  'jobs',
  'quests_claimed',
  'bounties_done',
] as const;

export interface SessionRow {
  day: number;
  /** Календарный день 'YYYY-MM-DD'. */
  date: string;
  session: number;
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
  /** Предметов в инвентаре (надетые + лежащие). */
  items: number;
  /** Мощь отряда (core squadPower, с экипировкой). */
  squad_power: number;
  /** Мощь врагов stage_reached (core stagePower); 0, если всё пройдено. */
  next_stage_power: number;
  avg_job_level: number;
  jobs: string;
  /** Всего получено наград заданий (накопительно). */
  quests_claimed: number;
  /** Всего выполнено поручений (накопительно). */
  bounties_done: number;
}

export interface FirstClear {
  stageId: string;
  day: number;
  session: number;
  time_h: number;
  /** Сколько боёв (всего, с победой) ушло на этап. */
  attempts: number;
}

/** Источники доходов/расходов золота и гемов. */
export const SOURCES = ['offline', 'fast_rewards', 'campaign', 'tower', 'bounties', 'quests', 'achievements'] as const;
export type Source = (typeof SOURCES)[number];
export type Ledger = Record<Source, { gold: number; gems: number }>;

export interface BalanceResult {
  model: PlayerModel;
  rows: SessionRow[];
  firstClears: FirstClear[];
  save: SaveState;
  /** Боёв на каждом этапе (до первой победы включительно). */
  stageAttempts: Record<string, number>;
  /** Доход по источникам. */
  income: Ledger;
  /** Расход по источникам (сейчас только гемы на платные быстрые награды). */
  spend: Ledger;
  /** Сколько раз получена награда каждого задания. */
  questClaims: Record<string, number>;
  /** Сколько дней выполнен каждый порог активности. */
  milestoneClaims: Record<string, number>;
  /** Штурмов каждого этажа башни (до победы включительно). */
  towerAttempts: Record<number, number>;
  /** Сколько раз надевались предметы. */
  equips: number;
  /** Смены профессий: [день, герой, профессия]. */
  jobChanges: { day: number; heroId: string; job: string }[];
}

const HOUR = 3_600_000;

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
  return Object.fromEntries(SOURCES.map((s) => [s, { gold: 0, gems: 0 }])) as Ledger;
}

/** Одна симуляция: состояние + учёт. Все шаги — через функции ядра. */
class Sim {
  save: SaveState;
  income = emptyLedger();
  spend = emptyLedger();
  questClaims: Record<string, number> = {};
  milestoneClaims: Record<string, number> = {};
  equips = 0;
  jobChanges: BalanceResult['jobChanges'] = [];
  dayNo = 1;
  day: string;

  constructor(
    public ctx: FullContext,
    public model: PlayerModel,
  ) {
    this.day = model.startDate;
    this.save = newGame(ctx, 0, model.startDate);
  }

  /** Применить шаг и разнести изменение золота/гемов по источнику. */
  step(source: Source, next: SaveState): void {
    const dg = next.resources.gold - this.save.resources.gold;
    const dm = next.currency.gems - this.save.currency.gems;
    if (dg > 0) this.income[source].gold += dg;
    else this.spend[source].gold -= dg;
    if (dm > 0) this.income[source].gems += dm;
    else this.spend[source].gems -= dm;
    this.save = next;
  }

  /** Смена профессий по roleByHero (через actChangeJob — засчитывается заданию и достижениям). */
  changeJobs(): void {
    this.save.heroes.forEach((_, i) => {
      for (let guard = 0; guard < 5; guard++) {
        const hero = this.save.heroes[i];
        const options = availableJobChanges(hero, this.ctx);
        if (options.length === 0) break;
        const want = this.model.roleByHero[i];
        const pick = options.find((j) => getJob(this.ctx, j).role === want) ?? options[0];
        this.save = actChangeJob(this.save, this.day, hero.id, pick, this.ctx).save;
        this.jobChanges.push({ day: this.dayNo, heroId: hero.id, job: pick });
      }
    });
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

  /** Профессии → экипировка → авто-расстановка. */
  prepare(): void {
    this.changeJobs();
    this.autoEquip();
    this.save = { ...this.save, squad: autoFormation(this.save, this.ctx) };
  }

  claimOffline(now: number): void {
    this.step('offline', actClaimOffline(this.save, now, this.day, this.ctx).save);
  }

  fastRewards(): void {
    for (let guard = 0; guard < 100; guard++) {
      const st = fastRewardsStatus(this.save, this.day, this.ctx);
      if (st.used >= this.model.fastRewardsPerDay || st.nextCost === null || st.nextCost > this.save.currency.gems) break;
      const preview = fastRewardsPreview(this.save, this.ctx);
      if (preview.gold <= 0 && preview.jobExp <= 0) break;
      this.step('fast_rewards', actUseFastRewards(this.save, this.day, this.ctx).save);
    }
  }

  claimBounties(now: number): void {
    for (const b of this.save.bounties.active) {
      if (now >= b.endsAt) this.step('bounties', claimBounty(this.save, b.id, now, this.ctx).save);
    }
  }

  /** Доска на сегодня; поручения по убыванию ценности (гем = 10 золота), группа — из свободных героев. */
  startBounties(now: number): void {
    this.save = ensureBoard(this.save, this.day, this.model.seedBase, this.ctx);
    const value = (b: { rewards: { gold: number; gems: number } }) => b.rewards.gold + 10 * b.rewards.gems;
    const board = [...this.save.bounties.board].sort((a, b) => value(b) - value(a) || (a.id < b.id ? -1 : 1));
    for (const b of board) {
      const busy = new Set(busyHeroes(this.save));
      const idle = this.save.heroes.filter((h) => !busy.has(h.id));
      if (idle.length < b.heroCount) continue;
      const group: string[] = [];
      if (b.role) {
        const r = idle.find((h) => getJob(this.ctx, h.job).role === b.role);
        if (!r) continue;
        group.push(r.id);
      }
      for (const h of idle) if (group.length < b.heroCount && !group.includes(h.id)) group.push(h.id);
      this.save = startBounty(this.save, b.id, group, now, this.ctx);
    }
  }

  /** Задания, пороги активности и достижения — всё, что можно забрать. */
  claimRewards(): void {
    for (let guard = 0; guard < 10; guard++) {
      let changed = false;
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
}

/** Прогнать модель игрока на days дней. Детерминирована: одинаковые входы — одинаковый результат. */
export function runBalance(ctx: FullContext, days: number, model: PlayerModel = PLAYER_MODEL): BalanceResult {
  const sim = new Sim(ctx, model);
  const rows: SessionRow[] = [];
  const firstClears: FirstClear[] = [];
  const stageAttempts = new Map<string, number>();
  const towerByFloor = new Map<number, number>();
  const lastChapter = ctx.content.stages[ctx.content.stages.length - 1]?.chapter ?? '';

  for (let day = 1; day <= days; day++) {
    sim.dayNo = day;
    sim.day = dateOf(model.startDate, day);
    for (let session = 1; session <= model.sessionsPerDay; session++) {
      const time_h = (day - 1) * 24 + model.firstSessionHour + (session - 1) * model.hoursBetweenSessions;
      const now = time_h * HOUR;
      sim.claimOffline(now);
      if (model.bounties) sim.claimBounties(now);
      sim.fastRewards();
      sim.claimRewards();
      sim.prepare();

      // Кампания.
      let wins = 0;
      let losses = 0;
      for (;;) {
        const stageId = nextOpenStage(sim.save, ctx);
        if (!stageId || losses >= model.maxLossesPerSession) break;
        const out = actPlayStage(sim.save, sim.day, stageId, model.seedBase + sim.save.battleSeq, ctx);
        sim.step('campaign', out.save);
        stageAttempts.set(stageId, (stageAttempts.get(stageId) ?? 0) + 1);
        if (out.result.winner === 'A') {
          wins++;
          firstClears.push({ stageId, day, session, time_h, attempts: stageAttempts.get(stageId)! });
          sim.prepare();
        } else {
          losses++;
        }
      }

      // Башня.
      let towerAttempts = 0;
      let towerLosses = 0;
      while (
        towerUnlocked(sim.save, ctx) &&
        sim.save.tower.floor < ctx.tower.maxFloor &&
        towerAttempts < model.towerMaxAttemptsPerSession &&
        towerLosses < model.towerMaxLossesPerSession
      ) {
        const out = actClimbTower(sim.save, sim.day, model.seedBase + sim.save.battleSeq, ctx);
        sim.step('tower', out.save);
        towerByFloor.set(out.floor, (towerByFloor.get(out.floor) ?? 0) + 1);
        towerAttempts++;
        if (out.result.winner === 'A') sim.prepare();
        else towerLosses++;
      }

      if (model.bounties) {
        sim.claimBounties(now);
        sim.startBounties(now);
      }
      sim.claimRewards();
      sim.prepare();

      const s = sim.save;
      const next = nextOpenStage(s, ctx);
      const heroes = s.squad.map((id) => s.heroes.find((h) => h.id === id)).filter((h) => !!h);
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
        items: s.inventory.items.length,
        squad_power: squadPower(s, ctx),
        next_stage_power: next ? stagePower(next, ctx) : 0,
        avg_job_level: Math.round((heroes.reduce((a, h) => a + h.jobLevel, 0) / Math.max(1, heroes.length)) * 10) / 10,
        jobs: heroes.map((h) => h.job).join('|'),
        quests_claimed: Object.values(sim.questClaims).reduce((a, n) => a + n, 0),
        bounties_done: s.achievements.counters.bounties_done ?? 0,
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
    jobChanges: sim.jobChanges,
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
    walls.push({ stageId: fc.stageId, hours: fc.time_h - prevH, attempts: fc.attempts, cleared: true });
    prevH = fc.time_h;
  }
  const next = nextOpenStage(res.save, ctx);
  const last = res.rows[res.rows.length - 1];
  if (next && last) {
    walls.push({ stageId: next, hours: last.time_h - prevH, attempts: res.stageAttempts[next] ?? 0, cleared: false });
  }
  return walls.sort((a, b) => b.hours - a.hours || b.attempts - a.attempts);
}

/** Этаж башни и число пройденных этапов на конец каждого дня. */
export function perDay(res: BalanceResult): { day: number; date: string; tower_floor: number; cleared_count: number; gold: number; gems: number }[] {
  const out = new Map<number, SessionRow>();
  for (const r of res.rows) out.set(r.day, r);
  return [...out.values()].map((r) => ({ day: r.day, date: r.date, tower_floor: r.tower_floor, cleared_count: r.cleared_count, gold: r.gold, gems: r.gems }));
}

export function total(ledger: Ledger): { gold: number; gems: number } {
  return SOURCES.reduce((a, s) => ({ gold: a.gold + ledger[s].gold, gems: a.gems + ledger[s].gems }), { gold: 0, gems: 0 });
}

/** Короткие наблюдения для владельца (по-русски). Эвристики — см. docs/content/balance.md. */
export function signals(res: BalanceResult, ctx: FullContext): string[] {
  const out: string[] = [];
  const days = perDay(res);
  const last = res.rows[res.rows.length - 1];
  if (!last) return out;
  const inc = total(res.income);
  const sp = total(res.spend);

  if (sp.gold === 0 && last.gold > 0) out.push(`Золото копится: ${last.gold} на руках, потратить его некуда (доход ${inc.gold}, расход 0).`);
  if (last.gems > 0 && sp.gems < inc.gems / 4) {
    out.push(`Гемы почти не тратятся: ${last.gems} на руках (доход ${inc.gems}, расход ${sp.gems}; модель берёт быстрые награды ${res.model.fastRewardsPerDay} раз(а) в день).`);
  }

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

  const maxTier = Math.max(...res.save.heroes.map((h) => getJob(ctx, h.job).tier));
  const maxLevel = Math.max(...res.save.heroes.map((h) => h.jobLevel));
  const tierLevel: Record<string, number> = ctx.progression.jobChange.tierLevel;
  const need = tierLevel[String(maxTier + 1)];
  if (need !== undefined) {
    out.push(`Профессии тира ${maxTier + 1} не открыты за ${days.length} дн.: джоб-уровень героев дошёл до ${maxLevel}, нужно ${need}.`);
  }

  const achDone = res.save.achievements.claimed.length;
  out.push(`Достижений получено: ${achDone} из ${ctx.meta.achievements.achievements.length}.`);
  return out;
}
