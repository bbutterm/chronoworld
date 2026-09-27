#!/usr/bin/env node
// Замер холодного старта прод-сборки (как у игрока в Telegram на слабом телефоне):
// `vite build` → `vite preview` → Chromium с CPU ×4 и сетью «Fast 3G» (как в DevTools: 562.5 мс RTT,
// 180 000 Б/с вниз, 84 375 Б/с вверх), кэш выключен. Меряет:
//   - FCP (первая отрисовка страницы — HTML-заставка из index.html),
//   - первый кадр BootScene (метка `cw:boot-frame`, ставит src/main.ts),
//   - главная готова к нажатиям (метка `cw:home` — первый кадр после create() главной),
//   - сколько байт и запросов до главной (JS / картинки / прочее).
// Затем повторный визит (кэш включён) — как второй запуск Mini App.
// Переменные: LOAD_PORT (5190), LOAD_RUNS (3, берётся медиана), LOAD_CPU (4), LOAD_NET (fast3g | none),
// LOAD_SKIP_BUILD=1 — не пересобирать dist, LOAD_JSON=файл — сырые цифры.
// Playwright — глобальный (`npm root -g`), Chromium уже скачан; скрипт ничего не устанавливает.
import { execSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.LOAD_PORT ?? 5190);
const URL = `http://localhost:${PORT}/`;
const RUNS = Number(process.env.LOAD_RUNS ?? 3);
const CPU = Number(process.env.LOAD_CPU ?? 4);
const NET = process.env.LOAD_NET ?? 'fast3g';
const NETWORKS = {
  fast3g: { offline: false, latency: 562.5, downloadThroughput: 180000, uploadThroughput: 84375 },
  none: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
};

const log = (...a) => console.log('[load]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadPlaywright() {
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  const entry = join(root, 'playwright', 'index.mjs');
  try {
    return await import(pathToFileURL(entry).href);
  } catch (e) {
    throw new Error(`Не найден глобальный Playwright (${entry}). Скрипт ничего не устанавливает.\n${e.message}`);
  }
}

async function startPreview() {
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let out = '';
  vite.stdout.on('data', (d) => (out += d));
  vite.stderr.on('data', (d) => (out += d));
  let exited = null;
  vite.on('exit', (code) => (exited = code));
  for (let i = 0; i < 150; i++) {
    if (exited !== null) throw new Error(`vite preview завершился с кодом ${exited} (порт ${PORT} занят?):\n${out}`);
    try {
      const r = await fetch(URL);
      if (r.ok) return vite;
    } catch {
      // ещё не поднялся
    }
    await sleep(200);
  }
  throw new Error(`vite preview не ответил за 30 с:\n${out}`);
}

function stopPreview(vite) {
  if (!vite || vite.exitCode !== null) return;
  try {
    if (process.platform !== 'win32') process.kill(-vite.pid, 'SIGTERM');
    else vite.kill('SIGTERM');
  } catch {
    vite.kill('SIGKILL');
  }
}

/** Цифры из страницы: метки, FCP, ресурсы до метки главной. */
function collect() {
  const mark = (n) => performance.getEntriesByName(n)[0]?.startTime ?? null;
  const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
  const home = mark('cw:home');
  const kinds = { js: [0, 0], img: [0, 0], other: [0, 0] };
  let cached = 0;
  for (const r of performance.getEntriesByType('resource')) {
    if (home !== null && r.startTime > home) continue;
    const k = /\.m?js(\?|$)/.test(r.name) ? 'js' : /\.(png|jpe?g|webp|avif|gif)(\?|$)/.test(r.name) ? 'img' : 'other';
    kinds[k][0]++;
    kinds[k][1] += r.transferSize || 0;
    if (r.transferSize === 0 && r.decodedBodySize > 0) cached++;
  }
  const nav = performance.getEntriesByType('navigation')[0];
  const files = performance
    .getEntriesByType('resource')
    .map((r) => ({ name: r.name.replace(location.origin, ''), start: Math.round(r.startTime), end: Math.round(r.responseEnd), size: r.transferSize, body: r.decodedBodySize }));
  kinds.other[0]++;
  kinds.other[1] += nav?.transferSize ?? 0;
  return { files, fcp, boot: mark('cw:boot-frame'), bootScript: mark('cw:script'), home, kinds, cached };
}

async function measure(browser, { warm }) {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  if (warm) {
    // Первый визит без замедления — наполнить кэш, затем замер повторного.
    await page.goto(URL);
    await page.waitForFunction(() => performance.getEntriesByName('cw:home').length > 0, null, { timeout: 120000 });
    await sleep(1500);
  } else {
    await cdp.send('Network.clearBrowserCache');
  }
  await cdp.send('Network.emulateNetworkConditions', NETWORKS[NET]);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'commit' });
  await page.waitForFunction(() => performance.getEntriesByName('cw:home').length > 0, null, { timeout: 180000, polling: 100 });
  const r = await page.evaluate(collect);
  r.wall = Date.now() - t0;
  await context.close();
  if (errors.length) throw new Error(`ошибки в консоли:\n${errors.join('\n')}`);
  return r;
}

const median = (xs) => {
  const s = xs.filter((x) => x !== null).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const sec = (ms) => (ms === null ? '—' : `${(ms / 1000).toFixed(2)} с`);
const kb = (b) => `${(b / 1024).toFixed(0)} КБ`;

function report(name, runs) {
  const m = (f) => median(runs.map(f));
  const k = runs[0].kinds;
  log(`${name} (медиана ${runs.length}):`);
  log(`  FCP (заставка index.html)  ${sec(m((r) => r.fcp))}`);
  log(`  первый кадр BootScene      ${sec(m((r) => r.boot))}`);
  log(`  главная готова             ${sec(m((r) => r.home))}`);
  log(`  до главной: JS ${k.js[0]} файл(ов) ${kb(k.js[1])}, картинки ${k.img[0]} ${kb(k.img[1])}, прочее ${k.other[0]} ${kb(k.other[1])}; из кэша ${runs[0].cached}`);
  return { fcp: m((r) => r.fcp), boot: m((r) => r.boot), home: m((r) => r.home), kinds: k, cached: runs[0].cached };
}

async function main() {
  if (process.env.LOAD_SKIP_BUILD !== '1') {
    log('сборка…');
    execSync('node node_modules/vite/bin/vite.js build', { stdio: 'ignore' });
  }
  const { chromium } = await loadPlaywright();
  const vite = await startPreview();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    log(`CPU ×${CPU}, сеть ${NET}, ${RUNS} прогона`);
    const cold = [];
    const warm = [];
    for (let i = 0; i < RUNS; i++) cold.push(await measure(browser, { warm: false }));
    for (let i = 0; i < RUNS; i++) warm.push(await measure(browser, { warm: true }));
    const out = { cpu: CPU, net: NET, cold: report('холодный старт', cold), warm: report('повторный визит', warm), raw: { cold, warm } };
    if (process.env.LOAD_JSON) writeFileSync(process.env.LOAD_JSON, JSON.stringify(out, null, 2));
    log('OK');
  } finally {
    await browser?.close();
    stopPreview(vite);
  }
}

main().catch((e) => {
  console.error('[load] FAIL', e.message ?? e);
  process.exit(1);
});
