/** Deno проверяет entrypoints, не входящие в tsc веб-клиента. SDK закреплён и lock проверяется frozen. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result = spawnSync(process.env.DENO_BIN ?? 'deno', [
  'check', '--config', 'supabase/functions/deno.json', '--lock', 'supabase/functions/deno.lock', '--frozen',
  'supabase/functions/cw-api/index.ts', 'supabase/functions/cw-bot/index.ts', 'supabase/functions/cw-cron/index.ts',
], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit' });
if (result.error) console.error('Backend check requires Deno 2.5+:', result.error.message);
process.exitCode = result.status ?? 1;
