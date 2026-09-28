import { syncAchievementCounters } from '../meta/achievements';
import type { GameContext } from '../progression/types';
import { emptyMail, type Letter, type MailState, type RewardBundle, type SaveState } from '../save/schema';
import type { EventsContext } from './events';
import { EventError, grantRewards, isEmptyRewards, sumRewards, type EventRewardEvent } from './rewards';

/** Сколько писем хранится: старые прочитанные без вложения (или с забранным) уходят первыми. */
export const MAIL_MAX = 100;

function mailOf(save: SaveState): MailState {
  return save.mail ?? emptyMail();
}

/** Письмо можно забрать: есть вложение и оно не забрано. */
export function letterClaimable(l: Letter): boolean {
  return !l.claimed && !isEmptyRewards(l.rewards);
}

/**
 * Положить письмо в почту (новые — первыми). id — m<номер>. Писем больше MAIL_MAX — удаляются самые старые из тех,
 * где забирать нечего (вложение с наградой не теряется). Чистая функция.
 */
export function sendMail(
  save: SaveState,
  day: string,
  letter: { from: string; title: string; body: string; rewards?: RewardBundle; source?: string },
): SaveState {
  const mail = mailOf(save);
  const seq = mail.seq + 1;
  const l: Letter = {
    id: `m${seq}`,
    ...(letter.source ? { source: letter.source } : {}),
    from: letter.from,
    title: letter.title,
    body: letter.body,
    day,
    rewards: letter.rewards ?? {},
    read: false,
    claimed: false,
  };
  let letters = [l, ...mail.letters];
  while (letters.length > MAIL_MAX) {
    const i = letters.map((x) => !letterClaimable(x)).lastIndexOf(true);
    if (i <= 0) break;
    letters = letters.filter((_, j) => j !== i);
  }
  const delivered = letter.source && !mail.delivered.includes(letter.source) ? [...mail.delivered, letter.source] : mail.delivered;
  return { ...save, mail: { seq, letters, delivered } };
}

/**
 * Доставить системные письма data/events.json → mail.letters, которых у игрока ещё не было (mail.delivered),
 * по порядку файла (первое окажется ниже в списке). untilDay прошёл — письмо не доставляется. Ничего нового — тот же save.
 */
export function deliverSystemMail(save: SaveState, day: string, ctx: EventsContext): SaveState {
  let s = save;
  const delivered = new Set(mailOf(save).delivered);
  for (const def of ctx.events.mail.letters) {
    if (delivered.has(def.id) || (def.untilDay && day > def.untilDay)) continue;
    s = sendMail(s, day, { from: def.from, title: def.title, body: def.body, rewards: def.rewards, source: def.id });
  }
  return s;
}

export interface MailStatus {
  letters: Letter[];
  /** Непрочитанных писем. */
  unread: number;
  /** Писем с незабранным вложением. */
  claimable: number;
}

export function mailStatus(save: SaveState): MailStatus {
  const letters = mailOf(save).letters;
  return { letters, unread: letters.filter((l) => !l.read).length, claimable: letters.filter(letterClaimable).length };
}

function findLetter(save: SaveState, id: string): Letter {
  const l = mailOf(save).letters.find((x) => x.id === id);
  if (!l) throw new EventError('unknown_letter', 'Письмо не найдено');
  return l;
}

function patchLetters(save: SaveState, fn: (l: Letter) => Letter): SaveState {
  const mail = mailOf(save);
  return { ...save, mail: { ...mail, letters: mail.letters.map(fn) } };
}

/** Отметить письмо прочитанным (уже прочитано — тот же save). EventError: unknown_letter. */
export function readMail(save: SaveState, id: string): SaveState {
  const l = findLetter(save, id);
  if (l.read) return save;
  return patchLetters(save, (x) => (x.id === id ? { ...x, read: true } : x));
}

/** Забрать вложение письма (и отметить прочитанным). EventError: unknown_letter, letter_claimed, letter_empty. */
export function claimMail(save: SaveState, id: string, ctx: GameContext): { save: SaveState; rewards: RewardBundle; events: EventRewardEvent[] } {
  const l = findLetter(save, id);
  if (l.claimed) throw new EventError('letter_claimed', 'Вложение уже получено');
  if (isEmptyRewards(l.rewards)) throw new EventError('letter_empty', 'В письме нет вложения');
  const out = grantRewards(patchLetters(save, (x) => (x.id === id ? { ...x, read: true, claimed: true } : x)), l.rewards, ctx);
  return { save: syncAchievementCounters(out.save), rewards: l.rewards, events: out.events };
}

/** «Забрать всё»: все незабранные вложения одной наградой. Нечего забирать — тот же save и пустая награда. */
export function claimAllMail(save: SaveState, ctx: GameContext): { save: SaveState; rewards: RewardBundle; events: EventRewardEvent[]; count: number } {
  const ready = mailOf(save).letters.filter(letterClaimable);
  if (!ready.length) return { save, rewards: {}, events: [], count: 0 };
  const ids = new Set(ready.map((l) => l.id));
  const rewards = sumRewards(ready.map((l) => l.rewards));
  const out = grantRewards(patchLetters(save, (x) => (ids.has(x.id) ? { ...x, read: true, claimed: true } : x)), rewards, ctx);
  return { save: syncAchievementCounters(out.save), rewards, events: out.events, count: ready.length };
}

/** Удалить прочитанные письма, в которых нечего забирать. Возвращает, сколько удалено. */
export function deleteReadMail(save: SaveState): { save: SaveState; removed: number } {
  const mail = mailOf(save);
  const letters = mail.letters.filter((l) => !l.read || letterClaimable(l));
  const removed = mail.letters.length - letters.length;
  return removed ? { save: { ...save, mail: { ...mail, letters } }, removed } : { save, removed: 0 };
}
