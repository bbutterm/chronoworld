/**
 * Онлайн фаза 1 (docs/design/online.md) — чистые функции клиента без Phaser, сети и часов: разбор ответов сервера
 * cw-api, «какое сохранение новее», реферальная ссылка, данные для `sync`, недельный зачёт MVP, «N ч назад».
 * Проверяются в tests/online-client.test.ts. Сеть — api.ts, связка с игрой — online.ts, экран — FriendsScene.
 */
import { grantRewards, offlineFullInMs, sendMail, stageStatus, type GameContext, type SaveState } from '../../core';

// ---------- ответы сервера ----------

export interface CloudSaveInfo {
  chapter: number;
  /** Время записи на сервере, мс (Date.parse updated_at). */
  updatedAt: number;
  saveVersion: number;
  /** CAS-ревизия записи, не версия схемы игры. Отсутствует у сервера первого протокола. */
  writeRevision?: number;
}

export interface HelloResp {
  id: number;
  name: string;
  fresh: boolean;
  cloudSave: CloudSaveInfo | null;
  giftsWaiting: number;
  refBonus: number;
  protocol?: number;
}

export interface FriendInfo {
  id: number;
  name: string;
  chapter: number;
  stage: number;
  /** Сила отряда (как «Мощь отряда» в игре); 0 — старый сервер или друг ещё не присылал. */
  power: number;
  towerBest: number;
  /** Мне сегодня уже отправлен колокольчик этому другу. */
  giftSent: boolean;
  /** От этого друга ждёт незабранный колокольчик. */
  giftWaiting: boolean;
}

/** Доски: сила отряда и прогресс — постоянные (cw_player), Башня и MVP — недельные (cw_score). */
export type BoardKind = 'power' | 'progress' | 'tower' | 'mvp';
export type BoardScope = 'all' | 'friends';

/** Порядок переключателя досок на экране «Рекорды». */
export const BOARD_KINDS: { id: BoardKind; label: string; hint: string }[] = [
  { id: 'power', label: 'Сила отряда', hint: 'Сила отряда — как «Мощь отряда» на экране героев' },
  { id: 'progress', label: 'Прогресс', hint: 'Дальше всех по кампании: глава, затем этап' },
  { id: 'tower', label: 'Башня', hint: 'Лучший этаж Башни за неделю' },
  { id: 'mvp', label: 'MVP', hint: 'Лучший зачёт охоты на MVP за неделю' },
];

export interface BoardRow {
  place: number;
  name: string;
  value: number;
  me: boolean;
  /** Глава, этап, сила игрока (0 — старый сервер не прислал). */
  chapter: number;
  stage: number;
  power: number;
}

export interface BoardMine {
  place: number;
  value: number;
  chapter: number;
  stage: number;
  power: number;
}

export interface BoardResp {
  /** Неделя «2026-W40» у недельных досок, '' — у постоянных. */
  week: string;
  top: BoardRow[];
  mine: BoardMine | null;
}

export interface CloudSaveData {
  data: unknown;
  saveVersion: number;
  chapter: number;
  updatedAt: number;
  writeRevision?: number;
  /** Подтверждённые IDs из серверного журнала: восстановление работает и при повреждённом JSON.online. */
  appliedGrantIds?: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Неотрицательное целое (или 0). */
const int = (v: unknown): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const str = (v: unknown, max = 64): string => (typeof v === 'string' ? v.slice(0, max) : '');
const time = (v: unknown): number => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : 0;
};
/** Ответ «ok: true» — объект, иначе null (ошибка сервера, 401, мусор). */
const okObj = (v: unknown): Obj | null => (isObj(v) && v.ok === true ? v : null);

export function parseHello(v: unknown): HelloResp | null {
  const o = okObj(v);
  if (!o || !int(o.id)) return null;
  const cs = isObj(o.cloudSave) ? o.cloudSave : null;
  return {
    id: int(o.id),
    name: str(o.name) || 'Герой',
    fresh: o.fresh === true,
    cloudSave: cs ? parseCloudInfo(cs) : null,
    giftsWaiting: int(o.giftsWaiting),
    refBonus: int(o.refBonus),
    ...(int(o.protocol) >= 2 ? { protocol: int(o.protocol) } : {}),
  };
}

export function parseSaveGet(v: unknown): CloudSaveData | null {
  const o = okObj(v);
  if (!o || !isObj(o.save) || !isObj(o.save.data)) return null;
  const s = o.save;
  return { data: s.data, ...parseCloudInfo(s),
    ...(Array.isArray(s.applied_grant_ids) ? { appliedGrantIds: s.applied_grant_ids.filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)).map((id) => id.toLowerCase()) } : {}) };
}

function parseCloudInfo(o: Obj): CloudSaveInfo {
  return { chapter: int(o.chapter), updatedAt: time(o.updated_at), saveVersion: int(o.save_version),
    ...(Number.isSafeInteger(o.write_revision) && Number(o.write_revision) > 0 ? { writeRevision: Number(o.write_revision) } : {}) };
}

export type SavePutResp = { status: 'saved'; writeRevision: number }
  | { status: 'conflict'; cloudSave: CloudSaveInfo | null }
  | { status: 'upgrade_required' | 'reward_history_conflict' };

export function parseSavePut(v: unknown): SavePutResp | null {
  if (!isObj(v)) return null;
  if (v.error === 'save_conflict') return { status: 'conflict', cloudSave: isObj(v.cloudSave) ? parseCloudInfo(v.cloudSave) : null };
  if (v.error === 'upgrade_required' || v.error === 'reward_history_conflict') return { status: v.error };
  if (v.ok === true && Number.isSafeInteger(v.writeRevision) && Number(v.writeRevision) > 0) return { status: 'saved', writeRevision: Number(v.writeRevision) };
  return null;
}

export interface RewardGrant {
  id: string;
  kind: 'gift' | 'ref' | 'ref_welcome';
  units: number;
  gems: number;
}

/** Недостоверный список целиком отклоняем: частично применённый ответ трудно надёжно подтвердить. */
export function parseGrants(v: unknown): RewardGrant[] | null {
  const o = okObj(v);
  if (!o || !Array.isArray(o.grants)) return null;
  const out: RewardGrant[] = [];
  const ids = new Map<string, RewardGrant>();
  for (const raw of o.grants) {
    if (!isObj(raw) || typeof raw.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.id)) return null;
    if (raw.kind !== 'gift' && raw.kind !== 'ref' && raw.kind !== 'ref_welcome') return null;
    if (!Number.isSafeInteger(raw.units) || Number(raw.units) < 1 || !Number.isSafeInteger(raw.gems) || Number(raw.gems) < 1) return null;
    const unitGems = raw.kind === 'gift' ? BELL_GEMS : raw.kind === 'ref' ? REF_INVITER_GEMS : REF_WELCOME_GEMS;
    if (Number(raw.gems) !== Number(raw.units) * unitGems || (raw.kind === 'ref_welcome' && raw.units !== 1)) return null;
    const id = raw.id.toLowerCase();
    const grant: RewardGrant = { id, kind: raw.kind, units: Number(raw.units), gems: Number(raw.gems) };
    const previous = ids.get(id);
    if (previous && (previous.kind !== grant.kind || previous.units !== grant.units || previous.gems !== grant.gems)) return null;
    if (!previous) out.push(grant);
    ids.set(id, grant);
  }
  return out;
}

/** Optional field is provided by the save schema; shape is kept here to read pre-protocol saves too. */
export interface OnlineProgress { appliedGrantIds: string[]; mvpWeek?: WeekBest; towerWeek?: WeekBest }
type OnlineSave = SaveState & { online?: OnlineProgress };

/** Применяем grant и его маркер одним сохранением. Ответ с тем же ID безопасен после любого retry. */
export function applyRewardGrants(save: SaveState, grants: readonly RewardGrant[], day: string, ctx: GameContext): { save: SaveState; bells: number; refs: number } {
  let s: OnlineSave = save;
  const originalIds = s.online?.appliedGrantIds ?? [];
  const ids = new Set(originalIds.map((id) => id.toLowerCase()));
  let bells = 0;
  let refs = 0;
  for (const grant of grants) {
    if (ids.has(grant.id)) continue;
    if (grant.kind === 'gift') {
      s = grantRewards(s, { gems: grant.gems }, ctx, 'online_bells').save;
      bells += grant.units;
    } else if (grant.kind === 'ref_welcome') {
      // Совместимость: старый клиент уже доставил welcome-письмо, а сервер создал grant при миграции.
      if (!s.mail?.delivered.includes(REF_WELCOME_SOURCE)) s = sendMail(s, day, {
        from: 'Друг', title: 'Друг рад, что ты с нами', body: `Ты прошёл первую главу по приглашению друга — держи ${grant.gems} гемов на дорогу.`,
        rewards: { gems: grant.gems }, source: REF_WELCOME_SOURCE,
      });
    } else {
      s = sendMail(s, day, {
        from: 'Гильдия искателей', title: grant.units > 1 ? `${grant.units} друга прошли первую главу` : 'Ваш друг прошёл первую главу',
        body: `Гильдия благодарит за приглашение друзей: ${grant.gems} гемов.`, rewards: { gems: grant.gems }, source: `online_grant_${grant.id}`,
      });
      refs += grant.units;
    }
    ids.add(grant.id);
  }
  if (ids.size === originalIds.length && originalIds.every((id) => ids.has(id)) && s === save) return { save, bells, refs };
  return { save: { ...s, online: { ...s.online, appliedGrantIds: [...ids] } } as SaveState, bells, refs };
}

export function parseFriends(v: unknown): FriendInfo[] | null {
  const o = okObj(v);
  if (!o || !Array.isArray(o.friends)) return null;
  return o.friends.filter(isObj).filter((f) => int(f.id) > 0).map((f) => ({
    id: int(f.id),
    name: str(f.name) || 'Друг',
    chapter: int(f.chapter),
    stage: int(f.stage),
    power: int(f.power),
    towerBest: int(f.towerBest),
    giftSent: f.giftSent === true,
    giftWaiting: f.giftWaiting === true,
  }));
}

export function parseBoard(v: unknown): BoardResp | null {
  const o = okObj(v);
  if (!o || !Array.isArray(o.top)) return null;
  const m = isObj(o.mine) && int(o.mine.place) > 0 ? o.mine : null;
  const mine = m ? { place: int(m.place), value: int(m.value), chapter: int(m.chapter), stage: int(m.stage), power: int(m.power) } : null;
  return {
    week: str(o.week, 16),
    top: o.top.filter(isObj).map((r, i) => ({
      place: int(r.place) || i + 1,
      name: str(r.name) || '…',
      value: int(r.value),
      me: r.me === true,
      chapter: int(r.chapter),
      stage: int(r.stage),
      power: int(r.power),
    })),
    mine,
  };
}

// ---------- тексты друзей и досок ----------

/** «Глава 4, этап 12» / «Только начинает» (глава 0 — ещё не присылал прогресс). */
export function whereText(chapter: number, stage: number): string {
  return chapter > 0 ? `Глава ${chapter}, этап ${Math.max(1, stage)}` : 'Только начинает';
}

/** Сила и Башня друга: «Сила 12 345 · Башня: 37» (силы нет — старый сервер — только Башня). */
export function friendStats(f: Pick<FriendInfo, 'power' | 'towerBest'>): string {
  return [...(f.power > 0 ? [`Сила ${groupDigits(f.power)}`] : []), `Башня: ${f.towerBest}`].join(' · ');
}

/** Строка друга целиком: «Глава 4, этап 12 · Сила 12 345 · Башня: 37» (на экране — в две строки). */
export function friendLine(f: Pick<FriendInfo, 'chapter' | 'stage' | 'power' | 'towerBest'>): string {
  return `${whereText(f.chapter, f.stage)} · ${friendStats(f)}`;
}

/** Значение в строке доски: сила числом, прогресс — «гл. 4-12», Башня — «этаж N», MVP — число. */
export function boardValueText(kind: BoardKind, r: Pick<BoardRow, 'value' | 'chapter' | 'stage'>): string {
  switch (kind) {
    case 'power':
      return groupDigits(r.value);
    case 'progress': {
      // Сервер: value = глава·100 + этап; глава/этап в строке точнее (если пришли).
      const ch = r.chapter || Math.floor(r.value / 100);
      const st = r.chapter ? r.stage : r.value % 100;
      return ch > 0 ? `гл. ${ch}-${Math.max(1, st)}` : '—';
    }
    case 'tower':
      return `этаж ${r.value}`;
    default:
      return groupDigits(r.value);
  }
}

/** Мелкая строка под именем: глава и сила («Глава 4, этап 12 · Сила 12 345»); то, что уже в значении, — не повторяем. */
export function boardSubLine(kind: BoardKind, r: Pick<BoardRow, 'chapter' | 'stage' | 'power'>): string {
  const parts: string[] = [];
  if (kind !== 'progress' && r.chapter > 0) parts.push(whereText(r.chapter, r.stage));
  if (kind !== 'power' && r.power > 0) parts.push(`Сила ${groupDigits(r.power)}`);
  return parts.join(' · ');
}

/** «Ваше место: 7 · 12 345» или подсказка, как попасть на доску. */
export function myPlaceText(kind: BoardKind, mine: BoardMine | null): string {
  if (mine) return `Ваше место: ${mine.place} · ${boardValueText(kind, mine)}`;
  switch (kind) {
    case 'power':
    case 'progress':
      return 'Вас пока нет на доске — пройдите этап, и вы появитесь';
    case 'tower':
      return 'Вас пока нет в рекордах — поднимитесь в Башне';
    default:
      return 'Вас пока нет в рекордах — сразитесь с MVP';
  }
}

/** `{ ok, claimed }` (gift_claim, ref_claim) → claimed; ошибка — null. */
export function parseClaimed(v: unknown): number | null {
  const o = okObj(v);
  return o ? int(o.claimed) : null;
}

/** `sync` → refRewarded; ошибка — null. */
export function parseSync(v: unknown): { refRewarded: boolean } | null {
  const o = okObj(v);
  return o ? { refRewarded: o.refRewarded === true } : null;
}

// ---------- прогресс игрока ----------

export interface Progress {
  /** Номер главы (order), 1…10. */
  chapter: number;
  /** Номер этапа в главе, 1…18. */
  stage: number;
}

/**
 * Где игрок в кампании: глава и этап первого открытого (не пройденного) этапа; всё пройдено — последний этап.
 * Новичок — глава 1, этап 1. Глава 2 у сервера = «глава 1 пройдена» (реферальная награда).
 */
export function progressOf(save: SaveState, ctx: GameContext): Progress {
  const stages = ctx.content.stages;
  const st = stages.find((s) => stageStatus(save, s.id, ctx) === 'open') ?? stages[stages.length - 1];
  if (!st) return { chapter: 1, stage: 1 };
  const chapter = ctx.content.chapters.find((c) => c.id === st.chapter)?.order ?? 1;
  return { chapter, stage: st.index + 1 };
}

/** Новая игра на этом устройстве: ни одного пройденного этапа. */
export const isFreshSave = (save: Pick<SaveState, 'campaign'>): boolean => save.campaign.cleared.length === 0;

// ---------- какое сохранение новее ----------

/** Облачное записано позже локального хотя бы на столько — «заметно новее» (часы устройств расходятся). */
export const NEWER_MARGIN_MS = 10 * 60 * 1000;

export interface LocalSaveInfo {
  chapter: number;
  fresh: boolean;
  /** Когда это устройство последний раз меняло игру, мс (0 — неизвестно). */
  changedAt: number;
}

/**
 * Предложить ли облачное сохранение вместо этого: в облаке есть игра и (здесь новая игра, или облачная дальше по
 * главе, или в той же главе, но записана заметно позже последней игры здесь — играли на другом устройстве).
 * declinedAt — updatedAt облачного сохранения, от которого игрок уже отказался (не спрашиваем снова).
 */
export function shouldOfferCloud(local: LocalSaveInfo, cloud: CloudSaveInfo | null, declinedAt = 0): boolean {
  if (!cloud || cloud.chapter < 1 || !cloud.updatedAt) return false;
  if (declinedAt && cloud.updatedAt <= declinedAt) return false;
  if (local.fresh) return true;
  if (cloud.chapter > local.chapter) return true;
  return cloud.chapter === local.chapter && local.changedAt > 0 && cloud.updatedAt > local.changedAt + NEWER_MARGIN_MS;
}

// ---------- тексты ----------

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** «только что», «5 минут назад», «3 часа назад», «2 дня назад». */
export function agoText(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} ${plural(min, 'минуту', 'минуты', 'минут')} назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ${plural(h, 'час', 'часа', 'часов')} назад`;
  const d = Math.floor(h / 24);
  return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
}

/** Число с пробелами по тысячам: 1 234 567. */
export const groupDigits = (n: number): string => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// ---------- реферальная ссылка ----------

/**
 * Ссылка на Mini App из VITE_TG_APP_LINK (https://t.me/<бот>/<app> или https://t.me/<бот>) — нормализованная
 * или null (не задана / не t.me): тогда «Позвать друга» не показывается.
 */
export function normalizeAppLink(raw: string | undefined | null): string | null {
  const s = (raw ?? '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/t\.me\/[A-Za-z0-9_]{3,}(\/[A-Za-z0-9_]+)?$/.test(s)) return null;
  return s;
}

/** Приглашение: ссылка на игру с startapp=ref_<id> (сервер читает start_param при первом входе). */
export function refLink(appLink: string, id: number): string {
  return `${appLink}?startapp=ref_${Math.floor(id)}`;
}

export const SHARE_TEXT = 'Заходи в Chronoworld — соберём отряд, пройдём Башню и будем слать друг другу колокольчики!';

/** Окно «Поделиться» Telegram: t.me/share/url с ссылкой-приглашением и текстом. */
export function shareUrl(appLink: string, id: number, text = SHARE_TEXT): string {
  return `https://t.me/share/url?url=${encodeURIComponent(refLink(appLink, id))}&text=${encodeURIComponent(text)}`;
}

// ---------- недели и зачёт MVP ----------

/** ISO-неделя «2026-W40» (UTC) — так же, как на сервере (supabase/functions/cw-api/tg.ts isoWeek). */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

export interface WeekBest {
  week: string;
  value: number;
}

/**
 * Лучший зачёт недели по результату каждой попытки, независимо от пожизненного рекорда MVP.
 * Возвращает тот же объект, если результат не улучшил текущую неделю.
 */
export function nextMvpWeek(cur: WeekBest | null, week: string, score: number): WeekBest {
  const base: WeekBest = cur && cur.week === week ? cur : { week, value: 0 };
  const value = Number.isFinite(score) ? Math.max(base.value, Math.max(0, Math.round(score))) : base.value;
  return value === base.value && base === cur ? cur : { week, value };
}

// ---------- что изменилось после commit ----------

export type OnlineTrigger = 'stage' | 'tower' | 'hunt';

/** Победа, после которой стоит отправить sync и облачное сохранение: этап кампании, новый этаж Башни, бой охоты. */
export function victoryOf(prev: SaveState, next: SaveState): OnlineTrigger | null {
  if (next.campaign.cleared.length > prev.campaign.cleared.length) return 'stage';
  if (next.tower.floor > prev.tower.floor) return 'tower';
  const a = prev.hunt;
  const b = next.hunt;
  if (b && b !== a && (b.used !== a?.used || b.day !== a?.day || b.best !== a?.best || b.kills !== a?.kills)) return 'hunt';
  return null;
}

// ---------- облачное сохранение: не чаще раза в минуту ----------

export const CLOUD_SAVE_GAP_MS = 60_000;

/**
 * Сколько ждать до отправки облачного сохранения: 0 — можно сейчас, иначе мс до конца минутного окна.
 * lastPut — время прошлой отправки (0 — не было).
 */
export function cloudSaveDelay(now: number, lastPut: number, gap = CLOUD_SAVE_GAP_MS): number {
  if (!lastPut) return 0;
  return Math.max(0, lastPut + gap - now);
}

// ---------- sync после улучшений: не чаще раза в минуту ----------

/** sync не по победе (сила выросла, сроки уведомлений) — не чаще раза в столько. */
export const SYNC_GAP_MS = 60_000;

/**
 * Сколько ждать до sync не по победе: не раньше debounce и не раньше минуты после прошлого sync (lastSync 0 — не было).
 */
export function syncDelay(now: number, lastSync: number, debounce: number, gap = SYNC_GAP_MS): number {
  return Math.max(debounce, lastSync ? lastSync + gap - now : 0);
}

/** Сила отряда для сервера — то же число, что «Мощь отряда» в игре (formatNumber округляет так же). */
export const syncPower = (power: number): number => Math.max(0, Math.round(power));

// ---------- уведомления в боте ----------

export interface NotifyTimers {
  /** Когда сундук трофеев заполнится, мс; null — уже полон (игрок в игре и видит) или не копится. */
  chestFullAt: number | null;
  /** Когда вернётся ближайшая экспедиция, мс; null — в пути никого. */
  expeditionsDoneAt: number | null;
}

/**
 * Моменты для уведомлений бота (сервер шлёт «Сундук полон» и «Отряд вернулся», когда они наступят, если игрок не в
 * игре). Сундук — offlineFullInMs ядра; экспедиции — ближайший endsAt из ещё не вернувшихся.
 */
export function notifyTimersOf(save: SaveState, now: number, ctx: GameContext): NotifyTimers {
  const full = offlineFullInMs(save, now, ctx);
  const ends = (save.bounties?.active ?? []).map((e) => e.endsAt).filter((t) => Number.isFinite(t) && t > now);
  return { chestFullAt: full !== null && full > 0 ? now + full : null, expeditionsDoneAt: ends.length ? Math.min(...ends) : null };
}

/** Моменты заметно изменились (больше минуты или появились/пропали) — стоит сообщить серверу. */
export function timersChanged(a: NotifyTimers | null, b: NotifyTimers): boolean {
  if (!a) return true;
  const diff = (x: number | null, y: number | null) => (x === null) !== (y === null) || (x !== null && y !== null && Math.abs(x - y) > 60_000);
  return diff(a.chestFullAt, b.chestFullAt) || diff(a.expeditionsDoneAt, b.expeditionsDoneAt);
}

/** Бот игры: уведомления и команды. */
export const BOT_LINK = 'https://t.me/Chronoworldbot';

// ---------- награды ----------

/** Приглашённый прошёл главу 1 (sync → refRewarded): ему — гемы письмом. */
export const REF_WELCOME_GEMS = 100;
/** Пригласившему за каждого друга, прошедшего главу 1 (ref_claim). */
export const REF_INVITER_GEMS = 200;
/** За каждый колокольчик (gift_claim). */
export const BELL_GEMS = 20;
/** Сервер отдаёт не больше стольких колокольчиков в день. */
export const BELLS_PER_DAY = 5;
/** source письма приглашённому (почта помнит доставленные — не придёт дважды). */
export const REF_WELCOME_SOURCE = 'online_ref_welcome';
