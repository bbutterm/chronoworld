#!/usr/bin/env node
// Локальная фактическая приёмка Phaser. Внешние запросы и любые облачные записи заблокированы.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { tsImport } = require('tsx/esm/api');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = new URL(process.env.URL || 'http://127.0.0.1:5553/?compact=1');
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Только локальный dev URL');
assert.equal(url.searchParams.get('compact'), '1', 'Сцена проверяется до production allowlist: DEV ?compact=1');
const out = path.resolve(process.env.OUT || path.join(os.tmpdir(), 'chronoworld-night-chronicle-actual'));
fs.mkdirSync(out, { recursive: true });
const modes = (process.env.MODES || 'canvas,webgl').split(',');
assert(modes.every((m) => ['canvas', 'webgl'].includes(m)));
const fixtureNames = (process.env.FIXTURES || 'fresh,legal').split(',');
assert(fixtureNames.every((n) => ['fresh', 'legal'].includes(n)));
const requireCompiled = process.env.COMPILED === '1';
const tailOnly = process.env.TAIL_ONLY === '1';
if (tailOnly) assert(fixtureNames.every((n) => n === 'legal'), 'Короткий tail требует законный checkpoint');
const report = { startedAt: new Date().toISOString(), url: url.href, tailOnly, passed: false, runs: [] };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const root = path.join(__dirname, '..');
function treeDigest(relative) {
  const files = [];
  const visit = (dir) => {
    for (const item of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const name = `${dir}/${item.name}`;
      if (item.isDirectory()) visit(name);
      else if (/\.(ts|json)$/.test(item.name)) files.push(name);
    }
  };
  visit(relative); files.sort();
  return { files: files.length, sha256: sha(JSON.stringify(files.map((p) => [p, sha(fs.readFileSync(path.join(root, p)))]))) };
}
report.readOnlyCoreData = { core: treeDigest('src/core'), data: treeDigest('data') };
const sourcePaths = ['src/game/scenes/ChronicleScene.ts', 'src/game/chronicleLayout.ts', 'src/game/screen.ts', 'src/game/ui.ts', 'src/game/viewport.ts', 'src/game/viewLayout.ts', 'src/game/modalBack.ts', 'src/game/modalInput.ts', 'src/game/scroll.ts', 'src/game/loreView.ts', 'src/game/heroStoryView.ts', 'src/game/storyPage.ts', 'src/game/dialogue.ts', 'src/game/scenes/ChapterDoneScene.ts', 'src/game/battleScreenLayout.ts', 'src/game/scenes/TavernEveningScene.ts', 'src/game/compactEveningLayout.ts', 'src/game/storage.ts', 'scripts/night-chronicle-ui-qa.cjs'];
report.sourceHashes = Object.fromEntries(sourcePaths.map((p) => [p, sha(fs.readFileSync(path.join(__dirname, '..', p)))]));

async function fixtures() {
  const from = pathToFileURL(__filename).href;
  const [{ loadFullContext, readJsonDir }, core, { SaveSlot, LocalStorageAdapter }] = await Promise.all([
    tsImport('./lib/content-node.ts', from), tsImport('../src/core/index.ts', from), tsImport('../src/game/storage.ts', from),
  ]);
  const ctx = loadFullContext();
  const { lore, problems } = core.parseLore(readJsonDir('data/lore'));
  assert.deepEqual(problems, []);
  const saved = fs.readFileSync(path.join(__dirname, '../tests/fixtures/chronicle-legal-checkpoint.json'));
  report.legalFixture = { sha256: sha(saved), provenance: 'rational DATA2 seed3, after-ch10_s18;180/180 пройдено через публичные actions, +12h только при стенах' };
  const hints = [...fs.readFileSync(path.join(__dirname, '../src/game/hints.ts'), 'utf8').split('export type HintId =')[1].split(';')[0].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const make = (save) => {
    // Только setup чтения: исключает автоматическое вступление над проверяемым экраном. Не выдаёт ресурсы/героев.
    for (const c of ctx.content.chapters) save = core.markPageSeen(save, core.episodePageId(c.id));
    return core.serialize(save);
  };
  const saves = { fresh: make(core.newGame(ctx, Date.now())), legal: make(JSON.parse(saved)) };
  const expectations = Object.fromEntries(Object.entries(saves).map(([name, raw]) => {
    const s = JSON.parse(raw);
    const world = core.worldEntries(s, ctx.content, lore);
    const findings = core.findingEntries(s, ctx.content);
    const monsters = core.bestiary(s, ctx.content, ctx);
    const items = core.itemEntries(s, ctx);
    const heroes = core.heroEntries(s, ctx.content);
    const cards = (rows, prefix, id, open) => ({ all: rows.map((r) => `${prefix}${id(r)}`), open: rows.filter(open).map((r) => `${prefix}${id(r)}`) });
    return [name, {
      cards: {
        world: { ...cards(world, 'chronicleWorld_', (r) => r.id, (r) => r.open), shown: world.filter((r, i) => r.open || world.findIndex((x) => !x.open) === i).map((r) => `chronicleWorld_${r.id}`) },
        findings: cards(findings, 'chronicleFinding_', (r) => r.finding.id, (r) => r.found),
        bestiary: cards(monsters, 'chronicleMonster_', (r) => r.unitId, (r) => r.open),
        items: cards(items, 'chronicleItem_', (r) => r.item.id, (r) => r.open),
        heroes: cards(heroes, 'chronicleHero_', (r) => r.templateId, () => true),
      },
      histories: Object.fromEntries(ctx.content.chapters.map((c) => [c.id, ctx.story.scenes.filter((sc) => sc.chapter === c.id && s.seenScenes.includes(sc.id)).map((sc) => sc.id)])),
      stories: heroes.filter((h) => h.owned && lore.heroStories[h.templateId]?.length).map((h) => h.templateId),
      pages: world.filter((w) => w.open && w.kind === 'chapter').map((w) => w.id),
    }];
  }));
  report.expectations = expectations;
  // Публичный контракт чтения: непрочитанные открытые кусочки + ровно одна ревизия SaveSlot на commit.
  // Проверяем и heroStoryRead, и revision, вместо исключения этих полей из сравнения сохранения.
  const expectedHeroReads = (before, templateIds) => {
    const slot = new SaveSlot(new LocalStorageAdapter('chronoworld.qa.expected-read', null));
    slot.revision = before.revision ?? 0;
    let save = structuredClone(before);
    let commits = 0;
    for (const id of templateIds) {
      if (!core.heroStoryUnread(save, id, lore)) continue;
      const written = slot.write(core.markHeroStoryRead(save, id, lore));
      assert(written.ok, 'Не удалось вычислить ожидаемый публичный read commit');
      save = written.save;
      commits++;
    }
    return { save: JSON.parse(core.serialize(save)), commits };
  };
  if (tailOnly) {
    // В исходном полном WebGL прогоне все12 историй уже открыты перед tail.
    // Воспроизводим только публичные read commits; выигрыши/ресурсы/герои не добавляются.
    const state = expectedHeroReads(JSON.parse(saves.legal), expectations.legal.stories);
    saves.legal = core.serialize(state.save);
    report.tailSetup = { publicHeroReadCommits: state.commits, source: 'Same legal checkpoint; public reading preferences only' };
  }
  return { hints, saves, expectations, expectedHeroReads };
}

async function run(browser, mode, fixtureName, fixture) {
  const width = mode === 'canvas' ? 360 : 390;
  const result = { mode, width, fixture: fixtureName, passed: false, errors: [], steps: [], catalogues: [], inspectedCards: [], inspectedStories: [], inspectedHistories: [], inspectedPages: [], cloudWrites: 0 };
  const expected = fixture.expectations[fixtureName];
  report.runs.push(result);
  const context = await browser.newContext({ viewport: { width, height: 640 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  await context.route('**/*', async (route) => {
    const request = route.request(); const target = new URL(request.url());
    if (target.pathname.endsWith('/telegram-web-app.js')) return route.fulfill({ body: '', contentType: 'application/javascript' });
    if (target.origin !== url.origin || !['GET', 'HEAD'].includes(request.method())) {
      if (!['GET', 'HEAD'].includes(request.method())) result.cloudWrites++;
      return route.abort('blockedbyclient');
    }
    if (/\/assets\/index-[^/]+\.js$/.test(target.pathname)) {
      // Наблюдение только в этом локальном browser response; dist и product exports не меняются.
      const response = await route.fetch();
      const code = await response.text();
      const game = /([\w$]+)=new\s*[\w$.]+\.Game\(\{type:/.exec(code);
      const view = /function [\w$]+\(\)\{return ([\w$]+)\.adaptive\?Math.max\(/.exec(code);
      assert(game && view, 'Не найдены приватные compiled QA hooks');
      result.bundleHash = sha(code);
      await route.fulfill({ response, body: `${code};window.__game=${game[1]};window.__view=()=>${view[1]};window.__qaCompiled=true;` });
      return;
    }
    return route.continue();
  });
  await context.addInitScript(({ mode, save, hints }) => {
    localStorage.setItem('chronoworld.save.v1', save);
    localStorage.setItem('chronoworld.hints', JSON.stringify(hints));
    localStorage.setItem('chronoworld.hintsShown', JSON.stringify(hints));
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) { return mode === 'canvas' && /webgl|experimental/i.test(kind) ? null : get.call(this, kind, ...args); };
    window.__tgEvents = {}; window.__bbCallbacks = []; window.__bbVisible = false;
    window.Telegram = { WebApp: { platform: 'ios', version: '9.0', initData: '', isFullscreen: true,
      safeAreaInset: { top: 47, bottom: 34, left: 0, right: 0 }, contentSafeAreaInset: { top: 89, bottom: 0, left: 0, right: 0 },
      ready() {}, expand() {}, onEvent(k, fn) { (window.__tgEvents[k] ??= []).push(fn); },
      offEvent(k, fn) { window.__tgEvents[k] = (window.__tgEvents[k] ?? []).filter((f) => f !== fn); },
      BackButton: { show() { window.__bbVisible = true; }, hide() { window.__bbVisible = false; },
        onClick(fn) { window.__bbCallbacks.push(fn); }, offClick(fn) { window.__bbCallbacks = window.__bbCallbacks.filter((f) => f !== fn); } },
    } };
  }, { mode, save: fixture.saves[fixtureName], hints: fixture.hints });
  const page = await context.newPage();
  page.on('pageerror', (e) => result.errors.push(e.stack || e.message));
  page.on('console', (m) => { if (m.type() === 'error') result.errors.push(m.text()); });
  const evalOnScene = (fn, arg) => page.evaluate(fn, arg);
  try {
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__game?.scene && !window.__game.scene.isActive('Boot') && window.__game.scene.getScenes(true).length, null, { timeout: 120000 });
    result.compiled = await page.evaluate(() => !!window.__qaCompiled);
    if (requireCompiled) assert.equal(result.compiled, true, 'Ожидалась настоящая compiled сборка');
    await page.evaluate(() => {
      window.__qaWalk = (list) => list.flatMap((o) => [o, ...(o.list ? window.__qaWalk(o.list) : [])]);
      window.__qaFrames = 0; window.__game.events.on('postrender', () => window.__qaFrames++);
    });
    const node = async (name) => evalOnScene((name) => {
      const scene = window.__game.scene.getScenes(true).at(-1), v = window.__view(), s = v.cssW / v.worldW;
      const o = window.__qaWalk(scene.children.list).find((o) => o.name === name && o.scene);
      if (!o) throw Error(`Не найден ${name} в ${scene.scene.key}`);
      const m = o.getWorldTransformMatrix(); let clip = null;
      for (let p = o; p; p = p.parentContainer) if (p.getData?.('clip')) clip = p.getData('clip');
      return { x: v.cssLeft + (m.tx - v.worldX) * s, y: v.cssTop + (m.ty - v.worldY) * s, worldY: m.ty, clip,
        cssMid: clip ? v.cssTop + ((clip[0] + clip[1]) / 2 - v.worldY) * s : null };
    }, name);
    const tap = async (name) => {
      // Штатный400ms shield после DESTROY защищает от провалившегося тапа; не обходим его.
      await page.waitForFunction(() => window.__game.input.enabled, null, { timeout: 10000 });
      let p = await node(name);
      if (p.clip && (p.worldY < p.clip[0] + 80 || p.worldY > p.clip[1] - 80)) {
        await page.mouse.move(p.x, p.cssMid); await page.mouse.wheel(0, p.worldY - (p.clip[0] + p.clip[1]) / 2); await page.waitForTimeout(150); p = await node(name);
      }
      assert(p.x >= 0 && p.x <= width && p.y >= 136 && p.y <= page.viewportSize().height - 34, `${name}: кнопка скрыта`);
      await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(300);
    };
    const sdkBack = async () => {
      await page.evaluate(() => { if (!window.__bbCallbacks.length) throw Error('SDK Back не зарегистрирован'); [...window.__bbCallbacks].forEach((fn) => fn()); });
      // popOut завершается игровым tween, а400ms shield начинается только на DESTROY.
      // Реально ждём окончания закрытия и щита; input.enabled до DESTROY ещё может бытьtrue.
      await page.waitForFunction(() => {
        const game = window.__game, scene = game.scene.getScenes(true).at(-1);
        return game.input.enabled && scene && !window.__qaWalk(scene.children.list).some((o) => o.getData?.('screenModal'));
      }, null, { timeout: 10000 });
      await page.waitForTimeout(150);
    };
    const wheel = async (dy, scroll = 'chronicleScroll') => {
      await page.waitForFunction(() => window.__game.input.enabled, null, { timeout: 10000 });
      const p = await node(scroll);
      await page.mouse.move(width / 2, p.cssMid); await page.mouse.wheel(0, dy); await page.waitForTimeout(200);
    };
    const expectedCards = (tab) => expected.cards[tab];
    const hasNode = (name) => page.evaluate((name) => {
      const s = window.__game.scene.getScenes(true).at(-1);
      return window.__qaWalk(s.children.list).some((o) => o.name === name && o.scene);
    }, name);
    const topScroll = () => page.evaluate(() => {
      const s = window.__game.scene.getScenes(true).at(-1);
      const o = window.__qaWalk(s.children.list).filter((o) => o.getData?.('clip') && o.name !== 'chronicleScroll').at(-1);
      if (!o) return null; if (!o.name) o.setName('qaModalScroll'); return o.name;
    });
    const snapshot = async (label, saveShot = true) => {
      await page.waitForTimeout(150);
      const step = await page.evaluate(() => {
        const scene = window.__game.scene.getScenes(true).at(-1), v = window.__view(), s = v.cssW / v.worldW;
        const all = window.__qaWalk(scene.children.list), visible = (o) => {
          let a = 1; for (let p = o; p; p = p.parentContainer) { if (!p.visible) return false; a *= p.alpha ?? 1; }
          if (a < 0.05 || !o.getBounds) return false;
          const b = o.getBounds(); let top = v.safeTop, bottom = v.safeBottom;
          for (let p = o; p; p = p.parentContainer) { const clip = p.getData?.('clip'); if (clip) { top = Math.max(top, clip[0]); bottom = Math.min(bottom, clip[1]); } }
          return b.bottom > top && b.top < bottom && b.right > 0 && b.left < 1080;
        };
        return { scene: scene.scene.key, view: v, renderer: window.__game.renderer.type, frames: window.__qaFrames, creates: window.__qaCreates ?? 0, parentLocked: scene.area?.locked, parentContentHeight: scene.area?.height,
          scrolls: all.filter((o) => o.getData?.('clip')).map((o) => ({ name: o.name, y: o.y, clip: o.getData('clip'), offset: o.getData('clip')[0] - o.y })),
          text: all.filter((o) => o.type === 'Text' && visible(o)).map((o) => ({ name: o.name, text: o.text, font: parseFloat(o.style.fontSize) * Math.hypot(o.getWorldTransformMatrix().a, o.getWorldTransformMatrix().b) * s })),
          controls: all.filter((o) => o.input?.enabled && o.input?.hitArea && visible(o)).map((o) => { const m = o.getWorldTransformMatrix(), h = o.input.hitArea; return { name: o.name, width: h.width * Math.hypot(m.a, m.b) * s, height: h.height * Math.hypot(m.c, m.d) * s }; }),
          invalidFrames: all.filter((o) => o.frame && !o.frame.source).map((o) => o.texture?.key),
          modalNames: all.filter((o) => o.getData?.('screenModal')).map((o) => o.name),
          cards: all.filter((o) => /^chronicle(World_|Finding_|Monster_|Item_|Hero_)/.test(o.name)).map((o) => ({ name: o.name, interactive: !!o.input || window.__qaWalk(o.list ?? []).some((c) => c.input?.enabled) })),
        };
      });
      result.steps.push({ label, ...step });
      if (saveShot) await page.screenshot({ path: path.join(out, `${mode}-${fixtureName}-${label}.png`) });
      assert.deepEqual(result.errors, [], `${label}: ошибки браузера`);
      assert.deepEqual(step.invalidFrames, [], `${label}: texture source уничтожен`);
      assert.equal(step.scene, 'Chronicle', `${label}: потеряна Летопись`);
      assert.equal(step.renderer, mode === 'canvas' ? 1 : 2, `${label}: неверный renderer`);
      assert(step.view.adaptive && step.view.compact, `${label}: не используется короткая раскладка`);
      for (const t of step.text) assert(t.font >= 11.99, `${label}: мелкий текст ${t.name || t.text}: ${t.font}`);
      for (const t of step.text) assert(!/undefined|NaN/.test(t.text), `${label}: сломанная подпись ${t.text}`);
      for (const c of step.controls) assert(c.width >= 43.9 && c.height >= 43.9, `${label}: цель ${c.name} меньше44CSSpx ${c.width}x${c.height}`);
      console.log(`${mode}/${fixtureName}: ${label}, controls=${step.controls.length}, fonts=${step.text.length}`);
      return step;
    };
    const dismissBoot = async () => {
      for (let i = 0; i < 12; i++) {
        const label = await page.evaluate(() => {
          const s = window.__game.scene.getScenes(true).at(-1), all = window.__qaWalk(s.children.list);
          if (all.some((o) => o.name === 'pagesSkip')) return 'pagesSkip';
          const layer = all.find((o) => ['dialogue', 'unlockBanner'].includes(o.name));
          const c = layer && window.__qaWalk(layer.list).find((o) => o.list?.some((t) => t.type === 'Text' && ['Позже', 'Пропустить'].includes(t.text)));
          if (c) { c.setName('qaDismiss'); return c.name; } return null;
        });
        if (!label) return; await tap(label);
      }
      throw Error('Сюжетная очередь не закрылась');
    };
    await dismissBoot(); await tap('nav_Home'); await dismissBoot(); await tap('chronicleBtn');
    await page.evaluate(() => { window.__qaCreates = 0; window.__game.scene.getScene('Chronicle').events.on('create', () => window.__qaCreates++); });
    await snapshot('world');
    const fullSave = () => page.evaluate(() => JSON.parse(localStorage.getItem('chronoworld.save.v1')));
    const beforeRead = await fullSave();
    const expectedRead = fixture.expectedHeroReads(beforeRead, expected.stories);
    result.saveContract = {
      beforeSha256: sha(JSON.stringify(beforeRead)), expectedAfterSha256: sha(JSON.stringify(expectedRead.save)),
      revisionBefore: beforeRead.revision ?? 0, revisionExpectedAfter: expectedRead.save.revision ?? 0,
      expectedHeroReadCommits: expectedRead.commits, fullSaveExact: false,
    };
    if (tailOnly) {
      const chapter = expected.pages.at(-1);
      assert(chapter, 'Нет законно открытой главы для tail');
      await tap(`chronicleWorld_${chapter}`); await snapshot('tail-chapter-detail');
      await sdkBack(); const closed = await snapshot('tail-chapter-destroyed');
      assert.deepEqual(closed.modalNames, []); assert.equal(closed.parentLocked, false);
      await tap('chronicleTab_heroes'); await snapshot('tail-heroes-tab');
      await tap('chronicleHero_alan'); await snapshot('tail-alan-detail');
      await tap('loreModalExtra'); await snapshot('tail-alan-reopen');
      await sdkBack(); const back = await snapshot('tail-alan-closed');
      assert.equal(back.creates, 0); assert.equal(back.parentLocked, false); assert.deepEqual(back.modalNames, []);
      const after = await fullSave();
      result.saveContract.actualAfterSha256 = sha(JSON.stringify(after));
      result.saveContract.revisionActualAfter = after.revision ?? 0;
      assert.equal(expectedRead.commits, 0, 'Повтор прочитанной истории не должен создавать commit');
      assert.deepEqual(after, beforeRead, 'Короткий tail изменил полное сохранение/ревизию');
      result.saveContract.fullSaveExact = true;
      assert.deepEqual(result.errors, []); assert.equal(result.cloudWrites, 0);
      result.passed = true; return;
    }
    const areaOffset = (s) => s.scrolls.find((a) => a.name === 'chronicleScroll').offset;
    const assertCapturedLock = async (label, before) => {
      const locked = await snapshot(`${label}-locked`, false);
      assert.equal(locked.parentLocked, true, `${label}: родительский список не заблокирован`);
      await wheel(120);
      const held = await snapshot(`${label}-held`, false);
      assert(Math.abs(areaOffset(held) - before) < 1, `${label}: прокрутился список под окном`);
    };
    await wheel(190); const remembered = areaOffset(await snapshot('world-middle'));
    await tap('chronicleTab_bestiary'); const beforeDrag = areaOffset(await snapshot('bestiary-before-drag', false));
    const dragArea = await node('chronicleScroll');
    const cdp = await context.newCDPSession(page);
    const beginY = dragArea.cssMid + 70, endY = dragArea.cssMid - 70;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: width / 2, y: beginY }] });
    for (let i = 1; i <= 14; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: width / 2, y: beginY + (endY - beginY) * i / 14 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(200);
    const dragged = await snapshot('bestiary-touch-drag'); assert(areaOffset(dragged) > beforeDrag + 100, 'Палец не прокручивает список');
    assert.equal(dragged.modalNames.length, 0, 'Протяжка ошибочно открыла карточку');
    for (const tab of ['findings', 'bestiary', 'items', 'heroes', 'world']) {
      await tap(`chronicleTab_${tab}`); const first = await snapshot(`${tab}-top`);
      if (tab === 'world') assert(Math.abs(areaOffset(first) - remembered) < 1, 'Вкладка сбросила scroll');
      await wheel(90000); const end = await snapshot(`${tab}-end`);
      assert(end.creates === 0, 'Переключение вкладки вызвало scene restart');
      const catalogue = expectedCards(tab);
      result.catalogues.push({ tab, total: catalogue.all.length, readable: catalogue.open.length });
      const actualNames = end.cards.map((c) => c.name);
      assert.equal(actualNames.length, new Set(actualNames).size, `${tab}: повторённые карточки`);
      for (const name of catalogue.open) assert(actualNames.includes(name), `${tab}: открытая карточка отсутствует ${name}`);
      assert.deepEqual(actualNames.slice().sort(), (catalogue.shown ?? catalogue.all).slice().sort(), `${tab}: неполный каталог`);
      if (tab !== 'heroes') for (const card of end.cards) if (!catalogue.open.includes(card.name)) assert.equal(card.interactive, false, `${card.name}: запертая запись кликабельна`);
      {
        for (const name of catalogue.open) {
          const card = { name };
          // Каждая открытая карточка реально получает касание, детали и SDK Back; закрытые сверяются в snapshot.
          await tap(card.name); const detail = await snapshot(`detail-${card.name}`, false);
          assert(detail.modalNames.length > 0, `${card.name}: касание не открыло детали`);
          const cardOffset = areaOffset(detail);
          await assertCapturedLock(card.name, cardOffset);
          if (tab === 'world' && /^chronicleWorld_chapter\d+$/.test(card.name)) {
            const chapterId = card.name.slice('chronicleWorld_'.length);
            const reopen = async () => { if (!await hasNode(`chronicleEpisode_${chapterId}`)) await tap(card.name); };
            for (const prefix of ['chronicleEpisode_', 'chronicleChapter_']) {
              await reopen();
              const btn = `${prefix}${chapterId}`;
              if (!await hasNode(btn)) continue;
              await tap(btn); const pages = await snapshot(`pages-${btn}`, false);
              assert(pages.modalNames.includes('dialogue'), `${btn}: страница не открылась`);
              await assertCapturedLock(btn, cardOffset);
              const scroll = await topScroll(); if (scroll) await wheel(90000, scroll);
              await snapshot(`pages-end-${btn}`, false);
              await sdkBack(); result.inspectedPages.push(btn);
            }
            const sceneIds = expected.histories[chapterId];
            for (const sceneId of sceneIds) {
              await reopen(); await tap(`chronicleScenes_${chapterId}`);
              await snapshot(`history-${sceneId}`, false);
              const scroll = await topScroll(); assert(scroll, `${chapterId}: история не прокручивается`);
              await wheel(90000, scroll); await snapshot(`history-end-${sceneId}`, false);
              const row = await page.evaluate(({ sceneIds, sceneId }) => {
                const s = window.__game.scene.getScenes(true).at(-1), layer = window.__qaWalk(s.children.list).find((o) => o.name === 'history');
                if (!layer) throw Error('Нет слоя history');
                const buttons = window.__qaWalk(layer.list).filter((o) => o.type === 'Container' && o.list?.some((t) => t.type === 'Text' && t.text.startsWith('▶  ')));
                if (buttons.length !== sceneIds.length) throw Error(`Неполная история: ${buttons.length}/${sceneIds.length}`);
                for (let i = 0; i < buttons.length; i++) buttons[i].setName(`qaHistory_${sceneIds[i]}`);
                return `qaHistory_${sceneId}`;
              }, { sceneIds, sceneId });
              await tap(row); const replay = await snapshot(`history-replay-${sceneId}`, false);
              assert(replay.modalNames.includes('dialogue'), `${sceneId}: readonly replay не открылся`);
              await assertCapturedLock(`replay-${sceneId}`, cardOffset);
              await sdkBack(); result.inspectedHistories.push(sceneId);
              const back = await snapshot(`history-back-${sceneId}`, false);
              assert.equal(back.modalNames.length, 0, `${sceneId}: Back оставил окно`);
              assert.equal(back.parentLocked, false, `${sceneId}: Back не освободил captured lock`);
            }
            if ((await snapshot(`world-pages-complete-${chapterId}`, false)).modalNames.length) await sdkBack();
          } else if (tab === 'heroes' && await hasNode('loreModalExtra')) {
            await tap('loreModalExtra'); const story = await snapshot(`story-${card.name}`, false);
            assert(story.modalNames.includes('heroStory'), `${card.name}: история героя не открылась`);
            const scroll = await topScroll(); assert(scroll, `${card.name}: нет scroll истории`);
            await wheel(90000, scroll); await snapshot(`story-end-${card.name}`, false);
            await assertCapturedLock(`story-${card.name}`, cardOffset);
            await sdkBack(); result.inspectedStories.push(card.name.slice('chronicleHero_'.length));
          } else await sdkBack();
          const closed = await snapshot(`back-${card.name}`, false);
          assert.equal(closed.modalNames.length, 0, 'SDK Back не закрыл детали');
          assert.equal(closed.parentLocked, false, 'Закрытие деталей оставило список заблокированным');
          assert(Math.abs(areaOffset(closed) - cardOffset) < 1, `${card.name}: окно изменило позицию родительского списка`);
          assert.equal(closed.creates, 0, 'Закрытие деталей вызвало scene restart');
          result.inspectedCards.push(card.name);
        }
      }
      await wheel(90000);
      const anchor = await snapshot(`${tab}-resize-before`, false);
      await page.setViewportSize({ width, height: 760 });
      await page.evaluate(() => (window.__tgEvents.viewportChanged ?? []).forEach((fn) => fn({ isStateStable: true })));
      const taller = await snapshot(`${tab}-tall`);
      assert(taller.scrolls.find((a) => a.name === 'chronicleScroll').clip[1] > anchor.scrolls.find((a) => a.name === 'chronicleScroll').clip[1], 'Resize не изменил реальную маску');
      const tallerArea = taller.scrolls.find((a) => a.name === 'chronicleScroll');
      const tallerMax = Math.max(0, taller.parentContentHeight - (tallerArea.clip[1] - tallerArea.clip[0]));
      assert(Math.abs(areaOffset(taller) - Math.min(areaOffset(anchor), tallerMax)) < 1, 'Resize сбросил допустимый offset');
      await page.setViewportSize({ width, height: 640 });
      await page.evaluate(() => (window.__tgEvents.viewportChanged ?? []).forEach((fn) => fn({ isStateStable: true })));
      const shorter = await snapshot(`${tab}-short`);
      assert(Math.abs(areaOffset(shorter) - areaOffset(taller)) < 1, 'Обратный resize сбросил offset');
    }
    // Последняя открытая глава: все доступные страницы и полная история, включая последнюю сцену.
    await tap('chronicleTab_world');
    const chapter = await page.evaluate(() => {
      const s = window.__game.scene.getScenes(true).at(-1);
      return window.__qaWalk(s.children.list).filter((o) => /^chronicleWorld_chapter\d+$/.test(o.name) && window.__qaWalk(o.list ?? []).some((c) => c.input?.enabled)).at(-1)?.name;
    });
    if (chapter) { await tap(chapter); await snapshot('chapter-detail'); await sdkBack(); }
    await tap('chronicleTab_heroes');
    await tap('chronicleHero_alan'); const hero = await snapshot('alan-detail');
    if (fixtureName === 'legal') {
      await tap('loreModalExtra'); await snapshot('alan-story');
      const scrollName = await topScroll();
      assert(scrollName, 'История героя не имеет настоящей прокрутки');
      await wheel(90000, scrollName); await snapshot('alan-story-end');
      await page.setViewportSize({ width, height: 760 }); await snapshot('alan-story-tall');
      await page.setViewportSize({ width, height: 640 }); await snapshot('alan-story-short');
      await page.evaluate(() => {
        window.Telegram.WebApp.safeAreaInset.top = 0; window.Telegram.WebApp.contentSafeAreaInset.top = 0;
        for (const k of ['safeAreaChanged', 'contentSafeAreaChanged', 'viewportChanged']) (window.__tgEvents[k] ?? []).forEach((fn) => fn({ isStateStable: true }));
      });
      await snapshot('alan-story-sdk-no-top');
      await page.evaluate(() => {
        window.Telegram.WebApp.safeAreaInset.top = 47; window.Telegram.WebApp.contentSafeAreaInset.top = 89;
        for (const k of ['safeAreaChanged', 'contentSafeAreaChanged', 'viewportChanged']) (window.__tgEvents[k] ?? []).forEach((fn) => fn({ isStateStable: true }));
      });
      await snapshot('alan-story-sdk-top-return');
      await sdkBack(); const back = await snapshot('alan-story-back'); assert.equal(back.creates, 0, 'Закрытие истории пересоздало сцену');
    } else { assert(hero.text.some((t) => t.text.includes('Алан'))); await sdkBack(); }
    await tap('chronicleTab_world'); await wheel(-90000); await wheel(35);
    const beforeEvening = areaOffset(await snapshot('before-evening'));
    await tap('chronicleTavern');
    assert.equal(await page.evaluate(() => window.__game.scene.getScenes(true).at(-1).scene.key), 'TavernEvening');
    await sdkBack(); const returnEvening = await snapshot('evening-return');
    assert(Math.abs(areaOffset(returnEvening) - beforeEvening) < 1, 'Возврат из вечеров сбросил scroll');
    await sdkBack(); assert.equal(await page.evaluate(() => window.__game.scene.getScenes(true).at(-1).scene.key), 'Home');
    await tap('chronicleBtn'); const reopened = await snapshot('home-book-reentry');
    assert(Math.abs(areaOffset(reopened) - beforeEvening) < 1, 'Повторный вход через Город потерял позицию вкладки');
    await sdkBack();
    const afterRead = await fullSave();
    result.saveContract.actualAfterSha256 = sha(JSON.stringify(afterRead));
    result.saveContract.revisionActualAfter = afterRead.revision ?? 0;
    assert.deepEqual(afterRead, expectedRead.save, 'Просмотр архива не совпал с публичным контрактом чтения полного сохранения');
    result.saveContract.fullSaveExact = true;
    assert.deepEqual(result.inspectedStories.slice().sort(), expected.stories.slice().sort(), 'Не проверены все доступные истории героев');
    assert.deepEqual(result.inspectedHistories.slice().sort(), Object.values(expected.histories).flat().sort(), 'Не проверены все действительно прочитанные сюжетные сцены');
    assert.equal(result.cloudWrites, 0); result.passed = true;
  } finally { await context.close(); }
}

(async () => {
  const fixture = await fixtures();
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try { for (const mode of modes) for (const name of fixtureNames) await run(browser, mode, name, fixture); report.passed = true; }
  finally { await browser.close(); report.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); }
})().catch((e) => { report.error = e.stack; fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.error(e); process.exitCode = 1; });
