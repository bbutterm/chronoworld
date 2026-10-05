#!/usr/bin/env node
/* Локальная приёмка лагеря/призыва; общий harness блокирует cloud и все записи по сети. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { tsImport } = require('tsx/esm/api');
const qa = require('./night-compact-ui-qa.cjs');

async function cityFixture() {
  const fixture = await qa.fixtures();
  const from = pathToFileURL(__filename).href;
  const [{ loadFullContext }, core] = await Promise.all([tsImport('./lib/content-node.ts', from), tsImport('../src/core/index.ts', from)]);
  const game = loadFullContext();
  let save = JSON.parse(fixture.choiceSave);
  save = core.markScenesSeen(save, game.story.scenes.map((s) => s.id));
  save.storyQueue = [];
  save = core.markUnlocksSeen(save, core.pendingUnlocks(save, game).map((f) => f.id));
  fixture.choiceSave = core.serialize(save);
  fixture.game = game;
  fixture.markHeroSeen = core.markHeroSeen;
  return fixture;
}

async function revealControl(page, name) {
  for (let i = 0; i < 12; i++) {
    const target = await page.evaluate((name) => {
      const scene = window.__game.scene.getScenes(true).at(-1);
      const o = window.__qaWalk(scene.children.list).find((o) => o.name === name && o.scene);
      if (!o) throw Error(`Не найдена цель ${name}`);
      let clip = null;
      for (let p = o.parentContainer; p; p = p.parentContainer) if (p.getData('clip')) { clip = p.getData('clip'); break; }
      const y = o.getWorldTransformMatrix().ty;
      const h = o.input?.hitArea.height ?? o.height;
      const v = window.__view(), scale = v.cssW / v.worldW;
      if (!clip) return { ready: true };
      const [top, bottom] = clip;
      const half = Math.min(h / 2, (bottom - top) / 2 - 12);
      const delta = y - half < top - 0.5 ? y - half - top : y + half > bottom + 0.5 ? y + half - bottom : 0;
      return { ready: Math.abs(delta) < 1, delta, x: v.cssLeft + (540 - v.worldX) * scale, y: v.cssTop + ((top + bottom) / 2 - v.worldY) * scale };
    }, name);
    if (target.ready) return;
    await page.mouse.move(target.x, target.y); await page.mouse.wheel(0, target.delta);
    await page.waitForTimeout(150);
  }
  throw Error(`Цель ${name} не достигнута реальной прокруткой`);
}

async function cityFlow(browser, mode, fixture, width, height) {
  const { context, page, run } = await qa.openContext(browser, mode, fixture, true);
  run.fixture = `город/${width}×${height}, поздние insets`;
  const c = qa.controls(page, run, fixture);
  const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('chronoworld.save.v1')));
  const back = async () => {
    const count = await page.evaluate(() => { const list = [...window.__tgBackHandlers]; for (const fn of list) fn(); return list.length; });
    assert.equal(count, 1, 'Telegram Back должен иметь ровно одного владельца');
    await page.waitForTimeout(100);
    await page.waitForFunction(() => window.__game.input.enabled && !window.__game.scene.getScenes(true).at(-1).children.list.some((o) => o.getData?.('closing')), null, { timeout: 5000 });
    await page.waitForTimeout(100);
  };
  const tap = async (name) => { await revealControl(page, name); await c.tap(name); };
  const shot = async (label, scene) => {
    const step = await c.shot(`${width}x${height}-${label}`, scene);
    const names = ['settings', 'currencyBalanceTarget', 'mailIconHit', 'contractIconHit', 'eventsIconHit', 'chronicleBtnHit', 'friendsBtn',
      'settingsClose', 'battleSpeed', 'resetProgress', 'tavernInfo', 'giftClaim', 'pullOne', 'pullTen', 'tavernRevealSkip', 'summonPrepare', 'summonDone', 'summonAgain'];
    for (const control of step.controls.filter((o) => names.includes(o.name))) assert(control.width >= 43.9 && control.height >= 43.9, `${label}: ${control.name} <44CSS`);
    for (const text of step.text.filter((o) => o.name.startsWith('pityLabel') || o.name === 'freeIn')) assert(text.font >= 11.99);
    return step;
  };
  try {
    await c.dismiss();
    await page.setViewportSize({ width, height });
    await page.waitForFunction((width) => Math.abs(window.__view().cssW - width) < 0.01, width);
    await page.waitForTimeout(450);
    await c.tap('nav_Home'); await c.dismiss();
    const home = await shot('home-before-insets', 'Home');
    assert.equal(home.view.uiHeight, 1920, 'До SDK insets доступно полное поле');
    const before = await save();
    await page.evaluate(() => {
      window.Telegram.WebApp.safeAreaInset = { top: 47, bottom: 34, left: 0, right: 0 };
      window.Telegram.WebApp.contentSafeAreaInset = { top: 89, bottom: 0, left: 0, right: 0 };
      for (const fn of window.__tgEvents.contentSafeAreaChanged ?? []) fn();
    });
    await page.waitForTimeout(450);
    await shot('home-insets', 'Home'); assert.deepEqual(await save(), before, 'Insets перезапустили/изменили save');
    await tap('questsTile'); await shot('quests-real-tile', 'Quests'); await c.tap('nav_Home'); await c.dismiss();
    await tap('achievementsTile'); await shot('achievements-real-tile', 'Achievements'); await c.tap('nav_Home'); await c.dismiss();
    await c.tap('settings'); const settings = await shot('settings', 'Home');
    assert(settings.scrolls.some((s) => s.name === 'settingsContent'));
    await revealControl(page, 'resetProgress'); await shot('settings-end', 'Home');
    const settingsSave = await save();
    await page.setViewportSize({ width, height: height + 120 }); await page.waitForTimeout(450); await shot('settings-tall', 'Home');
    await page.setViewportSize({ width, height }); await page.waitForTimeout(450); await shot('settings-short', 'Home');
    assert.deepEqual(await save(), settingsSave, 'Настройки/resize изменили прогресс');
    await back(); assert(!(await c.objects()).some((o) => o.name === 'settingsModal'));
    await c.tap('settings'); await c.tap('settingsClose');
    await tap('tavernTile'); await shot('tavern', 'Tavern');
    await tap('tavernInfo'); await shot('tavern-rates', 'Tavern'); await back();
    const st = await save();
    if (!st.summon.welcomeGiven) {
      await tap('giftClaim'); await shot('tavern-gift-claimed', 'Tavern');
      const gift = await save();
      if (!gift.summon.welcomeGiven) {
        const input = await page.evaluate(() => {
          const scene = window.__game.scene.getScene('Tavern'), p = scene.input.activePointer;
          const target = window.__qaWalk(scene.children.list).find((o) => o.name === 'giftClaim');
          return { locked: scene.mainArea.locked, pointer: { x: p.x, y: p.y, worldX: p.worldX, worldY: p.worldY },
            hit: scene.input.hitTestPointer(p).map((o) => ({ name: o.name, type: o.type, x: o.x, y: o.y })),
            target: { enabled: target.input?.enabled, hitArea: target.input?.hitArea, matrix: [...target.getWorldTransformMatrix().matrix] } };
        });
        throw Error(`Реальный тап не выдал подарок: ${JSON.stringify(input)}`);
      }
    }
    const claimed = await save();
    await page.setViewportSize({ width, height: height + 120 }); await page.waitForTimeout(450); await shot('tavern-tall', 'Tavern');
    await page.setViewportSize({ width, height }); await page.waitForTimeout(450); await shot('tavern-short', 'Tavern');
    assert.deepEqual(await save(), claimed, 'Resize повторил подарок/поменял summon state');
    await tap('pullTen'); await shot('reveal-start', 'Tavern');
    await c.tap('tavernRevealSkip');
    await page.waitForFunction(() => window.__game.scene.getScene('Tavern').reveal?.phase === 'done', null, { timeout: 60000 });
    const pulled = await save();
    assert.equal(pulled.heroes.length - claimed.heroes.length, 10, 'Призыв записан не один раз');
    assert.equal(await page.evaluate(() => window.__game.scene.getScene('Tavern').reveal.cards.length), 10);
    await shot('reveal-done', 'Tavern');
    await revealControl(page, 'summonCard_9'); await shot('reveal-last-card', 'Tavern');
    await page.setViewportSize({ width, height: height + 120 }); await page.waitForTimeout(450); await shot('reveal-tall', 'Tavern');
    await page.setViewportSize({ width, height }); await page.waitForTimeout(450); await shot('reveal-short', 'Tavern');
    assert.deepEqual(await save(), pulled, 'Resize повторил призыв или изменил результат');
    const viewedHeroId = await page.evaluate(() => window.__game.scene.getScene('Tavern').reveal.results[9].heroId);
    await tap('summonCard_9'); await shot('summon-real-card-hero', 'Hero'); await back();
    await page.waitForFunction(() => window.__game.scene.getScene('Tavern').reveal?.phase === 'done', null, { timeout: 60000 });
    await page.waitForFunction(() => window.__qaWalk(window.__game.scene.getScene('Tavern').children.list).find((o) => o.name === 'summonDone')?.alpha >= 0.99 && window.__game.input.enabled, null, { timeout: 5000 });
    await c.tap('summonDone'); await shot('tavern-after-done', 'Tavern');
    assert.equal(await page.evaluate(() => !!window.__game.scene.getScene('Tavern').reveal), false, 'Готово повторно показало старый reveal');
    const viewed = fixture.markHeroSeen(pulled, viewedHeroId);
    const expectedViewed = { ...viewed, revision: pulled.revision + (viewed === pulled ? 0 : 1) };
    assert.deepEqual(await save(), expectedViewed, 'Возврат карточки изменил данные кроме законного прочтения героя и revision commit');
    await back(); await c.dismiss(); await shot('home-after-tavern', 'Home');
    run.passed = true;
  } finally { await context.close(); }
}

(async () => {
  const fixture = await cityFixture();
  const owned = ['src/game/scenes/HomeScene.ts', 'src/game/scenes/TavernScene.ts', 'src/game/homeBuildings.ts', 'src/game/homeEvents.ts', 'src/game/settingsLayout.ts', 'src/game/homeLayout.ts', 'src/game/compactTavernLayout.ts', 'scripts/night-city-compact-ui-qa.cjs', 'scripts/night-compact-ui-qa.cjs'];
  qa.report.citySourceHashes = Object.fromEntries(owned.map((file) => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', file))).digest('hex')]));
  const browser = await qa.chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const sizes = (process.env.SIZES || '360x640,390x844').split(',').map((s) => s.split('x').map(Number));
    for (const mode of qa.modes) for (const [width, height] of sizes) await cityFlow(browser, mode, fixture, width, height);
    qa.report.passed = true;
  } finally {
    qa.report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(qa.out, 'report.json'), JSON.stringify(qa.report, null, 2));
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
