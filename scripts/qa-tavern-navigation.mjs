#!/usr/bin/env node
// Узкая native-проверка навигации призыва. Только локальный dev-сервер и отдельное QA сохранение.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROME_EXECUTABLE_PATH=/usr/bin/chromium \
// QA_TAVERN_URL=http://127.0.0.1:5197 node scripts/qa-tavern-navigation.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const url = process.env.QA_TAVERN_URL ?? 'http://127.0.0.1:5197';
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('QA fixture requires a local dev server');
const entry = process.env.PLAYWRIGHT_MODULE ?? join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright/index.mjs');
const { chromium } = await import(pathToFileURL(resolve(entry)).href);
const out = resolve(process.env.QA_TAVERN_OUT ?? join(tmpdir(), `chronoworld-tavern-navigation-${Date.now()}`));
mkdirSync(out, { recursive: true });
const report = [];

for (const spec of [
  { name: 'webgl390', width: 390, height: 844, args: [] },
  { name: 'canvas360', width: 360, height: 640, args: ['--disable-webgl'] },
]) {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage', ...spec.args] });
  const page = await browser.newPage({ viewport: { width: spec.width, height: spec.height }, hasTouch: true });
  const errors = [], external = [], row = { case: spec.name, checks: [], errors, external };
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/*', route => {
    const request = route.request();
    if (!['127.0.0.1', 'localhost'].includes(new URL(request.url()).hostname)) {
      external.push({ method: request.method(), url: request.url() });
      return route.abort();
    }
    return route.continue();
  });
  await page.addInitScript(() => {
    localStorage.setItem('chronoworld.reduceMotion', '1');
    let back = null;
    window.__qaTelegramBack = () => back?.();
    window.Telegram = { WebApp: { platform: 'android', version: '8.0', initData: '',
      ready() {}, expand() {}, disableVerticalSwipes() {}, lockOrientation() {},
      setHeaderColor() {}, setBackgroundColor() {}, setBottomBarColor() {}, onEvent() {}, offEvent() {},
      BackButton: { show() {}, hide() {}, onClick(fn) { back = fn; }, offClick(fn) { if (back === fn) back = null; } },
    } };
  });
  const check = (condition, label) => { assert.ok(condition, `${spec.name}: ${label}`); row.checks.push(label); };
  const pause = () => page.waitForTimeout(350);
  const wait = async key => {
    await page.waitForFunction(key => window.__game?.scene.isActive(key) && !window.__sprites?.busy(), key, { timeout: 60000 });
    await pause();
  };
  const state = () => page.evaluate(() => {
    const scene = window.__game.scene.getScene('Tavern'), r = scene.reveal;
    const save = JSON.parse(localStorage.getItem('chronoworld.save.v1'));
    return { active: window.__game.scene.getScenes(true).map(s => s.sys.settings.key),
      phase: r?.phase ?? null, ids: r?.results.map(x => x.heroId) ?? null, offset: r?.body.offset ?? null,
      renderer: window.__game.renderer.type, data: scene.sys.settings.data,
      save: JSON.stringify(save), resources: JSON.stringify({ currency: save.currency, summon: save.summon, heroSeq: save.heroSeq }) };
  });
  const tap = async (key, name) => {
    const bounds = await page.evaluate(([key, name]) => {
      const all = ns => ns.flatMap(o => o.list ? [o, ...all(o.list)] : [o]);
      const object = all(window.__game.scene.getScene(key).children.list).find(o => o.name === name || o.text === name);
      if (!object) throw new Error(`Missing ${key}/${name}`);
      const b = object.getBounds(); return { x: b.centerX, y: b.centerY };
    }, [key, name]);
    const canvas = await page.locator('canvas').boundingBox(), view = await page.evaluate(() => window.__view());
    const scale = canvas.width / view.worldW;
    await page.touchscreen.tap(canvas.x + (bounds.x - view.worldX) * scale, canvas.y + (bounds.y - view.worldY) * scale);
    await pause();
  };
  const back = async () => { await page.evaluate(() => window.__qaTelegramBack()); await pause(); };
  try {
    await page.goto(url); await wait('Campaign');
    // QA stock is only for UI reachability; the summon itself uses the real native button and core action.
    await page.evaluate(async () => {
      const { session, commit } = await import('/src/game/session.ts');
      const { GAME } = await import('/src/game/content.ts');
      const unlock = GAME.unlocks.features.find(f => f.id === 'tavern');
      const index = GAME.content.stages.findIndex(s => s.id === unlock.stage);
      const save = structuredClone(session.save);
      save.createdAt = 1700000000000;
      save.campaign.cleared = GAME.content.stages.slice(0, index + 1).map(s => s.id);
      save.seenUnlocks = GAME.unlocks.features.map(f => f.id);
      save.currency.scrolls = 20; save.currency.gems = 300; save.summon.welcomeGiven = true;
      commit(save); window.__game.scene.getScene('Campaign').scene.start('Home');
    });
    await wait('Home'); await tap('Home', 'tavernTile'); await wait('Tavern');
    check((await state()).renderer === (spec.name.startsWith('canvas') ? 1 : 2), 'expected renderer');
    await tap('Tavern', 'pullTen'); await wait('Tavern');
    await page.waitForFunction(() => window.__game.scene.getScene('Tavern').reveal?.phase === 'done', null, { timeout: 60000 });
    const pulled = await state(); check(pulled.ids.length === 10, 'real ten-card summon');
    await tap('Tavern', 'summonCard_0'); await wait('Hero');
    const read = await state();
    await tap('Hero', 'backButton'); await wait('Tavern');
    const resumed = await state();
    check(resumed.phase === 'done' && JSON.stringify(resumed.ids) === JSON.stringify(pulled.ids), 'Hero returns to completed same-card result');
    check(resumed.save === read.save && resumed.resources === pulled.resources, 'Hero return preserves save and charged resources');
    await page.setViewportSize({ width: 320, height: 568 }); await pause();
    check((await state()).phase === 'done', 'resize keeps completed result');
    await back(); await wait('Tavern');
    check((await state()).phase === null, 'Telegram Back after resize returns to hall');
    await page.setViewportSize({ width: spec.width, height: spec.height }); await pause();
    // Repeat through the Stage shortcut to prove that this exit cannot retain reveal data.
    await tap('Tavern', 'pullOne'); await wait('Tavern');
    await page.waitForFunction(() => window.__game.scene.getScene('Tavern').reveal?.phase === 'done', null, { timeout: 60000 });
    const second = await state();
    await tap('Tavern', 'summonPrepare'); await wait('Stage');
    await tap('Stage', 'backButton'); await wait('Campaign'); await tap('Campaign', 'Город'); await wait('Home');
    await tap('Home', 'tavernTile'); await wait('Tavern');
    const fresh = await state();
    check(fresh.phase === null && fresh.save === second.save, 'ordinary reentry opens hall with unchanged save');
    // A guaranteed rare card checks both Back during reveal and the upper showcase modal.
    await page.evaluate(async () => {
      const { session, commit } = await import('/src/game/session.ts');
      const { setReducedMotion } = await import('/src/game/state.ts');
      const save = structuredClone(session.save); save.summon.sincePurple = 49; commit(save); setReducedMotion(false);
    });
    await tap('Tavern', 'pullOne'); await wait('Tavern');
    const rare = await state(); await back();
    check((await state()).active.includes('Tavern'), 'Telegram Back during reveal stays in Tavern');
    await page.waitForFunction(() => ['showcase', 'done'].includes(window.__game.scene.getScene('Tavern').reveal?.phase), null, { timeout: 60000 });
    if ((await state()).phase === 'showcase') {
      await back(); await page.waitForFunction(() => window.__game.scene.getScene('Tavern').reveal?.phase === 'done', null, { timeout: 30000 });
      row.checks.push('Telegram Back closes upper rare showcase');
    }
    await page.setViewportSize({ width: 320, height: 568 }); await pause();
    await back(); await wait('Tavern');
    const closed = await state();
    check(closed.phase === null && closed.save === rare.save, 'Back closes result after resize without save mutation');
    check(errors.length === 0 && external.length === 0, 'no browser errors or external requests');
    await page.screenshot({ path: join(out, `${spec.name}-hall.png`) });
    row.status = 'PASS'; console.log(`${spec.name}: PASS ${row.checks.length} checks`);
  } catch (error) {
    row.status = 'FAIL'; row.error = String(error);
    await page.screenshot({ path: join(out, `${spec.name}-failure.png`) }).catch(() => {});
    throw error;
  } finally {
    report.push(row); writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close();
  }
}
console.log(out);
