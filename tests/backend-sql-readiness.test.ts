import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const dockerHarness = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--host='));
const log = process.env.CW_SQL_HARNESS_LOG;
const statePath = process.env.CW_SQL_HARNESS_STATE;
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { probes: 0, sql: 0 };
fs.appendFileSync(log, JSON.stringify(args) + '\\n');
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
const host = args[args.indexOf('-h') + 1];
if (args[0] === 'run') { process.stdout.write('isolated-container\\n'); }
else if (args[0] === 'exec' && args.includes('pg_isready')) {
  state.probes++; save();
  // initdb's temporary server accepts the Unix socket during the first two probes, never TCP.
  if (process.env.CW_SQL_HARNESS_MODE === 'never_ready' || (host === '127.0.0.1' && state.probes < 3)) {
    process.stderr.write('127.0.0.1:5432 - no response\\n'); process.exit(1);
  }
  process.stdout.write('accepting connections\\n');
}
else if (args[0] === 'exec' && args.includes('psql')) {
  state.sql++; save();
  const failure = state.probes < 3 ? 'TEMPORARY_SERVER_CLOSED_BEFORE_SQL'
    : host !== '127.0.0.1' ? 'SQL_HOST_MISMATCH'
    : 'READY_SENTINEL_FIRST_SQL';
  process.stderr.write(failure + '\\n'); process.exit(77);
}
else if (args[0] === 'inspect') { process.stdout.write('container state: running\\n'); }
else if (args[0] === 'logs') { process.stderr.write('final postmaster diagnostic from stderr\\n'); }
else if (args[0] !== 'stop' && args[0] !== 'rm') { process.stderr.write('unexpected docker command\\n'); process.exit(2); }
`;

async function runHarness(mode: 'normal' | 'never_ready', fastClock = false) {
  const directory = await mkdtemp(join(tmpdir(), 'cw-sql-readiness-'));
  try {
    const executable = join(directory, 'docker');
    const log = join(directory, 'calls.jsonl');
    const statePath = join(directory, 'state.json');
    await writeFile(executable, dockerHarness, { mode: 0o700 });
    const args: string[] = [];
    if (fastClock) {
      const clock = join(directory, 'clock.mjs');
      await writeFile(clock, 'let clock = 0; Date.now = () => (clock += 30001);');
      args.push('--import', clock);
    }
    args.push('scripts/backend-sql.mjs');
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ''}`, CW_SQL_HARNESS_LOG: log, CW_SQL_HARNESS_STATE: statePath, CW_SQL_HARNESS_MODE: mode },
      encoding: 'utf8',
      timeout: 10_000,
    });
    if (result.error) throw result.error;
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as string[]);
    const state = JSON.parse(await readFile(statePath, 'utf8')) as { probes: number; sql: number };
    return { status: result.status, stderr: result.stderr, calls, state };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('PostgreSQL integration waits for the final TCP server', () => {
  it('rejects the temporary socket server and executes SQL once on the same TCP host', async () => {
    const result = await runHarness('normal');
    // The harness deliberately fails the first SQL statement after observing readiness; mutations are never retried.
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('READY_SENTINEL_FIRST_SQL');
    expect(result.stderr).not.toContain('TEMPORARY_SERVER_CLOSED_BEFORE_SQL');
    expect(result.stderr).not.toContain('SQL_HOST_MISMATCH');
    expect(result.state).toEqual({ probes: 3, sql: 1 });
    const probes = result.calls.filter((args) => args.includes('pg_isready'));
    expect(probes.every((args) => args[args.indexOf('-h') + 1] === '127.0.0.1')).toBe(true);
    expect(probes.every((args) => args[args.indexOf('-t') + 1] === '1')).toBe(true);
    const sql = result.calls.find((args) => args.includes('psql'))!;
    expect(sql[sql.indexOf('-h') + 1]).toBe('127.0.0.1');
    expect(sql).toContain('-w');
    expect(result.calls.filter((args) => args[0] === 'stop')).toHaveLength(1);
    expect(result.calls.filter((args) => args[0] === 'rm')).toHaveLength(1);
  });

  it('fails at the readiness deadline before SQL, reports container diagnostics and cleans up', async () => {
    const result = await runHarness('never_ready', true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('PostgreSQL did not accept TCP connections within 30 s');
    expect(result.stderr).toContain('container state: running');
    expect(result.stderr).toContain('final postmaster diagnostic from stderr');
    expect(result.state).toEqual({ probes: 1, sql: 0 });
    expect(result.calls.filter((args) => args[0] === 'inspect')).toHaveLength(1);
    expect(result.calls.filter((args) => args[0] === 'logs')).toHaveLength(1);
    expect(result.calls.filter((args) => args[0] === 'stop')).toHaveLength(1);
    expect(result.calls.filter((args) => args[0] === 'rm')).toHaveLength(1);
  });
});
