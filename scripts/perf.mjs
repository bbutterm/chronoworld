#!/usr/bin/env node
// Замер производительности боя в браузере (как e2e: сам поднимает vite, Playwright глобальный,
// Chromium уже скачан — скрипт ничего не устанавливает). Эмулирует слабый телефон: CPU ×4 медленнее
// (CDP Emulation.setCPUThrottlingRate), скорость боя 2x, N одинаковых тестовых боёв подряд (seed 7).
// Меряет: интервал кадров (rAF), время шага Phaser (prestep → postrender), число объектов сцены,
// твины/таймеры, кучу JS после сборки мусора, память текстур (w×h×4). Падает при ошибках в консоли
// и при утечках между боями (растут слушатели/твины/таймеры, объекты сцены не удаляются, куча пухнет).
// Переменные: PERF_PORT (5185), PERF_RUNS (5), PERF_CPU (4), PERF_SEED (7), PERF_HEAP_LEAK_MB (8),
// PERF_JSON=файл — сырые цифры, PERF_SNAPSHOT=файл — снимок кучи после боёв (для поиска удерживающих ссылок).
// Память текстур меряется по экранам: главная, список героев, карточка героя, бой, главная после боёв.
// Подробности и цифры: docs/content/performance.md.
import { execSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.PERF_PORT ?? 5185);
const URL = `http://localhost:${PORT}/`;
const RUNS = Number(process.env.PERF_RUNS ?? 5);
const CPU = Number(process.env.PERF_CPU ?? 4);
const SEED = Number(process.env.PERF_SEED ?? 7);
/** Рост кучи между 2-м и последним боем, после которого считаем, что память течёт. */
const HEAP_LEAK_MB = Number(process.env.PERF_HEAP_LEAK_MB ?? 8);

const log = (...a) => console.log('[perf]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadPlaywright() {
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  const entry = join(root, 'playwright', 'index.mjs');
  try {
    return await import(pathToFileURL(entry).href);
  } catch (e) {
    throw new Error(`Не найден глобальный Playwright (${entry}). Он нужен заранее установленным: perf ничего не ставит.\n${e.message}`);
  }
}

async function startVite() {
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let out = '';
  vite.stdout.on('data', (d) => (out += d));
  vite.stderr.on('data', (d) => (out += d));
  let exited = null;
  vite.on('exit', (code) => (exited = code));
  for (let i = 0; i < 150; i++) {
    if (exited !== null) throw new Error(`vite завершился с кодом ${exited} (порт ${PORT} занят?):\n${out}`);
    try {
      const r = await fetch(URL);
      if (r.ok) return vite;
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
    if (process.platform !== 'win32') process.kill(-vite.pid, 'SIGTERM');
    else vite.kill('SIGTERM');
  } catch {
    vite.kill('SIGKILL');
  }
}

/** В странице: сборщик кадров и выборки объектов. Живёт в window.__perf. */
function installProbe() {
  const g = window.__game;
  const P = { on: false, frames: [], steps: [], samples: [], stepStart: 0, last: 0, made: { objects: 0, texts: 0, tweens: 0, timers: 0 } };
  window.__perf = P;
  // Сколько за бой создаётся игровых объектов, твинов и таймеров (churn — нагрузка на GC и загрузку текстур).
  const battle = g.scene.getScene('Battle');
  battle.sys.events.on('addedtoscene', (o) => {
    if (!P.on) return;
    P.made.objects++;
    if (o.type === 'Text') P.made.texts++;
    P.made[o.type] = (P.made[o.type] ?? 0) + 1;
  });
  const home = g.scene.getScene('Home');
  const wrap = (proto, names, key) => {
    for (const n of names) {
      const orig = proto[n];
      proto[n] = function (...args) {
        if (P.on && this.scene === battle) P.made[key]++;
        return orig.apply(this, args);
      };
    }
  };
  wrap(Object.getPrototypeOf(home.tweens), ['add', 'addCounter', 'chain'], 'tweens');
  wrap(Object.getPrototypeOf(home.time), ['addEvent'], 'timers');
  const countDeep = (list) => {
    let n = 0;
    let texts = 0;
    for (const o of list) {
      n++;
      if (o.type === 'Text') texts++;
      if (o.list) {
        const c = countDeep(o.list);
        n += c.n;
        texts += c.texts;
      }
    }
    return { n, texts };
  };
  // Таймеры Phaser плюс своя очередь сцены боя (Scheduler), если она есть.
  const timers = (sc) => sc.time._active.length + sc.time._pendingInsertion.length + (sc.later?.size ?? 0);
  P.sample = () => {
    const sc = g.scene.getScene('Battle');
    if (!sc || !g.scene.isActive('Battle')) return null;
    const { n, texts } = countDeep(sc.children.list);
    return { objects: n, texts, tweens: sc.tweens.getTweens().length, timers: timers(sc) };
  };
  const raf = (t) => {
    if (P.on) {
      if (P.last) P.frames.push(t - P.last);
      P.last = t;
    } else P.last = 0;
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
  g.events.on('prestep', () => (P.stepStart = performance.now()));
  g.events.on('postrender', () => {
    if (P.on && P.stepStart) P.steps.push(performance.now() - P.stepStart);
  });
  setInterval(() => {
    if (!P.on) return;
    const s = P.sample();
    if (s) P.samples.push(s);
  }, 250);
  /** Сколько слушателей висит на долгоживущих эмиттерах (игра, масштаб, текстуры, анимации, события сцены боя). */
  P.listeners = () => {
    const total = (em) => (em?.eventNames ? em.eventNames().reduce((s, n) => s + em.listenerCount(n), 0) : 0);
    const sc = g.scene.getScene('Battle');
    return {
      game: total(g.events),
      scale: total(g.scale),
      textures: total(g.textures),
      anims: total(g.anims),
      input: total(g.input.events),
      battleInput: total(sc.input),
      battleSys: total(sc.sys.events),
      battleLoad: total(sc.load),
    };
  };
  P.leftovers = () => {
    const sc = g.scene.getScene('Battle');
    return {
      objects: countDeep(sc.children.list).n,
      update: sc.sys.updateList.length,
      tweens: sc.tweens.getTweens().length,
      timers: timers(sc),
      textures: g.textures.getTextureKeys().length,
      anims: g.anims.anims.size,
    };
  };
  /** Все загруженные текстуры: ключ, размер источника, байт (w×h×4). */
  P.textures = () =>
    g.textures.getTextureKeys().map((key) => {
      const t = g.textures.get(key);
      let bytes = 0;
      const dims = [];
      for (const s of t.source) {
        bytes += s.width * s.height * 4;
        dims.push(`${s.width}x${s.height}`);
      }
      return { key, dims: dims.join('+'), bytes };
    });
  /** Все текстуры, МБ (w×h×4), и сколько из них листы юнитов spr_*. */
  P.texMB = () => {
    const all = P.textures();
    const sum = (a) => a.reduce((s, t) => s + t.bytes, 0) / 1048576;
    return { all: sum(all), sheets: sum(all.filter((t) => t.key.startsWith('spr_'))), count: all.length };
  };
  /** Сцена показана и дозагрузила листы (ленивая загрузка спрайтов; у старых сборок её нет). */
  P.settled = (k) => {
    if (!g.scene.isActive(k)) return false;
    const sc = g.scene.getScene(k);
    return !(window.__sprites?.busy() ?? false) && sc.ready !== false;
  };
  /** Прототипы классов Phaser (для подсчёта живых экземпляров через CDP queryObjects) — берём у объектов боя. */
  P.grabProtos = () => {
    const sc = g.scene.getScene('Battle');
    const all = (list) => list.flatMap((o) => (o.list ? [o, ...all(o.list)] : [o]));
    const objs = all(sc.children.list);
    P.protos = {};
    for (const t of ['Text', 'Image', 'Sprite', 'Container']) {
      const o = objs.find((x) => x.type === t);
      if (o) P.protos[t] = Object.getPrototypeOf(o);
    }
  };
  P.battleSprites = () => [...g.scene.getScene('Battle').views.values()].map((v) => v.look.key);
}

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
};
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
const mb = (b) => (b / 1048576).toFixed(1);
const f1 = (v) => v.toFixed(1);

async function main() {
  const { chromium } = await loadPlaywright();
  const vite = await startVite();
  log(`vite: ${URL}, CPU ×${CPU}, боёв: ${RUNS}, seed ${SEED}, скорость 2x`);
  let browser;
  const problems = [];
  const rows = [];
  let tex = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (/favicon/.test(m.location()?.url ?? '')) return;
      problems.push(`console.error: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.enable');
    await cdp.send('Performance.enable');
    /** Время JS за всё время жизни страницы, с (CDP Performance.getMetrics: ScriptDuration). */
    const scriptSec = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'ScriptDuration')?.value ?? 0;

    await page.goto(URL);
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('chronoworld.battleSpeed', '2');
    });
    await page.reload();
    await page.waitForFunction(() => window.__game?.scene?.isActive('Home'), null, { timeout: 60000 });
    await sleep(500);
    await page.evaluate(installProbe);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });

    const heapMB = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      await cdp.send('HeapProfiler.collectGarbage');
      const h = await cdp.send('Runtime.getHeapUsage');
      return h.usedSize / 1048576;
    };
    const heap0 = await heapMB();

    // Память текстур по экранам (без замедления CPU, до боёв).
    const screens = [];
    const texOn = async (name, key, data) => {
      if (key) {
        await page.waitForFunction(() => window.__game.scene.getScenes(true).length > 0, null, { timeout: 30000 });
        await page.evaluate(([k, d]) => window.__game.scene.getScenes(true)[0].scene.start(k, d), [key, data]);
        await page.waitForFunction((k) => window.__perf.settled(k), key ?? 'Home', { timeout: 60000 });
        await sleep(800);
      }
      const t = await page.evaluate(() => window.__perf.texMB());
      screens.push({ name, ...t });
      log(`текстуры, ${name}: ${f1(t.all)} МБ (листы юнитов ${f1(t.sheets)}), текстур ${t.count}`);
    };
    await texOn('главная (после загрузки)');
    await texOn('список героев', 'Heroes');
    const heroId = await page.evaluate(() => {
      try {
        const s = JSON.parse(localStorage.getItem('chronoworld.save.v1') ?? 'null');
        return (s?.heroes ?? s?.data?.heroes ?? s?.save?.heroes)?.[0]?.id ?? null;
      } catch {
        return null;
      }
    });
    if (heroId) await texOn('карточка героя', 'Hero', { heroId });
    await texOn('главная (после карточки)', 'Home');
    /**
     * Сколько живых (после сборки мусора) экземпляров Text/Image/Sprite/Container во всей игре
     * и сколько из них уже уничтожены, но удерживаются чьими-то ссылками (dead).
     */
    const liveObjects = async () => {
      const out = { dead: 0 };
      const { result: names } = await cdp.send('Runtime.evaluate', { expression: 'Object.keys(window.__perf.protos ?? {})', returnByValue: true });
      for (const name of names.value) {
        const { result: proto } = await cdp.send('Runtime.evaluate', { expression: `window.__perf.protos[${JSON.stringify(name)}]`, objectGroup: 'perf' });
        const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.objectId, objectGroup: 'perf' });
        const { result: r } = await cdp.send('Runtime.callFunctionOn', {
          objectId: objects.objectId,
          functionDeclaration: 'function () { return [this.length, this.filter((o) => !o.scene).length]; }',
          returnByValue: true,
        });
        out[name] = r.value[0];
        out.dead += r.value[1];
      }
      // Иначе массивы результатов держит сама DevTools-сессия — и объекты «утекают» из-за замера.
      await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'perf' });
      return out;
    };

    for (let i = 1; i <= RUNS; i++) {
      await page.waitForFunction(() => window.__game.scene.getScenes(true).length > 0, null, { timeout: 30000 });
      const script0 = await scriptSec();
      await page.evaluate((seed) => {
        const P = window.__perf;
        P.frames = [];
        P.made = { objects: 0, texts: 0, tweens: 0, timers: 0 };
        P.steps = [];
        P.samples = [];
        P.on = true;
        window.__game.scene.getScenes(true)[0].scene.start('Battle', { mode: 'test', seed });
      }, SEED);
      await page.waitForFunction(() => window.__perf.settled('Battle') || window.__game.scene.isActive('Result'), null, { timeout: 60000 });
      if (i === 1) {
        await page.evaluate(() => window.__perf.grabProtos());
        tex = await page.evaluate(() => ({ all: window.__perf.textures(), used: window.__perf.battleSprites() }));
        const t = await page.evaluate(() => window.__perf.texMB());
        screens.push({ name: 'бой', ...t });
      }
      await page.waitForFunction(() => window.__game.scene.isActive('Result'), null, { timeout: 180000, polling: 500 });
      const data = await page.evaluate(() => {
        const P = window.__perf;
        P.on = false;
        return { frames: P.frames, steps: P.steps, samples: P.samples, made: P.made, listeners: P.listeners(), leftovers: P.leftovers() };
      });
      const script = (await scriptSec()) - script0;
      const heap = await heapMB();
      const live = await liveObjects();
      const max = (k) => Math.max(0, ...data.samples.map((s) => s[k]));
      const row = {
        run: i,
        frames: data.frames.length,
        frameAvg: avg(data.frames),
        frameP95: pct(data.frames, 0.95),
        jank: data.frames.filter((f) => f > 50).length,
        stepAvg: avg(data.steps),
        stepP95: pct(data.steps, 0.95),
        maxObjects: max('objects'),
        maxTexts: max('texts'),
        maxTweens: max('tweens'),
        maxTimers: max('timers'),
        script,
        made: data.made,
        heap,
        live,
        listeners: data.listeners,
        leftovers: data.leftovers,
      };
      rows.push(row);
      log(
        `бой ${i}: кадр ср ${f1(row.frameAvg)} мс, p95 ${f1(row.frameP95)}; шаг ср ${f1(row.stepAvg)}, p95 ${f1(row.stepP95)}; ` +
          `JS ${row.script.toFixed(2)} с; создано объектов ${row.made.objects} (Text ${row.made.texts}), твинов ${row.made.tweens}, таймеров ${row.made.timers}; ` +
          `объектов до ${row.maxObjects} (Text ${row.maxTexts}), твинов до ${row.maxTweens}, таймеров до ${row.maxTimers}; куча ${f1(heap)} МБ`,
      );
      await sleep(300);
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await texOn(`главная (после ${RUNS} боёв)`, 'Home');
    if (process.env.PERF_SNAPSHOT) {
      const chunks = [];
      cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => chunks.push(e.chunk));
      await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
      writeFileSync(process.env.PERF_SNAPSHOT, chunks.join(''));
    }

    // Утечки: после выхода из боя сцена пуста, слушатели и счётчики не растут от боя к бою.
    const first = rows[0];
    const last = rows[rows.length - 1];
    for (const k of Object.keys(first.listeners)) {
      if (last.listeners[k] > first.listeners[k]) problems.push(`утечка слушателей ${k}: ${first.listeners[k]} → ${last.listeners[k]}`);
    }
    for (const k of ['objects', 'update', 'tweens', 'timers']) {
      if (last.leftovers[k] > 0) problems.push(`после боя в сцене Battle осталось ${k}: ${last.leftovers[k]}`);
    }
    for (const k of ['textures', 'anims']) {
      if (last.leftovers[k] > first.leftovers[k]) problems.push(`растёт число ${k}: ${first.leftovers[k]} → ${last.leftovers[k]}`);
    }
    if (rows.length > 2) {
      const growth = last.heap - rows[1].heap;
      if (growth > HEAP_LEAK_MB) problems.push(`куча растёт от боя к бою: +${f1(growth)} МБ (бои 2→${rows.length})`);
      // Уничтоженные объекты сцены должны собираться: число живых экземпляров не растёт от боя к бою.
      for (const [k, n] of Object.entries(last.live)) {
        if (n > rows[1].live[k]) problems.push(`не собираются объекты ${k}: после 2-го боя ${rows[1].live[k]}, после ${rows.length}-го ${n}`);
      }
    }

    // Итог.
    const all = (k) => rows.map((r) => r[k]);
    const sum = (a) => a.reduce((s, t) => s + t.bytes, 0);
    const spr = tex.all.filter((t) => t.key.startsWith('spr_'));
    const used = new Set(tex.used);
    const summary = {
      cpu: CPU,
      runs: RUNS,
      frameAvg: avg(all('frameAvg')),
      frameP95: avg(all('frameP95')),
      stepAvg: avg(all('stepAvg')),
      stepP95: avg(all('stepP95')),
      jank: all('jank').reduce((a, b) => a + b, 0),
      scriptSec: avg(all('script')),
      madeObjects: avg(rows.map((r) => r.made.objects)),
      madeTexts: avg(rows.map((r) => r.made.texts)),
      madeTweens: avg(rows.map((r) => r.made.tweens)),
      madeTimers: avg(rows.map((r) => r.made.timers)),
      maxObjects: Math.max(...all('maxObjects')),
      maxTexts: Math.max(...all('maxTexts')),
      maxTweens: Math.max(...all('maxTweens')),
      maxTimers: Math.max(...all('maxTimers')),
      heapStart: heap0,
      heapFirst: first.heap,
      heapLast: last.heap,
      texturesMB: sum(tex.all) / 1048576,
      spritesMB: sum(spr) / 1048576,
      battleSpritesMB: sum(spr.filter((t) => used.has(t.key))) / 1048576,
    };
    console.log('\n| метрика | значение |\n|---|---|');
    console.log(`| кадр (rAF), ср / p95, мс (CPU ×${CPU}) | ${f1(summary.frameAvg)} / ${f1(summary.frameP95)} |`);
    console.log(`| шаг Phaser (update+render), ср / p95, мс | ${f1(summary.stepAvg)} / ${f1(summary.stepP95)} |`);
    console.log(`| кадров > 50 мс за ${RUNS} боёв | ${summary.jank} |`);
    console.log(`| макс. объектов в сцене (из них Text) | ${summary.maxObjects} (${summary.maxTexts}) |`);
    console.log(`| время JS за бой (ScriptDuration), с | ${summary.scriptSec.toFixed(2)} |`);
    console.log(`| макс. твинов / таймеров одновременно | ${summary.maxTweens} / ${summary.maxTimers} |`);
    console.log(
      `| создано за бой: объектов (из них Text) / твинов / таймеров | ${summary.madeObjects.toFixed(0)} (${summary.madeTexts.toFixed(0)}) / ${summary.madeTweens.toFixed(0)} / ${summary.madeTimers.toFixed(0)} |`,
    );
    console.log(`| куча JS: старт / после 1-го / после ${RUNS}-го боя, МБ | ${f1(heap0)} / ${f1(first.heap)} / ${f1(last.heap)} |`);
    console.log(`| живых объектов после боёв, Text/Image/Sprite/Container | ${rows.map((r) => `${r.live.Text}/${r.live.Image}/${r.live.Sprite}/${r.live.Container}`).join(' → ')} |`);
    console.log(`| из них уничтоженных, но удерживаемых ссылками | ${rows.map((r) => r.live.dead).join(' → ')} |`);
    console.log(`| текстуры всего, МБ (w×h×4) | ${f1(summary.texturesMB)} |`);
    console.log(`| из них листы юнитов spr_* / нужные этому бою, МБ | ${f1(summary.spritesMB)} / ${f1(summary.battleSpritesMB)} |`);
    console.log('\n| экран | текстуры, МБ | из них листы юнитов, МБ | текстур |\n|---|---|---|---|');
    for (const t of screens) console.log(`| ${t.name} | ${f1(t.all)} | ${f1(t.sheets)} | ${t.count} |`);
    console.log('\nЛисты юнитов, крупнейшие (* — нужен этому бою):');
    for (const t of [...spr].sort((a, b) => b.bytes - a.bytes).slice(0, 15)) {
      console.log(`  ${used.has(t.key) ? '*' : ' '} ${t.key.padEnd(28)} ${t.dims.padEnd(11)} ${mb(t.bytes).padStart(6)} МБ`);
    }
    if (process.env.PERF_JSON) writeFileSync(process.env.PERF_JSON, JSON.stringify({ summary, screens, rows, textures: tex.all, used: [...used] }, null, 2));
  } catch (e) {
    problems.push(`сценарий: ${e.message}`);
  } finally {
    await browser?.close().catch(() => {});
    stopVite(vite);
  }
  if (problems.length) {
    console.error(`\n[perf] ПРОВАЛ (${problems.length}):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  log('OK');
  process.exit(0);
}

main().catch((e) => {
  console.error('[perf] ПРОВАЛ:', e.message);
  process.exit(1);
});
