#!/usr/bin/env node
// Слайды веток героев: promo/src/branches.html через vite → promo/branches/<герой>.png (1080×1920) и all_heroes.png.
//   node promo/src/branches.mjs
import { execSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.PROMO_PORT ?? 5252);
const OUT = 'promo/.work/branches';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
const { chromium } = await import(pathToFileURL(join(root, 'playwright', 'index.mjs')).href);
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
for (let i = 0; i < 300; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
  } catch {
    /* ждём */
  }
  await sleep(200);
}
// Фон слайда — по теме героя.
const BG = { alan: 'bg_battle_ch1', iris: 'bg_map_ch1', bran: 'bg_battle_ch5', meilin: 'bg_map_ch5', kai: 'bg_battle_ch7', lira: 'bg_map_ch7',
  dorn: 'bg_battle_ch4', zara: 'bg_map_ch4', vika: 'bg_battle_ch8', teo: 'bg_map_ch8', greta: 'bg_battle_ch6', otto: 'bg_map_ch2' };
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  const shoot = async (qs, name) => {
    await page.goto(`http://localhost:${PORT}/promo/src/branches.html?${qs}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
    await sleep(300);
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    console.log(name);
  };
  await shoot('grid=1', 'all_heroes');
  for (const [id, bg] of Object.entries(BG)) await shoot(`hero=${id}&bg=${bg}`, id);
} finally {
  await browser.close();
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    vite.kill('SIGKILL');
  }
}
