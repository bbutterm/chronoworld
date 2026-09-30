#!/usr/bin/env node
// Кадры поведения в бою (docs/design/battle-behavior.md): отход стрелка, перехват стража, провокация, связь крестоносца,
// фаза босса со свитой. Сохранения — scripts/behavior-save.ts; бой проигрывается по кадрам вручную (как skillfx-shots.mjs),
// при первом нужном событии — серия кадров.
//   npx tsx scripts/behavior-save.ts > /tmp/behavior.json
//   SHOTS_SIZE=390x844 SHOTS_PORT=5791 node scripts/behavior-shots.mjs /tmp/behavior.json <папка>
// Playwright глобальный (npm root -g), Chromium — из PLAYWRIGHT_BROWSERS_PATH; скрипт ничего не устанавливает. Поднимает vite сам.
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.SHOTS_PORT ?? 5791);
const URL = `http://localhost:${PORT}/`;
const [savesFile, outDir] = process.argv.slice(2);
if (!savesFile || !outDir) throw new Error('usage: behavior-shots.mjs <saves.json> <out dir>');
const OFFSETS = [150, 450, 900];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[behavior]', ...a);

async function loadPlaywright() {
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return import(pathToFileURL(join(root, 'playwright', 'index.mjs')).href);
}

async function startVite() {
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let out = '';
  vite.stdout.on('data', (d) => (out += d));
  vite.stderr.on('data', (d) => (out += d));
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(URL)).ok) return vite;
    } catch {
      // ещё не поднялся
    }
    await sleep(200);
  }
  throw new Error(`vite не ответил:\n${out}`);
}

/** Какое событие лога снимаем в сцене (по имени сцены из behavior-save.ts). */
const MATCH = {
  кайт: (e) => e.type === 'move' && e.reason === 'kite',
  страж: (e) => e.type === 'move' && e.reason === 'intercept',
  провокация: (e) => e.type === 'status' && e.taunt === true,
  // Связь — после баннера босса (первые секунды поле затемнено).
  связь: (e) => e.type === 'link' && e.action === 'apply' && e.t >= 4,
  фаза: (e) => e.type === 'phase',
};

const scenes = JSON.parse(readFileSync(savesFile, 'utf8'));
const { chromium } = await loadPlaywright();
const vite = await startVite();
mkdirSync(outDir, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const sc of scenes) {
    const [vw, vh] = (process.env.SHOTS_SIZE ?? '390x844').split('x').map(Number);
    const page = await browser.newPage({ viewport: { width: vw, height: vh } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.addInitScript((save) => {
      if (!sessionStorage.getItem('behavior-init')) {
        localStorage.clear();
        localStorage.setItem('chronoworld.save.v1', save);
        sessionStorage.setItem('behavior-init', '1');
      }
    }, sc.save);
    await page.goto(URL);
    await page.waitForFunction(() => window.__game?.scene?.isActive('Campaign'), null, { timeout: 60000, polling: 100 });
    await page.evaluate((stageId) => {
      const g = window.__game;
      for (const s of g.scene.getScenes(true)) if (s.scene.key !== 'Battle') g.scene.stop(s.scene.key);
      g.scene.start('Battle', { mode: 'stage', stageId });
    }, sc.stageId);
    await page.waitForFunction(() => window.__game.scene.getScene('Battle')?.ready === true, null, { timeout: 60000, polling: 100 });
    await page.evaluate(([offsets, match]) => {
      const g = window.__game;
      g.loop.sleep();
      const sc = g.scene.getScene('Battle');
      // eslint-disable-next-line no-new-func
      window.__cap = { t: performance.now(), last: 0, done: false, queue: [], sc, offsets, match: new Function('e', `return (${match})(e)`) };
    }, [OFFSETS, MATCH[sc.name].toString()]);
    let shots = 0;
    for (let guard = 0; guard < 5000; guard++) {
      const due = await page.evaluate(() => {
        const c = window.__cap;
        const g = window.__game;
        const sc = c.sc;
        for (let f = 0; f < 600; f++) {
          const ready = c.queue.findIndex((q) => q.at <= sc.time.now);
          if (ready >= 0) return c.queue.splice(ready, 1)[0];
          if (c.done && c.queue.length === 0) return { end: true };
          if (sc.finished || !g.scene.isActive('Battle')) return c.queue.length ? c.queue.shift() : { end: true };
          c.t += 1000 / 60;
          g.step(c.t, 1000 / 60);
          const log = sc.result.log;
          for (; c.last < sc.cursor; c.last++) {
            if (c.done || !c.match(log[c.last])) continue;
            c.done = true;
            for (const o of c.offsets) c.queue.push({ at: sc.time.now + o, ms: o, t: log[c.last].t });
          }
        }
        return { wait: true };
      });
      if (due.end) break;
      if (due.wait) continue;
      const file = `${sc.name}_${due.ms}.png`;
      await page.screenshot({ path: join(outDir, file) });
      shots++;
      log(`${sc.name}: ${file} (бой ${due.t} с)`);
    }
    log(`${sc.name}: ${shots} кадров, ошибок ${errors.length}`);
    for (const e of errors.slice(0, 5)) log('  ', e);
    await page.close();
  }
} finally {
  await browser?.close();
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    vite.kill('SIGKILL');
  }
}
