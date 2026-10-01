/**
 * Проверка Telegram.WebApp.initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 * secret = HMAC_SHA256(key "WebAppData", botToken); hash = hex(HMAC_SHA256(secret, data_check_string)).
 * Без Deno API — тестируется в vitest (tests/online-tg.test.ts).
 */

export interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
  language_code?: string;
}

export interface TgInit {
  user: TgUser;
  authDate: number;
  startParam?: string;
}

const enc = new TextEncoder();

async function hmac(key: BufferSource, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/** data_check_string: пары key=value без hash, по алфавиту, через \n. */
export function dataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([k]) => k !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

export async function signInitData(params: URLSearchParams, botToken: string): Promise<string> {
  const secret = await hmac(enc.encode('WebAppData'), botToken);
  return hex(await hmac(secret, dataCheckString(params)));
}

/** Разбор и проверка. null — подпись неверна, нет пользователя или данные старше maxAgeSec. */
export async function verifyInitData(initData: string, botToken: string, nowSec: number, maxAgeSec = 2 * 86400): Promise<TgInit | null> {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  const expected = await signInitData(params, botToken);
  if (expected.length !== hash.length) return null;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= expected.charCodeAt(i) ^ hash.charCodeAt(i);
  if (diff !== 0) return null;
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || nowSec - authDate > maxAgeSec) return null;
  let user: TgUser;
  try {
    user = JSON.parse(params.get('user') ?? '');
  } catch {
    return null;
  }
  if (!user || typeof user.id !== 'number') return null;
  return { user, authDate, startParam: params.get('start_param') ?? undefined };
}

/** «ref_123» → 123 (не сам игрок). */
export function refFromStartParam(startParam: string | undefined, self: number): number | null {
  const m = /^ref_(\d{1,15})$/.exec(startParam ?? '');
  if (!m) return null;
  const id = Number(m[1]);
  return id && id !== self ? id : null;
}

/** ISO-неделя «2026-W40» (UTC). */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
