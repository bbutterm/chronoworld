#!/usr/bin/env node
/* Local native360→320→360 regression, normal clocks; all nonlocal/non-GET requests blocked. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { gunzipSync } = require('node:zlib');
const { tsImport } = require('node:module').createRequire(path.join(process.cwd(), 'package.json'))('tsx/esm/api');
const qa = require('./night-compact-ui-qa.cjs');
(async () => {
  const fixture = await qa.fixtures();
  const from = pathToFileURL(path.join(process.cwd(), 'scripts/night-compact-ui-qa.cjs')).href;
  const [{ loadFullContext }, core] = await Promise.all([tsImport('./lib/content-node.ts', from), tsImport('../src/core/index.ts', from)]);
  const game = loadFullContext();
  // Use the published public-action playthrough, never the common helper's synthetic choice fixture.
  const saveFile = path.resolve(process.env.SAVE_FILE || 'docs/REPORTS/2026-10-05-night-final-root-campaign/raw/final-save.json.gz');
  const input = fs.readFileSync(saveFile);
  const original = JSON.parse((saveFile.endsWith('.gz') ? gunzipSync(input) : input).toString('utf8'));
  const progress = (s) => JSON.stringify({ campaign: s.campaign, resources: s.resources, currency: s.currency, heroes: s.heroes, squad: s.squad, inventory: s.inventory });
  const originalProgress = progress(original);
  let save = core.markScenesSeen(original, game.story.scenes.map((s) => s.id));
  save.storyQueue = []; save = core.clearChapterDone(save);
  for (const chapter of game.content.chapters) save = core.markPageSeen(save, core.episodePageId(chapter.id));
  save = core.markUnlocksSeen(save, core.pendingUnlocks(save, game).map((f) => f.id));
  assert.equal(progress(save), originalProgress, 'UI notice preparation changed lawful progression/resources');
  qa.report.fixtureCore = { saveFile: path.relative(process.cwd(), saveFile), fileSha256: crypto.createHash('sha256').update(input).digest('hex'),
    lawfulClears: save.campaign.cleared.length, preparedSaveHash: crypto.createHash('sha256').update(core.serialize(save)).digest('hex'),
    fabricatedResources: false, fabricatedVictories: false, normalBrowserClock: true };
  const browser = await qa.chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader'] });
  const violations = [];
  let context;
  try {
    const state = await qa.openContext(browser, process.env.MODE || 'canvas', { ...fixture, choiceSave: core.serialize(save) }, true);
    context = state.context; const { page, run } = state; const c = qa.controls(page, run, fixture);
    run.fixture = 'motion preference + native360→320→360 metrics regression';
    await context.addInitScript(() => {
      localStorage.setItem('chronoworld.reduceMotion','1');
      window.Telegram.WebApp.safeAreaInset = { top: 47, bottom: 34, left: 0, right: 0 };
      window.Telegram.WebApp.contentSafeAreaInset = { top: 89, bottom: 0, left: 0, right: 0 };
    });
    await page.reload({ waitUntil:'domcontentloaded' });
    await page.waitForFunction(() => window.__game?.scene.isActive('Campaign') && !window.__game.scene.isActive('Boot'), null, { timeout:60000 });
    await page.evaluate(() => {
      window.__qaFrames=0; window.__game.events.on('postrender',()=>window.__qaFrames++);
      window.__qaWalk=(list)=>list.flatMap((o)=>[o,...(o.list?window.__qaWalk(o.list):[])]);
    });
    await c.dismiss(); await c.tap('nav_Home'); await c.dismiss();
    const beforeMotion = await page.evaluate(() => localStorage.getItem('chronoworld.save.v1'));
    await page.evaluate(() => {
      const scene=window.__game.scene.getScene('Home'), add=scene.tweens.add;
      window.__motionProbe=[];
      scene.tweens.add=function(config){
        const targets=[config.targets].flat();
        window.__motionProbe.push({targets:targets.map((o)=>o.name||o.type),scale:config.scale,alpha:config.alpha,duration:config.duration});
        return add.call(this,config);
      };
    });
    await c.tap('settings');
    run.motion=await page.evaluate(()=>{
      const scene=window.__game.scene.getScene('Home'),inner=window.__qaWalk(scene.children.list).find((o)=>o.name==='popInner');
      return {preference:localStorage.getItem('chronoworld.reduceMotion'),innerScale:inner?.scaleX,innerAlpha:inner?.alpha,addedTweens:window.__motionProbe,saveUnchanged:localStorage.getItem('chronoworld.save.v1')};
    });
    assert.equal(run.motion.preference,'1'); assert.equal(run.motion.saveUnchanged,beforeMotion); delete run.motion.saveUnchanged;
    if(run.motion.addedTweens.some((t)=>t.targets.includes('popInner')))violations.push('Уменьшить анимацию=Вкл всё равно добавляет scale/alpha tween popInner');
    await page.screenshot({path:path.join(qa.out,'reduced-motion-settings.png')});
    await page.evaluate(()=>window.__tgBackHandlers.forEach((fn)=>fn()));
    await page.waitForTimeout(500);
    await c.tap('chronicleBtnHit'); await c.tap('chronicleTavern');
    await c.tap('evening_tav_ch1'); await page.waitForTimeout(2100);
    const exists=await page.evaluate(()=>window.__qaWalk(window.__game.scene.getScene('TavernEvening').children.list).find((o)=>o.name==='eveningCounter')?.text);
    if(!exists)await c.tap('eveningAdvance');
    await page.evaluate(()=>{
      window.__fontInstance=window.__game.scene.getScene('TavernEvening');window.__fontCreates=0;
      window.__fontInstance.events.on('create',()=>window.__fontCreates++);
    });
    const beforeFont=await page.evaluate(()=>localStorage.getItem('chronoworld.save.v1'));
    const metric=async(width)=>{
      await page.setViewportSize({width,height:640});
      await page.waitForFunction((w)=>window.innerWidth===w && Math.abs(window.__view().cssW-w)<.01,width,{timeout:5000});
      await page.waitForTimeout(350);
      const m=await page.evaluate(()=>{
        const scene=window.__game.scene.getScene('TavernEvening'),v=window.__view(),s=v.cssW/v.worldW;
        const nodes=window.__qaWalk(scene.children.list),caption=nodes.find((o)=>o.name==='eveningCounter'),skip=nodes.find((o)=>o.name==='eveningSkip');
        const matrix=skip.getWorldTransformMatrix();
        return {width:window.innerWidth,view:v,captionText:caption.text,captionWorldFont:parseFloat(caption.style.fontSize),captionCSS:parseFloat(caption.style.fontSize)*s,
          skipCSS:{width:skip.input.hitArea.width*Math.hypot(matrix.a,matrix.b)*s,height:skip.input.hitArea.height*Math.hypot(matrix.c,matrix.d)*s},
          sameScene:window.__fontInstance===scene,creates:window.__fontCreates,frames:window.__qaFrames,invalidFrames:nodes.filter((o)=>o.frame&&!o.frame.source).map((o)=>o.texture?.key),save:localStorage.getItem('chronoworld.save.v1'),clip:nodes.find((o)=>o.name==='eveningBody').getData('clip'),bodyY:nodes.find((o)=>o.name==='eveningBody').y};
      });
      assert(m.sameScene && m.creates===0);assert.equal(m.save,beforeFont);assert.equal(m.invalidFrames.length,0);delete m.save;
      await page.screenshot({path:path.join(qa.out,`font-touch-${width}.png`)});return m;
    };
    run.widthProbe=[await metric(360),await metric(320),await metric(360)];
    assert.deepEqual(run.widthProbe[2].clip,run.widthProbe[0].clip);
    assert.equal(run.widthProbe[2].bodyY,run.widthProbe[0].bodyY);
    assert(run.widthProbe[1].frames>run.widthProbe[0].frames && run.widthProbe[2].frames>run.widthProbe[1].frames,'renderer heartbeat stopped after native resize');
    for(const m of run.widthProbe) {
      if(m.captionCSS<11.99)violations.push(`${m.width}: visible eveningCounter=${m.captionCSS.toFixed(3)}CSS`);
      if(m.skipCSS.height<43.99)violations.push(`${m.width}: eveningSkip hit=${m.skipCSS.height.toFixed(3)}CSS`);
    }
    assert.equal(run.errors.length,0);run.violations=violations;run.passed=violations.length===0;
    qa.report.passed=run.passed;qa.report.finishedAt=new Date().toISOString();
    fs.writeFileSync(path.join(qa.out,'report.json'),JSON.stringify(qa.report,null,2));
    console.log(JSON.stringify({passed:run.passed,motion:run.motion,widthProbe:run.widthProbe.map(({width,captionCSS,skipCSS,creates,captionText})=>({width,captionCSS,skipCSS,creates,captionText})),violations,errors:run.errors},null,2));
    if(violations.length)process.exitCode=1;
  } catch(error) {
    qa.report.error=error.stack;qa.report.finishedAt=new Date().toISOString();
    fs.writeFileSync(path.join(qa.out,'report.json'),JSON.stringify(qa.report,null,2));console.error(error.stack);process.exitCode=1;
  } finally { if(context)await context.close();await browser.close(); }
})();
