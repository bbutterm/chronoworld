#!/usr/bin/env node
// Картинки предпросмотра Mini App в Telegram (BotFather → Configure Mini App → Preview media): promo/src/preview.html?n=1…8
// → promo/preview/NN_*.jpg, 1080×1920, JPEG ≤ 1 МБ. Сервер — python http.server из корня репозитория (PROMO_PORT, 5256).
//   node promo/src/preview.mjs
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.PROMO_PORT ?? 5256);
const OUT = 'promo/preview';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) rmSync(join(OUT, f));
const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
const { chromium } = await import(pathToFileURL(join(root, 'playwright', 'index.mjs')).href);
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { stdio: 'ignore', detached: true });
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break;
  } catch {
    /* ждём */
  }
  await sleep(200);
}
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  page.on('console', (m) => m.type() !== 'log' && console.log('[page]', m.text()));
  let ids = [];
  for (let n = 1; ; n++) {
    await page.goto(`http://127.0.0.1:${PORT}/promo/src/preview.html?n=${n}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
    if (n === 1) ids = await page.evaluate(() => window.SLIDES);
    let f = '';
    for (const q of [90, 85, 80, 75, 70]) {
      f = join(OUT, `${ids[n - 1]}.jpg`);
      await page.screenshot({ path: f, type: 'jpeg', quality: q });
      if (statSync(f).size <= 1_000_000) break;
    }
    console.log(f, Math.round(statSync(f).size / 1024), 'КБ');
    if (n >= ids.length) break;
  }
} finally {
  await browser.close();
  try {
    process.kill(-srv.pid, 'SIGTERM');
  } catch {
    srv.kill('SIGKILL');
  }
}
