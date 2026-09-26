/**
 * Модель игрока для инструмента баланса (T7). Только вызовы ядра — правила здесь не повторяются.
 * Меняйте PLAYER_MODEL (или передавайте свой конфиг в runBalance) — игровые данные не трогаем.
 */
import {
  availableJobChanges,
  buildUnit,
  changeJob,
  claimOffline,
  enemySquad,
  getJob,
  newGame,
  playStage,
  stageStatus,
  type GameContext,
  type SaveState,
  type UnitDef,
} from '../../src/core';

export interface PlayerModel {
  /** Сессий в день. */
  sessionsPerDay: number;
  /** Час первой сессии дня (от полуночи). */
  firstSessionHour: number;
  /** Часов между сессиями внутри дня (ночь — остаток суток). */
  hoursBetweenSessions: number;
  /** Сколько поражений за сессию игрок терпит, прежде чем закрыть игру и ждать офлайн. */
  maxLossesPerSession: number;
  /**
   * Желаемая роль героя по слоту отряда (0–1 фронт, 2–4 тыл). При смене профессии берётся
   * первая по алфавиту профессия нужной роли, если её нет — первая по алфавиту из доступных.
   */
  roleBySlot: string[];
  /** Сдвиг seed боя: seed = seedBase + save.battleSeq. */
  seedBase: number;
}

export const PLAYER_MODEL: PlayerModel = {
  sessionsPerDay: 4,
  firstSessionHour: 8,
  hoursBetweenSessions: 4,
  maxLossesPerSession: 3,
  roleBySlot: ['tank', 'tank', 'damage', 'damage', 'healer'],
  seedBase: 1,
};

export const CSV_COLUMNS = [
  'day',
  'session',
  'time_h',
  'stage_reached',
  'cleared_count',
  'attempts',
  'wins',
  'losses',
  'gold',
  'squad_power',
  'next_stage_power',
  'avg_job_level',
  'jobs',
] as const;

export interface SessionRow {
  day: number;
  session: number;
  time_h: number;
  /** Следующий открытый этап (где игрок остановился) или "done", если кампания пройдена. */
  stage_reached: string;
  cleared_count: number;
  attempts: number;
  wins: number;
  losses: number;
  gold: number;
  squad_power: number;
  next_stage_power: number;
  avg_job_level: number;
  jobs: string;
}

export interface FirstClear {
  stageId: string;
  day: number;
  session: number;
  time_h: number;
  /** Сколько боёв (всего, с победой) ушло на этап. */
  attempts: number;
}

export interface BalanceResult {
  rows: SessionRow[];
  firstClears: FirstClear[];
  save: SaveState;
  /** Боёв на каждом этапе (до первой победы включительно). */
  stageAttempts: Record<string, number>;
}

const HOUR = 3_600_000;

/**
 * Прокси силы отряда: Σ hp × atk / 1000 по живым слотам (округление до целого).
 * Грубая оценка «сколько урона вынесет × сколько нанесёт»; def, spd и навыки не учитываются.
 * Одна и та же формула для героев и для врагов, чтобы колонки можно было сравнивать.
 */
export function squadPower(units: (UnitDef | null)[]): number {
  let p = 0;
  for (const u of units) if (u) p += u.stats.hp * u.stats.atk;
  return Math.round(p / 1000);
}

/** Следующий открытый (ещё не пройденный) этап или null, если всё пройдено. */
export function nextOpenStage(save: SaveState, ctx: GameContext): string | null {
  for (const s of ctx.content.stages) if (stageStatus(save, s.id, ctx) === 'open') return s.id;
  return null;
}

/** Сменить профессии всем героям, у кого есть переход (политика — PlayerModel.roleBySlot). */
export function applyJobChanges(save: SaveState, ctx: GameContext, model: PlayerModel): SaveState {
  const heroes = save.heroes.map((hero) => {
    let h = hero;
    // Цикл — на случай, если после смены сразу доступна следующая (при resetJobLevel = false).
    for (let guard = 0; guard < 5; guard++) {
      const options = availableJobChanges(h, ctx);
      if (options.length === 0) break;
      const slot = save.squad.indexOf(h.id);
      const wantRole = slot >= 0 ? model.roleBySlot[slot] : undefined;
      const pick = options.find((j) => getJob(ctx, j).role === wantRole) ?? options[0];
      h = changeJob(h, pick, ctx).hero;
    }
    return h;
  });
  return { ...save, heroes };
}

function heroUnits(save: SaveState, ctx: GameContext): (UnitDef | null)[] {
  return save.squad.map((id) => {
    const h = id ? save.heroes.find((x) => x.id === id) : undefined;
    return h ? buildUnit(h, ctx) : null;
  });
}

/** Прогнать модель игрока на days дней. Детерминирована: одинаковые входы — одинаковый результат. */
export function runBalance(ctx: GameContext, days: number, model: PlayerModel = PLAYER_MODEL): BalanceResult {
  let save = newGame(ctx, 0);
  const rows: SessionRow[] = [];
  const firstClears: FirstClear[] = [];
  const stageAttempts = new Map<string, number>();

  for (let day = 1; day <= days; day++) {
    for (let session = 1; session <= model.sessionsPerDay; session++) {
      const time_h = (day - 1) * 24 + model.firstSessionHour + (session - 1) * model.hoursBetweenSessions;
      save = claimOffline(save, time_h * HOUR, ctx).save;
      save = applyJobChanges(save, ctx, model);

      let wins = 0;
      let losses = 0;
      for (;;) {
        const stageId = nextOpenStage(save, ctx);
        if (!stageId || losses >= model.maxLossesPerSession) break;
        const out = playStage(save, stageId, model.seedBase + save.battleSeq, ctx);
        save = out.save;
        stageAttempts.set(stageId, (stageAttempts.get(stageId) ?? 0) + 1);
        if (out.result.winner === 'A') {
          wins++;
          firstClears.push({ stageId, day, session, time_h, attempts: stageAttempts.get(stageId)! });
          save = applyJobChanges(save, ctx, model);
        } else {
          losses++;
        }
      }

      const next = nextOpenStage(save, ctx);
      const heroes = save.squad.map((id) => save.heroes.find((h) => h.id === id)).filter((h) => !!h);
      rows.push({
        day,
        session,
        time_h,
        stage_reached: next ?? 'done',
        cleared_count: save.campaign.cleared.length,
        attempts: wins + losses,
        wins,
        losses,
        gold: save.resources.gold,
        squad_power: squadPower(heroUnits(save, ctx)),
        next_stage_power: next ? squadPower(enemySquad(next, ctx)) : 0,
        avg_job_level: Math.round((heroes.reduce((a, h) => a + h.jobLevel, 0) / Math.max(1, heroes.length)) * 10) / 10,
        jobs: heroes.map((h) => h.job).join('|'),
      });
    }
  }
  return { rows, firstClears, save, stageAttempts: Object.fromEntries(stageAttempts) };
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
