#!/usr/bin/env node
// Замер экранов меню (docs/design/ui-polish-research.md §7.3): для каждого экрана по сохранению атласа
// (scripts/ui-atlas-save.ts, по умолчанию late) — постройка сцены, объекты, твины, draw calls за кадр, память.
//   npm run perf:ui -- [--saves late] [--only Home,Stage] [--cpu 4] [--size 390x844] [--dpr 1] [--frames 5] [--units 8] [--strict]
// Что меряется (CPU ×4 через CDP Emulation.setCPUThrottlingRate, как npm run perf):
//   build    — от события START сцены до CREATE (init + create, без ожидания кадра), мс; холодный (первый вход) и повторный;
//   mark     — метки transitions.ts: 'scene:<ключ>:start' → 'scene:<ключ>:create' (с ожиданием шага игры), мс;
//   frame    — JS одного шага игры (update + render) после постройки, медиана по --frames ручным шагам, мс;
//   draws    — вызовы gl.drawElements/drawArrays за один шаг (обёртка в addInitScript), textures — сколько разных
//              текстур у видимых объектов (каждая — свой слот в батче WebGL);
//   objects / Text / Container / NineSlice — обход children сцены (src/game/perf.ts objectStats);
//   tweens   — активные твины сцены, decor — декоративные твины juice.ts (decorStats);
//   heap     — куча JS после сборки мусора, МБ; texMB — память текстур (w×h×4) в менеджере.
// Порог (§7.3): build > 120 мс при CPU ×4 или > 120 Text на экране меню — «!» в таблице; --strict — тогда код 1.
// Переменные: PERF_UI_PORT (5470), PERF_UI_JSON=файл — сырые цифры (для сравнения до/после).
// В headless Chromium WebGL программный: смотреть JS-время и счётчики, а не интервал кадров.
// Playwright глобальный (npm root -g), Chromium — из PLAYWRIGHT_BROWSERS_PATH; скрипт ничего не устанавливает.
import { execFileSync, execSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const PORT = Number(process.env.PERF_UI_PORT ?? 5470);
const URL = `http://localhost:${PORT}/`;
const SAVES = arg('saves', 'late').split(',').filter(Boolean);
const ONLY = arg('only', '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const CPU = Number(arg('cpu', process.env.PERF_UI_CPU ?? '4'));
const [VW, VH] = arg('size', '390x844').split('x').map(Number);
const DPR = Number(arg('dpr', '1'));
const FRAMES = Math.max(1, Number(arg('frames', '5')));
const STRICT = process.argv.includes('--strict');
/** Ограничить слоты текстур WebGL (MAX_TEXTURE_IMAGE_UNITS), как у слабого телефона: --units 8. 0 — как есть. */
const UNITS = Number(arg('units', '0'));
const BUILD_LIMIT_MS = 120;
const TEXT_LIMIT = 120;
const SAVE_KEY = 'chronoworld.save.v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[perf-ui]', ...a);

/** Экраны: key — сцена, data(meta) — данные create(). Result — после боя этапа («Пропустить»), последним. */
const SCREENS = [
  { name: 'Home', key: 'Home' },
  { name: 'Campaign', key: 'Campaign' },
  { name: 'Stage', key: 'Stage', data: (m) => ({ stageId: m.stageId }) },
  { name: 'Heroes', key: 'Heroes' },
  { name: 'Hero', key: 'Hero', data: (m) => ({ heroId: m.heroId }) },
  { name: 'Tavern', key: 'Tavern' },
  { name: 'Shop', key: 'Shop' },
  { name: 'Quests', key: 'Quests' },
  { name: 'Mail', key: 'Mail' },
  { name: 'Tower', key: 'Tower' },
  { name: 'Hunt', key: 'Hunt' },
  { name: 'Expeditions', key: 'Expeditions' },
  { name: 'Adventure', key: 'Adventure' },
  { name: 'Inventory', key: 'Inventory' },
  { name: 'Friends', key: 'Friends' },
  { name: 'Chronicle', key: 'Chronicle' },
  { name: 'Result', key: 'Result', battle: true },
];
const screens = SCREENS.filter((s) => !ONLY.length || ONLY.includes(s.name.toLowerCase()));

async function loadPlaywright() {
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  const entry = join(root, 'playwright', 'index.mjs');
  try {
    return await import(pathToFileURL(entry).href);
  } catch (e) {
    throw new Error(`Не найден глобальный Playwright (${entry}). Скрипт ничего не устанавливает.\n${e.message}`);
  }
}

async function startVite() {
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let out = '';
  let exited = null;
  vite.stdout.on('data', (d) => (out += d));
  vite.stderr.on('data', (d) => (out += d));
  vite.on('exit', (code) => (exited = code));
  for (let i = 0; i < 150; i++) {
    if (exited !== null) throw new Error(`vite завершился с кодом ${exited} (порт ${PORT} занят? PERF_UI_PORT=…):\n${out}`);
    try {
      if ((await fetch(URL)).ok) return vite;
    } catch {
      // ещё не поднялся
    }
    await sleep(200);
  }
  throw new Error(`vite не ответил за 30 с:\n${out}`);
}

function stopVite(vite) {
  if (!vite || vite.exitCode !== null) return;
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    vite.kill('SIGKILL');
  }
}

/**
 * Счётчик draw calls: обёртка drawElements/drawArrays (и instanced) у WebGL1/2 — до загрузки игры.
 * units > 0 — getParameter(MAX_TEXTURE_IMAGE_UNITS) не больше units (Phaser читает его при создании рендерера).
 */
function installDrawCounter(units) {
  window.__dc = 0;
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    if (units > 0) {
      const gp = C.prototype.getParameter;
      C.prototype.getParameter = function (p) {
        const v = gp.call(this, p);
        return p === 0x8872 && typeof v === 'number' ? Math.min(v, units) : v;
      };
    }
    for (const m of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const orig = C.prototype[m];
      if (typeof orig !== 'function') continue;
      C.prototype[m] = function (...a) {
        window.__dc++;
        return orig.apply(this, a);
      };
    }
  }
}

async function waitScene(page, key, timeout = 30000) {
  await page.waitForFunction(
    (k) => window.__game?.scene?.isActive(k) && !window.__sprites?.busy() && window.__game.scene.getScene(k).ready !== false,
    key,
    { timeout, polling: 100 },
  );
}

/**
 * Открыть экран через ScenePlugin (как игра — с метками transitions.ts), засечь START → CREATE сцены.
 * Перед этим все сцены останавливаются (без затемнения: экран-источник уже не RUNNING).
 */
async function openScene(page, key, data) {
  await page.evaluate(
    ([k, d]) => {
      const g = window.__game;
      const target = g.scene.getScene(k);
      window.__pu = { start: 0, create: 0 };
      target.sys.events.once('start', () => (window.__pu.start = performance.now()));
      target.sys.events.once('create', () => (window.__pu.create = performance.now()));
      const from = g.scene.getScenes(true)[0] ?? g.scene.getScene('Home');
      for (const s of g.scene.getScenes(true)) if (s !== from) g.scene.stop(s.scene.key);
      from.scene.start(k, d ?? {});
    },
    [key, data ?? null],
  );
}

/** Закрыть сюжетные диалоги поверх экрана: «Пропустить» — прямой вызов обработчика кнопки нельзя, поэтому кликом. */
async function closeDialogues(page, key) {
  for (let n = 0; n < 6; n++) {
    const pos = await page.evaluate((k) => {
      const sc = window.__game.scene.getScene(k);
      if (!sc.children.getByName('dialogue')) return null;
      const all = (list) => list.flatMap((o) => (o.list ? [o, ...all(o.list)] : [o]));
      const t = all(sc.children.list).find((o) => o.type === 'Text' && o.text === 'Пропустить' && o.visible);
      if (!t) return null;
      const b = t.getBounds();
      const v = window.__view?.() ?? { worldX: 0, worldY: 0, worldW: 1080 };
      return [b.centerX, b.centerY, v.worldX, v.worldY, v.worldW];
    }, key);
    if (!pos) return n;
    const box = await page.locator('canvas').boundingBox();
    const s = box.width / pos[4];
    await page.mouse.click(box.x + (pos[0] - pos[2]) * s, box.y + (pos[1] - pos[3]) * s);
    await sleep(500);
  }
  return 6;
}

/** Снять цифры экрана: счётчики объектов, твины, кадр и draw calls (ручные шаги при усыплённом цикле), память. */
async function sample(page, cdp, key) {
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  const heap = await cdp.send('Runtime.getHeapUsage').catch(() => null);
  const r = await page.evaluate(
    async ([k, frames]) => {
      const g = window.__game;
      const sc = g.scene.getScene(k);
      const P = await import('/src/game/perf.ts');
      const J = await import('/src/game/juice.ts');
      const stats = P.objectStats(sc.children.list);
      const tweens = sc.tweens.getTweens().length;
      const decor = J.decorStats(sc).tweens;
      // Ручные шаги: игровой цикл усыплён, шаг = update + render одного кадра.
      g.loop.sleep();
      let t = performance.now();
      const draws = [];
      const ms = [];
      for (let i = 0; i < frames + 1; i++) {
        t += 1000 / 60;
        const d0 = window.__dc;
        const a = performance.now();
        g.step(t, 1000 / 60);
        const b = performance.now();
        if (i === 0) continue; // первый шаг после сна — с разовыми делами (часы, догоняющие таймеры)
        draws.push(window.__dc - d0);
        ms.push(b - a);
      }
      g.loop.wake();
      const med = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
      // Источник считаем один раз: кадры атласа скина делят одну текстуру.
      const seen = new Set();
      let texBytes = 0;
      for (const [name, tex] of Object.entries(g.textures.list)) {
        if (name.startsWith('__')) continue;
        for (const s of tex.source ?? []) {
          if (seen.has(s.glTexture ?? s)) continue;
          seen.add(s.glTexture ?? s);
          texBytes += (s.width || 0) * (s.height || 0) * 4;
        }
      }
      const textures = P.textureCount(sc.children.list);
      const marks = (n) => performance.getEntriesByName(n).at(-1)?.startTime ?? null;
      const mS = marks(`scene:${k}:start`);
      const mC = marks(`scene:${k}:create`);
      return {
        ...stats,
        textures,
        tweens,
        decor,
        draws: med(draws),
        frameMs: med(ms),
        texMB: texBytes / 1048576,
        build: window.__pu && window.__pu.create && window.__pu.start ? window.__pu.create - window.__pu.start : null,
        mark: mS !== null && mC !== null && mC >= mS ? mC - mS : null,
        renderer: g.renderer.type === 2 ? 'webgl' : 'canvas',
        units: g.renderer.maxTextures ?? null,
      };
    },
    [key, FRAMES],
  );
  r.heapMB = heap ? heap.usedSize / 1048576 : null;
  return r;
}

/** Бой этапа → «Пропустить» → Итоги: засечь постройку Result. */
async function openResult(page, meta) {
  await openScene(page, 'Battle', { mode: 'stage', stageId: meta.stageId });
  await waitScene(page, 'Battle', 60000);
  await closeDialogues(page, 'Battle');
  await page.evaluate(() => {
    const g = window.__game;
    const target = g.scene.getScene('Result');
    window.__pu = { start: 0, create: 0 };
    target.sys.events.once('start', () => (window.__pu.start = performance.now()));
    target.sys.events.once('create', () => (window.__pu.create = performance.now()));
    const sc = g.scene.getScene('Battle');
    if (g.scene.isActive('Battle') && !sc.finished) sc.skip();
  });
  await waitScene(page, 'Result', 60000);
  await page.waitForFunction(() => window.__game.scene.getScene('Result').ready, null, { timeout: 15000, polling: 100 }).catch(() => {});
}

async function runSave(browser, saveName, meta, hints) {
  const context = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR });
  const page = await context.newPage();
  const errors = [];
  let current = 'Boot';
  page.on('pageerror', (e) => errors.push(`${current}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon/.test(m.location()?.url ?? '')) errors.push(`${current}: ${m.text()}`);
  });
  await page.addInitScript(installDrawCounter, UNITS);
  await page.addInitScript(
    ([key, save, hints]) => {
      if (sessionStorage.getItem('perf-ui-init')) return;
      localStorage.clear();
      localStorage.setItem(key, save);
      localStorage.setItem('chronoworld.hints', JSON.stringify(hints));
      localStorage.setItem('chronoworld.hintsShown', JSON.stringify(hints));
      localStorage.setItem('chronoworld.battleAutoUlt', '1');
      localStorage.setItem('chronoworld.hint.manualUlt', '1');
      localStorage.setItem('chronoworld.hint.bossCharge', '1');
      sessionStorage.setItem('perf-ui-init', '1');
    },
    [SAVE_KEY, meta.save, hints],
  );
  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.enable').catch(() => {});
  await page.goto(URL);
  await page.waitForFunction(() => window.__game?.scene?.getScenes(true).some((s) => s.scene.key !== 'Boot' && s.scene.key !== undefined), null, { timeout: 120000, polling: 200 });
  await waitScene(page, (await page.evaluate(() => window.__game.scene.getScenes(true)[0].scene.key)), 60000);
  await sleep(800);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  const rows = [];
  try {
    for (const pass of ['cold', 'warm']) {
      for (const sc of screens) {
        current = `${pass} ${sc.name}`;
        try {
          if (sc.battle) await openResult(page, meta);
          else {
            await openScene(page, sc.key, sc.data?.(meta));
            await waitScene(page, sc.key);
          }
          await sleep(300);
          const dialogues = await closeDialogues(page, sc.key);
          await sleep(700);
          const r = await sample(page, cdp, sc.key);
          rows.push({ save: saveName, pass, screen: sc.name, dialogues, ...r });
        } catch (e) {
          rows.push({ save: saveName, pass, screen: sc.name, error: String(e.message ?? e).split('\n')[0] });
          log(`${saveName} ${pass} ${sc.name}: ошибка — ${String(e.message ?? e).split('\n')[0]}`);
        }
      }
    }
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
    await context.close();
  }
  return { rows, errors };
}

const f = (v, d = 0) => (v === null || v === undefined ? '—' : Number(v).toFixed(d));

function table(rows, saveName) {
  const cold = new Map(rows.filter((r) => r.save === saveName && r.pass === 'cold').map((r) => [r.screen, r]));
  const warm = new Map(rows.filter((r) => r.save === saveName && r.pass === 'warm').map((r) => [r.screen, r]));
  const head = ['экран', 'build хол.', 'build повт.', 'mark', 'кадр мс', 'draws', 'текстур', 'объектов', 'Text', 'Cont', '9-sl', 'твинов', 'decor', 'куча МБ', 'текстуры МБ'];
  const out = [head];
  const flags = [];
  for (const s of screens) {
    const c = cold.get(s.name);
    const w = warm.get(s.name) ?? c;
    if (!c || c.error) {
      out.push([s.name, c?.error ? 'ошибка' : '—']);
      continue;
    }
    const bad = (c.build ?? 0) > BUILD_LIMIT_MS || (w?.build ?? 0) > BUILD_LIMIT_MS || c.text > TEXT_LIMIT;
    if (bad) flags.push(s.name);
    out.push([
      s.name + (bad ? ' !' : ''),
      f(c.build),
      f(w?.build),
      f(w?.mark),
      f(w?.frameMs, 1),
      f(w?.draws),
      f(w?.textures),
      f(w?.total),
      f(w?.text),
      f(w?.containers),
      f(w?.nineslices),
      f(w?.tweens),
      f(w?.decor),
      f(w?.heapMB, 1),
      f(w?.texMB, 1),
    ]);
  }
  const widths = head.map((_, i) => Math.max(...out.map((r) => String(r[i] ?? '').length)));
  for (const r of out) console.log(r.map((v, i) => (i === 0 ? String(v ?? '').padEnd(widths[i]) : String(v ?? '').padStart(widths[i]))).join('  '));
  return flags;
}

async function main() {
  log(`сохранения: ${SAVES.join(', ')}; ${VW}×${VH} dpr ${DPR}; CPU ×${CPU}${UNITS ? `; слотов текстур ≤ ${UNITS}` : ''}; экранов: ${screens.length}`);
  const raw = execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/ui-atlas-save.ts', '--saves', SAVES.join(',')], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const { saves, hints } = JSON.parse(raw);
  const { chromium } = await loadPlaywright();
  const vite = await startVite();
  let browser;
  const rows = [];
  const errors = [];
  try {
    browser = await chromium.launch({ headless: true });
    for (const s of SAVES.filter((x) => saves[x])) {
      const r = await runSave(browser, s, saves[s], hints);
      rows.push(...r.rows);
      errors.push(...r.errors.map((e) => `${s} ${e}`));
    }
  } finally {
    await browser?.close();
    stopVite(vite);
  }
  let flagged = [];
  for (const s of SAVES.filter((x) => saves[x])) {
    log(`${saves[s].label}`);
    const any = rows.find((r) => r.save === s && r.renderer);
    if (any) log(`рендер ${any.renderer}, слотов текстур в батче: ${any.units ?? '?'}${UNITS ? ` (ограничено --units ${UNITS})` : ''}`);
    log(`build — START→CREATE сцены (мс, CPU ×${CPU}); mark — метки transitions.ts; кадр/draws — один шаг игры; «!» — build > ${BUILD_LIMIT_MS} мс или Text > ${TEXT_LIMIT}`);
    flagged = flagged.concat(table(rows, s).map((n) => `${s}:${n}`));
  }
  // ERR_INSUFFICIENT_RESOURCES — Chromium отказал в запросе (очередь/память/диск контейнера под CPU ×4), не ошибка игры:
  // печатаем предупреждением; цифры такого экрана стоит перемерить.
  const envNoise = (e) => /ERR_INSUFFICIENT_RESOURCES/.test(e);
  const warnings = errors.filter(envNoise);
  errors.splice(0, errors.length, ...errors.filter((e) => !envNoise(e)));
  if (warnings.length) log(`предупреждения браузера (${warnings.length}, перемерить экраны): ${[...new Set(warnings.map((w) => w.split(':')[0]))].join(', ')}`);
  if (errors.length) {
    log(`ошибки консоли (${errors.length}):`);
    for (const e of errors.slice(0, 20)) log('  ' + e);
  }
  if (process.env.PERF_UI_JSON) writeFileSync(process.env.PERF_UI_JSON, JSON.stringify({ cpu: CPU, units: UNITS, size: `${VW}x${VH}`, dpr: DPR, rows, errors, warnings }, null, 2));
  if (flagged.length) log(`выше порога: ${flagged.join(', ')}`);
  const failed = rows.some((r) => r.error) || errors.length > 0 || (STRICT && flagged.length > 0);
  log(failed ? 'FAIL' : 'OK');
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error('[perf-ui] FAIL', e.message ?? e);
  process.exit(1);
});
