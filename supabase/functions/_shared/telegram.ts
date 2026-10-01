/** Вызов Bot API (без Deno API; токен передаётся параметром и в ответах не возвращается). */

export interface TgResult<T = unknown> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

export async function tgCall<T = unknown>(token: string, method: string, params: Record<string, unknown> = {}): Promise<TgResult<T>> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const body = (await res.json()) as TgResult<T>;
    return body && typeof body === 'object' ? body : { ok: false, error_code: res.status, description: 'bad response' };
  } catch (e) {
    return { ok: false, error_code: 0, description: String(e) };
  }
}
