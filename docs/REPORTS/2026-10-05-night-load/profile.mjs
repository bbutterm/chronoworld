#!/usr/bin/env node
// Read-only production-build probe. No source injection or game-save mutations.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.env.AUDIT_ROOT ?? process.cwd());
const dist = resolve(root, process.env.AUDIT_DIST ?? 'dist');
const out = resolve(process.env.AUDIT_OUT ?? '/tmp/chronoworld-cold-load-audit');
const port = Number(process.env.AUDIT_PORT ?? 5198);
const rate = Number(process.env.AUDIT_CPU ?? 4);
const net = process.env.AUDIT_NET ?? 'none';
const runs = Number(process.env.AUDIT_RUNS ?? 1);
const profile = process.env.AUDIT_PROFILE === '1';
const details = process.env.AUDIT_DETAILS !== '0';
const suppliedSave = process.env.AUDIT_SAVE ? JSON.parse(readFileSync(resolve(process.env.AUDIT_SAVE), 'utf8')) : null;
const suppliedNow = Number(process.env.AUDIT_NOW ?? 0);
const modes = (process.env.AUDIT_MODES ?? 'cold,warm').split(',');
const failPack = process.env.AUDIT_FAIL_PACK === '1';
const failPortrait = process.env.AUDIT_FAIL_PORTRAIT ?? '';
const expectedFault = request => (failPack && /\/assets\/boot-[^/]+\.bin/.test(request)) ||
  (failPortrait && new RegExp(`/sprites/portraits/${failPortrait}\\.(png|webp)(?:\\?|$)`).test(request));
const networks = {
  fast3g: { offline: false, latency: 562.5, downloadThroughput: 180000, uploadThroughput: 84375 },
  none: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
};
if (!networks[net]) throw new Error(`Unsupported network ${net}`);
mkdirSync(out, { recursive: true });
const helper = readFileSync(join(root, 'scripts/lib/perf-browser.mjs'), 'utf8').replace("['preview']", "['preview', '--outDir', process.env.AUDIT_DIST ?? 'dist']");
const { loadPlaywright, browserOptions, startVite, stopVite } = await import(`data:text/javascript;base64,${Buffer.from(helper).toString('base64')}`);
const { textureMemory } = await import(pathToFileURL(join(root, 'scripts/lib/texture-memory.mjs')));
const { chromium } = await loadPlaywright();
process.chdir(root);
const url = `http://localhost:${port}/`;
const phaserFile = readdirSync(join(dist, 'assets')).find(f => /^phaser-.*\.js$/.test(f));
if (!phaserFile) throw new Error('No production Phaser chunk');
const vite = await startVite(port, url, true);
let browser;

function collect() {
  const home = performance.getEntriesByName('cw:home')[0]?.startTime ?? null;
  const entries = performance.getEntriesByType('resource').map(r => ({
    name: r.name.replace(location.origin, ''), initiator: r.initiatorType,
    start: r.startTime, end: r.responseEnd, transfer: r.transferSize,
    encoded: r.encodedBodySize, decoded: r.decodedBodySize,
    fetch: r.fetchStart, request: r.requestStart, response: r.responseStart,
  }));
  return {
    home, marks: performance.getEntriesByType('mark').map(r => ({ name: r.name, start: r.startTime })),
    paint: performance.getEntriesByType('paint').map(r => ({ name: r.name, start: r.startTime })),
    navigation: performance.getEntriesByType('navigation').map(r => ({
      start: r.startTime, end: r.responseEnd, transfer: r.transferSize,
      encoded: r.encodedBodySize, decoded: r.decodedBodySize,
    })),
    resources: entries, fonts: document.fonts?.status,
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
  };
}

async function memory(cdp) {
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const metrics = await cdp.send('Performance.getMetrics');
  const proto = await cdp.send('Runtime.evaluate', {
    expression: `import('/assets/${phaserFile}').then(m => {
      for (const value of Object.values(m)) {
        const p = typeof value === 'function' ? value() : value;
        if (p?.Game && p?.Scene) return p.Game.prototype;
      }
      throw new Error('Production Phaser export not found');
    })`, awaitPromise: true, objectGroup: 'load-audit',
  });
  if (proto.exceptionDetails || !proto.result.objectId) throw new Error('Unable to inspect production Game prototype');
  const objects = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId, objectGroup: 'load-audit' });
  const res = await cdp.send('Runtime.callFunctionOn', {
    objectId: objects.objects.objectId, returnByValue: true,
    functionDeclaration: `function () {
      const textureMemory = ${textureMemory.toString()};
      return this.map(game => {
        const textures = textureMemory(Object.entries(game.textures.list).map(([key, t]) => ({ key, source: t.source })));
        return {
          renderer: game.renderer?.constructor?.name, width: game.canvas?.width, height: game.canvas?.height,
          textures: textures.sort((a,b) => b.bytes - a.bytes),
          textureBytes: textures.reduce((sum, t) => sum + t.bytes, 0),
          portraitFilters: Object.entries(game.textures.list).filter(([key]) => key.startsWith('portrait_')).map(([key, t]) => ({ key, filters: t.source.map(s => s.scaleMode) })),
          scenes: game.scene.scenes.filter(s => s.sys.isActive()).map(s => s.sys.settings.key),
        };
      });
    }`,
  });
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'load-audit' });
  if (res.exceptionDetails) throw new Error('Production texture query failed');
  return { metrics: Object.fromEntries(metrics.metrics.map(m => [m.name, m.value])), games: res.result.value };
}

async function measure(index, warm) {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  if (failPack || failPortrait) await context.route('**/*', route => {
    const request = route.request().url();
    if (expectedFault(request)) {
      return route.fulfill({ status: 404, body: 'Asset failure injected by read-only audit' });
    }
    return route.continue();
  });
  if (suppliedSave) await page.addInitScript(({ save, now }) => {
    localStorage.setItem('chronoworld.save.v1', JSON.stringify(save));
    if (now) {
      const OriginalDate = Date;
      globalThis.Date = class extends OriginalDate {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
      };
    }
  }, { save: suppliedSave, now: suppliedNow });
  const errors = [], warnings = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') {
      const msg = m.text();
      if (expectedFault(m.location().url) && /Failed to load resource:.*404/.test(msg)) warnings.push(`Expected injected 404: ${m.location().url}`);
      else errors.push(msg);
    }
    if (m.type() === 'warning') warnings.push(m.text());
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  let requests = new Map();
  cdp.on('Network.requestWillBeSent', e => {
    if (!e.request.url.startsWith(url)) return;
    requests.set(e.requestId, { id: e.requestId, url: e.request.url.replace(url.slice(0,-1), ''), timestamp: e.timestamp, type: e.type, method: e.request.method, initiator: e.initiator.type });
  });
  cdp.on('Network.responseReceived', e => {
    const r = requests.get(e.requestId);
    if (!r) return;
    Object.assign(r, { responseTimestamp: e.timestamp, status: e.response.status, mime: e.response.mimeType, headers: e.response.headers, fromDiskCache: e.response.fromDiskCache, encodedDataLengthAtHeaders: e.response.encodedDataLength, protocol: e.response.protocol });
  });
  cdp.on('Network.loadingFinished', e => {
    const r = requests.get(e.requestId);
    if (r) Object.assign(r, { endTimestamp: e.timestamp, encodedDataLength: e.encodedDataLength });
  });
  cdp.on('Network.loadingFailed', e => {
    const r = requests.get(e.requestId);
    if (r) Object.assign(r, { failed: e.errorText });
  });
  if (warm) {
    await page.goto(url);
    await page.waitForFunction(() => performance.getEntriesByName('cw:home').length > 0, null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    requests = new Map(); errors.length = 0; warnings.length = 0;
  } else {
    await cdp.send('Network.clearBrowserCache');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  }
  await cdp.send('Network.emulateNetworkConditions', networks[net]);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  if (profile) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.start');
  }
  console.log(JSON.stringify({ phase: 'navigate', warm, index, cpu: rate, net }));
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => performance.getEntriesByName('cw:home').length > 0, null, { timeout: 180000, polling: 100 });
  const atHome = await page.evaluate(collect);
  console.log(JSON.stringify({ phase: 'home', warm, index, home: atHome.home, marks: atHome.marks }));
  if (profile) {
    const cpu = await cdp.send('Profiler.stop');
    writeFileSync(join(out, `${warm ? 'warm' : 'cold'}-${index}.cpuprofile`), JSON.stringify(cpu.profile));
  }
  if (details) await page.waitForTimeout(500);
  const afterHome = details ? await page.evaluate(collect) : atHome;
  const document = [...requests.values()].find(r => r.type === 'Document');
  const origin = document?.timestamp;
  const http = [...requests.values()].map(r => ({ ...r, start: origin ? (r.timestamp - origin) * 1000 : null, end: origin && r.endTimestamp ? (r.endTimestamp - origin) * 1000 : null }));
  const mem = details ? await memory(cdp) : null;
  if (details) await page.screenshot({ path: join(out, `${warm ? 'warm' : 'cold'}-${index}.png`) });
  await context.close();
  return { warm, index, atHome, afterHome, http, memoryAfterHomeGC: mem, errors, warnings };
}

try {
  browser = await chromium.launch({ ...browserOptions(), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const measurements = [];
  for (let i = 1; i <= runs; i++) {
    if (modes.includes('cold')) measurements.push(await measure(i, false));
    if (modes.includes('warm')) measurements.push(await measure(i, true));
  }
  const data = { root, dist, cpu: rate, network: net, browser: browser.version(), launchGraphics: 'SwiftShader software WebGL', details, injectedFailures: { failPack, failPortrait }, suppliedSave: process.env.AUDIT_SAVE ?? null, suppliedNow, profileOverhead: profile, scope: 'Local production build via Vite preview; no physical phone FPS measurement', measurements };
  writeFileSync(join(out, 'network-memory.json'), JSON.stringify(data, null, 2));
  for (const r of measurements) console.log(JSON.stringify({ warm: r.warm, home: r.atHome.home, marks: r.atHome.marks, http: r.http.length, errors: r.errors, textureBytes: r.memoryAfterHomeGC?.games?.[0]?.textureBytes, jsHeap: r.memoryAfterHomeGC?.metrics.JSHeapUsedSize }));
  if (measurements.some(r => r.errors.length)) process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  stopVite(vite);
}
