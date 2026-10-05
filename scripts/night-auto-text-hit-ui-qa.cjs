#!/usr/bin/env node
/* Native Campaign→Battle→Result Text regression, lawful core setup, normal clocks, local compiled only. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { tsImport } = require('tsx/esm/api');
const qa = require('./night-compact-ui-qa.cjs');
const metaGapMode = process.env.META_GAP === '1';

async function fixture() {
  const base = await qa.fixtures();
  const from = pathToFileURL(__filename).href;
  const [{ loadFullContext }, core, { S }] = await Promise.all([tsImport('./lib/content-node.ts', from), tsImport('../src/core/index.ts', from), tsImport('../src/game/theme.ts', from)]);
  const game = loadFullContext();
  const now = Date.now(), born = now - 12 * 3600000;
  const day = (time) => new Date(time).toISOString().slice(0, 10);
  let save = core.newGame(game, born, day(born));
  const first = core.actPlayStage(save, day(born), game.content.stages[0].id, 7, game, born);
  assert.equal(first.result.winner, 'A', 'Public first-stage fixture no longer wins; do not forge progression');
  const idle = core.actClaimOffline(first.save, now, day(now), game);
  save = idle.save;
  assert(idle.rewards.jobExp > 0 && idle.rewards.gold > 0, 'Public12h idle claim did not supply level-up resources');
  assert(save.squad.some((id) => id && core.levelUpInfo(save, id, game).canLevel), 'Public outcome does not make any squad level-up available');
  // Suppress already-readable narrative/unlock notices solely for this focused UI context.
  save = core.markScenesSeen(save, game.story.scenes.map((scene) => scene.id));
  save.storyQueue = []; save = core.clearChapterDone(save);
  for (const chapter of game.content.chapters) save = core.markPageSeen(save, core.episodePageId(chapter.id));
  save = core.markUnlocksSeen(save, core.pendingUnlocks(save, game).map((unlock) => unlock.id));
  const serialized = core.serialize(save);
  qa.report.fixtureCore = { creation: 'newGame(now−12h)', firstBattle: { stageId: game.content.stages[0].id, seed: 7, winner: first.result.winner },
    idle: idle.rewards, preparedSaveHash: crypto.createHash('sha256').update(serialized).digest('hex'),
    fabricatedResources: false, fabricatedVictories: false, normalBrowserClock: true };
  return { ...base, choiceSave: serialized, metadataGapWorld: S.xs };
}

async function nativeTap(page, controls, name, key) {
  // A scene can be active before the first camera pre-render; wait for the actual projection too.
  await page.waitForFunction(({ name, key }) => {
    const scene = window.__game.scene.getScene(key);
    if (!window.__game.scene.isActive(key)) return false;
    const object = window.__qaWalk(scene.children.list).find((o) => o.name === name && o.scene);
    if (!object?.input?.enabled || !object.visible || object.alpha < .99) return false;
    for (let parent = object.parentContainer; parent; parent = parent.parentContainer) if (!parent.visible || parent.alpha < .99) return false;
    const matrix = object.getWorldTransformMatrix(), v = window.__view();
    const point = scene.cameras.main.getWorldPoint((matrix.tx - v.worldX) * v.zoom, (matrix.ty - v.worldY) * v.zoom);
    return Math.abs(point.x - matrix.tx) < 1 && Math.abs(point.y - matrix.ty) < 1;
  }, { name, key }, { timeout: 20000 });
  await controls.tap(name);
}

async function reveal(page) {
  for (let i = 0; i < 14; i++) {
    const position = await page.evaluate(() => {
      const scene = window.__game.scene.getScene('Result');
      const label = window.__qaWalk(scene.children.list).find((o) => o.name === 'resultLevelUp');
      if (!label) throw Error('Actual Result has no public level-up Text target');
      let clip;
      for (let p = label.parentContainer; p; p = p.parentContainer) if (p.getData('clip')) { clip = p.getData('clip'); break; }
      if (!clip) throw Error('Result Text is not in the actual body ScrollArea');
      const matrix = label.getWorldTransformMatrix(), rect = label.input.hitArea, v = window.__view(), scale = v.cssW / v.worldW;
      const height = rect.height * Math.hypot(matrix.c, matrix.d);
      const delta = matrix.ty - height / 2 < clip[0] ? matrix.ty - height / 2 - clip[0] :
        matrix.ty + height / 2 > clip[1] ? matrix.ty + height / 2 - clip[1] : 0;
      return { delta, x: v.cssLeft + (540 - v.worldX) * scale, y: v.cssTop + ((clip[0] + clip[1]) / 2 - v.worldY) * scale };
    });
    if (Math.abs(position.delta) < .5) return;
    await page.mouse.move(position.x, position.y); await page.mouse.wheel(0, position.delta); await page.waitForTimeout(180);
  }
  throw Error('Native wheel could not fully reveal the Result Text hit area');
}

async function run(browser, mode, fixture) {
  const { context, page, run } = await qa.openContext(browser, mode, fixture, true);
  run.fixture = 'public newGame + first-stage win +12h idle; native Result auto Text';
  try {
    await context.addInitScript(() => {
      localStorage.setItem('chronoworld.reduceMotion', '1');
      window.Telegram.WebApp.safeAreaInset = { top: 47, bottom: 34, left: 0, right: 0 };
      window.Telegram.WebApp.contentSafeAreaInset = { top: 89, bottom: 0, left: 0, right: 0 };
      const set = Storage.prototype.setItem; window.__autoTextWrites = 0;
      Storage.prototype.setItem = function (key, value) { if (key === 'chronoworld.save.v1') window.__autoTextWrites++; return set.call(this, key, value); };
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__qaCompiled && window.__game.scene.isActive('Campaign') && !window.__game.scene.isActive('Boot'), null, { timeout:60000 });
    await page.evaluate(() => {
      window.__qaFrames = 0; window.__game.events.on('postrender', () => window.__qaFrames++);
      window.__qaWalk = (list) => list.flatMap((o) => [o, ...(o.list ? window.__qaWalk(o.list) : [])]);
    });
    const controls = qa.controls(page, run, fixture);
    await controls.dismiss();
    await nativeTap(page, controls, 'fightCta', 'Campaign');
    await page.waitForFunction(() => window.__game.scene.isActive('Stage'));
    await nativeTap(page, controls, 'cta', 'Stage');
    await page.waitForFunction(() => window.__game.scene.isActive('Battle'), null, { timeout:30000 });
    await nativeTap(page, controls, 'skipBtn', 'Battle');
    await page.waitForFunction(() => window.__game.scene.isActive('Result') && window.__game.scene.getScene('Result').ready, null, { timeout:30000 });
    await controls.dismiss(); await reveal(page);
    await page.evaluate((checkMetadata) => {
      const scene = window.__game.scene.getScene('Result'), label = window.__qaWalk(scene.children.list).find((o) => o.name === 'resultLevelUp');
      window.__autoIdentity = { scene, label, input: label.input, rect: label.input.hitArea, callback: label.input.hitAreaCallback,
        enabled: label.input.enabled, save: localStorage.getItem('chronoworld.save.v1'), writes: window.__autoTextWrites, creates: 0,
        metadata: checkMetadata ? window.__qaWalk(scene.children.list).find((o) => o.name === 'resultMeta') : undefined };
      scene.events.on('create', () => window.__autoIdentity.creates++);
    }, metaGapMode);
    run.widthProbe = [];
    for (const width of metaGapMode ? [320, 360] : [360, 320, 360]) {
      await page.setViewportSize({ width, height:640 });
      await page.waitForFunction((width) => window.innerWidth === width && Math.abs(window.__view().cssW - width) < .01, width);
      await page.waitForTimeout(400); await reveal(page);
      const metric = await page.evaluate((checkMetadata) => {
        const scene = window.__game.scene.getScene('Result'), all = window.__qaWalk(scene.children.list), label = all.find((o) => o.name === 'resultLevelUp');
        const identity = window.__autoIdentity, v = window.__view(), matrix = label.getWorldTransformMatrix(), rect = label.input.hitArea, scale = v.cssW / v.worldW;
        let metadata;
        if (checkMetadata) {
          const row = all.find((o) => o.name === 'resultMeta'), caption = all.find((o) => o.name === 'resultStageMeta'), chip = all.find((o) => o.name === 'resultFirstWin');
          const glyph = chip?.list.find((o) => o.type === 'Text');
          if (!row || !caption || !chip || !glyph) throw Error('Final compiled Result has no actual first-win metadata row');
          metadata = { sameContainer: row === identity.metadata, gapWorld: caption.getBounds().left - glyph.getBounds().right,
            gapCSS: (caption.getBounds().left - glyph.getBounds().right) * scale, plateWidth: chip.width, glyphWidth: glyph.width,
            stage: caption.text, tag: glyph.text };
        }
        return { width: window.innerWidth, view: v, renderer: window.__game.renderer.type, text: label.text, metadata,
          fontCSS: parseFloat(label.style.fontSize) * Math.hypot(matrix.c, matrix.d) * scale,
          hitCSS: { width: rect.width * Math.hypot(matrix.a, matrix.b) * scale, height: rect.height * Math.hypot(matrix.c, matrix.d) * scale },
          centerDelta: { x: rect.x + rect.width / 2 - label.displayOriginX, y: rect.y + rect.height / 2 - label.displayOriginY },
          auto: label.input.customHitArea === false, sceneSame: scene === identity.scene, labelSame: label === identity.label,
          inputSame: label.input === identity.input, rectSame: rect === identity.rect, callbackSame: label.input.hitAreaCallback === identity.callback,
          enabledSame: label.input.enabled === identity.enabled, creates: identity.creates, saveSame: localStorage.getItem('chronoworld.save.v1') === identity.save,
          writesSame: window.__autoTextWrites === identity.writes, frames: window.__qaFrames,
          clip: all.find((o) => o.name === 'resultScroll').getData('clip'),
          invalidFrames: all.filter((o) => o.frame && !o.frame.source).map((o) => o.texture?.key) };
      }, metaGapMode);
      run.widthProbe.push(metric);
      assert.equal(metric.renderer, mode === 'canvas' ? 1 : 2); assert(metric.view.adaptive, 'Production Result policy is not adaptive');
      assert(metric.auto && metric.sceneSame && metric.labelSame && metric.inputSame && metric.rectSame && metric.callbackSame && metric.enabledSame);
      assert(metric.saveSame && metric.writesSame && metric.creates === 0, 'Resize changed progression, scene lifecycle or save');
      assert(metric.fontCSS >= 11.99 && metric.hitCSS.width >= 43.99 && metric.hitCSS.height >= 43.99);
      assert(Math.abs(metric.centerDelta.x) < .01 && Math.abs(metric.centerDelta.y) < .01, 'Auto Text retained stale padding origin after glyph redraw');
      assert.equal(metric.invalidFrames.length, 0); assert.equal(run.errors.length, 0);
      if (metaGapMode) {
        assert(metric.metadata.sameContainer, 'Metadata reflow recreated its parent container');
        assert(metric.metadata.gapWorld >= fixture.metadataGapWorld - .5, 'First-win glyphs overlap the stage caption');
        assert(metric.metadata.plateWidth >= metric.metadata.glyphWidth + 2 * fixture.metadataGapWorld - .5, 'First-win glyphs exceed their plate');
      }
      await page.screenshot({ path: path.join(qa.out, `${mode}-result-${width}.png`) });
    }
    if (metaGapMode) assert(run.widthProbe[1].frames > run.widthProbe[0].frames);
    else assert(run.widthProbe[1].frames > run.widthProbe[0].frames && run.widthProbe[2].frames > run.widthProbe[1].frames);
    // The real InputPlugin callback and ScrollArea guard must accept the drawn Text, then the native tap routes to Heroes.
    await nativeTap(page, controls, 'resultLevelUp', 'Result');
    await page.waitForFunction(() => window.__game.scene.isActive('Heroes'), null, { timeout:10000 });
    const final = await page.evaluate(() => ({ saveSame: localStorage.getItem('chronoworld.save.v1') === window.__autoIdentity.save,
      writesSame: window.__autoTextWrites === window.__autoIdentity.writes, active: window.__game.scene.getScenes(true).at(-1).scene.key }));
    assert(final.saveSame && final.writesSame); assert.equal(final.active, 'Heroes'); run.final = final;
    await page.screenshot({ path: path.join(qa.out, `${mode}-native-text-heroes.png`) });
    run.passed = true; assert.equal(run.errors.length, 0);
    console.log(JSON.stringify({ mode, passed:true, widths:run.widthProbe.map(({ width, fontCSS, hitCSS, centerDelta, creates }) => ({ width, fontCSS, hitCSS, centerDelta, creates })), final }, null, 2));
  } finally { await context.close(); }
}

(async () => {
  const prepared = await fixture();
  const modes = (process.env.MODES || 'canvas,webgl1').split(','); assert(modes.every((mode) => ['canvas', 'webgl', 'webgl1'].includes(mode)));
  const browser = await qa.chromium.launch({ executablePath:process.env.CHROME_EXECUTABLE_PATH || '/usr/bin/chromium', headless:true,
    args:['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
  try {
    for (const mode of modes) await run(browser, mode, prepared);
    qa.report.passed = qa.report.runs.every((run) => run.passed);
  } catch (error) { qa.report.error = error.stack; console.error(error.stack); process.exitCode = 1; }
  finally { await browser.close(); qa.report.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(qa.out, 'report.json'), JSON.stringify(qa.report, null, 2)); }
})();
