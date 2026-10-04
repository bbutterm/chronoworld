/** Реальные транзакции PostgreSQL, в отдельном локальном Docker-контейнере; production не используется. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const container = `cw-sql-${process.pid}`;
const postgresHost = '127.0.0.1';
const postgresPassword = 'cw-local-tests';
const localDockerEnv = { ...process.env };
for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete localDockerEnv[key];
const docker = (...args) => run('docker', ['--host=unix:///var/run/docker.sock', ...args]);
function run(command, args, input, includeStderr = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: command === 'docker' ? localDockerEnv : process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve((includeStderr ? `${out}\n${err}` : out).trim()) : reject(new Error(`${command} exited ${code}: ${err.slice(-4000)}`)));
    child.stdin.end(input ?? '');
  });
}
const sql = (text) => run('docker', ['--host=unix:///var/run/docker.sock', 'exec', '-i', '-e', `PGPASSWORD=${postgresPassword}`, container, 'psql', '-h', postgresHost, '-w', '-XAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], text);
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const query = async (text) => JSON.parse(await sql(text));
const write = (data, revision, id = randomUUID(), player = 1) => query(`select public.cw_save_put(${player}, ${literal(JSON.stringify(data))}::jsonb, 7, 2, ${revision === null ? 'null' : revision}, '${id}'::uuid);`);
const claim = (player = 1, kind = 'all') => query(`select public.cw_claim_rewards(${player}, '${kind}');`);
const sync = (player, power, tower, mvp, chapter = 2, stage = 1) => query(`select public.cw_sync_player(${player}, ${chapter}, ${stage}, ${power}, ${tower}, ${mvp}, '2026-W40', '{}', ${tower});`);
let launched = false;
try {
  // Контейнеру не нужен исходящий HTTP; нет опубликованных портов и постоянного диска.
  // До finally сохраняем контейнер и его логи, даже если initdb аварийно завершится.
  await docker('run', '-d', '--name', container, '--tmpfs', '/var/lib/postgresql/data', '-e', `POSTGRES_PASSWORD=${postgresPassword}`, process.env.CW_POSTGRES_IMAGE ?? 'postgres:17-alpine');
  launched = true;
  const readyUntil = Date.now() + 30_000;
  for (;;) {
    // Временный сервер initdb принимает Unix-сокет, но не TCP. Ждём только окончательный postmaster.
    try { await docker('exec', container, 'pg_isready', '-h', postgresHost, '-t', '1', '-U', 'postgres'); break; }
    catch (error) {
      if (Date.now() >= readyUntil) {
        const diagnostics = await Promise.allSettled([
          docker('inspect', '--format', '{{json .State}}', container),
          run('docker', ['--host=unix:///var/run/docker.sock', 'logs', '--tail', '60', container], undefined, true),
        ]);
        const detail = diagnostics.map((r) => r.status === 'fulfilled' ? r.value : r.reason.message).join('\n');
        throw new Error(`PostgreSQL did not accept TCP connections within 30 s: ${error.message}\n${detail.slice(-6000)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(500, Math.max(1, readyUntil - Date.now()))));
    }
  }
  await sql('create role anon; create role authenticated; create role service_role bypassrls;');
  const migrations = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter((f) => f.endsWith('.sql')).sort();
  for (const file of migrations) {
    await sql(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    if (file.includes('baseline')) {
      // Существующий игрок/снимок до обновления: никакой DROP/reset при последующих миграциях.
      await sql(`insert into cw_player (tg_id, first_name, ref_bonus_pending) values (1, 'Существующий игрок', 2);
        insert into cw_save values (1, '{"version":7,"currency":{"gems":123}}', 7, 2, now());`);
    }
  }
  assert.equal(await sql("select data->'currency'->>'gems' from cw_save where tg_id=1;"), '123');
  assert.equal(await sql('select write_revision from cw_save where tg_id=1;'), '1');
  // Миграции действительно повторяемые.
  for (const file of migrations) await sql(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));

  const initial = { version: 7, currency: { gems: 123 }, online: { appliedGrantIds: [] } };
  assert.equal((await write(initial, 0)).error, 'save_conflict');
  assert.equal((await write(initial, null)).error, 'upgrade_required');
  assert.equal((await query(`select public.cw_save_put(1, ${literal(JSON.stringify(initial))}::jsonb, 6, 2, 1, '${randomUUID()}'::uuid);`)).error, 'upgrade_required');
  const id = randomUUID();
  const accepted = await write(initial, 1, id);
  assert.equal(accepted.writeRevision, 2);
  assert.equal((await write(initial, 1, id)).writeRevision, 2, 'потерянный ответ безопасно повторяется с тем же writeId');
  assert.equal((await write({ ...initial, currency: { gems: 0 } }, 1, id)).error, 'save_conflict');
  assert.equal(await sql("select data->'currency'->>'gems' from cw_save where tg_id=1;"), '123');

  await sql("insert into cw_gift (day, from_id, to_id) select current_date, n, 1 from generate_series(10,19) n;");
  const claims = await Promise.all(Array.from({ length: 12 }, () => claim(1, 'gift')));
  const ids = claims[0].grants.map((g) => g.id).sort();
  assert.equal(ids.length, 5);
  for (const response of claims) assert.deepEqual(response.grants.map((g) => g.id).sort(), ids);
  assert.equal(await sql('select count(*) from cw_gift where claimed;'), '5');
  assert.equal(await sql("select sum(gems) from cw_reward_grant where kind='gift';"), '100');
  assert.deepEqual((await claim(1, 'gift')).grants.map((g) => g.id).sort(), ids, 'отложенная доставка сохраняется после потерянного ответа');
  const gifted = { ...initial, currency: { gems: 223 }, online: { appliedGrantIds: ids } };
  assert.equal((await write(gifted, 2)).writeRevision, 3);
  assert.equal((await claim(1, 'gift')).grants.length, 0, 'ACK происходит лишь вместе с записью награды');
  const cloud = await query('select public.cw_save_get(1);');
  assert.equal(cloud.save.write_revision, 3);
  assert.deepEqual(cloud.save.applied_grant_ids.sort(), ids);
  assert.equal((await write(initial, 3)).error, 'reward_history_conflict', 'rollback снимка не удаляет историю выданных наград');

  const referralClaims = await Promise.all(Array.from({ length: 8 }, () => claim(1, 'ref')));
  const referral = referralClaims[0].grants;
  assert.equal(referral.length, 1);
  assert.equal(referral[0].units, 2);
  assert.equal(referral[0].gems, 400);
  for (const response of referralClaims) assert.equal(response.grants[0].id, referral[0].id);
  assert.equal(await sql('select ref_bonus_pending from cw_player where tg_id=1;'), '0');
  // Другой игрок не может подтвердить чужую награду даже с известным UUID.
  await sql("insert into cw_player (tg_id, first_name, ref_by) values (2,'Друг 2',1), (3,'Друг 3',1);");
  await write({ version: 7, online: { appliedGrantIds: [referral[0].id] } }, 0, randomUUID(), 2);
  assert.equal((await claim(1, 'ref')).grants[0].id, referral[0].id);
  await Promise.all([sync(2, 100, 5, 800), sync(3, 200, 8, 1200), sync(2, 50, 2, 500), sync(2, 300, 9, 1400)]);
  assert.equal(await sql('select ref_bonus_pending from cw_player where tg_id=1;'), '2', 'реферальный счётчик +1 атомарно, один раз на приглашённого');
  assert.equal(await sql("select count(*) from cw_reward_grant where kind='ref_welcome';"), '2');
  assert.equal(await sql("select value from cw_score where tg_id=2 and board='mvp';"), '1400');
  assert.equal(await sql("select value from cw_score where tg_id=2 and board='tower';"), '9');
  await query("select public.cw_sync_player(2, 2, 1, 100, 100, 0, '2026-W41', '{}');");
  assert.equal(await sql("select count(*) from cw_score where tg_id=2 and board='tower' and week='2026-W41';"), '0', 'пожизненный рекорд не является результатом новой недели');
  await query("select public.cw_sync_player(2, 2, 1, 100, 100, 0, '2026-W41', '{}', 4);");
  await query("select public.cw_sync_player(2, 2, 1, 100, 100, 0, '2026-W41', '{}', 3);");
  assert.equal(await sql("select value from cw_score where tg_id=2 and board='tower' and week='2026-W41';"), '4', 'меньший новый результат недели независим от старого рекорда 100');
  assert.equal(await sql('select tower_best from cw_player where tg_id=2;'), '100');
  await sync(2, 1, 1, 1, 1, 18);
  assert.equal(await sql('select stage from cw_player where tg_id=2;'), '1', 'старый прогресс другой главы не портит этап');

  const privileges = await sql("select has_function_privilege('anon','cw_claim_rewards(bigint,text)','execute'), has_function_privilege('authenticated','cw_save_put(bigint,jsonb,integer,integer,bigint,uuid)','execute'), has_table_privilege('anon','cw_save','select'), has_function_privilege('service_role','cw_claim_rewards(bigint,text)','execute');");
  assert.equal(privileges, 'f|f|f|t');
  console.log(`Backend SQL integration passed: ${migrations.length} safe migrations, CAS/retry, ${claims.length} concurrent gift claims, ${referralClaims.length} referral claims, quota, durable ACK, concurrent sync, private RPCs.`);
} finally {
  if (launched) {
    await docker('stop', container).catch(() => {});
    await docker('rm', '-f', container).catch(() => {});
  }
}
