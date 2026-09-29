import { syncAchievementCounters } from '../meta/achievements';
import type { GameContext } from '../progression/types';
import { DayStringSchema, type EventsState, type RewardBundle, type SaveState } from '../save/schema';
import { deliverSystemMail } from './mail';
import { EventError, grantRewards, type EventRewardEvent } from './rewards';
import { EventsConfigSchema, type EventsConfig, type NewbieTask } from './schema';

/** GameContext + data/events.json. */
export interface EventsContext extends GameContext {
  events: EventsConfig;
}

/** Разобрать data/events.json (ядро файлы не читает). Ошибка → EventError('invalid_config') с путём до поля. */
export function parseEventsConfig(json: unknown): EventsConfig {
  const r = EventsConfigSchema.safeParse(json);
  if (!r.success) {
    const msg = r.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.length ? i.path.map(String).join('.') : '(корень)'}: ${i.message}`)
      .join('; ');
    throw new EventError('invalid_config', `data/events.json: ${msg}`);
  }
  return r.data;
}

/** Перекрёстные проверки data/events.json с контентом: карточки героев в наградах существуют. */
export function validateEventsConfig(cfg: EventsConfig, ctx: GameContext, problems: string[]): void {
  const check = (where: string, r: RewardBundle) => {
    for (const t of r.heroes ?? []) if (!ctx.content.heroes[t]) problems.push(`data/events.json: ${where}: карточки героя «${t}» нет в data/heroes`);
  };
  cfg.login.days.forEach((d, i) => check(`login.days[${i}]`, d.rewards));
  cfg.newbie.milestones.forEach((m, i) => check(`newbie.milestones[${i}]`, m.rewards));
  cfg.mail.letters.forEach((l) => {
    check(`mail.letters ${l.id}`, l.rewards);
    if (l.onlyIfCleared && !ctx.content.stages.some((s) => s.id === l.onlyIfCleared))
      problems.push(`data/events.json: mail.letters ${l.id}: onlyIfCleared — этапа ${l.onlyIfCleared} нет в data/campaign`);
  });
}

/** ctx → ctx + events. */
export function withEvents<C extends GameContext>(ctx: C, json: unknown): C & EventsContext {
  return { ...ctx, events: parseEventsConfig(json) };
}

function assertDay(day: string): void {
  if (!DayStringSchema.safeParse(day).success) throw new EventError('invalid_day', `Неверный день: ${JSON.stringify(day)} (нужно YYYY-MM-DD)`);
}

/** Номер дня 'YYYY-MM-DD' от 1970-01-01 (григорианский календарь, чистая арифметика — без Date). */
export function dayNumber(day: string): number {
  let y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10));
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Дней от a до b (b − a). */
export function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

/** Состояние событий на день day (ещё не начинались — как будто начались сегодня). */
function stateOf(save: SaveState, day: string): EventsState {
  return save.events ?? { startDay: day, lastDay: day, loginDays: 1, loginClaimed: [], newbieTasks: [], newbieMilestones: [] };
}

/**
 * Игрок открыл игру в день day (UI зовёт при каждом показе главной, экранов событий и почты).
 * - события ещё не начинались → старт: день 1 входа и «7 дней новичка» с этого дня;
 * - day новее последнего засчитанного → +1 день входа (пропущенные дни не сбрасывают счёт, как в AFK);
 * - тот же день или раньше (часы переведены назад) → вход не засчитывается.
 * Заодно доставляет системные письма data/events.json → mail.letters, которых у игрока ещё не было
 * (первое открытие — «Добро пожаловать»). Ничего не изменилось — тот же объект save. Чистая функция.
 */
export function touchEvents(save: SaveState, day: string, ctx: EventsContext): SaveState {
  assertDay(day);
  let s = save;
  const ev = save.events;
  if (!ev) s = { ...s, events: stateOf(save, day) };
  else if (day > ev.lastDay) s = { ...s, events: { ...ev, lastDay: day, loginDays: ev.loginDays + 1 } };
  return deliverSystemMail(s, day, ctx);
}

// ---------- «Вход 7 дней» ----------

export interface LoginDayView {
  /** Номер дня 1…N. */
  day: number;
  rewards: RewardBundle;
  label?: string;
  /** День входа уже наступил (игрок открывал игру столько разных дней). */
  reached: boolean;
  claimed: boolean;
  /** Можно забрать сейчас. */
  ready: boolean;
}

export interface LoginStatus {
  name: string;
  /** Засчитано дней входа (не больше числа дней календаря). */
  loginDays: number;
  days: LoginDayView[];
  /** Сколько дней можно забрать сейчас (красный кружок). */
  claimable: number;
  /** Все награды получены — календарь закончен. */
  done: boolean;
}

export function loginStatus(save: SaveState, day: string, ctx: EventsContext): LoginStatus {
  const ev = stateOf(save, day);
  const cfg = ctx.events.login;
  const days = cfg.days.map((d, i): LoginDayView => {
    const n = i + 1;
    const reached = n <= ev.loginDays;
    const claimed = ev.loginClaimed.includes(n);
    return { day: n, rewards: d.rewards, ...(d.label ? { label: d.label } : {}), reached, claimed, ready: reached && !claimed };
  });
  return {
    name: cfg.name,
    loginDays: Math.min(ev.loginDays, cfg.days.length),
    days,
    claimable: days.filter((d) => d.ready).length,
    done: days.every((d) => d.claimed),
  };
}

/**
 * Забрать награду дня входа n (1…N). Сначала touchEvents(day). Порядок не важен — любой наступивший день.
 * EventError: unknown_login_day, login_locked, login_claimed.
 */
export function claimLogin(save: SaveState, day: string, n: number, ctx: EventsContext): { save: SaveState; rewards: RewardBundle; events: EventRewardEvent[] } {
  const s = touchEvents(save, day, ctx);
  const ev = s.events!;
  const def = ctx.events.login.days[n - 1];
  if (!def || !Number.isInteger(n)) throw new EventError('unknown_login_day', `Нет дня входа ${n}`);
  if (ev.loginClaimed.includes(n)) throw new EventError('login_claimed', `Награда дня ${n} уже получена`);
  if (n > ev.loginDays) throw new EventError('login_locked', `День ${n} ещё не наступил: заходите в игру каждый день (сейчас дней входа: ${ev.loginDays})`);
  const out = grantRewards({ ...s, events: { ...ev, loginClaimed: [...ev.loginClaimed, n].sort((a, b) => a - b) } }, def.rewards, ctx, `login_${n}`);
  return { save: syncAchievementCounters(out.save), rewards: def.rewards, events: out.events };
}

// ---------- «7 дней новичка» ----------

export interface NewbieTaskView extends NewbieTask {
  /** День события, в который задание открылось (1…). */
  day: number;
  progress: number;
  done: boolean;
  claimed: boolean;
  /** День задания ещё не наступил. */
  locked: boolean;
  ready: boolean;
}

export interface NewbieMilestoneView {
  points: number;
  rewards: RewardBundle;
  reached: boolean;
  claimed: boolean;
  ready: boolean;
}

export interface NewbieStatus {
  name: string;
  /** День события сегодня (1 — день старта); после конца — больше durationDays. */
  eventDay: number;
  durationDays: number;
  /** Событие идёт (задания открываются). */
  active: boolean;
  /** Можно забирать (идёт или льготный день после конца). */
  open: boolean;
  /** Полных дней до конца (0 — последний день); после конца — 0. */
  daysLeft: number;
  /** Дней до закрытия (с учётом льготных); 0 — закрыто. */
  closesIn: number;
  days: { day: number; locked: boolean; tasks: NewbieTaskView[] }[];
  points: number;
  maxPoints: number;
  milestones: NewbieMilestoneView[];
  /** Сколько заданий и сундуков можно забрать сейчас. */
  claimable: number;
  /** Всё получено. */
  done: boolean;
}

export function newbieStatus(save: SaveState, day: string, ctx: EventsContext): NewbieStatus {
  assertDay(day);
  const ev = stateOf(save, day);
  const cfg = ctx.events.newbie;
  const eventDay = Math.max(1, daysBetween(ev.startDay, day) + 1);
  const active = eventDay <= cfg.durationDays;
  const open = eventDay <= cfg.durationDays + cfg.graceDays;
  const counters = syncAchievementCounters(save).achievements.counters;
  const claimedTasks = new Set(ev.newbieTasks);
  const tasks = new Map<string, NewbieTask>();
  const days = cfg.days.map((d, i) => {
    const n = i + 1;
    const locked = n > eventDay;
    return {
      day: n,
      locked,
      tasks: d.tasks.map((t): NewbieTaskView => {
        tasks.set(t.id, t);
        const raw = counters[t.counter] ?? 0;
        const done = raw >= t.target;
        const claimed = claimedTasks.has(t.id);
        return { ...t, day: n, progress: Math.min(raw, t.target), done, claimed, locked, ready: open && !locked && done && !claimed };
      }),
    };
  });
  const points = ev.newbieTasks.reduce((a, id) => a + (tasks.get(id)?.points ?? 0), 0);
  const milestones = cfg.milestones.map((m): NewbieMilestoneView => {
    const reached = points >= m.points;
    const claimed = ev.newbieMilestones.includes(m.points);
    return { points: m.points, rewards: m.rewards, reached, claimed, ready: open && reached && !claimed };
  });
  const all = days.flatMap((d) => d.tasks);
  return {
    name: cfg.name,
    eventDay,
    durationDays: cfg.durationDays,
    active,
    open,
    daysLeft: Math.max(0, cfg.durationDays - eventDay),
    closesIn: open ? cfg.durationDays + cfg.graceDays - eventDay + 1 : 0,
    days,
    points,
    maxPoints: all.reduce((a, t) => a + t.points, 0),
    milestones,
    claimable: all.filter((t) => t.ready).length + milestones.filter((m) => m.ready).length,
    done: all.every((t) => t.claimed) && milestones.every((m) => m.claimed),
  };
}

function assertOpen(st: NewbieStatus): void {
  if (!st.open) throw new EventError('event_over', `Событие «${st.name}» закончилось`);
}

/**
 * Забрать очки выполненного задания «7 дней новичка». Сначала touchEvents(day).
 * EventError: event_over, unknown_task, task_locked, task_not_done, task_claimed.
 */
export function claimNewbieTask(save: SaveState, day: string, taskId: string, ctx: EventsContext): { save: SaveState; points: number } {
  const s = touchEvents(save, day, ctx);
  const st = newbieStatus(s, day, ctx);
  const t = st.days.flatMap((d) => d.tasks).find((x) => x.id === taskId);
  if (!t) throw new EventError('unknown_task', `Неизвестное задание: ${taskId}`);
  if (t.claimed) throw new EventError('task_claimed', `Очки за «${t.name}» уже получены`);
  assertOpen(st);
  if (t.locked) throw new EventError('task_locked', `Задание откроется на ${t.day}-й день события`);
  if (!t.done) throw new EventError('task_not_done', `Задание «${t.name}» ещё не выполнено (${t.progress}/${t.target})`);
  const ev = s.events!;
  return { save: { ...s, events: { ...ev, newbieTasks: [...ev.newbieTasks, t.id] } }, points: t.points };
}

/**
 * Забрать сундук «7 дней новичка» за порог очков points. Сначала touchEvents(day).
 * EventError: event_over, unknown_milestone, milestone_not_reached, milestone_claimed.
 */
export function claimNewbieMilestone(save: SaveState, day: string, points: number, ctx: EventsContext): { save: SaveState; rewards: RewardBundle; events: EventRewardEvent[] } {
  const s = touchEvents(save, day, ctx);
  const st = newbieStatus(s, day, ctx);
  const m = st.milestones.find((x) => x.points === points);
  if (!m) throw new EventError('unknown_milestone', `Нет награды за ${points} очков`);
  if (m.claimed) throw new EventError('milestone_claimed', `Награда за ${points} очков уже получена`);
  assertOpen(st);
  if (!m.reached) throw new EventError('milestone_not_reached', `Нужно ${points} очков, сейчас ${st.points}`);
  const ev = s.events!;
  const out = grantRewards({ ...s, events: { ...ev, newbieMilestones: [...ev.newbieMilestones, points].sort((a, b) => a - b) } }, m.rewards, ctx, `newbie_${points}`);
  return { save: syncAchievementCounters(out.save), rewards: m.rewards, events: out.events };
}

/** Красные кружки главной: сколько можно забрать во «Входе», в «Новичке» (0, если закрыт) и есть ли что показывать. */
export function eventsBadges(save: SaveState, day: string, ctx: EventsContext): { login: number; newbie: number; loginVisible: boolean; newbieVisible: boolean } {
  const l = loginStatus(save, day, ctx);
  const n = newbieStatus(save, day, ctx);
  return { login: l.claimable, newbie: n.open ? n.claimable : 0, loginVisible: !l.done, newbieVisible: n.open && !n.done };
}

