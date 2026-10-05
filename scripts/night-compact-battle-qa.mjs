#!/usr/bin/env node
/** Real controls on a lawful profile; changing viewport/insets never edits progression or combat state. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

const arg = (key, fallback) => { const i = process.argv.indexOf('--' + key); return i < 0 ? fallback : process.argv[i + 1]; };
const SAVE = arg('save'), CLOCK = arg('clock');
if (!SAVE || !CLOCK) throw new Error('--save and --clock are required lawful profile files');
const origin = arg('origin', 'http://127.0.0.1:5536');
const stage = arg('stage', 'ch10_s18'), width = Number(arg('width', '360')), height = Number(arg('height', width === 360 ? '640' : '844'));
const scenario = arg('scenario', 'victory');
const renderer = arg('renderer', 'canvas'), out = resolve(arg('out', '/tmp/chronoworld-night-compact-battle'));
const profile = JSON.parse(readFileSync(SAVE, 'utf8')), clock = JSON.parse(readFileSync(CLOCK, 'utf8'));
if (!Number.isFinite(clock.now) || !['canvas', 'webgl1'].includes(renderer) || !['victory', 'defeat'].includes(scenario) || !Number.isFinite(width) || !Number.isFinite(height)) throw new Error('Invalid fixture');
const moduleRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
const modulePath = process.env.PLAYWRIGHT_MODULE ? resolve(process.env.PLAYWRIGHT_MODULE) : join(moduleRoot, 'playwright', 'index.mjs');
const { chromium } = await import(pathToFileURL(modulePath).href);
mkdirSync(out, { recursive: true });
const report = { method: 'Existing lawful profile; real Stage fight button, real configured speed/manual/ult/skip inputs, Telegram callbacks and viewport changes on the same running Battle. Victory scenario checks an earned manual ultimate; defeat preserves auto battle for a lawful loss. Paused frame clock during inset invariance checks; native RAF for result/chapter/modal interactions. Chapter summary is an earned chapter review, not a newly granted reward. No device-FPS or playthrough claim.', origin, width, height, renderer, stage, scenario, cleared: profile.campaign.cleared.length, errors: [], checks: [], evidence: {} };
const flush = () => writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
const check = (condition, label, details) => { report.checks.push({ label, pass: !!condition, details }); flush(); if (!condition) throw new Error(label); };
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, timezoneId: 'UTC' });
const page = await context.newPage();
const deadline = setTimeout(() => { report.deadline = true; flush(); void browser.close(); }, 240000);
page.on('pageerror', e => { report.errors.push(e.stack ?? e.message); flush(); });
page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
await context.route('**/*', route => { const u = new URL(route.request().url()); return ['http:', 'https:'].includes(u.protocol) && !['localhost', '127.0.0.1'].includes(u.hostname) ? route.abort() : route.continue(); });
await page.addInitScript(({ profile, clock, height, renderer }) => {
  localStorage.clear();
  localStorage.setItem('chronoworld.save.v1', JSON.stringify(profile));
  localStorage.setItem('chronoworld.timeShift', String(Math.max(0, clock.now - Date.now())));
  for (const [k, v] of Object.entries({ battleAutoUlt: '1', battleSpeed: '1', autoAdvance: '0', fpsCap: '60', reduceMotion: '0' })) localStorage.setItem('chronoworld.' + k, v);
  const events = {};
  window.__compactQa = { events, writes: 0 };
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function(k, v) { if (k === 'chronoworld.save.v1') window.__compactQa.writes++; return set.call(this, k, v); };
  window.Telegram = { WebApp: { version: '9.0', platform: 'ios', initData: '', isFullscreen: true, isExpanded: true, viewportHeight: height, viewportStableHeight: height,
    safeAreaInset: { top: 47, bottom: 34, left: 0, right: 0 }, contentSafeAreaInset: { top: 89, bottom: 0, left: 0, right: 0 },
    ready() {}, expand() {}, requestFullscreen() {}, lockOrientation() {}, disableVerticalSwipes() {}, setHeaderColor() {}, setBackgroundColor() {}, setBottomBarColor() {},
    BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
    onEvent(name, fn) { (events[name] ??= []).push(fn); }, offEvent(name, fn) { events[name] = (events[name] ?? []).filter(x => x !== fn); } } };
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type === 'webgl2' || (renderer === 'canvas' && ['webgl', 'experimental-webgl'].includes(type)) ? null : get.call(this, type, ...args); };
}, { profile, clock, height, renderer });

async function click(name, byText = false) {
  await page.waitForFunction(() => window.__game.input.enabled !== false, null, { timeout: 5000 });
  const p = await page.evaluate(([name, byText]) => {
    const sc = window.__game.scene.getScenes(true)[0];
    const walk = list => list.flatMap(o => [o, ...(o.list ? walk(o.list) : [])]);
    const visible = o => { for (let p = o; p; p = p.parentContainer) if (!p.visible || p.alpha < .05) return false; return true; };
    const o = walk(sc.children.list).find(o => (byText ? o.type === 'Text' && o.text === name : o.name === name) && visible(o));
    if (!o) throw new Error('Target missing: ' + name);
    const b = o.getBounds(), world = o.type === 'Container' && o.input?.enabled ? o.getWorldTransformMatrix().transformPoint(0, 0) : { x: b.centerX, y: b.centerY };
    const cam = sc.cameras.main;
    const camera = cam.matrix.transformPoint(world.x - cam.scrollX, world.y - cam.scrollY), canvas = window.__game.canvas.getBoundingClientRect();
    return { x: canvas.x + camera.x * canvas.width / window.__game.canvas.width, y: canvas.y + camera.y * canvas.height / window.__game.canvas.height };
  }, [name, byText]);
  await page.mouse.click(p.x, p.y);
}

async function frames(n) {
  return page.evaluate(n => {
    const q = window.__compactQa, g = window.__game;
    for (let i = 0; i < n; i++) {
      q.time += 1000 / 30; q.wall += 1000 / 30; g.loop.time = q.time;
      if (i % 6 === 5 || i === n - 1) g.step(q.time, 1000 / 30); else g.headlessStep(q.time, 1000 / 30);
    }
    const s = g.scene.getScene('Battle'); return { clock: s.clock, finished: s.finished };
  }, n);
}

async function evidence(key) {
  const data = await page.evaluate(() => {
    const sc = window.__game.scene.getScenes(true)[0], v = window.__view(), scale = v.cssW / v.worldW;
    const walk = list => list.flatMap(o => [o, ...(o.list ? walk(o.list) : [])]);
    const visible = o => { for (let p = o; p; p = p.parentContainer) if (!p.visible || p.alpha < .05) return false; return true; };
    const clip = o => { for (let p = o; p; p = p.parentContainer) if (p.getData?.('clip')) return p.getData('clip'); return null; };
    const entries = walk(sc.children.list).filter(visible).map(o => {
      const b = o.getBounds?.(), m = o.getWorldTransformMatrix?.(), c = clip(o);
      const area = o.input?.hitArea;
      const hitW = (area?.radius ? area.radius * 2 : area?.width ?? 0) * (m ? Math.hypot(m.a, m.b) : 1) * scale;
      const hitH = (area?.radius ? area.radius * 2 : area?.height ?? 0) * (m ? Math.hypot(m.c, m.d) : 1) * scale;
      return { name: o.name, type: o.type, text: o.text, bounds: b ? { ...b } : null, clip: c, visibleInClip: !b || !c || b.bottom > c[0] && b.top < c[1],
        fontCss: o.type === 'Text' ? parseFloat(o.style.fontSize) * Math.hypot(m.c, m.d) * scale : null,
        interactive: !!o.input?.enabled, hitW, hitH };
    });
    return { scene: sc.scene.key, view: v, entries, writes: window.__compactQa.writes };
  });
  report.evidence[key] = data; flush();
  return data;
}

function readable(data, label) {
  const texts = data.entries.filter(o => o.type === 'Text' && o.visibleInClip && o.bounds && o.bounds.y + o.bounds.height >= 0 && o.bounds.y < data.view.safeBottom && o.text);
  check(texts.length > 0 && texts.every(o => o.fontCss >= 11.99), label, texts.map(o => ({ name: o.name, text: o.text, fontCss: o.fontCss })));
}

async function markBattle() {
  return page.evaluate(async () => {
    const s = window.__game.scene.getScene('Battle'), q = window.__compactQa;
    const { session } = await import('/src/game/session.ts');
    q.refs = { result: s.result, log: s.result.log, save: session.save };
    q.state = JSON.stringify({ cursor: s.cursor, clock: s.clock, createSeq: s.createSeq, inputs: s.inputs, committed: s.committed,
      units: s.viewList.map(v => ({ uid: v.snap.uid, pos: v.pos, offX: v.offX, offY: v.offY, hp: v.hp, energy: v.energy, shield: v.shield, alive: v.alive })) });
    q.serializedSave = JSON.stringify(session.save); q.beforeWrites = q.writes;
    return { clock: s.clock, cursor: s.cursor, seed: s.result.seed, writes: q.writes, uiHeight: window.__view().uiHeight };
  });
}

async function assertBattle(label) {
  const data = await page.evaluate(async () => {
    const s = window.__game.scene.getScene('Battle'), q = window.__compactQa;
    const { session } = await import('/src/game/session.ts');
    const state = JSON.stringify({ cursor: s.cursor, clock: s.clock, createSeq: s.createSeq, inputs: s.inputs, committed: s.committed,
      units: s.viewList.map(v => ({ uid: v.snap.uid, pos: v.pos, offX: v.offX, offY: v.offY, hp: v.hp, energy: v.energy, shield: v.shield, alive: v.alive })) });
    return { resultSame: q.refs.result === s.result, logSame: q.refs.log === s.result.log, saveSame: q.refs.save === session.save,
      stateSame: q.state === state, saveBytesSame: q.serializedSave === JSON.stringify(session.save), writesSame: q.beforeWrites === q.writes, uiHeight: window.__view().uiHeight };
  });
  check(['resultSame', 'logSame', 'saveSame', 'stateSame', 'saveBytesSame', 'writesSame'].every(k => data[k]), label, data);
}

async function insets(mode) {
  await page.evaluate(mode => {
    const app = window.Telegram.WebApp;
    app.safeAreaInset.top = mode === 'full' ? 0 : 47;
    app.safeAreaInset.bottom = mode === 'full' ? 0 : 34;
    app.contentSafeAreaInset.top = mode === 'full' ? 0 : mode === 'shorter' ? 109 : 89;
    for (const fn of window.__compactQa.events.contentSafeAreaChanged ?? []) fn();
  }, mode);
  await page.waitForTimeout(450);
}

try {
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__game?.scene && window.__game.scene.getScenes(true).length && !window.__game.scene.isActive('Boot') && !window.__sprites.busy(), null, { timeout: 90000 });
  // Core-only profiles have never seen UI announcements. Finish startup through their actual buttons
  // before opening preparation, so an old Campaign callback cannot redirect a later test scene.
  await page.waitForTimeout(900);
  for (let i = 0, quiet = 0; i < 40 && quiet < 3; i++) {
    const overlay = await page.evaluate(() => {
      const sc = window.__game.scene.getScenes(true)[0];
      if (!sc) return 'loading';
      if (sc.children.getByName('unlockBanner')) return 'unlock';
      if (sc.children.getByName('dialogue')) return 'dialogue';
      return null;
    });
    if (!overlay) { quiet++; await page.waitForTimeout(350); continue; }
    if (overlay === 'loading') { await page.waitForTimeout(250); continue; }
    quiet = 0;
    await click(overlay === 'unlock' ? 'Позже' : 'Пропустить', true);
    await page.waitForTimeout(700);
  }
  await page.evaluate(async stageId => {
    const { session } = await import('/src/game/session.ts');
    const { GAME } = await import('/src/game/content.ts');
    const { stageStatus } = await import('/src/core/index.ts');
    const hints = await import('/src/game/hints.ts');
    const ids = Object.keys(hints.HINT_TEXT);
    localStorage.setItem(hints.HINT_KEY, JSON.stringify(ids)); localStorage.setItem(hints.HINT_SHOWN_KEY, JSON.stringify(ids)); hints.reloadHints();
    if (stageStatus(session.save, stageId, GAME) === 'locked') throw new Error('Fixture does not unlock stage');
    for (const s of window.__game.scene.getScenes(true)) window.__game.scene.stop(s.scene.key);
    window.__game.scene.start('Stage', { stageId });
  }, stage);
  await page.waitForFunction(() => window.__game.scene.isActive('Stage') && !window.__sprites.busy(), null, { timeout: 60000 });
  await page.waitForTimeout(400);
  const fightLabel = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('Stage');
    const walk = list => list.flatMap(o => [o, ...(o.list ? walk(o.list) : [])]);
    return walk(sc.children.list).find(o => o.type === 'Text' && ['В бой', 'Повторить', 'Тренировка'].includes(o.text))?.text;
  });
  check(!!fightLabel, 'lawful Stage exposes its actual available fight action', fightLabel);
  // Stage is owned by another compact packet. Click its visible classic CTA, then let Battle START opt in.
  await page.evaluate(() => { const u = new URL(location.href); u.searchParams.set('compact', '1'); history.replaceState(null, '', u); });
  await click(fightLabel, true);
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => window.__game.scene.isActive('Battle'))) break;
    if (await page.evaluate(() => !!window.__game.scene.getScenes(true)[0]?.children.getByName('dialogue'))) await click('Пропустить', true);
    await page.waitForTimeout(150);
  }
  await page.waitForFunction(() => window.__game.scene.isActive('Battle') && window.__game.scene.getScene('Battle').ready && !window.__sprites.busy(), null, { timeout: 90000 });
  await page.evaluate(() => {
    const q = window.__compactQa, g = window.__game; g.loop.sleep();
    q.originalDate = Date.now; q.originalPerformance = performance.now.bind(performance); q.time = performance.now(); q.wall = Date.now();
    Date.now = () => q.wall; Object.defineProperty(performance, 'now', { configurable: true, value: () => q.time });
  });
  await frames(330);
  report.battleBeforeInsets = await markBattle();
  await insets('shorter'); await assertBattle('async Telegram insets preserve the current battle/result/log/save');
  await page.evaluate(() => window.__game.step(window.__compactQa.time, 0));
  const short = await evidence('battleShort');
  const hud = short.entries.filter(o => ['speedBtn', 'skipBtn', 'ultModeBtn', 'battleSound'].includes(o.name));
  check(hud.length === 4 && hud.every(o => o.hitW >= 43.99 && o.hitH >= 43.99), '4 HUD actions have at least 44 CSS targets', hud);
  const portraits = short.entries.filter(o => o.name?.startsWith('heroPanel_'));
  check(portraits.length === 5 && portraits.every(o => o.hitW >= 43.99 && o.hitH >= 43.99), '5 ultimate portrait targets stay accessible', portraits);
  await page.screenshot({ path: join(out, 'battle-short.png') });
  await insets('full'); await assertBattle('expanding Telegram keeps the same live battle');
  await insets('normal'); await assertBattle('returning to the compact view keeps the same live battle');
  const alternate = width === 360 ? { width: 390, height: 844 } : { width: 360, height: 640 };
  await page.setViewportSize(alternate); await page.waitForTimeout(450);
  await assertBattle('actual browser viewport resize preserves the same live battle');
  await page.evaluate(() => window.__game.step(window.__compactQa.time, 0));
  readable(await evidence('battleViewportResized'), 'resized Battle text stays at least 12 CSS');
  await page.setViewportSize({ width, height }); await page.waitForTimeout(450);
  await assertBattle('returning the browser viewport preserves the same live battle');
  await page.evaluate(() => window.__game.step(window.__compactQa.time, 0));
  const advertisedSpeeds = await page.evaluate(async () => (await import('/src/game/state.ts')).playbackSpeeds);
  report.advertisedSpeeds = advertisedSpeeds;
  for (const expected of [...advertisedSpeeds.slice(1), advertisedSpeeds[0]]) {
    await click('speedBtn');
    const speed = await page.evaluate(async () => (await import('/src/game/state.ts')).playback.speed);
    check(speed === expected, 'real speed button advances to ' + expected, speed);
  }
  if (scenario === 'victory') {
    await click('ultModeBtn');
    check(await page.evaluate(() => window.__game.scene.getScene('Battle').manual), 'real Auto button enables manual ultimates');
    let uid = null;
    for (let i = 0; i < 45; i++) {
      uid = await page.evaluate(() => [...window.__game.scene.getScene('Battle').heroPanel.entries].find(([, e]) => e.ready && !e.dead)?.[0] ?? null);
      if (uid) break;
      const status = await frames(30); if (status.finished) break;
  }
  check(!!uid, 'a real earned ultimate becomes ready in manual mode');
  const portraitName = await page.evaluate(uid => window.__game.scene.getScene('Battle').heroPanel.entries.get(uid).node.name, uid);
  const oldInputs = await page.evaluate(() => window.__game.scene.getScene('Battle').inputs.length);
  await click(portraitName);
  check(await page.evaluate(([n, uid]) => { const s = window.__game.scene.getScene('Battle'); return s.inputs.length === n + 1 && s.inputs.at(-1).uid === uid; }, [oldInputs, uid]), 'real portrait click queues exactly one earned ultimate');
  }
  report.battleOutcome = await page.evaluate(() => {
    const r = window.__game.scene.getScene('Battle').result;
    return { winner: r.winner, duration: r.duration, seed: r.seed, reason: r.reason };
  });
  check(report.battleOutcome.winner === (scenario === 'defeat' ? 'B' : 'A'), 'the fixture produces the intended lawful ' + scenario, report.battleOutcome);
  await page.evaluate(() => { const q = window.__compactQa; Date.now = q.originalDate; Object.defineProperty(performance, 'now', { configurable: true, value: q.originalPerformance }); window.__game.loop.wake(); });
  await click('skipBtn');
  await page.waitForFunction(() => window.__game.scene.isActive('Result') && window.__game.scene.getScene('Result').ready, null, { timeout: 30000 });
  await page.waitForTimeout(450);
  for (let i = 0; i < 20; i++) {
    if (!await page.evaluate(() => !!window.__game.scene.getScene('Result').children.getByName('unlockBanner'))) break;
    await click('Позже', true); await page.waitForTimeout(700);
  }
  readable(await evidence('result'), 'visible Result text is at least 12 CSS'); await page.screenshot({ path: join(out, 'result.png') });
  const footer = await page.evaluate(() => {
    const s = window.__game.scene.getScene('Result'), v = window.__view(), scale = v.cssW / v.worldW;
    return s.footerNodes.filter(f => f.node.input?.enabled).map(f => ({ label: f.node.list?.find(o => o.type === 'Text')?.text, y: f.node.y, w: f.node.input.hitArea.width * scale, h: f.node.input.hitArea.height * scale }));
  });
  check(footer.every(f => f.w >= 43.99 && f.h >= 43.99), 'all Result footer targets are at least 44 CSS', footer);
  const resultState = await page.evaluate(async () => {
    const { session } = await import('/src/game/session.ts'); const q = window.__compactQa, s = window.__game.scene.getScene('Result');
    q.resultArea = s.bodyArea; q.resultSave = session.save; q.resultWrites = q.writes;
    return { clip: s.bodyArea.content.getData('clip'), offset: s.bodyArea.offset };
  });
  const canvas = await page.locator('canvas').boundingBox();
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height * .6); await page.mouse.wheel(0, 260); await page.waitForTimeout(150);
  const scrolled = await page.evaluate(() => window.__game.scene.getScene('Result').bodyArea.offset);
  check(scrolled > resultState.offset, 'result body really scrolls without moving navigation', { before: resultState.offset, after: scrolled });
  await insets('shorter');
  const resultResize = await page.evaluate(async () => {
    const { session } = await import('/src/game/session.ts'); const q = window.__compactQa, s = window.__game.scene.getScene('Result');
    return { areaSame: q.resultArea === s.bodyArea, saveSame: q.resultSave === session.save, writesSame: q.resultWrites === q.writes, offset: s.bodyArea.offset, clip: s.bodyArea.content.getData('clip') };
  });
  check(resultResize.areaSame && resultResize.saveSame && resultResize.writesSame && resultResize.offset === scrolled, 'Result insets preserve existing content/offset and do not repeat rewards', resultResize);
  await insets('normal');
  await click('resultStats'); await page.waitForTimeout(350);
  readable(await evidence('statistics'), 'visible statistics text is at least 12 CSS');
  await insets('shorter'); readable(await evidence('statisticsResized'), 'resized statistics text stays at least 12 CSS');
  await click('sheetClose'); await page.waitForTimeout(350);
  check(!await page.evaluate(() => !!window.__game.scene.getScene('Result').children.getByName('bottomSheet')), 'resized statistics close through the actual cross');
  await insets('normal');
  await click('К кампании', true); await page.waitForTimeout(350);
  check(await page.evaluate(() => window.__game.scene.isActive('Campaign')), 'Result returns to Campaign through the real button');
  report.chapterReview = await page.evaluate(async () => {
    const { startChapterDone } = await import('/src/game/scenes/ChapterDoneScene.ts');
    const { GAME } = await import('/src/game/content.ts');
    const { session } = await import('/src/game/session.ts');
    const chapterId = GAME.content.chapters[0].id;
    const stages = GAME.content.stages.filter(s => s.chapter === chapterId);
    const cleared = stages.filter(s => session.save.campaign.cleared.includes(s.id)).length;
    if (cleared !== stages.length) throw new Error('Fixture has not earned the chapter summary');
    startChapterDone(window.__game.scene.getScene('Campaign'), { chapterId });
    return { chapterId, cleared, stages: stages.length };
  });
  await page.waitForFunction(() => window.__game.scene.isActive('ChapterDone') && !!window.__game.scene.getScene('ChapterDone').bodyArea && window.__game.scene.getScene('ChapterDone').footerNodes.length, null, { timeout: 30000 });
  await page.waitForTimeout(450);
  // The lawful core-only profile may have an unread chronicle page: close that normal page using its own CTA.
  for (let i = 0; i < 5; i++) {
    const pages = await page.evaluate(() => { const s = window.__game.scene.getScene('ChapterDone'); return !!s.children.getByName('dialogue')?.getData('pages'); });
    if (!pages) break;
    await click('pagesNext'); await page.waitForTimeout(400);
  }
  readable(await evidence('chapter'), 'visible ChapterDone text is at least 12 CSS'); await page.screenshot({ path: join(out, 'chapter.png') });
  await page.evaluate(async () => {
    const q = window.__compactQa, s = window.__game.scene.getScene('ChapterDone'); const { session } = await import('/src/game/session.ts');
    q.chapterArea = s.bodyArea; q.chapterSave = session.save; q.chapterWrites = q.writes;
  });
  await insets('shorter');
  check(await page.evaluate(async () => { const q = window.__compactQa, s = window.__game.scene.getScene('ChapterDone'); const { session } = await import('/src/game/session.ts'); return q.chapterArea === s.bodyArea && q.chapterSave === session.save && q.chapterWrites === q.writes; }), 'ChapterDone inset updates preserve the earned summary without new rewards');
  await insets('normal');
  const chapterCanvas = await page.locator('canvas').boundingBox();
  await page.mouse.move(chapterCanvas.x + chapterCanvas.width / 2, chapterCanvas.y + chapterCanvas.height * .65); await page.mouse.wheel(0, 1400); await page.waitForTimeout(200);
  await click('storyHistoryBtn'); await page.waitForTimeout(350);
  check(await page.evaluate(() => !!window.__game.scene.getScene('ChapterDone').children.getByName('history')), 'earned chapter history is reachable through the scrolled real button');
  await insets('shorter'); readable(await evidence('historyResized'), 'resized chapter history text is at least 12 CSS');
  await click('sheetClose'); await page.waitForTimeout(350);
  check(!await page.evaluate(() => !!window.__game.scene.getScene('ChapterDone').children.getByName('history')), 'resized history sheet closes through the actual cross');
  await click('cta'); await page.waitForTimeout(350);
  check(await page.evaluate(() => window.__game.scene.isActive('Campaign')), 'ChapterDone fixed CTA returns to Campaign');
  check(report.errors.length === 0, 'no browser errors', report.errors);
  report.finished = new Date().toISOString(); flush();
  console.log(JSON.stringify({ checks: report.checks.length, failures: report.checks.filter(c => !c.pass), errors: report.errors.length, out }));
} catch (error) {
  report.fatal = error.stack;
  report.debug = await page.evaluate(() => window.__game?.scene.getScenes(true).map(sc => {
    const walk = list => list.flatMap(o => [o, ...(o.list ? walk(o.list) : [])]);
    return { scene: sc.scene.key, text: walk(sc.children.list).filter(o => o.type === 'Text').map(o => {
      const ancestors = []; for (let p = o; p; p = p.parentContainer) ancestors.push({ name: p.name, type: p.type, visible: p.visible, alpha: p.alpha });
      return { text: o.text, ancestors };
    }) };
  })).catch(() => null);
  flush(); console.error(error); process.exitCode = 1;
}
finally { clearTimeout(deadline); await context.close().catch(() => {}); await browser.close().catch(() => {}); }
