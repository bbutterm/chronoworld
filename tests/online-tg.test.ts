import { describe, expect, it } from 'vitest';
import { isoWeek, refFromStartParam, signInitData, verifyInitData } from '../supabase/functions/cw-api/tg';

const TOKEN = '123456:TEST-token';

async function makeInit(fields: Record<string, string>, token = TOKEN): Promise<string> {
  const p = new URLSearchParams(fields);
  p.set('hash', await signInitData(p, token));
  return p.toString();
}

describe('онлайн: проверка Telegram initData (cw-api)', () => {
  const user = JSON.stringify({ id: 42, first_name: 'Вика', username: 'vika', language_code: 'ru' });

  it('верная подпись — игрок и start_param', async () => {
    const init = await makeInit({ auth_date: '1000', query_id: 'q', user, start_param: 'ref_7' });
    const r = await verifyInitData(init, TOKEN, 1500);
    expect(r?.user.id).toBe(42);
    expect(r?.startParam).toBe('ref_7');
  });

  it('чужой токен, подмена поля и старые данные — отказ', async () => {
    const init = await makeInit({ auth_date: '1000', user });
    expect(await verifyInitData(init, 'other:token', 1500)).toBeNull();
    expect(await verifyInitData(init.replace('42', '43'), TOKEN, 1500)).toBeNull();
    expect(await verifyInitData(init, TOKEN, 1000 + 3 * 86400)).toBeNull();
    expect(await verifyInitData('', TOKEN, 1500)).toBeNull();
  });

  it('реферал и неделя', () => {
    expect(refFromStartParam('ref_7', 42)).toBe(7);
    expect(refFromStartParam('ref_42', 42)).toBeNull();
    expect(refFromStartParam('abc', 42)).toBeNull();
    expect(isoWeek(new Date(Date.UTC(2026, 9, 1)))).toBe('2026-W40');
    expect(isoWeek(new Date(Date.UTC(2027, 0, 1)))).toBe('2026-W53');
  });
});
