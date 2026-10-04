#!/usr/bin/env node
/** Bounded Adventure regression smoke. Private browser fixtures only; no product edits or online writes. */
import { execSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const moduleRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE ? resolve(process.env.PLAYWRIGHT_MODULE) : join(moduleRoot, 'playwright', 'index.mjs')).href);
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const ORIGIN = arg('origin', 'http://127.0.0.1:5515');
const OUT = arg('out', 'ui-atlas/night-ui-cache');
const MODE = arg('mode', 'telegram');
const ROUTE = arg('route', 'Home,Campaign,Adventure,Tavern,Shop,Quests,Events,Mail,Friends,Tower,Hunt,Expeditions,Inventory,Achievements,Chronicle,Autobattler').split(',').filter(Boolean);
const NAV = arg('nav', 'Home,Heroes,Adventure,Campaign').split(',').filter(Boolean);
const WIDTH = Number(arg('width', '390')), HEIGHT = WIDTH === 360 ? 640 : 844;
const all = JSON.parse(readFileSync(arg('fixtures', 'ui-atlas-saves.json'), 'utf8'));
const PROFILE = arg('profile', 'late');
const FLOORS = arg('floors', '21,41,61').split(',').filter(x => x !== 'none' && x !== '').map(Number);
const REPEAT = Number(arg('repeat', '5'));
const MAX_MS = Number(arg('max-seconds', '240')) * 1000;
if (FLOORS.some(n => !Number.isInteger(n) || n < 1) || !Number.isInteger(REPEAT) || REPEAT < 1 || !Number.isFinite(MAX_MS) || MAX_MS < 1000) throw new Error('Invalid floors, repeat count or deadline');
if (!all.saves[PROFILE]) throw new Error(`Fixture ${PROFILE} is missing`);
mkdirSync(OUT, { recursive: true });
const report = { started: new Date().toISOString(), origin: ORIGIN, route: ROUTE, nav: NAV, floors: FLOORS, repeat: REPEAT, maxMs: MAX_MS, mode: MODE, profile: PROFILE, errors: [], steps: [] };
const save = () => writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const deadline = setTimeout(() => { report.deadlineExceeded = true; save(); void browser.close(); }, MAX_MS);
let current = 'Boot';
page.on('pageerror', e => { report.errors.push({ current, message: e.message, stack: e.stack }); save(); console.log('PAGEERROR', current, e.message); });
page.on('console', m => { if (m.type() === 'error') { report.errors.push({ current, console: m.text() }); console.log('CONSOLE', current, m.text()); } });
await context.route('**/*', route => { const u = new URL(route.request().url()); return ['http:', 'https:'].includes(u.protocol) && !['localhost', '127.0.0.1'].includes(u.hostname) ? route.abort() : route.continue(); });
await page.addInitScript(({ all, profile, height, mode }) => {
  localStorage.clear();
  localStorage.setItem('chronoworld.save.v1', all.saves[profile].save);
  localStorage.setItem('chronoworld.hints', JSON.stringify(all.hints));
  localStorage.setItem('chronoworld.hintsShown', JSON.stringify(all.hints));
  localStorage.setItem('chronoworld.battleAutoUlt', '1');
  localStorage.setItem('chronoworld.fpsCap', '60');
  if (mode === 'telegram') window.Telegram = { WebApp: { version: '9.0', platform: 'ios', initData: '', isFullscreen: true, isExpanded: true, viewportHeight: height, viewportStableHeight: height,
    safeAreaInset: { top: 47, bottom: 34, left: 0, right: 0 }, contentSafeAreaInset: { top: 89, bottom: 0, left: 0, right: 0 },
    ready() {}, expand() {}, requestFullscreen() {}, lockOrientation() {}, disableVerticalSwipes() {}, setHeaderColor() {}, setBackgroundColor() {}, setBottomBarColor() {},
    BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} }, onEvent() {}, offEvent() {} } };
  if (mode === 'canvas' || mode === 'webgl1') {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type === 'webgl2' || (mode === 'canvas' && ['webgl', 'experimental-webgl'].includes(type)) ? null : getContext.call(this, type, ...args); };
  }
}, { all, profile: PROFILE, height: HEIGHT, mode: MODE });
async function diagnostic() {
  return page.evaluate(() => {
    const g = window.__game;
    const walk = list => list.flatMap(o => [o, ...(o.list ? walk(o.list) : [])]);
    const missing = [];
    const adventure = { nav: [], tiles: [] };
    for (const sc of g.scene.getScenes(true)) for (const o of walk(sc.children.list)) if (o.frame && !o.frame.source) missing.push({ scene: sc.scene.key, name: o.name, type: o.type, x: o.x, y: o.y, texture: o.texture?.key, frame: o.frame.name, active: o.active, visible: o.visible, parent: o.parentContainer?.name });
    if (g.scene.isActive('Adventure')) for (const o of walk(g.scene.getScene('Adventure').children.list)) {
      if (o.name?.startsWith('nav_')) adventure.nav.push({ name: o.name, visible: o.visible, alpha: o.alpha, interactive: !!o.input?.enabled });
      if (['expeditionsTile', 'towerTile', 'huntTile', 'autobattlerTile'].includes(o.name)) adventure.tiles.push({ name: o.name, visible: o.visible, alpha: o.alpha, interactive: !!o.input?.enabled });
    }
    const gl = g.renderer.gl;
    const liveTextureKeys = new Set(g.scene.getScenes(true).flatMap(sc => walk(sc.children.list).map(o => o.texture?.key)).filter(Boolean));
    const backgrounds = Object.values(g.textures.list).filter(t => /^(skin_bg_(battle|map)_|bg_(battle|map)_)/.test(t.key)).map(t => ({ key: t.key, kind: /_(battle)_/.test(t.key) ? 'battle' : 'map', live: liveTextureKeys.has(t.key), sources: t.source.map(s => [s.width, s.height]) }));
    const idleBackgrounds = { battle: backgrounds.filter(t => t.kind === 'battle' && !t.live).length, map: backgrounds.filter(t => t.kind === 'map' && !t.live).length };
    return { scenes: g.scene.getScenes(true).map(s => s.scene.key), renderer: g.renderer.type, glVersion: gl?.getParameter(gl.VERSION), postrender: window.__qaRenders, lastRender: window.__qaLastRender, now: performance.now(), loopRunning: g.loop.running, invalid: window.__qaInvalid, missing, adventure, backgrounds, idleBackgrounds, cache: window.__sprites.stats() };
  });
}
async function record(label, expected, beforeFrames) {
  const d = await diagnostic();
  const file = label.replace(/[^\w-]/g, '_') + '.png';
  await page.screenshot({ path: join(OUT, file) });
  const failures = [];
  if (expected && !d.scenes.includes(expected)) failures.push(`Expected scene ${expected}; reached ${d.scenes.join(', ')}`);
  if (beforeFrames !== undefined && d.postrender <= beforeFrames) failures.push('No successful postrender after the action');
  if (d.invalid.length || d.missing.length) failures.push('A live image lost its texture source');
  if (expected === 'Adventure' && (d.adventure.nav.length !== 4 || d.adventure.tiles.length !== 4 || [...d.adventure.nav, ...d.adventure.tiles].some(o => !o.visible || o.alpha < .9 || !o.interactive))) failures.push('Adventure tiles or navigation are incomplete/invisible/disabled');
  report.steps.push({ label, expected, screenshot: file, ...d, failures }); save();
  console.log('STEP', label, d.scenes, 'frames', d.postrender, 'invalid', JSON.stringify(d.invalid), 'missing', JSON.stringify(d.missing));
  return !failures.length && !report.errors.length;
}
async function clickObject(selector, textMatch = false) {
  const pos = await page.evaluate(([selector, textMatch]) => {
    const sc = window.__game.scene.getScenes(true)[0];
    const walk = list => list.flatMap(o => [o, ...(o.list ? walk(o.list) : [])]);
    const o = walk(sc.children.list).find(o => textMatch ? o.type === 'Text' && o.text === selector && o.visible : o.name === selector && o.visible && o.alpha > .05);
    if (!o) return null;
    const b = o.getBounds(), v = window.__view();
    const p = o.type === 'Container' && o.input?.enabled ? o.getWorldTransformMatrix().transformPoint(0, 0) : { x: b.centerX, y: b.centerY };
    return { ...p, v };
  }, [selector, textMatch]);
  if (!pos) return false;
  const box = await page.locator('canvas').boundingBox(), scale = box.width / pos.v.worldW;
  await page.mouse.click(box.x + (pos.x - pos.v.worldX) * scale, box.y + (pos.y - pos.v.worldY) * scale);
  return true;
}
async function dismissDialogues() {
  for (let n = 0; n < 6; n++) {
    const open = await page.evaluate(() => !!window.__game.scene.getScenes(true)[0]?.children.getByName('dialogue'));
    if (!open) return;
    if (!await clickObject('Пропустить', true)) return;
    await page.waitForTimeout(450);
  }
}
async function openScene(key, label = 'open-' + key) {
  current = label;
  const before = await page.evaluate(() => window.__qaRenders);
  await page.evaluate(key => { const g = window.__game; for (const s of g.scene.getScenes(true)) g.scene.stop(s.scene.key); g.scene.start(key); }, key);
  await page.waitForFunction(key => window.__game.scene.isActive(key) && !window.__sprites.busy() && window.__game.scene.getScene(key).ready !== false, key, { timeout: 25000 });
  await page.waitForTimeout(750);
  await dismissDialogues();
  return record(label, key, before);
}
async function navigate(to, label = 'nav-' + to) {
  current = label;
  const before = await page.evaluate(() => window.__qaRenders);
  if (!await clickObject('nav_' + to)) {
    report.steps.push({ label, missingNav: true, failures: [`Missing visible navigation target ${to}`] }); save();
    return false;
  }
  await page.waitForTimeout(750);
  await dismissDialogues();
  return record(label, to, before);
}
try {
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__game?.scene && !window.__game.scene.isActive('Boot') && window.__game.scene.getScenes(true).length && !window.__sprites.busy(), null, { timeout: 90000 });
  await page.evaluate(() => {
    const g = window.__game;
    window.__qaRenders = 0; window.__qaInvalid = [];
    g.events.on('postrender', () => { window.__qaRenders++; window.__qaLastRender = performance.now(); });
    const p = g.renderer.pipelines?.get('MultiPipeline');
    if (p) {
      const batch = p.batchSprite;
      p.batchSprite = function(o, ...args) {
        if (!o.frame?.source) {
          const d = { scene: o.scene?.scene.key, name: o.name, type: o.type, x: o.x, y: o.y, texture: o.texture?.key, frame: o.frame?.name, textureSource: o.texture?.source?.map(x => !!x), parent: o.parentContainer?.name };
          window.__qaInvalid.push(d); console.error('QA_INVALID_FRAME ' + JSON.stringify(d));
        }
        return batch.call(this, o, ...args);
      };
    }
  });
  let okay = true;
  if (FLOORS.length) for (const floor of FLOORS) {
    // Synthetic rendering variants are confined to this private browser. They are not playthrough evidence.
    await page.evaluate(async floor => {
      const { session, commit } = await import('/src/game/session.ts');
      const { run: _run, last: _last, ...tower } = session.save.tower;
      commit({ ...session.save, tower: { ...tower, floor: floor - 1 } });
    }, floor);
    if (!await openScene('Tower', `floor${floor}-warm-Tower`)) { okay = false; break; }
    // The lobby displays the previous record. Warm the exact next-floor theme without a second live background.
    const beforeWarm = await page.evaluate(() => window.__qaRenders);
    await page.evaluate(async floor => {
      const B = await import('/src/game/backdrops.ts');
      const scene = window.__game.scene.getScene('Tower');
      const bg = scene.children.list.find(o => o.type === 'Image');
      if (!bg) throw new Error('Tower background image is missing');
      B.setThemeBackground(bg, 'battle', B.themeOfTowerFloor(floor));
    }, floor);
    await page.waitForTimeout(750);
    if (!await record(`floor${floor}-warm-next-theme`, 'Tower', beforeWarm) || !await navigate('Adventure', `floor${floor}-first-Adventure`)) { okay = false; break; }
    for (let n = 1; n <= REPEAT; n++) {
      if (!await navigate('Heroes', `floor${floor}-repeat${n}-Heroes`) || !await navigate('Adventure', `floor${floor}-repeat${n}-Adventure`)) { okay = false; break; }
    }
    if (!okay) break;
    if (!await openScene('Home', `floor${floor}-release-Home`)) { okay = false; break; }
    const released = await diagnostic();
    // Home's diorama is still a live owner; only spare keys count against the one-idle-background budget.
    const cacheFailures = Object.entries(released.idleBackgrounds).filter(([, count]) => count > 1).map(([kind, count]) => `${count} idle ${kind} backgrounds exceed the limit of one`);
    report.steps.push({ label: `floor${floor}-released-cache`, ...released, failures: cacheFailures }); save();
    if (cacheFailures.length) { okay = false; break; }
  }
  else {
    for (const key of ROUTE) if (!await openScene(key)) { okay = false; break; }
    if (okay) for (const to of NAV) if (!await navigate(to)) { okay = false; break; }
  }
  if (!okay) { await page.waitForTimeout(1000); await record('halt-after-' + current); }
  report.finished = new Date().toISOString();
} catch (e) { report.fatal = e.stack; console.error(e); }
finally { clearTimeout(deadline); save(); await context.close().catch(() => {}); await browser.close(); }
if (report.deadlineExceeded || report.fatal || report.errors.length || report.steps.some(s => s.missingNav || s.failures?.length || s.invalid?.length || s.missing?.length)) process.exitCode = 1;
