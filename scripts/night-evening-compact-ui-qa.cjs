#!/usr/bin/env node
/* Частный локальный browser context: законные core-состояния, реальные касания, никаких cloud writes. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { tsImport } = require('tsx/esm/api');
const qa = require('./night-compact-ui-qa.cjs');

async function fixtures() {
  const fixture = await qa.fixtures();
  const from = pathToFileURL(__filename).href;
  const [{ loadFullContext }, core] = await Promise.all([tsImport('./lib/content-node.ts', from), tsImport('../src/core/index.ts', from)]);
  const game = loadFullContext();
  const quiet = (save) => {
    save = core.markScenesSeen(save, game.story.scenes.map((s) => s.id));
    save.storyQueue = [];
    save = core.clearChapterDone(save);
    for (const chapter of game.content.chapters) save = core.markPageSeen(save, core.episodePageId(chapter.id));
    return core.markUnlocksSeen(save, core.pendingUnlocks(save, game).map((f) => f.id));
  };
  const first = quiet(JSON.parse(fixture.choiceSave));
  let late = quiet({ ...first, campaign: { ...first.campaign, cleared: game.content.stages.map((s) => s.id) } });
  for (const evening of game.story.tavern.evenings) late = core.finishEvening(late, evening.id, game).save;
  assert(core.bondView(late, 'alan', game).quest.open);
  const credit = {};
  if ((process.env.PROFILES || '').split(',').some((p) => ['captured', 'legacy', 'empty'].includes(p))) {
    const checkpoint = process.env.EVENING_PREWIN_FIXTURE || path.join(__dirname, '../tests/fixtures/tavern-chapter1-before-win.json');
    const before = core.deserialize(fs.readFileSync(checkpoint, 'utf8'));
    const win = core.actPlayStage(before, '2026-10-05', 'ch1_s10', 20, game, 1791160663806);
    assert.equal(win.result.winner, 'A', 'Законный checkpoint перестал побеждать в последнем этапе главы');
    assert.deepEqual(win.save.tavern.chapterSquads.chapter1, ['alan', 'dorn', 'bran', 'kai', 'vika']);
    const lira = win.save.heroes.find((h) => h.templateId === 'lira');
    assert(lira, 'Нет запасной Лиры в законном checkpoint');
    const switched = quiet(core.setSquad(win.save, [lira.id, null, null, null, null]));
    credit.captured = core.serialize(switched);
    credit.legacy = core.serialize({ ...switched, tavern: { ...switched.tavern, chapterSquads: undefined } });
    credit.empty = core.serialize({ ...switched, tavern: { ...switched.tavern, chapterSquads: { chapter1: [] } } });
    qa.report.creditFixture = { checkpointHash: crypto.createHash('sha256').update(fs.readFileSync(checkpoint)).digest('hex'), action: 'actPlayStage(ch1_s10, seed20), затем setSquad(Лира)', explicitEmpty: 'разрешённое optional legacy metadata состояние; не игровая награда' };
  }
  return { ...fixture, core, game, first: core.serialize(first), late: core.serialize(late), ...credit };
}

async function revealControl(page, name) {
  for (let i = 0; i < 14; i++) {
    const target = await page.evaluate((name) => {
      const scene = window.__game.scene.getScenes(true).at(-1);
      const object = window.__qaWalk(scene.children.list).find((o) => o.name === name && o.scene);
      if (!object) throw Error(`Не найдена цель ${name}`);
      let clip;
      for (let p = object.parentContainer; p; p = p.parentContainer) if (p.getData('clip')) { clip = p.getData('clip'); break; }
      if (!clip) return { ready: true };
      const y = object.getWorldTransformMatrix().ty;
      const height = object.input?.hitArea.height ?? object.height;
      if (clip[1] - clip[0] + 0.1 < height) throw Error(`${name}: полная цель не помещается в scroll-маске`);
      const half = height / 2;
      const delta = y - half < clip[0] - 0.5 ? y - half - clip[0] : y + half > clip[1] + 0.5 ? y + half - clip[1] : 0;
      const v = window.__view(), scale = v.cssW / v.worldW;
      return { ready: Math.abs(delta) < 1, delta, x: v.cssLeft + (540 - v.worldX) * scale, y: v.cssTop + ((clip[0] + clip[1]) / 2 - v.worldY) * scale };
    }, name);
    if (target.ready) return;
    await page.mouse.move(target.x, target.y); await page.mouse.wheel(0, target.delta);
    await page.waitForTimeout(180);
  }
  throw Error(`Реальная прокрутка не достигла ${name}`);
}

async function flow(browser, mode, fixture, profile, width, height) {
  const ownFixture = { ...fixture, choiceSave: fixture[profile] };
  const { context, page, run } = await qa.openContext(browser, mode, ownFixture, true);
  run.fixture = `вечера/${profile}/${width}×${height}`;
  const c = qa.controls(page, run, ownFixture);
  const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('chronoworld.save.v1')));
  const has = (name) => page.evaluate((name) => window.__qaWalk(window.__game.scene.getScenes(true).at(-1).children.list).some((o) => o.name === name && o.scene), name);
  const tap = async (name) => {
    await revealControl(page, name);
    await page.waitForFunction((name) => {
      const o = window.__qaWalk(window.__game.scene.getScenes(true).at(-1).children.list).find((o) => o.name === name);
      if (!window.__game.input.enabled || !o?.input?.enabled) return false;
      for (let p = o; p; p = p.parentContainer) if (!p.visible || p.alpha < 0.99 || (p.name === 'popInner' && p.scaleX < 0.999)) return false;
      return true;
    }, name, { timeout: 5000 });
    const target = await page.evaluate((name) => {
      const scene = window.__game.scene.getScenes(true).at(-1);
      const o = window.__qaWalk(scene.children.list).find((o) => o.name === name);
      const m = o.getWorldTransformMatrix(), v = window.__view(), scale = v.cssW / v.worldW;
      const height = o.input.hitArea.height * Math.hypot(m.c, m.d);
      let top = m.ty - height / 2, bottom = m.ty + height / 2;
      for (let p = o.parentContainer; p; p = p.parentContainer) if (p.getData('clip')) {
        const clip = p.getData('clip'); top = Math.max(top, clip[0]); bottom = Math.min(bottom, clip[1]);
      }
      return { scene: scene.scene.key, width: o.input.hitArea.width * Math.hypot(m.a, m.b) * scale, visibleHeight: Math.max(0, bottom - top) * scale };
    }, name);
    if (target.scene === 'TavernEvening') assert(target.width >= 43.9 && target.visibleHeight >= 43.9, `${name}: видимая цель <44CSS`);
    await c.tap(name);
    run.taps = (run.taps ?? 0) + 1;
  };
  const back = async () => {
    assert.equal(await page.evaluate(() => { const handlers = [...window.__tgBackHandlers]; handlers.forEach((fn) => fn()); return handlers.length; }), 1);
    await page.waitForTimeout(100);
    await page.waitForFunction(() => window.__game.input.enabled && !window.__game.scene.getScenes(true).at(-1).children.list.some((o) => o.getData?.('closing')), null, { timeout: 5000 });
    await page.waitForTimeout(350);
  };
  const shot = async (label, scene = 'TavernEvening') => {
    const step = await c.shot(`${profile}-${width}x${height}-${label}`, scene);
    if (scene === 'TavernEvening') {
      for (const control of step.controls.filter((o) => ['eveningSkip', 'eveningDone', 'bondQuestGo', 'bondQuestCancel', 'bondQuestDone'].includes(o.name) || o.name.startsWith('eveningOption_'))) {
        assert(control.width >= 43.9 && control.height >= 43.9, `${label}: ${control.name} <44CSS`);
      }
      for (const text of step.text.filter((o) => ['eveningBodyText', 'eveningSpeaker', 'eveningCounter', 'eveningSummaryTitle'].includes(o.name) || o.name.startsWith('eveningCredit_'))) assert(text.font >= 11.99, `${label}: ${text.name} <12CSS`);
    }
    return step;
  };
  const resize = async (nextHeight, label) => {
    const before = await save();
    const count = await page.evaluate(() => window.__eveningCreateCount);
    await page.evaluate(() => { window.__eveningInstance = window.__game.scene.getScene('TavernEvening'); });
    await page.setViewportSize({ width, height: nextHeight });
    await page.waitForFunction((height) => {
      const app = window.Telegram.WebApp, v = window.__view();
      const top = app.safeAreaInset.top + app.contentSafeAreaInset.top;
      const bottom = app.safeAreaInset.bottom + app.contentSafeAreaInset.bottom;
      const expected = Math.min(1920, (window.innerHeight - top - bottom) * 1080 / window.innerWidth);
      return window.innerHeight === height && Math.abs(v.uiHeight - expected) < 0.01;
    }, nextHeight, { timeout: 5000 });
    await shot(label);
    assert.deepEqual(await save(), before, `${label}: resize изменил прогресс`);
    assert.equal(await page.evaluate(() => window.__eveningCreateCount), count, `${label}: create повторён`);
    assert(await page.evaluate(() => window.__game.scene.getScene('TavernEvening') === window.__eveningInstance));
  };
  const scrollToEnd = async (name) => {
    const point = await page.evaluate((name) => {
      const o = window.__qaWalk(window.__game.scene.getScenes(true).at(-1).children.list).find((o) => o.name === name);
      const clip = o.getData('clip'), v = window.__view(), scale = v.cssW / v.worldW;
      return { x: v.cssLeft + (540 - v.worldX) * scale, y: v.cssTop + ((clip[0] + clip[1]) / 2 - v.worldY) * scale };
    }, name);
    await page.mouse.move(point.x, point.y); await page.mouse.wheel(0, 10000);
    await page.waitForTimeout(250);
  };
  try {
    await c.dismiss();
    await page.setViewportSize({ width, height });
    await page.waitForFunction((width) => Math.abs(window.__view().cssW - width) < 0.01, width);
    await page.waitForTimeout(450);
    await c.tap('nav_Home'); await c.dismiss();
    await page.evaluate(() => {
      window.Telegram.WebApp.safeAreaInset = { top: 47, bottom: 34, left: 0, right: 0 };
      window.Telegram.WebApp.contentSafeAreaInset = { top: 89, bottom: 0, left: 0, right: 0 };
      (window.__tgEvents.contentSafeAreaChanged ?? []).forEach((fn) => fn());
      const manager = window.__game.scene, add = manager.add;
      manager.add = function(key, config, ...args) {
        if (key === 'TavernEvening' && typeof config === 'function') {
          const create = config.prototype.create;
          config.prototype.create = function(data) {
            window.__eveningCreateView = { ...window.__view() };
            window.__eveningCreateCount = (window.__eveningCreateCount ?? 0) + 1;
            return create.call(this, data);
          };
        }
        return add.call(this, key, config, ...args);
      };
    });
    await page.waitForTimeout(450);
    await tap('chronicleBtnHit'); await shot('classic-chronicle', 'Chronicle');
    await tap('chronicleTavern'); const first = await shot('first-lazy-hub');
    assert.equal(await page.evaluate(() => window.__eveningCreateView.uiHeight), first.view.uiHeight, 'Раскладка не подготовлена до первого create');
    assert.equal(await page.evaluate(() => window.__eveningCreateCount), 1);
    await tap('eveningInfo_0'); await shot('hub-rules');
    await resize(height + 120, 'rules-tall'); await resize(height, 'rules-short');
    await back(); assert(!(await has('bottomSheet')));
    await tap('eveningInfo_0'); await back();

    if (['captured', 'legacy', 'empty'].includes(profile)) {
      const before = await save();
      const recipients = fixture.core.eveningSquadHeroes(before, 'tav_ch1', fixture.game);
      assert.deepEqual(recipients, profile === 'captured' ? ['alan', 'bran', 'vika', 'dorn', 'kai'] : profile === 'legacy' ? ['lira'] : []);
      const credit = first.text.find((t) => t.name === 'eveningCredit_tav_ch1');
      assert(credit, 'Нет public credit preview нового вечера');
      const preview = recipients.length ? `За главу +1 близости: ${recipients.map((id) => fixture.game.content.heroes[id].name).join(', ')}` : 'Близость за главу не начисляется';
      assert(credit.text.endsWith(preview), `${profile}: превью не соответствует public credit contract`);
      if (profile === 'captured') assert(!credit.text.includes('Лира'), 'Запасная Лира подменяет участников главы');
      await resize(height + 120, 'credit-tall'); await resize(height, 'credit-short');
      await tap('evening_tav_ch1'); await page.waitForTimeout(1900); await tap('eveningSkip'); await shot('credit-summary');
      const expected = fixture.core.finishEvening(before, 'tav_ch1', fixture.game);
      const finished = await save();
      assert.deepEqual(finished.tavern, expected.save.tavern, 'Начисление разошлось с показанным превью');
      const names = await page.evaluate(() => window.__qaWalk(window.__game.scene.getScene('TavernEvening').children.list).filter((o) => o.type === 'Text').map((o) => o.text));
      for (const id of recipients) assert(names.includes(fixture.game.content.heroes[id].name), `Нет ${id} в результате близости`);
      if (profile === 'captured') assert(!names.includes('Лира'), 'Результат начислил близость запасной Лире');
      if (profile === 'empty') assert(names.includes('Близость не изменилась'), 'Пустой snapshot вызвал legacy начисление');
      await scrollToEnd('eveningSummaryScroll'); await shot('credit-summary-end');
      await resize(height + 120, 'credit-summary-tall'); await resize(height, 'credit-summary-short');
      await tap('eveningDone'); await shot('credit-hub-after-done');
      assert(!(await has('eveningCredit_tav_ch1')), 'Прочитанный вечер обещает повторное начисление');
      await tap('evening_tav_ch1'); await page.waitForTimeout(1900); await tap('eveningSkip'); await shot('credit-replay');
      assert.deepEqual(await save(), finished, 'Пересмотр повторил начисление или commit');
      await back(); await shot('credit-hub-after-replay');
    } else if (profile === 'first') {
      await tap('evening_tav_ch1'); await page.waitForTimeout(1900); await shot('first-line');
      if (await page.evaluate(() => !window.__qaWalk(window.__game.scene.getScene('TavernEvening').children.list).find((o) => o.name === 'eveningCounter').text)) await tap('eveningAdvance');
      await page.waitForFunction(() => !!window.__qaWalk(window.__game.scene.getScene('TavernEvening').children.list).find((o) => o.name === 'eveningCounter').text);
      const line = await page.evaluate(() => window.__qaWalk(window.__game.scene.getScene('TavernEvening').children.list).find((o) => o.name === 'eveningBodyText').text);
      const swipe = await page.evaluate(() => {
        const o = window.__qaWalk(window.__game.scene.getScene('TavernEvening').children.list).find((o) => o.name === 'eveningAdvance');
        const m = o.getWorldTransformMatrix(), v = window.__view(), scale = v.cssW / v.worldW;
        return { x: v.cssLeft + (m.tx - v.worldX) * scale, y: v.cssTop + (m.ty - v.worldY) * scale };
      });
      await page.mouse.move(swipe.x, swipe.y); await page.mouse.down();
      await page.mouse.move(swipe.x, swipe.y - 90, { steps: 12 }); await page.mouse.up();
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => window.__qaWalk(window.__game.scene.getScene('TavernEvening').children.list).find((o) => o.name === 'eveningBodyText').text), line, 'Swipe пролистнул завершённую реплику');
      await resize(height + 120, 'line-tall'); await resize(height, 'line-short');
      assert.equal(await page.evaluate(() => window.__qaWalk(window.__game.scene.getScene('TavernEvening').children.list).find((o) => o.name === 'eveningBodyText').text), line);
      for (let i = 0; i < 30 && !(await has('eveningOption_alan')); i++) await tap('eveningAdvance');
      assert(await has('eveningOption_alan'), 'Реальными касаниями выбор не достигнут');
      const choosing = await save();
      await shot('choice'); await resize(520, 'choice-small-window');
      const firstPoint = await page.evaluate(() => {
        const o = window.__qaWalk(window.__game.scene.getScene('TavernEvening').children.list).find((o) => o.name === 'eveningOption_yes');
        const m = o.getWorldTransformMatrix(), v = window.__view(), scale = v.cssW / v.worldW;
        return { x: v.cssLeft + (m.tx - v.worldX) * scale, y: v.cssTop + (m.ty - v.worldY) * scale };
      });
      await page.mouse.move(firstPoint.x, firstPoint.y); await page.mouse.down();
      await page.mouse.move(firstPoint.x, firstPoint.y - 90, { steps: 12 }); await page.mouse.up();
      assert.deepEqual(await save(), choosing, 'Swipe выбрал ответ');
      await revealControl(page, 'eveningOption_alan'); await shot('last-choice-reached');
      await tap('eveningOption_alan');
      const chosen = await save(), expected = fixture.core.chooseOption(choosing, 'c_tav1', 'alan', fixture.game).save;
      assert.deepEqual(chosen.tavern, expected.tavern); assert.deepEqual(chosen.resources, choosing.resources);
      await resize(height, 'choice-reply'); await tap('eveningSkip');
      await shot('summary');
      const finished = await save();
      assert.deepEqual(finished.tavern, fixture.core.finishEvening(chosen, 'tav_ch1', fixture.game).save.tavern);
      await scrollToEnd('eveningSummaryScroll'); await shot('summary-last-row');
      await resize(height + 120, 'summary-tall'); await resize(height, 'summary-short');
      await tap('eveningDone'); await shot('hub-after-done');
      await tap('evening_tav_ch1'); await page.waitForTimeout(1900); await tap('eveningSkip'); await shot('replay-summary');
      assert.deepEqual(await save(), finished, 'Пересмотр изменил сохранение или повторил близость');
      await back(); await shot('hub-after-replay-back');
    } else {
      await tap('bondScene_alan'); await page.waitForTimeout(1900); await shot('personal-line');
      await tap('eveningAdvance'); await resize(height + 120, 'personal-tall'); await resize(height, 'personal-short');
      await tap('eveningSkip'); await shot('personal-summary'); await tap('eveningDone');
      const personal = await save();
      const id = fixture.core.bondView(personal, 'alan', fixture.game).scene.id;
      assert(personal.tavern.seen.includes(id));
      await tap('bondScene_alan'); await page.waitForTimeout(1900); await tap('eveningSkip'); await tap('eveningDone');
      assert.deepEqual(await save(), personal, 'Личная сцена при пересмотре повторила commit');
      await tap('bondQuest_alan'); await shot('quest'); await scrollToEnd('bondQuestScroll'); await shot('quest-last-line');
      await resize(height + 120, 'quest-tall'); await resize(height, 'quest-short');
      await back(); assert(!(await has('bondQuestModal'))); await shot('hub-after-quest-back');
      await tap('bondQuest_alan'); await tap('bondQuestCancel'); assert(!(await has('bondQuestModal')));
      await tap('bondQuest_alan');
      const canceled = await save();
      await page.evaluate(() => {
        const clock = window.__game.scene.getScene('TavernEvening').time, delayed = clock.delayedCall;
        // SDK Back в следующей microtask после фактического Go, до queued30ms start. Таймер не ускоряется.
        clock.delayedCall = function(delay, ...args) {
          const timer = delayed.call(this, delay, ...args);
          if (delay === 30) {
            this.delayedCall = delayed;
            window.__qaCancellationScheduled = true;
            queueMicrotask(() => [...window.__tgBackHandlers].forEach((fn) => fn()));
          }
          return timer;
        };
      });
      await tap('bondQuestGo'); await page.waitForTimeout(400);
      assert(await page.evaluate(() => window.__qaCancellationScheduled), 'Native Go не создал queued start');
      await shot('hub-after-canceled-go');
      assert.deepEqual(await save(), canceled, 'SDK Back не отменил queued бой/запись награды');
      assert(!(await has('bondQuestModal')) && !(await has('bondQuestResult')));
      await tap('bondQuest_alan');
      const beforeFight = await save(); await tap('bondQuestGo');
      await page.waitForFunction(() => window.__game.scene.isActive('Battle') && window.__game.scene.getScene('Battle').ready, null, { timeout: 30000 });
      await shot('real-bond-battle', 'Battle'); await c.tap('skipBtn');
      await page.waitForFunction(() => window.__game.scene.isActive('TavernEvening') && window.__qaWalk(window.__game.scene.getScene('TavernEvening').children.list).some((o) => o.name === 'bondQuestResult'), null, { timeout: 30000 });
      await shot('quest-result');
      const fought = await save(); assert.equal(fought.battleSeq, beforeFight.battleSeq + 1, 'Бой не записан ровно один раз');
      await scrollToEnd('bondQuestResultScroll'); await shot('quest-result-end');
      await resize(height + 120, 'quest-result-tall'); await resize(height, 'quest-result-short');
      await tap('bondQuestDone'); await shot('hub-after-result');
      assert.deepEqual(await save(), fought, 'Закрытие результата повторило бой/награду');
    }
    await back(); await shot('return-classic-chronicle', 'Chronicle');
    run.passed = true;
  } finally { await context.close(); }
}

(async () => {
  const fixture = await fixtures();
  const owned = ['src/game/scenes/TavernEveningScene.ts', 'src/game/compactEveningLayout.ts', 'scripts/night-evening-compact-ui-qa.cjs'];
  qa.report.eveningSourceHashes = Object.fromEntries(owned.map((file) => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', file))).digest('hex')]));
  qa.report.fixtureScope = 'UI acceptance: canonical campaign cleared set; public finishEvening/chooseOption, starter stats, no gameplay completion claim';
  const browser = await qa.chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const sizes = (process.env.SIZES || '360x640,390x844').split(',').map((s) => s.split('x').map(Number));
    const profiles = (process.env.PROFILES || 'first,late').split(',');
    assert(profiles.every((p) => ['first', 'late', 'captured', 'legacy', 'empty'].includes(p)));
    for (const mode of qa.modes) for (const [width, height] of sizes) for (const profile of profiles) await flow(browser, mode, fixture, profile, width, height);
    qa.report.passed = true;
  } finally {
    qa.report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(qa.out, 'report.json'), JSON.stringify(qa.report, null, 2));
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
