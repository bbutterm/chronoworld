/**
 * Клиент сервера cw-api (supabase/functions/cw-api, docs/design/online.md). Один POST { action, initData, ... }.
 * - Игрок — по Telegram.WebApp.initData; нет его (браузер, не Telegram) — офлайн: все вызовы сразу null.
 * - Никаких исключений наружу: сеть упала, таймаут (8 с), 401/500, мусор в ответе — null.
 * - Адрес — VITE_CW_API (по умолчанию — развёрнутая функция). Ключ apikey не нужен (verify_jwt выключен).
 * - Ручная проверка без Telegram: ?tgmock=1 в dev-сборке (или с ?dev=1) — ответы-заглушки mock.ts, без сети.
 */
import {
  parseBoard,
  parseGrants,
  parseFriends,
  parseHello,
  parseSaveGet,
  parseSavePut,
  parseSync,
  type BoardKind,
  type BoardResp,
  type BoardScope,
  type CloudSaveData,
  type FriendInfo,
  type HelloResp,
} from './logic';
import { mockCall } from './mock';

export const DEFAULT_API = 'https://ajltzwomvyvntvtjnrrf.supabase.co/functions/v1/cw-api';
export const TIMEOUT_MS = 8000;

const env = (import.meta as unknown as { env?: Record<string, string | boolean | undefined> }).env ?? {};
export const API_URL = String(env.VITE_CW_API || DEFAULT_API);

interface TgWebApp {
  initData?: string;
  platform?: string;
  openTelegramLink?: (url: string) => void;
  openLink?: (url: string) => void;
}

const tg = (): TgWebApp | undefined => {
  try {
    return (globalThis as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
  } catch {
    return undefined;
  }
};

/** Заглушка сервера для скриншотов: ?tgmock=1 в dev-сборке или вместе с ?dev=1. */
export function mockMode(): boolean {
  try {
    if (typeof location === 'undefined') return false;
    const q = new URLSearchParams(location.search);
    return q.has('tgmock') && (!!env.DEV || q.has('dev'));
  } catch {
    return false;
  }
}

/** initData Mini App или null (не Telegram / открыто без данных). */
export function initData(): string | null {
  if (import.meta.env?.VITE_ADVANCE_LAB === '1') return null;
  if (mockMode()) return 'mock';
  const d = tg()?.initData;
  return typeof d === 'string' && d.length > 0 ? d : null;
}

/** Онлайн доступен: игра открыта в Telegram (или заглушка). Сеть при этом может и не работать. */
export const onlineAvailable = (): boolean => initData() !== null;

/** Открыть ссылку t.me внутри Telegram (share, профиль бота); вне Telegram — новая вкладка. */
export function openTgLink(url: string): void {
  try {
    const app = tg();
    if (app?.openTelegramLink) app.openTelegramLink(url);
    else globalThis.open?.(url, '_blank');
  } catch {
    /* не открылось — не страшно */
  }
}

export type Fetcher = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Вызов действия. Ответ — разобранный JSON при HTTP 2xx, иначе null. keepalive — при сворачивании (запрос
 * переживает выгрузку страницы; браузер берёт с keepalive только тела до 64 КБ).
 */
export async function call(action: string, payload: Record<string, unknown> = {}, opts: { keepalive?: boolean; fetcher?: Fetcher; timeoutMs?: number; allowConflict?: boolean } = {}): Promise<unknown | null> {
  const init = initData();
  if (!init) return null;
  if (init === 'mock' && !opts.fetcher) return mockCall(action, payload);
  const f: Fetcher | undefined = opts.fetcher ?? (typeof fetch === 'function' ? (fetch as unknown as Fetcher) : undefined);
  if (!f) return null;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs ?? TIMEOUT_MS) : null;
  try {
    const body = JSON.stringify({ ...payload, action, initData: init });
    const res = await f(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      ...(ctrl ? { signal: ctrl.signal } : {}),
      ...(opts.keepalive && body.length < 60_000 ? { keepalive: true } : {}),
    });
    if (!res.ok && !(opts.allowConflict && res.status === 409)) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const api = {
  /** extra — для уведомлений бота: tzOffset, chestFullAt, expeditionsDoneAt. */
  hello: async (extra: Record<string, unknown> = {}): Promise<HelloResp | null> => parseHello(await call('hello', extra)),
  saveGet: async (): Promise<CloudSaveData | null> => parseSaveGet(await call('save_get')),
  /** Один writeId на снимок: повтор после разрыва связи возвращает прежнюю принятую ревизию. */
  savePut: async (data: unknown, saveVersion: number, chapter: number, opts: { expectedRevision: number; writeId: string; keepalive?: boolean }) =>
    parseSavePut(await call('save_put', { data, saveVersion, chapter, expectedRevision: opts.expectedRevision, writeId: opts.writeId }, { keepalive: opts.keepalive, allowConflict: true })),
  sync: async (
    p: { chapter: number; stage: number; power: number; towerBest: number; towerWeek?: number; towerWeekId?: string; mvpWeek: number; mvpWeekId?: string; tzOffset?: number; chestFullAt?: number | null; expeditionsDoneAt?: number | null },
    keepalive = false,
  ) => parseSync(await call('sync', p, { keepalive })),
  board: async (board: BoardKind, scope: BoardScope): Promise<BoardResp | null> => parseBoard(await call('board', { board, scope })),
  friends: async (): Promise<FriendInfo[] | null> => parseFriends(await call('friends')),
  giftSend: async (to: number): Promise<boolean> => (await call('gift_send', { to }) as { ok?: unknown } | null)?.ok === true,
  giftClaim: async () => parseGrants(await call('gift_claim', { protocol: 2 })),
  refClaim: async () => parseGrants(await call('ref_claim', { protocol: 2 })),
  rewardClaim: async () => parseGrants(await call('reward_claim', { protocol: 2 })),
};
