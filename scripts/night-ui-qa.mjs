#!/usr/bin/env node
/** Read-only product QA: private browser fixtures, explicit renderer/Telegram coverage and real pointer clicks. */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const moduleRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE ? resolve(process.env.PLAYWRIGHT_MODULE) : join(moduleRoot, 'playwright', 'index.mjs')).href);
const arg = (key, fallback) => { const i = process.argv.indexOf(`--${key}`); return i < 0 ? fallback : process.argv[i + 1]; };
const ORIGIN = arg('origin', 'http://127.0.0.1:5515');
const OUT = resolve(arg('out', 'ui-atlas/night-ui-qa'));
const FIXTURES = JSON.parse(readFileSync(arg('fixtures', 'ui-atlas-saves.json'), 'utf8'));
const ONLY = arg('only', '').split(',').filter(Boolean);
const COMBOS = arg('combos', 'new-browser-390,late-telegram-390,mid-telegram-360,new-webgl1-360,late-canvas-360').split(',');
const MAX_MS = Number(arg('max-seconds', '600')) * 1000;
if (!Number.isFinite(MAX_MS) || MAX_MS < 1000) throw new Error('Invalid global deadline');
const SCENES = ['Home', 'Campaign', 'Adventure', 'Tavern', 'Shop', 'Quests', 'Events', 'Mail', 'Friends', 'Tower', 'Hunt', 'Expeditions', 'Inventory', 'Achievements', 'Chronicle', 'Autobattler'];
const report = { started: new Date().toISOString(), origin: ORIGIN, fixtures: Object.fromEntries(Object.entries(FIXTURES.saves).map(([k, v]) => [k, v.label])), combos: [], errors: [], blockedRequests: [] };
mkdirSync(OUT, { recursive: true });
const save = () => writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
const active = page => page.evaluate(() => window.__game.scene.getScenes(true).map(s => s.scene.key));
async function start(page, key, data = {}) {
  await page.evaluate(([key, data]) => {
    const game = window.__game;
    for (const sc of game.scene.getScenes(true)) game.scene.stop(sc.scene.key);
    game.scene.start(key, data);
  }, [key, data]);
  await page.waitForFunction(key => window.__game.scene.isActive(key) && !window.__sprites.busy() && window.__game.scene.getScene(key).ready !== false, key, { timeout: 25000 });
  await page.waitForTimeout(750);
}
async function state(page, key) {
  return page.evaluate(key => {
    const sc = window.__game.scene.getScene(key);
    const view = window.__view();
    const walk = (list, visible = true, alpha = 1) => list.flatMap(o => {
      const shown = visible && o.visible !== false;
      const a = alpha * (o.alpha ?? 1);
      const bounds = o.getBounds?.();
      const entry = { name: o.name, type: o.type, text: o.text, x: o.x, y: o.y, visible: shown, alpha: a, depth: o.depth, interactive: !!o.input?.enabled,
        bounds: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : undefined };
      return [entry, ...(o.list ? walk(o.list, shown, a) : [])];
    });
    const objects = walk(sc.children.list);
    const nav = objects.filter(o => o.name?.startsWith('nav_'));
    const texts = objects.filter(o => o.type === 'Text' && o.visible && o.alpha > 0.05 && o.bounds?.height > 0);
    const rendered = texts.filter(o => o.bounds.x + o.bounds.width > view.worldX && o.bounds.x < view.worldX + view.worldW && o.bounds.y + o.bounds.height > view.worldY && o.bounds.y < view.worldY + view.worldH);
    const gl = window.__game.renderer.gl;
    return { active: window.__game.scene.getScenes(true).map(s => s.scene.key), view, renderer: window.__game.renderer.type, glVersion: gl?.getParameter(gl.VERSION), renderFrames: window.__nightQaFrames, renderAgeMs: performance.now() - window.__nightQaLastRender, childCount: objects.length, nav, texts: rendered, named: objects.filter(o => o.name), interactive: objects.filter(o => o.interactive && o.visible && o.alpha > .05) };
  }, key);
}
async function click(page, key, selector, textMatch = false) {
  const pos = await page.evaluate(([key, selector, textMatch]) => {
    const sc = window.__game.scene.getScene(key);
    const walk = list => list.flatMap(o => [o, ...(o.list ? walk(o.list) : [])]);
    const shown = o => { let p = o; while (p) { if (!p.visible || p.alpha === 0) return false; p = p.parentContainer; } return true; };
    const o = walk(sc.children.list).find(o => (textMatch ? o.type === 'Text' && o.text === selector : o.name === selector) && shown(o));
    if (!o) return null;
    const b = o.getBounds(), v = window.__view();
    const center = o.type === 'Container' && o.input?.enabled ? o.getWorldTransformMatrix().transformPoint(0, 0) : { x: b.centerX, y: b.centerY };
    return { ...center, view: v, name: o.name, input: !!o.input?.enabled };
  }, [key, selector, textMatch]);
  if (!pos) return { clicked: false, reason: 'object-missing-or-invisible', selector };
  const box = await page.locator('canvas').boundingBox();
  const scale = box.width / pos.view.worldW;
  const x = box.x + (pos.x - pos.view.worldX) * scale, y = box.y + (pos.y - pos.view.worldY) * scale;
  if (x < 0 || x > box.x + box.width || y < 0 || y > box.y + box.height) return { clicked: false, reason: 'outside-canvas', selector, x, y };
  await page.mouse.click(x, y);
  await page.waitForTimeout(650);
  return { clicked: true, selector, x, y, active: await active(page) };
}
async function dismiss(page, key) {
  for (let n = 0; n < 6; n++) {
    const found = await page.evaluate(key => !!window.__game.scene.getScene(key).children.getByName('dialogue'), key);
    if (!found) return;
    const r = await click(page, key, 'Пропустить', true);
    if (!r.clicked) return;
  }
}
async function screenshot(page, combo, scene) {
  const file = `${combo}_${scene}.png`;
  await page.screenshot({ path: join(OUT, file) });
  return file;
}
async function interactive(page, combo, profile) {
  const interactions = [];
  // Actual bottom-tab navigation must reach the target; a click alone is not a pass.
  for (const to of ['Home', 'Heroes', 'Adventure', 'Campaign']) {
    const from = (await active(page))[0];
    const r = await click(page, from, `nav_${to}`);
    r.expected = to; r.ok = r.clicked && r.active.includes(to);
    interactions.push(r);
    if (!r.ok) break;
    await dismiss(page, to);
  }
  await start(page, 'Home');
  interactions.push(await click(page, 'Home', 'settings'));
  const settings = await state(page, 'Home');
  interactions.push({ kind: 'settings-open', ok: settings.named.some(o => o.name === 'settingsModal'), state: settings });
  interactions.push(await click(page, 'Home', 'fpsCap'));
  interactions.push(await click(page, 'Home', 'reduceMotion'));
  interactions.push(await click(page, 'Home', 'settingsClose'));
  const closed = await state(page, 'Home');
  interactions.push({ kind: 'settings-close', ok: !closed.named.some(o => o.name === 'settingsModal'), listeners: await page.evaluate(() => window.__game.scene.getScene('Home').input.listenerCount('wheel')) });
  await start(page, 'Tavern');
  interactions.push(await click(page, 'Tavern', 'tavernInfo'));
  const tavern = await state(page, 'Tavern');
  interactions.push({ kind: 'tavern-rates', ok: tavern.named.some(o => ['bottomSheet', 'ratesModal'].includes(o.name)), state: tavern });
  const close = await click(page, 'Tavern', 'sheetClose');
  interactions.push(close);
  await start(page, 'Shop');
  const shopBefore = await state(page, 'Shop');
  if (shopBefore.named.some(o => o.name === 'shopSlot0')) {
    interactions.push(await click(page, 'Shop', 'shopSlot0'));
    const shop = await state(page, 'Shop');
    interactions.push({ kind: 'shop-sheet', ok: shop.named.some(o => o.name === 'bottomSheet'), state: shop });
    interactions.push(await click(page, 'Shop', 'sheetClose'));
  } else interactions.push({ kind: 'shop-sheet', skipped: true, reason: 'Shop is locked in this fixture' });
  await start(page, 'Chronicle');
  interactions.push(await click(page, 'Chronicle', 'chronicleTavern'));
  interactions.push({ kind: 'chronicle-tavern-entry', active: await active(page) });
  if (profile !== 'new') {
    await start(page, 'Autobattler');
    interactions.push(await click(page, 'Autobattler', 'autobattlerInfo'));
    interactions.push({ kind: 'arena-rules', state: await state(page, 'Autobattler') });
    interactions.push(await click(page, 'Autobattler', 'sheetClose'));
    interactions.push(await click(page, 'Autobattler', 'autobattlerStart'));
    const prep = await state(page, 'Autobattler');
    interactions.push({ kind: 'arena-start', ok: prep.named.some(o => o.name === 'autobattlerGo'), state: prep, screenshot: await screenshot(page, combo, 'AutobattlerPrep') });
    interactions.push(await click(page, 'Autobattler', 'autobattlerOpponent'));
    interactions.push({ kind: 'arena-opponent-sheet', state: await state(page, 'Autobattler') });
    interactions.push(await click(page, 'Autobattler', 'sheetClose'));
    interactions.push(await click(page, 'Autobattler', 'autobattlerTrain'));
    interactions.push({ kind: 'arena-training-sheet', state: await state(page, 'Autobattler') });
    interactions.push(await click(page, 'Autobattler', 'sheetClose'));
    interactions.push(await click(page, 'Autobattler', 'autobattlerSynergies'));
    interactions.push({ kind: 'arena-synergies-sheet', state: await state(page, 'Autobattler') });
    interactions.push(await click(page, 'Autobattler', 'sheetClose'));
  }
  return interactions;
}
async function run(browser, combo) {
  const [profile, mode, widthString] = combo.split('-');
  const width = Number(widthString), height = width === 360 ? 640 : 844;
  const meta = FIXTURES.saves[profile];
  if (!meta) throw new Error('Missing fixture: ' + profile);
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  let current = 'Boot';
  page.on('pageerror', e => { report.errors.push({ combo, scene: current, type: 'pageerror', message: e.message, stack: e.stack }); save(); console.log('PAGEERROR', combo, current, e.message); });
  page.on('console', m => { if (m.type() === 'error') { report.errors.push({ combo, scene: current, type: 'console', message: m.text() }); save(); } });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
      report.blockedRequests.push({ combo, scene: current, url: url.origin + url.pathname });
      return route.abort();
    }
    return route.continue();
  });
  await page.addInitScript(({ fixture, hints, mode, height }) => {
    localStorage.clear();
    localStorage.setItem('chronoworld.save.v1', fixture.save);
    localStorage.setItem('chronoworld.hints', JSON.stringify(hints));
    localStorage.setItem('chronoworld.hintsShown', JSON.stringify(hints));
    localStorage.setItem('chronoworld.battleAutoUlt', '1');
    localStorage.setItem('chronoworld.fpsCap', '60');
    if (mode === 'telegram') {
      const handlers = {};
      const app = { version: '9.0', platform: 'ios', initData: '', isFullscreen: true, isExpanded: true, viewportHeight: height, viewportStableHeight: height,
        safeAreaInset: { top: 47, bottom: 34, left: 0, right: 0 }, contentSafeAreaInset: { top: 89, bottom: 0, left: 0, right: 0 },
        ready() {}, expand() {}, requestFullscreen() {}, lockOrientation() {}, disableVerticalSwipes() {}, setHeaderColor() {}, setBackgroundColor() {}, setBottomBarColor() {},
        BackButton: { show() {}, hide() {}, onClick(fn) { handlers.back = fn; }, offClick() { handlers.back = null; } },
        onEvent(event, fn) { handlers[event] = fn; }, offEvent(event) { delete handlers[event]; } };
      window.Telegram = { WebApp: app }; window.__qaTelegram = { handlers, app };
    }
    if (mode === 'webgl1' || mode === 'canvas') {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        if (type === 'webgl2' || (mode === 'canvas' && ['webgl', 'experimental-webgl'].includes(type))) return null;
        return original.call(this, type, ...args);
      };
    }
  }, { fixture: meta, hints: FIXTURES.hints, mode, height });
  const result = { combo, profile, mode, width, height, screens: [], interactions: [] };
  report.combos.push(result);
  try {
    await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(() => window.__game?.scene && !window.__game.scene.isActive('Boot') && window.__game.scene.getScenes(true).length > 0 && !window.__sprites.busy(), null, { timeout: 90000 });
    await page.evaluate(() => {
      window.__nightQaFrames = 0; window.__nightQaLastRender = performance.now();
      window.__game.events.on('postrender', () => { window.__nightQaFrames++; window.__nightQaLastRender = performance.now(); });
    });
    result.boot = await active(page);
    for (const key of SCENES.filter(key => !ONLY.length || ONLY.includes(key))) {
      current = key;
      try {
        await start(page, key);
        await dismiss(page, key);
        const s = await state(page, key);
        result.screens.push({ key, reached: s.active.includes(key), renderAlive: s.renderFrames > 0 && s.renderAgeMs < 2000, state: s, screenshot: await screenshot(page, combo, key) });
        console.log('SCREEN', combo, key, 'objects', s.childCount, 'nav', s.nav.length, 'texts', s.texts.length);
      } catch (e) {
        result.screens.push({ key, reached: false, error: e.stack, active: await active(page).catch(() => []) });
        console.log('FAILED', combo, key, e.message);
      }
      save();
    }
    if (!ONLY.length) { current = 'Interactions'; result.interactions = await interactive(page, combo, profile); }
  } catch (e) { result.fatal = e.stack; console.log('FATAL', combo, e.message); }
  finally { await context.close(); save(); }
}
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const deadline = setTimeout(() => { report.deadlineExceeded = true; save(); void browser.close(); }, MAX_MS);
try { for (const combo of COMBOS) await run(browser, combo); report.finished = new Date().toISOString(); }
finally { clearTimeout(deadline); save(); await browser.close(); }
console.log('FINISHED', report.combos.length, 'combos', report.errors.length, 'errors');
if (report.deadlineExceeded || report.errors.length || report.combos.some(c => c.fatal || c.screens.some(s => !s.reached || s.renderAlive === false) || c.interactions.some(x => x.ok === false))) process.exitCode = 1;
