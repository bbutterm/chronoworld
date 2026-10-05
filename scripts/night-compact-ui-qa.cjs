#!/usr/bin/env node
/* Локальная приёмка адаптивного интерфейса. Никаких записей в облако или production. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { tsImport } = require('tsx/esm/api');

const baseUrl = process.env.URL || 'http://127.0.0.1:5511/';
const origin = new URL(baseUrl);
assert(['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname), 'URL должен указывать на локальный dev/preview, production запрещён');
const out = path.resolve(process.env.OUT || path.join(os.tmpdir(), 'chronoworld-compact-ui-qa'));
const modes = (process.env.MODES || 'webgl,canvas').split(',');
assert(modes.every((m) => ['webgl', 'webgl1', 'canvas'].includes(m)), 'MODES: webgl, webgl1, canvas');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const report = { url: baseUrl, startedAt: new Date().toISOString(), passed: false, runs: [] };
fs.mkdirSync(out, { recursive: true });

async function fixtures() {
  const from = pathToFileURL(__filename).href;
  const [{ loadFullContext }, core, { supportsAdaptiveLayout }] = await Promise.all([
    tsImport('./lib/content-node.ts', from), tsImport('../src/core/index.ts', from), tsImport('../src/game/viewLayout.ts', from),
  ]);
  const game = loadFullContext();
  const decision = game.story.scenes.find((s) => s.id === 'ch3o_s15_after');
  assert(decision?.choice?.options.some((o) => o.id === 'block'), 'Сюжетный fixture ch3_rescue больше не существует');
  let save = core.newGame(game, Date.now());
  const stageIndex = game.content.stages.findIndex((s) => s.id === 'ch3_s15');
  assert(stageIndex >= 0);
  save.campaign.cleared = game.content.stages.slice(0, stageIndex + 1).map((s) => s.id);
  save.storyQueue = [decision.id];
  save.seenScenes = game.story.scenes.filter((s) => s.id !== decision.id).map((s) => s.id);
  for (const chapter of game.content.chapters) save = core.markPageSeen(save, core.episodePageId(chapter.id));
  const hintSource = fs.readFileSync(path.join(__dirname, '../src/game/hints.ts'), 'utf8');
  const hintType = hintSource.split('export type HintId =')[1]?.split(';')[0];
  assert(hintType, 'Не найден каталог подсказок');
  const hints = [...hintType.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const sourceFiles = ['viewLayout.ts', 'viewport.ts', 'ui.ts', 'screen.ts', 'scroll.ts', 'featureTiles.ts', 'runtimeUiLayout.ts', 'storyPage.ts', 'dialogue.ts', 'unlockBanner.ts', 'scenes/CampaignScene.ts', 'scenes/AdventureScene.ts'];
  report.sourceHashes = Object.fromEntries(sourceFiles.map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../src/game', f))).digest('hex')]));
  return { choiceSave: core.serialize(save), choiceId: decision.choice.id, hints, supportsAdaptiveLayout };
}

async function openContext(browser, mode, fixture, choice) {
  const run = { mode, fixture: choice ? 'newGame + законное состояние выбора ch3_s15' : 'новая игра без сохранения', passed: false, errors: [], steps: [] };
  report.runs.push(run);
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/telegram-web-app.js')) return route.fulfill({ contentType: 'application/javascript', body: '' });
    if (url.origin !== origin.origin || !['GET', 'HEAD'].includes(request.method())) return route.abort('blockedbyclient');
    if (/\/assets\/index-[^/]+\.js$/.test(url.pathname)) {
      // Только ответ в приватном локальном browser context: dist и сервер не меняются.
      const response = await route.fetch();
      const code = await response.text();
      const game = /([\w$]+)=new\s*[\w$.]+\.Game\(\{type:/.exec(code);
      const view = /function [\w$]+\(\)\{return ([\w$]+)\.adaptive\?Math.max\(/.exec(code);
      assert(game && view, 'Не удалось инструментировать локальный compiled bundle; используйте dev URL или обновите matcher');
      run.bundleHash = crypto.createHash('sha256').update(code).digest('hex');
      await route.fulfill({ response, body: `${code};window.__game=${game[1]};window.__view=()=>${view[1]};window.__qaCompiled=true;` });
      return;
    }
    await route.continue();
  });
  await context.addInitScript(({ mode, hints, choiceSave, choice }) => {
    if (choice) localStorage.setItem('chronoworld.save.v1', choiceSave);
    localStorage.setItem('chronoworld.hints', JSON.stringify(hints));
    localStorage.setItem('chronoworld.hintsShown', JSON.stringify(hints));
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (name, ...args) {
      if ((mode === 'canvas' && /webgl|experimental/i.test(name)) || (mode === 'webgl1' && name === 'webgl2')) return null;
      return get.call(this, name, ...args);
    };
    window.__tgEvents = {};
    window.Telegram = { WebApp: {
      platform: 'ios', version: '9.0', initData: '', isFullscreen: true,
      safeAreaInset: { top: choice ? 0 : 47, bottom: choice ? 0 : 34, left: 0, right: 0 },
      contentSafeAreaInset: { top: choice ? 0 : 89, bottom: 0, left: 0, right: 0 },
      ready() {}, expand() {},
      onEvent(name, fn) { (window.__tgEvents[name] ??= []).push(fn); },
      offEvent(name, fn) { window.__tgEvents[name] = (window.__tgEvents[name] ?? []).filter((f) => f !== fn); },
      BackButton: { hide() {}, show() {}, onClick() {}, offClick() {} },
    } };
    const set = Storage.prototype.setItem;
    window.__choiceWrites = [];
    Storage.prototype.setItem = function (key, value) {
      if (key === 'chronoworld.save.v1') {
        const choice = JSON.parse(value).campaignChoices?.ch3_rescue;
        if (choice !== undefined) window.__choiceWrites.push(choice);
      }
      return set.call(this, key, value);
    };
  }, { mode, hints: fixture.hints, choiceSave: fixture.choiceSave, choice });
  const page = await context.newPage();
  page.on('pageerror', (error) => run.errors.push(error.stack || error.message));
  page.on('console', (message) => { if (message.type() === 'error') run.errors.push(message.text()); });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__game?.scene && !window.__game.scene.isActive('Boot') && window.__game.scene.getScenes(true).length, null, { timeout: 120000 });
  await page.evaluate(() => {
    window.__qaFrames = 0;
    window.__game.events.on('postrender', () => window.__qaFrames++);
    window.__qaWalk = (list) => list.flatMap((o) => [o, ...(o.list ? window.__qaWalk(o.list) : [])]);
  });
  return { context, page, run };
}

function controls(page, run, fixture) {
  const objects = () => page.evaluate(() => window.__qaWalk(window.__game.scene.getScenes(true).at(-1).children.list).filter((o) => o.name).map((o) => ({ name: o.name, y: o.y, text: o.text })));
  const tap = async (name) => {
    const p = await page.evaluate((name) => {
      const scene = window.__game.scene.getScenes(true).at(-1);
      const o = window.__qaWalk(scene.children.list).find((o) => o.name === name && o.scene);
      if (!o) throw Error(`Не найдена кнопка ${name} в ${scene.scene.key}`);
      const m = o.getWorldTransformMatrix();
      const v = window.__view();
      const s = v.cssW / v.worldW;
      return { x: v.cssLeft + (m.tx - v.worldX) * s, y: v.cssTop + (m.ty - v.worldY) * s };
    }, name);
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForTimeout(550);
  };
  const labelName = async (label) => page.evaluate((label) => {
    const scene = window.__game.scene.getScenes(true).at(-1);
    const o = window.__qaWalk(scene.children.list).find((o) => o.type === 'Container' && o.list?.some((t) => t.type === 'Text' && t.text === label));
    if (!o) throw Error(`Не найдена кнопка «${label}» в ${scene.scene.key}`);
    o.setName('qaLabelButton');
    return o.name;
  }, label);
  const dismiss = async () => {
    let quiet = 0;
    for (let i = 0; i < 60; i++) {
      const name = await page.evaluate(() => {
        const scene = window.__game.scene.getScenes(true).at(-1);
        const list = window.__qaWalk(scene.children.list);
        if (list.some((o) => o.name === 'pagesSkip')) return 'pagesSkip';
        const layer = list.find((o) => ['dialogue', 'unlockBanner'].includes(o.name));
        if (!layer) return null;
        const label = layer.name === 'unlockBanner' ? 'Позже' : 'Пропустить';
        const button = window.__qaWalk(layer.list).find((o) => o.type === 'Container' && o.list?.some((t) => t.type === 'Text' && t.text === label));
        if (!button) throw Error(`Не найден выход из ${layer.name}`);
        button.setName('qaModalSkip');
        return button.name;
      });
      if (!name) {
        if (++quiet === 2) return;
        await page.waitForTimeout(900);
      } else {
        quiet = 0;
        await tap(name);
      }
    }
    throw Error('Очередь сюжетных окон не закрылась');
  };
  const shot = async (label, expectedScene) => {
    await page.waitForTimeout(650);
    const step = await page.evaluate(() => {
      const game = window.__game;
      const scene = game.scene.getScenes(true).at(-1);
      const v = window.__view();
      const s = v.cssW / v.worldW;
      const all = window.__qaWalk(scene.children.list);
      const bg = scene.children.list.find((o) => o.type === 'Image' && o.x === 540 && o.y === 960 && o.displayWidth === 1080 && o.displayHeight === 1920);
      const title = all.find((o) => o.name === 'screenTitle');
      return {
        scene: scene.scene.key, renderer: game.renderer.type, frames: window.__qaFrames, view: v,
        invalidFrames: all.filter((o) => o.frame && !o.frame.source).map((o) => o.texture?.key),
        headerAboveBleed: !title || (bg?.getData('bleed') ?? []).every((o) => scene.children.getIndex(o) < scene.children.getIndex(title)),
        controls: all.filter((o) => o.name && o.input?.hitArea).map((o) => {
          const m = o.getWorldTransformMatrix();
          return { name: o.name, x: v.cssLeft + (m.tx - v.worldX) * s, y: v.cssTop + (m.ty - v.worldY) * s,
            width: o.input.hitArea.width * Math.hypot(m.a, m.b) * s,
            height: o.input.hitArea.height * Math.hypot(m.c, m.d) * s };
        }),
        text: all.filter((o) => o.name && o.type === 'Text').map((o) => ({ name: o.name, text: o.text, font: parseFloat(o.style.fontSize) * s, y: o.getWorldTransformMatrix().ty })),
        scrolls: all.filter((o) => o.getData?.('clip')).map((o) => ({ name: o.name, y: o.y, clip: o.getData('clip') })),
      };
    });
    run.steps.push({ label, ...step });
    await page.screenshot({ path: path.join(out, `${run.mode}-${run.fixture.startsWith('новая') ? 'cold' : 'choice'}-${label}.png`) });
    assert.equal(step.scene, expectedScene, `${label}: переход фактически не состоялся`);
    assert.equal(step.invalidFrames.length, 0, `${label}: уничтожена texture source`);
    assert(step.headerAboveBleed, `${label}: шапка закрыта продолжением фона после resize`);
    assert.deepEqual(run.errors, [], `${label}: ошибки браузера`);
    assert(step.frames > (run.steps.at(-2)?.frames ?? -1), `${label}: остановился renderer`);
    if (fixture.supportsAdaptiveLayout(step.scene)) {
      assert(step.view.adaptive, `${label}: adaptive policy не выбрана до create`);
      const h = page.viewportSize().height;
      assert(Math.abs(step.view.uiHeight - (h - 170) * 3) < 0.01, `${label}: интерфейс сжат по высоте`);
      for (const control of step.controls.filter((o) => o.name.startsWith('nav_') || ['currencyBalanceTarget', 'pill_gold', 'pill_gems', 'fightCta', 'chestClaim', 'campaignChoice_block', 'campaignChoice_evacuate'].includes(o.name))) {
        assert(control.height >= 43.9, `${label}: ${control.name} меньше44CSSpx`);
      }
      for (const text of step.text.filter((o) => ['chapterProgress', 'campaignObjective', 'dialogueBody', 'pageText'].includes(o.name))) assert(text.font >= 11.99, `${label}: мелкий текст ${text.name}`);
    } else assert.equal(step.view.uiHeight, 1920, `${label}: fixed scene потеряла часть интерфейса`);
    console.log(`${run.mode}: ${label} ${step.scene} uiHeight=${step.view.uiHeight}`);
    return step;
  };
  const resize = async (h) => {
    await page.setViewportSize({ width: 360, height: h });
    await page.evaluate(() => { for (const fn of window.__tgEvents.viewportChanged ?? []) fn({ isStateStable: true }); });
  };
  const balance = async () => {
    for (const name of ['pill_gold', 'pill_gems']) {
      // Тапаем обе визуальные строки. Одна цель должна сообщать обе суммы без пересекающихся input-зон.
      await tap(name);
      const values = await page.evaluate(() => {
        const scene = window.__game.scene.getScenes(true).at(-1);
        const all = window.__qaWalk(scene.children.list);
        const target = all.find((o) => o.name === 'currencyBalanceTarget');
        const save = JSON.parse(localStorage.getItem('chronoworld.save.v1'));
        const label = all.filter((o) => o.type === 'Text' && o.text.startsWith('Баланс\n')).at(-1)?.text;
        return { target: !!target?.input, separateInputs: all.filter((o) => ['pill_gold', 'pill_gems'].includes(o.name) && o.input).length,
          gold: save.resources.gold, gems: save.currency.gems, label };
      });
      assert(values.target && values.separateInputs === 0, 'Строки валют перехватывают тапы друг друга');
      assert(values.label, `Тап ${name} не открыл баланс`);
      const gold = /Золото: ([\d\s\u00a0]+)/.exec(values.label)?.[1].replace(/\D/g, '');
      const gems = /Гемы: ([\d\s\u00a0]+)/.exec(values.label)?.[1].replace(/\D/g, '');
      assert.equal(Number(gold), values.gold, 'Баланс показывает устаревшее/сокращённое золото');
      assert.equal(Number(gems), values.gems, 'Баланс показывает устаревшие/сокращённые гемы');
    }
  };
  return { objects, tap, labelName, dismiss, shot, resize, balance };
}

async function coldFlow(browser, mode, fixture) {
  const { context, page, run } = await openContext(browser, mode, fixture, false);
  try {
    const c = controls(page, run, fixture);
    const first = await c.shot('intro', 'Campaign');
    assert(first.text.some((t) => t.name === 'pageText'), 'Холодное вступление не открылось');
    await page.mouse.move(170, 380); await page.mouse.wheel(0, 8000);
    const end = await c.shot('intro-end', 'Campaign');
    assert(end.scrolls.find((s) => s.name === 'storyPageScroll').y < first.scrolls.find((s) => s.name === 'storyPageScroll').y, 'Последний абзац сюжета недоступен');
    await c.resize(760); await c.shot('intro-tall', 'Campaign');
    await c.resize(640); await c.shot('intro-short', 'Campaign');
    await c.tap('pagesNext'); const second = await c.shot('intro-next', 'Campaign');
    assert.notEqual(second.text.find((t) => t.name === 'pageTitle').text, first.text.find((t) => t.name === 'pageTitle').text);
    await c.dismiss(); await c.balance(); await c.shot('map-balance', 'Campaign');
    await c.tap('nav_Adventure'); await c.dismiss();
    await c.balance();
    const adventure = await c.shot('adventure', 'Adventure');
    await page.mouse.move(178, 490); await page.mouse.down(); await page.mouse.move(178, 240, { steps: 24 }); await page.mouse.up();
    const dragged = await c.shot('adventure-drag', 'Adventure');
    assert(dragged.scrolls.find((s) => s.name === 'adventureScroll').y < adventure.scrolls.find((s) => s.name === 'adventureScroll').y, 'Список приключений не прокручивается');
    await c.tap('nav_Campaign'); await c.dismiss(); await c.shot('map-return', 'Campaign');
    await page.mouse.move(170, 330); await page.mouse.wheel(0, 8000); await c.shot('formation-end', 'Campaign');
    const edit = await page.evaluate(() => {
      const scene = window.__game.scene.getScenes(true).at(-1);
      const list = window.__qaWalk(scene.children.list);
      const button = list.find((o) => o.name === 'campaignSquadEdit');
      const clip = list.find((o) => o.name === 'campaignMapScroll').getData('clip');
      return { y: button.getWorldTransformMatrix().ty, clip };
    });
    assert(edit.y >= edit.clip[0] && edit.y <= edit.clip[1], 'Редактирование отряда скрыто за footer');
    await c.resize(760); await c.shot('map-tall', 'Campaign'); await c.resize(640); await c.shot('map-short', 'Campaign');
    await c.tap('fightCta'); await c.dismiss(); await c.shot('stage', 'Stage');
    await c.tap('cta'); await c.dismiss(); await c.shot('battle', 'Battle');
    await c.tap('skipBtn'); await page.waitForFunction(() => window.__game.scene.isActive('Result') && window.__game.scene.getScene('Result').ready, null, { timeout: 30000 });
    await c.dismiss(); await c.shot('result', 'Result');
    await c.tap(await c.labelName('К кампании')); await c.dismiss(); await c.shot('campaign-after-battle', 'Campaign');
    await c.tap('nav_Adventure'); await c.dismiss(); await c.shot('adventure-after-battle', 'Adventure');
    run.passed = true;
  } finally { await context.close(); }
}

async function choiceFlow(browser, mode, fixture) {
  const { context, page, run } = await openContext(browser, mode, fixture, true);
  try {
    const c = controls(page, run, fixture);
    // SDK прислал реальные отступы после create: сцена и открытый диалог сохраняются.
    await page.evaluate(() => {
      window.Telegram.WebApp.safeAreaInset = { top: 47, bottom: 34, left: 0, right: 0 };
      window.Telegram.WebApp.contentSafeAreaInset = { top: 89, bottom: 0, left: 0, right: 0 };
      for (const fn of window.__tgEvents.safeAreaChanged ?? []) fn();
    });
    for (let i = 0; i < 24; i++) {
      if ((await c.objects()).some((o) => o.name === 'campaignChoice_block')) break;
      await page.waitForTimeout(300); await page.touchscreen.tap(180, 570);
    }
    await page.waitForFunction(() => window.__qaWalk(window.__game.scene.getScene('Campaign').children.list).some((o) => o.name === 'campaignChoice_block'), null, { timeout: 10000 });
    await c.shot('choice-open', 'Campaign'); await c.resize(760); await c.shot('choice-tall', 'Campaign'); await c.resize(640); await c.shot('choice-short', 'Campaign');
    const read = () => page.evaluate((id) => {
      const save = JSON.parse(localStorage.getItem('chronoworld.save.v1'));
      return { choice: save.campaignChoices?.[id] ?? null, writes: window.__choiceWrites.length, seen: save.seenScenes.includes('ch3o_s15_after') };
    }, fixture.choiceId);
    assert.deepEqual(await read(), { choice: null, writes: 0, seen: false }, 'resize принял ответ за игрока');
    await c.tap('campaignChoice_block'); await c.shot('choice-picked', 'Campaign');
    run.choice = await read();
    assert.deepEqual(run.choice, { choice: 'block', writes: 1, seen: false }, 'Ответ не записан ровно один раз перед reply');
    assert(!(await c.objects()).some((o) => o.name.startsWith('campaignChoice_')), 'Альтернативные ответы остались активны');
    await c.dismiss(); await c.tap('nav_Adventure'); await c.dismiss(); await c.shot('choice-adventure', 'Adventure');
    run.passed = true;
  } finally { await context.close(); }
}

(async () => {
  const fixture = await fixtures();
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    for (const mode of modes) { await coldFlow(browser, mode, fixture); await choiceFlow(browser, mode, fixture); }
    report.passed = true;
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
