#!/usr/bin/env node
// Кадры эффектов навыков героев в бою (docs/content/skills-vfx.md): отряды из scripts/skillfx-save.ts (все 12 героев,
// базовые формы и обе ветки), бой этапа проигрывается по кадрам вручную (цикл Phaser усыплён, game.step по 16.7 мс),
// при первом применении каждого навыка героя (атака навыком, конец каста, срабатывание пассивки) — серия кадров.
//   npx tsx scripts/skillfx-save.ts > /tmp/squads.json
//   SHOTS_PORT=5781 node scripts/skillfx-shots.mjs /tmp/squads.json <папка> [имя отряда…]
// В папке: <отряд>/<герой>_<навык>_<мс>.png и index.json (навык → кадры). Playwright глобальный (npm root -g),
// Chromium — из PLAYWRIGHT_BROWSERS_PATH; скрипт ничего не устанавливает. Поднимает vite сам.
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.SHOTS_PORT ?? 5781);
const URL = `http://localhost:${PORT}/`;
const [squadsFile, outDir, ...only] = process.argv.slice(2);
if (!squadsFile || !outDir) throw new Error('usage: skillfx-shots.mjs <squads.json> <out dir> [squad names]');
/** Кадры после применения навыка, мс времени сцены. */
const OFFSETS = (process.env.SHOTS_OFFSETS ?? '120,320,560,900').split(',').map(Number);
const REDUCED = process.env.SHOTS_REDUCED === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[shots]', ...a);

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

const squads = JSON.parse(readFileSync(squadsFile, 'utf8')).filter((s) => !only.length || only.includes(s.name));
const { chromium } = await loadPlaywright();
const vite = await startVite();
const index = {};
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const sq of squads) {
    const dir = join(outDir, sq.name);
    // id героя в бою (h1…) → шаблон и форма: alan-knight, iris (база).
    const who = Object.fromEntries(JSON.parse(sq.save).heroes.map((h) => [h.id, h.branch ? `${h.templateId}-${h.branch}` : h.templateId]));
    mkdirSync(dir, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.addInitScript(([save, reduced]) => {
      if (!sessionStorage.getItem('skillfx-init')) {
        localStorage.clear();
        localStorage.setItem('chronoworld.save.v1', save);
        if (reduced) localStorage.setItem('chronoworld.reduceMotion', '1');
        sessionStorage.setItem('skillfx-init', '1');
      }
    }, [sq.save, REDUCED]);
    await page.goto(URL);
    await page.waitForFunction(() => window.__game?.scene?.isActive('Campaign'), null, { timeout: 60000, polling: 100 });
    await page.evaluate((stageId) => {
      const g = window.__game;
      for (const s of g.scene.getScenes(true)) if (s.scene.key !== 'Battle') g.scene.stop(s.scene.key);
      g.scene.start('Battle', { mode: 'stage', stageId });
    }, sq.stageId);
    await page.waitForFunction(() => window.__game.scene.getScene('Battle')?.ready === true, null, { timeout: 60000, polling: 100 });
    // Цикл Phaser — вручную: кадр за кадром по 16.7 мс, кадры в нужные моменты.
    await page.evaluate((offsets) => {
      const g = window.__game;
      g.loop.sleep();
      const sc = g.scene.getScene('Battle');
      window.__cap = { t: performance.now(), last: 0, seen: new Set(), queue: [], sc, offsets };
    }, OFFSETS);
    let shots = 0;
    for (let guard = 0; guard < 20000; guard++) {
      const due = await page.evaluate(() => {
        const c = window.__cap;
        const g = window.__game;
        const sc = c.sc;
        for (let f = 0; f < 600; f++) {
          const ready = c.queue.findIndex((q) => q.at <= sc.time.now);
          if (ready >= 0) return c.queue.splice(ready, 1)[0];
          if (sc.finished || !g.scene.isActive('Battle')) return c.queue.length ? c.queue.shift() : { end: true };
          c.t += 1000 / 60;
          g.step(c.t, 1000 / 60);
          const log = sc.result.log;
          for (; c.last < sc.cursor; c.last++) {
            const e = log[c.last];
            const v = sc.views.get(e.unit);
            if (!v || v.snap.side !== 'A') continue;
            let kind = null;
            if (e.type === 'attack' && e.name) kind = 'skill';
            else if (e.type === 'passive') kind = 'passive';
            else if (e.type === 'cast' && e.action === 'start') kind = 'cast';
            if (!kind) continue;
            const key = `${v.def.id}:${e.skill}:${kind}`;
            if (c.seen.has(key)) continue;
            c.seen.add(key);
            const offs = kind === 'cast' ? [500] : c.offsets;
            for (const o of offs) c.queue.push({ at: sc.time.now + o, hero: v.def.id, skill: e.skill, kind, ms: o, name: e.name ?? '' });
          }
        }
        return { wait: true };
      });
      if (due.end) break;
      if (due.wait) continue;
      due.hero = who[due.hero] ?? due.hero;
      const file = `${due.hero}_${due.skill}_${due.kind === 'cast' ? 'cast' : due.ms}.png`;
      await page.screenshot({ path: join(dir, file) });
      shots++;
      (index[`${due.hero}:${due.skill}`] ??= { squad: sq.name, hero: due.hero, skill: due.skill, kind: due.kind === 'cast' ? 'skill' : due.kind, frames: [] }).frames.push(join(sq.name, file));
    }
    log(`${sq.name}: ${shots} кадров, ошибок ${errors.length}`);
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
writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 1));
log('готово:', Object.keys(index).length, 'навыков');
