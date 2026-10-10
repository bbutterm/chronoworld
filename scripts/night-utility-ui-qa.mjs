#!/usr/bin/env node
/* Локальная приёмка четырёх служебных экранов. В облако ничего не записывает. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tsImport } from 'tsx/esm/api';
import { browserOptions, loadPlaywright, startVite, stopVite } from './lib/perf-browser.mjs';

const root = path.resolve(import.meta.dirname, '..');
const reportDir = path.join(root, 'docs/REPORTS/2026-10-05-night-utility-ui');
const url = process.env.QA_URL ?? 'http://127.0.0.1:5598/?compact=1';
const origin = new URL(url);
assert(['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname), 'QA_URL должен быть локальным');
const out = path.resolve(process.env.QA_OUT ?? path.join(os.tmpdir(), 'chronoworld-night-utility-ui'));
const stopFile = process.env.QA_STOP_FILE ?? path.join(out, 'stop');
let stopRequested = false;
process.on('SIGTERM', () => { stopRequested = true; });
class RequestedStop extends Error {}
const continueActions = () => {
  if (stopRequested || fs.existsSync(stopFile)) throw new RequestedStop('Приёмка остановлена между действиями для общего CPU-окна');
};
const modes = (process.env.QA_MODES ?? 'canvas,webgl').split(',');
const sizes = (process.env.QA_SIZES ?? '360x640,390x844').split(',').map((s) => s.split('x').map(Number));
const scenarios = (process.env.QA_SCENARIOS ?? 'welcome,mail_all,achievements,mid,late').split(',');
const reducedMotion = process.env.QA_REDUCED_MOTION !== '0';
const refreshSecondTouchMs = Number(process.env.QA_REFRESH_SECOND_TOUCH_MS ?? 40);
assert(Number.isFinite(refreshSecondTouchMs) && refreshSecondTouchMs >= 0 && refreshSecondTouchMs <= 2000);
assert(modes.every((m) => ['canvas', 'webgl'].includes(m)));
assert(scenarios.every((s) => ['welcome', 'mail_all', 'achievements', 'mid', 'late'].includes(s)));
fs.mkdirSync(out, { recursive: true });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const report = { startedAt: new Date().toISOString(), url, passed: false, fixtureEvidence: {}, sourceHashes: {}, runs: [] };
for (const f of ['src/game/scenes/MailScene.ts', 'src/game/scenes/QuestsScene.ts', 'src/game/scenes/AchievementsScene.ts', 'src/game/scenes/ShopScene.ts', 'src/game/utilityScreenLayout.ts', 'src/game/screen.ts', 'src/game/ui.ts', 'src/game/viewLayout.ts', 'src/game/viewport.ts', 'src/game/scroll.ts', 'src/game/modalBack.ts']) {
  report.sourceHashes[f] = sha(fs.readFileSync(path.join(root, f)));
}
const gameSources = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'src/core', 'data'], { cwd: root, encoding: 'utf8' }).trim().split('\n'))].filter((f) => f && fs.existsSync(path.join(root, f))).sort();
report.gameSourceSha256 = sha(gameSources.map((f) => `${f}\0${sha(fs.readFileSync(path.join(root, f)))}`).join('\n'));
report.harnessSha256 = sha(fs.readFileSync(import.meta.filename));
report.browserClock = 'lawful fixture timestamp + elapsed performance milliseconds';
report.settings = { reducedMotion, audio: false, deviceScaleFactor: 1, refreshSecondTouchMs };
const [core, { loadFullContext }, { compactNumber }] = await Promise.all([
  tsImport('../src/core/index.ts', import.meta.url), tsImport('./lib/content-node.ts', import.meta.url), tsImport('../src/game/frame.ts', import.meta.url),
]);
const game = loadFullContext();
assert(game.shop, 'Реальный контекст должен содержать лавку');
const load = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const earlyBase = path.join(reportDir, 'fixtures/early-before-ch1_s9');
const midBase = path.join(reportDir, 'fixtures/mid-before-ch2_s18');
const earlyClock = load(`${earlyBase}.clock.json`);
const earlyBefore = load(`${earlyBase}.json`);
const earlyWin = core.actPlayStage(earlyBefore, earlyClock.day, 'ch1_s9', earlyClock.seed, game, earlyClock.now);
assert.equal(earlyWin.result.winner, 'A', 'Исторический законный бой раннего fixture должен выигрываться');
const earlyNow = earlyClock.now + Math.round(earlyWin.result.duration * 1000);
const midClock = load(`${midBase}.clock.json`);
let midNow = midClock.now + 48 * 3600_000;
const midDay = new Date(midNow).toISOString().slice(0, 10);
let mid = core.actClaimOffline(load(`${midBase}.json`), midNow, midDay, game).save;
// Пройденные этапы больше не сражаются (progression.campaign.replay: false): пять законных попыток — на текущем открытом
// этапе (победа открывает следующий), а не повторы ch1_s1.
const midStages = [];
for (let i = 0; i < 5; i++) {
  const open = game.content.stages.find((st) => core.stageStatus(mid, st.id, game) === 'open');
  assert(open, 'В mid fixture должен быть открытый этап');
  const r = core.actPlayStage(mid, midDay, open.id, 900 + i, game, midNow);
  midStages.push({ stage: open.id, winner: r.result.winner });
  mid = r.save;
  midNow += Math.round(r.result.duration * 1000);
}
// Без побед задание «победы в боях» не выполнено — законно добираем быстрые награды (третье готовое задание).
if (core.questStatus(mid, game, midDay).quests.filter((q) => q.done && !q.claimed).length < 3) mid = core.actUseFastRewards(mid, midDay, game).save;
assert(core.questStatus(mid, game, midDay).quests.filter((q) => q.done && !q.claimed).length >= 3);
assert(core.shopStatus(mid, midDay, game).slots.some((s) => !s.affordable && !s.soldOut));
const lateFile = path.join(root, 'tests/fixtures/boot-late-save.json');
const late = load(lateFile);
const lateNow = Date.UTC(2026, 9, 23, 12);
const welcomeNow = Date.UTC(2026, 9, 5, 12);
const fixtures = {
  welcome: { save: core.newGame(game, welcomeNow, '2026-10-05'), now: welcomeNow },
  mail_all: { save: core.newGame(game, welcomeNow, '2026-10-05'), now: welcomeNow },
  achievements: { save: earlyWin.save, now: earlyNow },
  mid: { save: mid, now: midNow },
  late: { save: late, now: lateNow },
};
report.fixtureEvidence = {
  early: { inputSha256: sha(fs.readFileSync(`${earlyBase}.json`)), inputClock: earlyClock, actualWinner: earlyWin.result.winner, actualDuration: earlyWin.result.duration, cleared: earlyWin.save.campaign.cleared.length },
  mid: { inputSha256: sha(fs.readFileSync(`${midBase}.json`)), inputClock: midClock, waitedHours: 48, offlineCapAppliedByCore: true, attemptSeeds: [900, 901, 902, 903, 904], attempts: midStages, now: midNow, day: midDay, resources: mid.resources, currency: mid.currency },
  late: { inputSha256: sha(fs.readFileSync(lateFile)), now: lateNow, cleared: late.campaign.cleared.length, heroes: late.heroes.length, inventory: late.inventory.items.length },
};
const hintsSource = fs.readFileSync(path.join(root, 'src/game/hints.ts'), 'utf8');
const hints = [...hintsSource.split('export type HintId =')[1].split(';')[0].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const { chromium } = await loadPlaywright();
const vite = process.env.QA_URL ? null : await startVite(5598, url, process.env.QA_PREVIEW === '1');
const browser = await chromium.launch({ ...browserOptions(), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function contextFor(mode, size, scenario) {
  continueActions();
  const fixture = fixtures[scenario];
  const run = { mode, size, scenario, passed: false, errors: [], requestsBlocked: [], steps: [], actionChecks: [], lifecycleChecks: [] };
  report.runs.push(run);
  const context = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, timezoneId: 'UTC' });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const u = new URL(request.url());
    if (u.pathname.endsWith('/telegram-web-app.js')) return route.fulfill({ contentType: 'application/javascript', body: '' });
    if (u.origin !== origin.origin || !['GET', 'HEAD'].includes(request.method())) {
      run.requestsBlocked.push({ origin: u.origin, method: request.method() });
      return route.abort('blockedbyclient');
    }
    if (/\/assets\/index-[^/]+\.js$/.test(u.pathname)) {
      const response = await route.fetch();
      const code = await response.text();
      const gameVar = /([\w$]+)=new\s*[\w$.]+\.Game\(\{type:/.exec(code);
      const viewVar = /function [\w$]+\(\)\{return ([\w$]+)\.adaptive\?Math.max\(/.exec(code);
      assert(gameVar && viewVar, 'Compiled probe matcher не соответствует этой сборке');
      run.bundleSha256 = sha(code);
      return route.fulfill({ response, body: `${code};window.__game=${gameVar[1]};window.__view=()=>${viewVar[1]};window.__qaCompiled=true;` });
    }
    return route.continue();
  });
  await context.addInitScript(({ fixture, mode, hints, reducedMotion }) => {
    localStorage.setItem('chronoworld.save.v1', JSON.stringify(fixture.save));
    localStorage.setItem('chronoworld.reduceMotion', reducedMotion ? '1' : '0');
    localStorage.setItem('chronoworld.audio', '0');
    window.__qaPointerEvents = [];
    for (const type of ['pointerdown', 'pointerup']) document.addEventListener(type, (e) => {
      window.__qaPointerEvents.push({ type, time: performance.now(), timestamp: e.timeStamp, pointerType: e.pointerType, x: e.clientX, y: e.clientY });
    }, { capture: true, passive: true });
    localStorage.setItem('chronoworld.hints', JSON.stringify(hints));
    localStorage.setItem('chronoworld.hintsShown', JSON.stringify(hints));
    const NativeDate = Date;
    window.__qaNow = fixture.now;
    const clockStart = performance.now();
    const clockNow = () => window.__qaNow + Math.floor(performance.now() - clockStart);
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [clockNow()])); }
      static now() { return clockNow(); }
    };
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      if (mode === 'canvas' && /webgl|experimental/i.test(kind)) return null;
      return get.call(this, kind, ...args);
    };
    window.__tgEvents = {};
    window.__tgBack = { visible: false, handlers: [] };
    window.Telegram = { WebApp: {
      platform: 'ios', version: '9.0', initData: '', isFullscreen: true,
      safeAreaInset: { top: 47, bottom: 34, right: 0, left: 0 },
      contentSafeAreaInset: { top: 89, bottom: 0, right: 0, left: 0 },
      ready() {}, expand() {},
      onEvent(n, fn) { (window.__tgEvents[n] ??= []).push(fn); },
      offEvent(n, fn) { window.__tgEvents[n] = (window.__tgEvents[n] ?? []).filter((x) => x !== fn); },
      BackButton: {
        show() { window.__tgBack.visible = true; }, hide() { window.__tgBack.visible = false; },
        onClick(fn) { window.__tgBack.handlers.push(fn); },
        offClick(fn) { window.__tgBack.handlers = window.__tgBack.handlers.filter((x) => x !== fn); },
      },
    } };
    const set = Storage.prototype.setItem;
    window.__qaWrites = [];
    Storage.prototype.setItem = function (key, value) {
      if (key === 'chronoworld.save.v1') window.__qaWrites.push(value);
      return set.call(this, key, value);
    };
  }, { fixture, mode, hints, reducedMotion });
  const page = await context.newPage();
  page.on('pageerror', (e) => run.errors.push(e.stack || e.message));
  page.on('console', (m) => { if (m.type() === 'error') run.errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForFunction(() => window.__game?.scene.getScenes(true).length && !window.__game.scene.isActive('Boot'), null, { timeout: 90_000 });
  await page.evaluate(() => {
    window.__qaWalk = (list) => list.flatMap((o) => [o, ...(o.list ? window.__qaWalk(o.list) : [])]);
    window.__qaCreates = {};
    for (const scene of window.__game.scene.scenes) scene.events.on('create', () => { window.__qaCreates[scene.scene.key] = (window.__qaCreates[scene.scene.key] ?? 0) + 1; });
  });
  return { context, page, run };
}

function controls(page, run) {
  const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('chronoworld.save.v1')));
  const bytes = () => page.evaluate(() => localStorage.getItem('chronoworld.save.v1'));
  const sceneKey = () => page.evaluate(() => window.__game.scene.getScenes(true).at(-1)?.scene.key);
  const wait = async () => {
    // Normal currency animations include a flight followed by the 900 ms counter.
    // Layout assertions inspect their settled state; this is not a timing benchmark.
    await page.waitForTimeout(reducedMotion ? 250 : 1400);
    await page.waitForFunction(() => {
      const scene = window.__game.scene.getScenes(true).at(-1);
      return window.__game.input.enabled && scene.input.enabled && window.__qaWalk(scene.children.list).every((o) => !o.getData?.('closing') && (o.name !== 'popInner' || o.scaleX > 0.999 && o.alpha > 0.999));
    }, null, { timeout: 20_000 });
  };
  const point = (name) => page.evaluate((name) => {
    const scene = window.__game.scene.getScenes(true).at(-1);
    const object = window.__qaWalk(scene.children.list).find((o) => o.name === name && o.scene);
    if (!object) throw Error(`Не найден ${name} в ${scene.scene.key}`);
    const target = object.input ? object : window.__qaWalk(object.list ?? []).find((o) => o.input?.enabled);
    if (!target) throw Error(`${name} не является интерактивным`);
    const m = target.getWorldTransformMatrix();
    const v = window.__view();
    const scale = v.cssW / v.worldW;
    return { x: v.cssLeft + (m.tx - v.worldX) * scale, y: v.cssTop + (m.ty - v.worldY) * scale };
  }, name);
  const tap = async (name, twice = false, secondTouchMs = 40) => {
    continueActions();
    const p = await point(name);
    await page.touchscreen.tap(p.x, p.y);
    if (twice) { await page.waitForTimeout(secondTouchMs); await page.touchscreen.tap(p.x, p.y); }
    await wait();
    if (process.env.QA_DEBUG_INPUT === '1') {
      const state = await page.evaluate(() => {
        const scene = window.__game.scene.getScenes(true).at(-1);
        const all = window.__qaWalk(scene.children.list);
        const pointer = scene.input.activePointer;
        return {
          scene: scene.scene.key, gameInput: window.__game.input.enabled, sceneInput: scene.input.enabled,
          area: scene.area ? { offset: scene.area.offset, locked: scene.area.locked, clip: scene.area.content.getData('clip') } : null,
          pointer: { x: pointer.x, y: pointer.y, worldX: pointer.worldX, worldY: pointer.worldY, isDown: pointer.isDown },
          modals: all.filter((o) => o.getData?.('screenModal')).map((o) => ({ name: o.name, closing: !!o.getData('closing') })),
          texts: all.filter((o) => o.type === 'Text').map((o) => o.text),
          view: window.__view(), shop: JSON.parse(localStorage.getItem('chronoworld.save.v1')).shop,
          pointerEvents: window.__qaPointerEvents.slice(-8),
        };
      });
      (run.tapDiagnostics ??= []).push({ name, twice, point: p, ...state });
    }
  };
  const label = (value) => page.evaluate((value) => {
    const scene = window.__game.scene.getScenes(true).at(-1);
    const all = window.__qaWalk(scene.children.list);
    const modal = [...all].reverse().find((o) => o.getData?.('screenModal') && !o.getData('closing'));
    const list = modal ? window.__qaWalk(modal.list) : all;
    const object = list.find((o) => o.input?.enabled && o.list?.some((t) => t.type === 'Text' && t.text === value));
    if (!object) throw Error(`Не найдена кнопка «${value}»`);
    object.setName('qaLabelButton');
    return object.name;
  }, value);
  const dismiss = async () => {
    for (let i = 0; i < 35; i++) {
      await wait();
      const name = await page.evaluate(() => {
        const scene = window.__game.scene.getScenes(true).at(-1);
        const all = window.__qaWalk(scene.children.list);
        if (all.some((o) => o.name === 'pagesSkip')) return 'pagesSkip';
        const modal = all.find((o) => ['dialogue', 'unlockBanner'].includes(o.name));
        if (!modal) return null;
        const word = modal.name === 'unlockBanner' ? 'Позже' : 'Пропустить';
        const button = window.__qaWalk(modal.list).find((o) => o.input?.enabled && o.list?.some((t) => t.type === 'Text' && t.text === word));
        if (!button) throw Error(`Не найден выход из ${modal.name}`);
        button.setName('qaDismiss');
        return button.name;
      });
      if (!name) return;
      await tap(name);
    }
    throw Error('Сюжетная очередь не закрылась');
  };
  const start = async (key, data) => {
    continueActions();
    await page.evaluate(({ key, data }) => window.__game.scene.getScenes(true).at(-1).scene.start(key, data), { key, data });
    await page.waitForFunction((key) => window.__game.scene.getScenes(true).at(-1)?.scene.key === key, key);
    await wait();
  };
  const capture = async (name, expectedScene) => {
    await wait();
    const step = await page.evaluate(() => {
      const scene = window.__game.scene.getScenes(true).at(-1);
      const all = window.__qaWalk(scene.children.list);
      const v = window.__view();
      const s = v.cssW / v.worldW;
      const visible = (o) => { for (let p = o; p; p = p.parentContainer) if (!p.visible || p.alpha === 0) return false; return true; };
      return {
        scene: scene.scene.key, renderer: window.__game.renderer.type, compiled: !!window.__qaCompiled, view: v,
        invalidFrames: all.filter((o) => o.frame && !o.frame.source).map((o) => o.texture?.key),
        fonts: all.filter((o) => o.type === 'Text' && o.text && visible(o)).map((o) => { const m = o.getWorldTransformMatrix(); return { text: o.text, font: parseFloat(o.style.fontSize) * Math.hypot(m.c, m.d) * s }; }),
        controls: all.filter((o) => o.input?.enabled && visible(o)).map((o) => { const m = o.getWorldTransformMatrix(); const a = o.input.hitArea; return { name: o.name || o.type, width: (a.width ?? 2 * a.radius) * Math.hypot(m.a, m.b) * s, height: (a.height ?? 2 * a.radius) * Math.hypot(m.c, m.d) * s }; }),
        scrolls: all.filter((o) => o.getData?.('clip')).map((o) => ({ name: o.name, clip: o.getData('clip'), y: o.y })),
        resources: Object.fromEntries(['gold', 'gems'].map((key) => { const pill = all.find((o) => o.name === `pill_${key}`); return [key, pill?.list.find((o) => o.type === 'Text')?.text]; })),
        rows: all.filter((o) => /^(letter_|quest_|ach_|shopSlot|fold|mailDelete)/.test(o.name)).map((o) => ({ name: o.name, y: o.getWorldTransformMatrix().ty, height: o.height })),
      };
    });
    run.steps.push({ name, ...step });
    assert.equal(step.scene, expectedScene);
    assert.equal(step.renderer, run.mode === 'canvas' ? 1 : 2, `${name}: фактический renderer не совпадает с запрошенным`);
    assert.equal(step.invalidFrames.length, 0, `${name}: уничтожена texture source`);
    assert.deepEqual(run.errors, [], `${name}: runtime errors`);
    assert(step.view.adaptive, `${name}: utility не включена в adaptive policy`);
    const current = await save();
    assert.equal(step.resources.gold, compactNumber(current.resources.gold), `${name}: stale gold header`);
    assert.equal(step.resources.gems, compactNumber(current.currency.gems), `${name}: stale gems header`);
    for (const font of step.fonts) assert(font.font >= 11.99, `${name}: font ${font.font} (${font.text})`);
    for (const control of step.controls) assert(control.width >= 43.9 && control.height >= 43.9, `${name}: target ${control.name} ${control.width}×${control.height}`);
    await page.screenshot({ path: path.join(out, `${run.mode}-${run.size.join('x')}-${run.scenario}-${name}.png`) });
    console.log(`${run.mode} ${run.size.join('x')} ${run.scenario}: ${name} ${step.scene}`);
    return step;
  };
  const scroll = async (end = true) => {
    continueActions();
    const p = await page.evaluate(() => {
      const scene = window.__game.scene.getScenes(true).at(-1);
      const all = window.__qaWalk(scene.children.list);
      const object = [...all].reverse().find((o) => o.getData?.('clip'));
      if (!object) throw Error('Нет ScrollArea');
      const clip = object.getData('clip'); const v = window.__view(); const s = v.cssW / v.worldW;
      return { x: v.cssLeft + (540 - v.worldX) * s, y: v.cssTop + ((clip[0] + clip[1]) / 2 - v.worldY) * s };
    });
    await page.mouse.move(p.x, p.y);
    await page.mouse.wheel(0, end ? 20_000 : -20_000);
    await wait();
  };
  const back = async (expectedScene) => {
    continueActions();
    const before = await page.evaluate(() => ({ scene: window.__game.scene.getScenes(true).at(-1).scene.key, time: performance.now() }));
    await page.evaluate(() => { if (!window.__tgBack.visible || window.__tgBack.handlers.length !== 1) throw Error(`Неверные SDK Back handlers: ${window.__tgBack.handlers.length}`); window.__tgBack.handlers[0](); });
    await page.waitForFunction((key) => window.__game.scene.getScenes(true).at(-1)?.scene.key === key, expectedScene, { timeout: 20_000 });
    await wait();
    const after = await page.evaluate(() => ({ scene: window.__game.scene.getScenes(true).at(-1).scene.key, time: performance.now() }));
    run.actionChecks.push({ name: 'physical-sdk-back', from: before.scene, to: after.scene, waitedMs: Math.round(after.time - before.time) });
  };
  const expandDone = async () => {
    const before = await page.evaluate(() => { const scene = window.__game.scene.getScenes(true).at(-1); return { hasFold: window.__qaWalk(scene.children.list).some((o) => o.name === 'fold'), open: scene.open }; });
    if (!before.hasFold) return;
    if (!before.open) await tap('fold');
    assert.equal(await page.evaluate(() => window.__game.scene.getScenes(true).at(-1).open), true, 'Физическое нажатие не раскрыло полученные строки');
    run.actionChecks.push({ name: 'done-fold-open', tapped: !before.open });
  };
  const lastRow = (step) => {
    const list = step.scrolls.find((s) => s.name.endsWith('Scroll'));
    const tail = step.rows.at(-1);
    assert(list && tail && tail.y + tail.height / 2 <= list.clip[1] + 0.1 && tail.y - tail.height / 2 >= list.clip[0] - 0.1, `${step.scene}: последняя строка не достигнута`);
  };
  const dynamic = async (scene, modal = false) => {
    const before = await page.evaluate(() => {
      const scene = window.__game.scene.getScenes(true).at(-1); window.__qaSceneRef = scene; window.__qaAreaRef = scene.area;
      window.__qaModalRef = window.__qaWalk(scene.children.list).find((o) => o.name === 'bottomSheet');
      return { offset: scene.area.offset, contentHeight: scene.area.height, open: scene.open, creates: window.__qaCreates[scene.scene.key], bytes: localStorage.getItem('chronoworld.save.v1'), writes: window.__qaWrites.length };
    });
    await page.evaluate(() => { window.Telegram.WebApp.contentSafeAreaInset.top = 169; for (const fn of window.__tgEvents.contentSafeAreaChanged ?? []) fn(); });
    await page.waitForTimeout(380);
    await capture('insets-small', scene);
    const insetScroll = await page.evaluate(() => { const a = window.__game.scene.getScenes(true).at(-1).area; return { offset: a.offset, clip: a.content.getData('clip') }; });
    const insetExpected = Math.min(before.offset, Math.max(0, before.contentHeight - (insetScroll.clip[1] - insetScroll.clip[0])));
    assert(Math.abs(insetScroll.offset - insetExpected) < 0.01, 'Insets должны сохранять offset до необходимого ограничения');
    await page.setViewportSize({ width: run.size[0], height: run.size[1] + 120 });
    await page.evaluate(() => { for (const fn of window.__tgEvents.viewportChanged ?? []) fn({ isStateStable: true }); });
    await page.waitForTimeout(380);
    await capture('resize-tall', scene);
    const actual = await page.evaluate(() => {
      const scene = window.__game.scene.getScenes(true).at(-1); return { sameScene: scene === window.__qaSceneRef, sameArea: scene.area === window.__qaAreaRef, sameModal: !window.__qaModalRef || window.__qaModalRef.scene === scene && window.__qaWalk(scene.children.list).includes(window.__qaModalRef), offset: scene.area.offset, clip: scene.area.content.getData('clip'), open: scene.open, creates: window.__qaCreates[scene.scene.key], bytes: localStorage.getItem('chronoworld.save.v1'), writes: window.__qaWrites.length };
    });
    assert(actual.sameScene && actual.sameArea && (!modal || actual.sameModal));
    assert.equal(actual.creates, before.creates);
    assert.equal(actual.open, before.open);
    assert.equal(actual.bytes, before.bytes);
    assert.equal(actual.writes, before.writes);
    const resizedExpected = Math.min(insetScroll.offset, Math.max(0, before.contentHeight - (actual.clip[1] - actual.clip[0])));
    assert(Math.abs(actual.offset - resizedExpected) < 0.01, 'Resize должен сохранять offset до необходимого ограничения');
    run.lifecycleChecks.push({ scene, modal, sameScene: actual.sameScene, sameArea: actual.sameArea, sameModal: actual.sameModal, noCreate: true, noSaveWrite: true, beforeOffset: before.offset, afterOffset: actual.offset, clampedOffsetCorrect: true, foldOpen: actual.open });
    await page.setViewportSize({ width: run.size[0], height: run.size[1] });
    await page.evaluate(() => { window.Telegram.WebApp.contentSafeAreaInset.top = 89; for (const fn of window.__tgEvents.contentSafeAreaChanged ?? []) fn(); });
    await page.waitForTimeout(380);
    await wait();
  };
  const expectSave = async (expected, name) => {
    const actual = await save();
    for (const key of ['resources', 'currency', 'daily', 'achievements', 'mail', 'shop', 'heroes', 'inventory']) assert.deepEqual(actual[key], expected[key], `${name}: ${key}`);
    run.actionChecks.push({ name, resources: actual.resources, currency: actual.currency, exactCoreState: true });
  };
  return { save, bytes, sceneKey, tap, label, dismiss, start, capture, scroll, back, expandDone, lastRow, dynamic, expectSave, wait };
}

async function flow(page, run) {
  const c = controls(page, run);
  await c.dismiss();
  if (run.scenario === 'welcome') {
    await c.start('Mail'); await c.capture('mail-ready', 'Mail');
    const before = await c.save(); const letter = core.mailStatus(before).letters.find(core.letterClaimable);
    assert(letter); await c.tap(`letter_${letter.id}`); await c.capture('mail-letter', 'Mail');
    await c.dynamic('Mail', true);
    const expected = core.claimMail(await c.save(), letter.id, game).save;
    await c.tap('letterClaim', true); await c.expectSave(expected, 'single-letter-double-tap');
    await c.capture('mail-claimed', 'Mail');
    const bytes = await c.bytes(); await c.scroll(); await c.tap('mailDelete');
    await c.tap(await c.label('Отмена')); assert.equal(await c.bytes(), bytes);
    run.actionChecks.push({ name: 'delete-read-cancel', unchanged: true });
    await c.back('Home'); assert.equal(await c.sceneKey(), 'Home');
    await c.start('Achievements', { from: 'Heroes' }); await c.capture('achievements-locked', 'Achievements');
    await c.back('Heroes'); assert.equal(await c.sceneKey(), 'Heroes');
    await c.start('Shop'); await c.capture('shop-locked', 'Shop');
    await c.back('Home'); assert.equal(await c.sceneKey(), 'Home');
    run.actionChecks.push({ name: 'locked-functions-logical-back', destinations: ['Heroes', 'Home'] });
  } else if (run.scenario === 'mail_all') {
    await c.start('Mail'); await c.capture('mail-all-ready', 'Mail');
    const expected = core.claimAllMail(await c.save(), game).save;
    await c.tap('mailClaimAll', true); await c.expectSave(expected, 'mail-claim-all-double-tap');
    await c.capture('mail-all-claimed', 'Mail'); await c.scroll();
    const removed = core.deleteReadMail(await c.save()).save;
    await c.tap('mailDelete'); await c.tap(await c.label('Удалить'), true);
    await c.expectSave(removed, 'delete-read-approved');
    await c.capture('mail-empty', 'Mail'); await c.back('Home'); assert.equal(await c.sceneKey(), 'Home');
  } else if (run.scenario === 'achievements') {
    await c.start('Achievements', { from: 'Heroes' }); await c.capture('achievements-ready', 'Achievements');
    const before = await c.save(); const achievement = core.achievementStatus(before, game).find((a) => a.done && !a.claimed);
    assert(achievement);
    const expected = core.actClaimAchievement(before, new Date(fixtures.achievements.now).toISOString().slice(0, 10), achievement.id, game).save;
    await c.tap(`ach_${achievement.id}`, true); await c.expectSave(expected, 'achievement-double-tap');
    const beforeAll = await c.save(); const all = core.actClaimAllAchievements(beforeAll, new Date(fixtures.achievements.now).toISOString().slice(0, 10), game).save;
    await c.tap('achievementsClaimAll', true); await c.expectSave(all, 'achievements-claim-all');
    await c.scroll(); await c.expandDone(); await c.scroll(); c.lastRow(await c.capture('achievements-last', 'Achievements'));
    await c.dynamic('Achievements'); await c.back('Heroes'); assert.equal(await c.sceneKey(), 'Heroes');
  } else if (run.scenario === 'mid') {
    await c.start('Shop'); await c.capture('shop-ready', 'Shop');
    let before = await c.save(); let stock = core.shopStatus(before, midDay, game);
    const good = stock.slots.find((s) => s.kind === 'heroExp' && s.stock === 2 && s.affordable);
    assert(good); await c.tap(`shopSlot${good.index}`); await c.capture('shop-sheet', 'Shop'); await c.dynamic('Shop', true);
    const bought = core.buyShopSlot(await c.save(), midDay, good.index, game).save;
    await c.tap('shopBuy', true); await c.expectSave(bought, 'shop-one-of-two-double-tap');
    await c.capture('shop-bought', 'Shop'); await c.scroll(); await c.capture('shop-last', 'Shop');
    before = await c.save(); stock = core.shopStatus(before, midDay, game);
    const poor = stock.slots.find((s) => !s.affordable && s.index >= 6);
    assert(poor); await c.tap(`shopSlot${poor.index}`); await c.capture('shop-insufficient', 'Shop');
    const bytes = await c.bytes(); await c.tap('shopBuy'); assert.equal(await c.bytes(), bytes);
    run.actionChecks.push({ name: 'unaffordable-purchase', unchanged: true });
    await c.back('Shop'); assert.equal(await c.sceneKey(), 'Shop'); await c.scroll(false);
    const free = core.refreshShop(await c.save(), midDay, game); await c.tap('shopRefresh', true, refreshSecondTouchMs); await c.expectSave(free, 'free-refresh-double-tap');
    const refreshBytes = await c.bytes();
    const existingConfirm = await page.evaluate(() => !!window.__game.scene.getScenes(true).at(-1).children.getByName('confirmModal'));
    if (existingConfirm) {
      const pointerEvents = await page.evaluate(() => window.__qaPointerEvents.filter((e) => e.pointerType === 'touch').slice(-4));
      assert.deepEqual(pointerEvents.map((e) => e.type), ['pointerdown', 'pointerup', 'pointerdown', 'pointerup']);
      const interval = pointerEvents[2].time - pointerEvents[1].time;
      assert(interval >= 400, `Второй touch прошёл внутри shield400: ${interval} ms`);
      await c.tap(await c.label('Отмена'));
      assert.equal(await c.bytes(), refreshBytes);
      run.actionChecks.push({ name: 'late-second-touch-confirm-cancel', nativeTouchIntervalMs: interval, unchanged: true });
    }
    await c.tap('shopRefresh'); await c.tap(await c.label('Отмена')); assert.equal(await c.bytes(), refreshBytes);
    run.actionChecks.push({ name: 'paid-refresh-cancel', unchanged: true });
    await c.start('Quests'); await c.capture('quests-ready', 'Quests');
    before = await c.save(); const quest = core.questStatus(before, game, midDay).quests.find((q) => q.done && !q.claimed);
    assert(quest); const claimed = core.actClaimQuest(before, midDay, quest.id, game).save;
    await c.tap(`quest_${quest.id}`, true); await c.expectSave(claimed, 'quest-double-tap');
    const m = core.questStatus(await c.save(), game, midDay).milestones.find((x) => x.reached && !x.claimed);
    assert(m); const milestone = core.actClaimActivity(await c.save(), midDay, m.points, game).save;
    await c.tap(`milestone_${m.points}`, true); await c.expectSave(milestone, 'milestone-double-tap');
    const all = core.actClaimAllQuests(await c.save(), midDay, game).save;
    await c.tap('questsClaimAll', true); await c.expectSave(all, 'quests-claim-all');
    await c.scroll(); await c.expandDone(); await c.scroll(); c.lastRow(await c.capture('quests-last', 'Quests'));
    await c.dynamic('Quests'); await c.back('Home'); assert.equal(await c.sceneKey(), 'Home');
  } else {
    for (const scene of ['Mail', 'Quests', 'Achievements', 'Shop']) {
      await c.start(scene); await c.capture(`${scene.toLowerCase()}-late`, scene); await c.scroll();
      if (scene !== 'Shop' && scene !== 'Mail') {
        await c.expandDone(); await c.scroll();
      }
      const last = await c.capture(`${scene.toLowerCase()}-last`, scene);
      c.lastRow(last);
      await c.dynamic(scene);
      if (scene === 'Shop') {
        await c.scroll(false); const status = core.shopStatus(await c.save(), '2026-10-23', game);
        assert(status.nextRefreshCost === 0);
        const free = core.refreshShop(await c.save(), '2026-10-23', game); await c.tap('shopRefresh'); await c.expectSave(free, 'late-free-refresh');
        const expected = core.refreshShop(await c.save(), '2026-10-23', game);
        await c.tap('shopRefresh'); await c.tap(await c.label('Обновить'), true); await c.expectSave(expected, 'late-paid-refresh-double-tap');
      }
      await c.back('Home'); assert.equal(await c.sceneKey(), 'Home');
    }
  }
  assert.deepEqual(run.errors, []);
  assert.equal(run.requestsBlocked.length, 0, 'Игра попыталась обратиться к внешнему сервису');
  run.passed = true;
}

try {
  for (const mode of modes) for (const size of sizes) for (const scenario of scenarios) {
    const { context, page, run } = await contextFor(mode, size, scenario);
    try { await flow(page, run); } catch (e) {
      try {
        await page.screenshot({ path: path.join(out, `${mode}-${size.join('x')}-${scenario}-failure.png`) });
        run.failureState = await page.evaluate(() => {
          const scene = window.__game.scene.getScenes(true).at(-1);
          return { scene: scene.scene.key, texts: window.__qaWalk(scene.children.list).filter((o) => o.type === 'Text').map((o) => o.text), save: JSON.parse(localStorage.getItem('chronoworld.save.v1')), view: window.__view() };
        });
      } catch { /* Preserve the original assertion if its page has already closed. */ }
      throw e;
    } finally { await context.close(); }
    fs.writeFileSync(path.join(out, 'progress.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  report.passed = true;
} catch (e) {
  if (e instanceof RequestedStop) {
    report.interruption = e.message;
    console.log(report.interruption);
    process.exitCode = 2;
  } else {
    report.failure = e.stack || e.message;
    console.error(report.failure);
    process.exitCode = 1;
  }
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  stopVite(vite);
}
