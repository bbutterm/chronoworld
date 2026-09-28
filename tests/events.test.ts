/**
 * События новичка и почта (src/core/events): «Вход 7 дней», «7 дней новичка», системные письма, миграция v4 → v5.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  claimAllMail,
  claimLogin,
  claimMail,
  claimNewbieMilestone,
  claimNewbieTask,
  collectGameContext,
  daysBetween,
  dayNumber,
  deleteReadMail,
  deserialize,
  EventError,
  eventsBadges,
  loginStatus,
  mailStatus,
  MAIL_MAX,
  newbieStatus,
  newGame,
  readMail,
  SAVE_VERSION,
  sendMail,
  serialize,
  touchEvents,
  trackAchievement,
  type SaveState,
} from '../src/core';
import { loadFullContext, readRawGameData } from '../scripts/lib/content-node';
import { saveProblems } from './invariants';

const ctx = loadFullContext();
const D1 = '2026-03-01';
/** День D1 + n. */
const day = (n: number) => `2026-03-${String(1 + n).padStart(2, '0')}`;
const fresh = (): SaveState => touchEvents(newGame(ctx, 0, D1), D1, ctx);

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(EventError);
    expect((e as EventError).code).toBe(code);
    return;
  }
  throw new Error(`ожидалась EventError ${code}`);
}

describe('календарь без Date', () => {
  it('dayNumber и daysBetween', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
    expect(dayNumber('1970-01-02')).toBe(1);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2); // високосный
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(dayNumber('2026-09-27')).toBe(20723);
  });
});

describe('touchEvents: день входа', () => {
  it('первое открытие — старт событий и письмо «Добро пожаловать»; тот же день — без изменений', () => {
    const s0 = newGame(ctx, 0, D1);
    expect(s0.events).toBeUndefined();
    expect(s0.mail.letters).toEqual([]);
    const s = touchEvents(s0, D1, ctx);
    expect(s.events).toEqual({ startDay: D1, lastDay: D1, loginDays: 1, loginClaimed: [], newbieTasks: [], newbieMilestones: [] });
    expect(s.mail.letters).toHaveLength(1);
    expect(s.mail.letters[0]).toMatchObject({ id: 'm1', source: 'welcome', title: 'Добро пожаловать в лагерь!', read: false, claimed: false, day: D1 });
    expect(s.mail.delivered).toEqual(['welcome']);
    expect(touchEvents(s, D1, ctx)).toBe(s);
    expect(saveProblems(s, ctx)).toEqual([]);
  });

  it('новый день +1; пропуск дней не сбрасывает и не добавляет лишнего; часы назад — не засчитываются', () => {
    let s = fresh();
    s = touchEvents(s, day(1), ctx);
    expect(s.events!.loginDays).toBe(2);
    s = touchEvents(s, day(5), ctx);
    expect(s.events!.loginDays).toBe(3);
    expect(touchEvents(s, day(2), ctx)).toBe(s);
    expect(touchEvents(s, day(5), ctx)).toBe(s);
    expect(s.events!.startDay).toBe(D1);
    expect(() => touchEvents(s, '2026-3-1', ctx)).toThrow(EventError);
  });
});

describe('«Вход 7 дней»', () => {
  it('день 1 забирается нажатием один раз; день 2 — только на следующий день', () => {
    const s = fresh();
    expect(loginStatus(s, D1, ctx).claimable).toBe(1);
    const r = claimLogin(s, D1, 1, ctx);
    const reward = ctx.events.login.days[0].rewards;
    expect(r.save.currency.scrolls).toBe(s.currency.scrolls + (reward.scrolls ?? 0));
    expect(r.save.resources.gold).toBe(s.resources.gold + (reward.gold ?? 0));
    expect(r.save.events!.loginClaimed).toEqual([1]);
    expect(loginStatus(r.save, D1, ctx).claimable).toBe(0);
    expectCode(() => claimLogin(r.save, D1, 1, ctx), 'login_claimed');
    expectCode(() => claimLogin(r.save, D1, 2, ctx), 'login_locked');
    expectCode(() => claimLogin(r.save, D1, 99, ctx), 'unknown_login_day');
    // Следующий день: claimLogin сам засчитывает вход.
    const r2 = claimLogin(r.save, day(1), 2, ctx);
    expect(r2.save.currency.gems).toBe(r.save.currency.gems + (ctx.events.login.days[1].rewards.gems ?? 0));
    expect(saveProblems(r2.save, ctx)).toEqual([]);
  });

  it('день 7 — фиолетовая карточка (значок «Новый!»); после всех дней календарь закончен', () => {
    let s = fresh();
    for (let i = 1; i < 7; i++) s = touchEvents(s, day(i * 2), ctx); // заходит через день — всё равно 7 дней входа
    expect(loginStatus(s, day(12), ctx).claimable).toBe(7);
    const before = s.heroes.length;
    for (let n = 1; n <= 7; n++) s = claimLogin(s, day(12), n, ctx).save;
    const heroId = ctx.events.login.days[6].rewards.heroes![0];
    expect(s.heroes).toHaveLength(before + 1);
    const card = s.heroes[s.heroes.length - 1];
    expect(card).toMatchObject({ templateId: heroId, rarity: ctx.content.heroes[heroId].baseRarity, level: 1, isNew: true });
    expect(card.rarity).toBe('purple');
    expect(s.summon.discovered).toContain(heroId);
    const st = loginStatus(s, day(12), ctx);
    expect(st.done).toBe(true);
    expect(eventsBadges(s, day(12), ctx).loginVisible).toBe(false);
    expect(saveProblems(s, ctx)).toEqual([]);
  });
});

describe('«7 дней новичка»', () => {
  const first = ctx.events.newbie.days[0].tasks[0];
  const second = ctx.events.newbie.days[1].tasks[0];

  it('прогресс — счётчики достижений; забрать очки один раз; задания следующих дней закрыты', () => {
    let s = fresh();
    let st = newbieStatus(s, D1, ctx);
    expect(st.eventDay).toBe(1);
    expect(st.active && st.open).toBe(true);
    expect(st.days[0].locked).toBe(false);
    expect(st.days[1].locked).toBe(true);
    expectCode(() => claimNewbieTask(s, D1, first.id, ctx), 'task_not_done');
    s = trackAchievement(s, first.counter, first.target, 'max');
    st = newbieStatus(s, D1, ctx);
    const view = st.days[0].tasks.find((t) => t.id === first.id)!;
    expect(view).toMatchObject({ progress: first.target, done: true, ready: true });
    expect(st.claimable).toBe(1);
    const r = claimNewbieTask(s, D1, first.id, ctx);
    expect(r.points).toBe(first.points);
    expect(newbieStatus(r.save, D1, ctx).points).toBe(first.points);
    expectCode(() => claimNewbieTask(r.save, D1, first.id, ctx), 'task_claimed');
    // Задание второго дня выполнено заранее, но откроется только на 2-й день события.
    const done2 = trackAchievement(r.save, second.counter, second.target, 'max');
    expectCode(() => claimNewbieTask(done2, D1, second.id, ctx), 'task_locked');
    expect(claimNewbieTask(done2, day(1), second.id, ctx).points).toBe(second.points);
    expectCode(() => claimNewbieTask(s, D1, 'nope', ctx), 'unknown_task');
  });

  it('сундуки за очки, последний — фиолетовая карточка; после конца и льготного дня — закрыто', () => {
    let s = fresh();
    // Выполнить все задания разом (счётчики — максимум целей).
    for (const d of ctx.events.newbie.days) for (const t of d.tasks) s = trackAchievement(s, t.counter, t.target, 'max');
    const last = day(ctx.events.newbie.durationDays - 1);
    const firstMilestone = ctx.events.newbie.milestones[0];
    expectCode(() => claimNewbieMilestone(s, last, firstMilestone.points, ctx), 'milestone_not_reached');
    for (const d of ctx.events.newbie.days) for (const t of d.tasks) s = claimNewbieTask(s, last, t.id, ctx).save;
    const st = newbieStatus(s, last, ctx);
    expect(st.points).toBe(st.maxPoints);
    expect(st.milestones.every((m) => m.ready)).toBe(true);
    const before = s.heroes.length;
    for (const m of ctx.events.newbie.milestones) s = claimNewbieMilestone(s, last, m.points, ctx).save;
    expect(s.heroes).toHaveLength(before + 1);
    expect(s.heroes[s.heroes.length - 1].rarity).toBe('purple');
    expectCode(() => claimNewbieMilestone(s, last, firstMilestone.points, ctx), 'milestone_claimed');
    expectCode(() => claimNewbieMilestone(s, last, 7, ctx), 'unknown_milestone');
    expect(newbieStatus(s, last, ctx).done).toBe(true);
    expect(saveProblems(s, ctx)).toEqual([]);
  });

  it('льготный день: новых заданий нет, выполненное забрать можно; потом событие закрыто', () => {
    let s = fresh();
    s = trackAchievement(s, first.counter, first.target, 'max');
    const { durationDays, graceDays } = ctx.events.newbie;
    const grace = day(durationDays);
    const st = newbieStatus(s, grace, ctx);
    expect(st.active).toBe(false);
    expect(st.open).toBe(graceDays > 0);
    expect(st.closesIn).toBe(graceDays);
    if (graceDays > 0) expect(claimNewbieTask(s, grace, first.id, ctx).points).toBe(first.points);
    const over = day(durationDays + graceDays);
    expect(newbieStatus(s, over, ctx).open).toBe(false);
    expect(eventsBadges(s, over, ctx)).toMatchObject({ newbie: 0, newbieVisible: false });
    expectCode(() => claimNewbieTask(s, over, first.id, ctx), 'event_over');
  });
});

describe('почта', () => {
  it('забрать вложение один раз; прочитать; письмо без вложения не забирается', () => {
    let s = fresh();
    const welcome = s.mail.letters[0];
    expect(mailStatus(s)).toMatchObject({ unread: 1, claimable: 1 });
    const r = claimMail(s, welcome.id, ctx);
    expect(r.save.resources.gold).toBe(s.resources.gold + (welcome.rewards.gold ?? 0));
    expect(r.save.resources.heroExp).toBe(s.resources.heroExp + (welcome.rewards.jobExp ?? 0));
    expect(r.save.mail.letters[0]).toMatchObject({ read: true, claimed: true });
    expectCode(() => claimMail(r.save, welcome.id, ctx), 'letter_claimed');
    expectCode(() => claimMail(r.save, 'm999', ctx), 'unknown_letter');
    s = sendMail(r.save, D1, { from: 'Гаррет', title: 'Новости', body: 'Просто письмо.' });
    expect(s.mail.letters[0].id).toBe('m2');
    expectCode(() => claimMail(s, 'm2', ctx), 'letter_empty');
    const read = readMail(s, 'm2');
    expect(read.mail.letters[0].read).toBe(true);
    expect(readMail(read, 'm2')).toBe(read);
    // Удаляются прочитанные без вложения (оба письма).
    expect(deleteReadMail(read)).toMatchObject({ removed: 2 });
  });

  it('«Забрать всё» суммирует вложения, включая карточки героев', () => {
    let s = fresh();
    s = sendMail(s, D1, { from: 'Разработчики', title: 'Компенсация', body: 'Извините за сбой.', rewards: { gems: 100, scrolls: 2, heroes: ['seyren'] } });
    s = sendMail(s, D1, { from: 'Разработчики', title: 'Пусто', body: '' });
    expect(mailStatus(s).claimable).toBe(2);
    const r = claimAllMail(s, ctx);
    expect(r.count).toBe(2);
    expect(r.save.currency.gems).toBe(s.currency.gems + 100);
    expect(r.save.currency.scrolls).toBe(s.currency.scrolls + 2);
    expect(r.save.heroes.length).toBe(s.heroes.length + 1);
    expect(r.events.some((e) => e.type === 'heroCard')).toBe(true);
    expect(mailStatus(r.save).claimable).toBe(0);
    expect(claimAllMail(r.save, ctx).save).toBe(r.save);
    expect(saveProblems(r.save, ctx)).toEqual([]);
  });

  it('лимит писем: старые без вложения уходят, вложения не теряются', () => {
    let s = fresh();
    for (let i = 0; i < MAIL_MAX + 20; i++) s = sendMail(s, D1, { from: 'x', title: `№${i}`, body: '' });
    expect(s.mail.letters).toHaveLength(MAIL_MAX);
    expect(s.mail.letters.some((l) => l.source === 'welcome')).toBe(true);
    expect(s.mail.letters[0].title).toBe(`№${MAIL_MAX + 19}`);
  });

  it('системное письмо с untilDay: после срока не доставляется; каждое — один раз', () => {
    const c = { ...ctx, events: { ...ctx.events, mail: { letters: [...ctx.events.mail.letters, { id: 'sorry', from: 'Разработчики', title: 'Компенсация', body: '', rewards: { gems: 50 }, untilDay: day(3) }] } } };
    const late = touchEvents(newGame(ctx, 0, day(4)), day(4), c);
    expect(late.mail.letters.map((l) => l.source)).toEqual(['welcome']);
    const inTime = touchEvents(newGame(ctx, 0, D1), day(2), c);
    expect(inTime.mail.letters.map((l) => l.source)).toEqual(['sorry', 'welcome']);
    expect(touchEvents(inTime, day(2), c)).toBe(inTime);
  });
});

describe('сохранение v5', () => {
  it('миграция v4 → v5: пустая почта, события начнутся при открытии; уже есть почта — не трогается', () => {
    const v4 = JSON.parse(serialize(newGame(ctx, 5, D1)));
    delete v4.mail;
    v4.version = 4;
    const s = deserialize(JSON.stringify(v4));
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.mail).toEqual({ seq: 0, letters: [], delivered: [] });
    expect(s.events).toBeUndefined();
    const withMail = { ...v4, mail: fresh().mail };
    expect(deserialize(JSON.stringify(withMail)).mail).toEqual(fresh().mail);
  });

  it('старые сохранения (v0, v3) доходят до v5 и получают письмо при открытии', () => {
    for (const f of ['save-v0.json', 'save-v3.json']) {
      const s = deserialize(readFileSync(join(import.meta.dirname, 'fixtures', f), 'utf8'));
      expect(s.version).toBe(SAVE_VERSION);
      const t = touchEvents(s, D1, ctx);
      expect(t.mail.letters.map((l) => l.source)).toEqual(['welcome']);
      expect(t.events!.loginDays).toBe(1);
    }
  });

  it('почта и события переживают serialize/deserialize', () => {
    let s = claimLogin(fresh(), D1, 1, ctx).save;
    s = claimMail(s, s.mail.letters[0].id, ctx).save;
    s = sendMail(s, D1, { from: 'Разработчики', title: 'Подарок', body: 'Спасибо!', rewards: { gems: 10 } });
    const back = deserialize(serialize(s));
    expect(back.mail).toEqual(s.mail);
    expect(back.events).toEqual(s.events);
    expect(serialize(back)).toBe(serialize(s));
  });
});

describe('data/events.json', () => {
  it('неизвестная карточка в награде — ошибка контента', () => {
    const raw = structuredClone(readRawGameData()) as ReturnType<typeof readRawGameData> & { events: { login: { days: { rewards: { heroes?: string[] } }[] } } };
    raw.events.login.days[0].rewards.heroes = ['no_such_hero'];
    const r = collectGameContext(raw);
    expect(r.ctx).toBeUndefined();
    expect(r.problems.some((p) => p.includes('data/events.json') && p.includes('no_such_hero'))).toBe(true);
  });

  it('бюджет недели: свитки + гемы обоих событий — не больше ~2 призывов ×10; две фиолетовые карточки', () => {
    const all = [...ctx.events.login.days.map((d) => d.rewards), ...ctx.events.newbie.milestones.map((m) => m.rewards)];
    const scrolls = all.reduce((a, r) => a + (r.scrolls ?? 0), 0);
    const gems = all.reduce((a, r) => a + (r.gems ?? 0), 0);
    const pulls = scrolls + gems / ctx.summon.costs.single;
    expect(pulls).toBeLessThanOrEqual(20);
    const heroes = all.flatMap((r) => r.heroes ?? []);
    expect(heroes.map((h) => ctx.content.heroes[h].baseRarity)).toEqual(['purple', 'purple']);
  });
});
