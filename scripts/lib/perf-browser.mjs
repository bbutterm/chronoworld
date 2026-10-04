import { execSync, spawn } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Optional explicit module/browser paths; default remains global Playwright and its browser. */
export async function loadPlaywright() {
  const entry = process.env.PLAYWRIGHT_MODULE ?? join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright', 'index.mjs');
  if (!isAbsolute(entry)) throw new Error('PLAYWRIGHT_MODULE must be an absolute path to index.mjs');
  try {
    return await import(pathToFileURL(entry).href);
  } catch (e) {
    throw new Error(`Playwright unavailable (${entry}); the perf scripts install nothing.\n${e.message}`);
  }
}

export const browserOptions = () => ({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}) });

export function stopVite(vite) {
  if (!vite?.pid) return;
  try {
    // Kill the group even if Vite exited: its worker may still be alive.
    if (process.platform !== 'win32') process.kill(-vite.pid, 'SIGTERM');
    else vite.kill('SIGTERM');
  } catch {
    vite.kill('SIGKILL');
  }
}

export async function startVite(port, url, preview = false) {
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...(preview ? ['preview'] : []), '--port', String(port), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
  });
  let out = '';
  let exited = false;
  let error;
  vite.stdout.on('data', d => { out += d; });
  vite.stderr.on('data', d => { out += d; });
  vite.on('exit', () => { exited = true; });
  vite.on('error', e => { error = e; });
  const deadline = Date.now() + 30000;
  try {
    while (Date.now() < deadline) {
      if (error) throw error;
      if (exited) throw new Error(`vite exited (port ${port}):\n${out}`);
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(1000, deadline - Date.now()))) });
        await r.body?.cancel();
        if (r.ok && !exited && !error) return vite;
      } catch { /* not ready */ }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error(`vite did not respond within 30 s:\n${out}`);
  } catch (e) {
    stopVite(vite);
    throw e;
  }
}
