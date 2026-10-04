import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { checkedDatabase } from '../supabase/functions/_shared/database';
import { clientNotifyFields } from '../supabase/functions/_shared/bot';
import * as boards from '../supabase/functions/cw-api/boards';
import * as telegram from '../supabase/functions/cw-api/tg';

interface Result { data?: unknown; count?: number | null; error?: { code: string; message: string } | null }
interface Query extends PromiseLike<Result> {
  select(cols?: string, options?: unknown): Query;
  eq(key: string, value: unknown): Query;
  match(values: Record<string, unknown>): Query;
  maybeSingle(): Query;
  single(): Query;
  insert(value: unknown): Query;
  upsert(value: unknown, options?: unknown): Query;
  update(value: unknown): Query;
}
interface Trace { table: string; operation: string; payload?: unknown; columns?: string; filters: Record<string, unknown> }
function database(result: (trace: Trace) => Result | Promise<Result>) {
  const traces: Trace[] = [];
  function query(table: string, payload?: unknown): Query {
    const trace: Trace = { table, payload, operation: payload === undefined ? 'select' : 'rpc', filters: {} };
    const q: Query = {
      select(cols) { trace.columns = cols; return q; },
      eq(key, value) { trace.filters[key] = value; return q; },
      match(values) { Object.assign(trace.filters, values); return q; },
      maybeSingle() { return q; }, single() { return q; },
      insert(value) { trace.operation = 'insert'; trace.payload = value; return q; },
      upsert(value) { trace.operation = 'upsert'; trace.payload = value; return q; },
      update(value) { trace.operation = 'update'; trace.payload = value; return q; },
      then(resolve, reject) { traces.push(structuredClone(trace)); return Promise.resolve(result(trace)).then(resolve, reject); },
    };
    return q;
  }
  return { traces, from: (table: string) => query(table), rpc: (name: string, payload: unknown) => query(`rpc:${name}`, payload) };
}

const TOKEN = '12345:local-backend-test-token';
/** Выполняется реальный entrypoint без сетевых импортов/сервера. SDK, Deno.serve и env — явные зависимости. */
function handler(db: ReturnType<typeof database>) {
  const source = readFileSync(new URL('../supabase/functions/cw-api/index.ts', import.meta.url), 'utf8').replace(/^import[\s\S]*?;\n/gm, '');
  const js = stripTypeScriptTypes(source);
  let serve: ((req: Request) => Promise<Response>) | undefined;
  vm.runInNewContext(js, {
    Deno: { env: { get: (name: string) => name === 'CHRONOWORLD_BOT_TOKEN' ? TOKEN : 'http://local-only.test' }, serve: (fn: typeof serve) => { serve = fn; } },
    createClient: () => db, checkedDatabase, clientNotifyFields, ...telegram, ...boards,
    Response, Request, TextEncoder, Date, console: { error: vi.fn() },
  });
  return serve!;
}
async function signed() {
  const p = new URLSearchParams({ user: JSON.stringify({ id: 42, first_name: 'Вика' }), auth_date: String(Math.floor(Date.now() / 1000)) });
  p.set('hash', await telegram.signInitData(p, TOKEN));
  return p.toString();
}
async function call(serve: ReturnType<typeof handler>, body: Record<string, unknown>, initData?: string) {
  const response = await serve(new Request('http://local-only.test/cw-api', { method: 'POST', body: JSON.stringify({ ...body, initData: initData ?? await signed() }) }));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

describe('backend: реальные обработчики HTTP и SDK-ошибки', () => {
  const write = { action: 'save_put', data: { version: 7, revision: 20 }, saveVersion: 7, chapter: 3, expectedRevision: 8, writeId: '00000000-0000-4000-8000-000000000001' };

  it('Supabase resolved {error} на save RPC => 500, никогда {ok:true}', async () => {
    const db = database(() => ({ data: null, error: { code: 'XX000', message: 'Sensitive database detail' } }));
    const response = await call(handler(db), write);
    expect(response).toEqual({ status: 500, body: { error: 'server' } });
    expect(db.traces[0].table).toBe('rpc:cw_save_put');
    expect(JSON.stringify(response)).not.toContain('Sensitive');
  });

  it('read/count ошибки также не выдаются за отсутствие облака/наград', async () => {
    const db = database(() => ({ data: null, error: { code: '08006', message: 'connection failed' } }));
    expect((await call(handler(db), { action: 'save_get' })).status).toBe(500);
    expect((await call(handler(db), { action: 'hello' })).status).toBe(500);
  });

  it('CAS передаёт независимые write revision/schema version/id; конфликт остаётся HTTP409', async () => {
    const cloudSave = { chapter: 4, save_version: 7, write_revision: 9, updated_at: '2026-10-04T12:00:00Z' };
    const db = database(() => ({ data: { error: 'save_conflict', cloudSave }, error: null }));
    expect(await call(handler(db), write)).toEqual({ status: 409, body: { error: 'save_conflict', cloudSave } });
    expect(db.traces[0].payload).toMatchObject({ p_tg_id: 42, p_data: write.data, p_save_version: 7, p_expected_revision: 8, p_write_id: write.writeId });
  });

  it('invalid/Unicode oversize save и неверная ревизия не доходят до SQL', async () => {
    const db = database(() => ({ data: { ok: true, writeRevision: 9 } }));
    const serve = handler(db);
    expect((await call(serve, { ...write, data: { text: 'я'.repeat(300_000) } })).status).toBe(413);
    expect((await call(serve, { ...write, data: [] })).status).toBe(413);
    expect((await call(serve, { ...write, expectedRevision: -1 })).status).toBe(400);
    expect((await call(serve, { ...write, writeId: 'bad' })).status).toBe(400);
    expect(db.traces).toHaveLength(0);
  });

  it('legacy grant-claim блокируется до изменения БД, новый протокол возвращает долговечные IDs', async () => {
    const grant = { id: '00000000-0000-4000-8000-000000000001', kind: 'gift', units: 1, gems: 20 };
    const db = database(() => ({ data: { ok: true, grants: [grant] } }));
    const serve = handler(db);
    expect(await call(serve, { action: 'gift_claim' })).toEqual({ status: 409, body: { error: 'upgrade_required' } });
    expect(db.traces).toHaveLength(0);
    expect(await call(serve, { action: 'gift_claim', protocol: 2 })).toEqual({ status: 200, body: { ok: true, grants: [grant] } });
    expect(db.traces[0]).toMatchObject({ table: 'rpc:cw_claim_rewards', payload: { p_tg_id: 42, p_kind: 'gift' } });
  });

  it('старый недельный результат не переносится в следующую неделю, sync ограничивает числа', async () => {
    const db = database(() => ({ data: { ok: true, refRewarded: false } }));
    await call(handler(db), { action: 'sync', chapter: 999, stage: -1, power: 999_999_999, towerBest: 9999, mvpWeek: 1000, mvpWeekId: '2000-W01' });
    expect(db.traces[0]).toMatchObject({ table: 'rpc:cw_sync_player', payload: { p_chapter: 10, p_stage: 0, p_power: 50_000_000, p_tower: 2000, p_tower_week: 0, p_mvp: 0 } });
  });

  it('недельная Башня отдельно от lifetime; старое/отсутствующее weekId не создаёт запись', async () => {
    const db = database(() => ({ data: { ok: true, refRewarded: false } }));
    const serve = handler(db);
    const week = telegram.isoWeek(new Date());
    await call(serve, { action: 'sync', towerBest: 100, towerWeek: 4, towerWeekId: week });
    await call(serve, { action: 'sync', towerBest: 100, towerWeek: 90, towerWeekId: '2000-W01' });
    await call(serve, { action: 'sync', towerBest: 100 });
    expect(db.traces.map((trace) => trace.payload)).toMatchObject([
      { p_tower: 100, p_tower_week: 4 }, { p_tower: 100, p_tower_week: 0 }, { p_tower: 100, p_tower_week: 0 },
    ]);
  });

  it('неверная подпись отсекается до чтения/записи БД', async () => {
    const db = database(() => ({ data: null }));
    expect(await call(handler(db), write, 'user=forged&hash=bad')).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect(db.traces).toHaveLength(0);
  });

  it('JSON null/array и некорректный JSON возвращают 400, не необработанное исключение', async () => {
    const db = database(() => ({ data: null }));
    const serve = handler(db);
    for (const body of ['null', '[]', '{broken']) {
      const response = await serve(new Request('http://local-only.test/cw-api', { method: 'POST', body }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'bad_json' });
    }
    expect(db.traces).toHaveLength(0);
  });
});
