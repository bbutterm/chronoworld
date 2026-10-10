#!/usr/bin/env node
/** Real battle/replay from an existing lawful save. No cloud access or edited progression. */
import { execSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = (key, fallback) => { const i = process.argv.indexOf('--' + key); return i < 0 ? fallback : process.argv[i + 1]; };
const SAVE_PATH = arg('save'), CLOCK_PATH = arg('clock'), STAGE = arg('stage');
if (!SAVE_PATH || !CLOCK_PATH || !STAGE) throw new Error('--save, --clock and --stage are required');
const save = JSON.parse(readFileSync(SAVE_PATH, 'utf8')), clock = JSON.parse(readFileSync(CLOCK_PATH, 'utf8'));
const ORIGIN = arg('origin', 'http://127.0.0.1:5523'), OUT = arg('out', 'ui-atlas/night-boss');
const WIDTH = Number(arg('width', '390')), HEIGHT = Number(arg('height', WIDTH === 360 ? '640' : '844'));
const RENDERER = arg('renderer', 'webgl1'), TELEGRAM = arg('telegram', '0') === '1';
const COMPACT = arg('compact', '0') === '1';
const RENDER_EVERY = Number(arg('render-every','1'));
const MAX_MS = Number(arg('max-seconds', '240')) * 1000;
if (!Number.isFinite(clock.now) || !Number.isFinite(MAX_MS) || MAX_MS < 1000 || !['canvas', 'webgl1'].includes(RENDERER) || !Number.isInteger(RENDER_EVERY) || RENDER_EVERY<1 || RENDER_EVERY>6) throw new Error('Invalid clock, deadline, renderer or render interval');
const moduleRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE ? resolve(process.env.PLAYWRIGHT_MODULE) : join(moduleRoot, 'playwright', 'index.mjs')).href);
mkdirSync(OUT, { recursive: true });
const report = { started: new Date().toISOString(), origin: ORIGIN, stage: STAGE, savePath: SAVE_PATH, clock, cleared: save.campaign.cleared.length, width: WIDTH, height: HEIGHT, rendererRequested: RENDERER, telegram: TELEGRAM, renderEvery:RENDER_EVERY, method: 'Existing lawful save; preparation scene opened directly; real fight button; deterministic replay updated at 30 Hz with synchronized private Date.now, performance.now and game.loop.time clocks, sampled every 0.2 s. With --render-every N only every Nth update is rendered; every sample and screenshot follows a real renderer postrender. Result/modal/navigation use native RAF. No playthrough or device-FPS claim.', errors: [], failures: [], samples: [], interactions: [] };
report.compactDevOverride=COMPACT;
const flush = () => writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, isMobile: true, hasTouch: true, timezoneId: 'UTC' });
const page = await context.newPage();
const deadline = setTimeout(() => { report.deadlineExceeded = true; flush(); void browser.close(); }, MAX_MS);
let current = 'Boot';
page.on('pageerror', e => { report.errors.push({ current, message: e.message, stack: e.stack }); flush(); });
page.on('console', m => { if (m.type() === 'error') report.errors.push({ current, console: m.text() }); });
await context.route('**/*', route => { const u = new URL(route.request().url()); return ['http:', 'https:'].includes(u.protocol) && !['localhost', '127.0.0.1'].includes(u.hostname) ? route.abort() : route.continue(); });
await page.addInitScript(({ save, clock, height, telegram, renderer }) => {
  localStorage.clear();
  localStorage.setItem('chronoworld.save.v1', JSON.stringify(save));
  localStorage.setItem('chronoworld.timeShift', String(Math.max(0, clock.now - Date.now())));
  for (const [key, value] of Object.entries({ battleAutoUlt: '1', battleSpeed: '1', autoAdvance: '0', fpsCap: '60', reduceMotion: '0' })) localStorage.setItem('chronoworld.' + key, value);
  window.__qaTgEvents = {};
  if (telegram) window.Telegram = { WebApp: { version: '9.0', platform: 'ios', initData: '', isFullscreen: true, isExpanded: true, viewportHeight: height, viewportStableHeight: height,
    safeAreaInset: { top: 47, bottom: 34, left: 0, right: 0 }, contentSafeAreaInset: { top: 89, bottom: 0, left: 0, right: 0 },
    ready() {}, expand() {}, requestFullscreen() {}, lockOrientation() {}, disableVerticalSwipes() {}, setHeaderColor() {}, setBackgroundColor() {}, setBottomBarColor() {},
    BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} }, onEvent(name,fn) { (window.__qaTgEvents[name]??=[]).push(fn); }, offEvent(name,fn) { window.__qaTgEvents[name]=(window.__qaTgEvents[name]??[]).filter(f=>f!==fn); } } };
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type === 'webgl2' || (renderer === 'canvas' && ['webgl', 'experimental-webgl'].includes(type)) ? null : getContext.call(this, type, ...args); };
}, { save, clock, height: HEIGHT, telegram: TELEGRAM, renderer: RENDERER });

async function clickObject(selector, textMatch = false) {
  await page.waitForFunction(() => window.__game?.input?.enabled !== false, null, { timeout:5000, polling:50 });
  const pos = await page.evaluate(([selector, textMatch]) => {
    const sc = window.__game.scene.getScenes(true)[0];
    const walk = list => list.flatMap(o => [o, ...(o.list ? walk(o.list) : [])]);
    const root=o=>{while(o.parentContainer)o=o.parentContainer;return o;};
    const shown=o=>{for(let p=o;p;p=p.parentContainer)if(!p.visible||p.alpha<.05)return false;return true;};
    const matches=walk(sc.children.list).filter(o=>(textMatch?o.type==='Text'&&o.text===selector:o.name===selector)&&shown(o));
    matches.sort((a,b)=>root(a).depth-root(b).depth||sc.children.list.indexOf(root(a))-sc.children.list.indexOf(root(b)));
    const o=matches.at(-1);
    if (!o) return null;
    const b = o.getBounds(), v = window.__view();
    const p = o.type === 'Container' && o.input?.enabled ? o.getWorldTransformMatrix().transformPoint(0, 0) : { x: b.centerX, y: b.centerY };
    let clip=null;for(let parent=o;parent;parent=parent.parentContainer)if(parent.getData?.('clip')){clip=parent.getData('clip');break;}
    return { ...p, v, clip };
  }, [selector, textMatch]);
  if (!pos) throw new Error('Visible target missing: ' + selector);
  const box = await page.locator('canvas').boundingBox(), scale = box.width / pos.v.worldW;
  const x=box.x+(pos.x-pos.v.worldX)*scale,y=box.y+(pos.y-pos.v.worldY)*scale;
  if(pos.clip&&(pos.y<pos.clip[0]||pos.y>pos.clip[1]))throw new Error('Target is outside its real scroll mask: '+selector);
  if(x<box.x||x>box.x+box.width||y<box.y||y>box.y+box.height)throw new Error('Target outside canvas: '+selector);
  await page.mouse.click(x,y);
  report.interactions.push({ selector, textMatch });
}

async function step(frames) {
  if(!await page.evaluate(() => window.__bossQa.manual)) {
    await page.waitForTimeout(frames*1000/30);
    return page.evaluate(() => ({ scenes:window.__game.scene.getScenes(true).map(s=>s.scene.key),frames:window.__bossQa.renders }));
  }
  return page.evaluate(([frames,renderEvery]) => {
    const g = window.__game;
    for (let i = 0; i < frames; i++) {
      window.__bossQa.time += 1000 / 30; window.__bossQa.wall += 1000 / 30; g.loop.time = window.__bossQa.time;
      if(i===frames-1 || (i+1)%renderEvery===0) g.step(window.__bossQa.time,1000/30);
      else g.headlessStep(window.__bossQa.time,1000/30);
    }
    return { scenes: g.scene.getScenes(true).map(s => s.scene.key), clock: g.scene.getScene('Battle').clock, finished: g.scene.getScene('Battle').finished, frames: window.__bossQa.renders };
  }, [frames,RENDER_EVERY]);
}

async function sceneEvidence() {
  return page.evaluate(() => {
    const g = window.__game, view = window.__view(), scenes = g.scene.getScenes(true), sc = scenes[0];
    const walk = list => list.flatMap(o => [o, ...(o.list ? walk(o.list) : [])]);
    const objects = walk(sc.children.list);
    const ancestorsVisible = o => { for (let p = o; p; p = p.parentContainer) if (!p.visible || p.alpha < .05) return false; return true; };
    const clip = o => { for(let p=o;p;p=p.parentContainer) { const c=p.getData?.('clip'); if(c) return c; } return null; };
    return { scenes: scenes.map(s => s.scene.key), view, renderer: g.renderer.type, glVersion: g.renderer.gl?.getParameter(g.renderer.gl.VERSION), postrender: window.__bossQa?.renders,
      texts: objects.filter(o => o.type === 'Text' && ancestorsVisible(o)).map(o => ({ text: o.text, depth: o.depth, parent: o.parentContainer?.name, bounds: { ...o.getBounds() }, clip:clip(o), fontSize: o.style.fontSize, alpha: o.alpha })),
      images: objects.filter(o => o.frame && ancestorsVisible(o)).map(o => ({ type:o.type,texture:o.texture?.key,frame:o.frame.name,bounds:{...o.getBounds()},clip:clip(o),alpha:o.alpha })),
      named: objects.filter(o => o.name && ancestorsVisible(o)).map(o => ({ name: o.name, interactive: !!o.input?.enabled, bounds: { ...o.getBounds() } })),
      targets: objects.filter(o=>o.input?.enabled&&ancestorsVisible(o)).map(o=>{const h=o.input.hitArea,m=o.getWorldTransformMatrix();return{name:o.name,width:(h.width??h.radius*2)*Math.hypot(m.a,m.b)*view.cssW/view.worldW,height:(h.height??h.radius*2)*Math.hypot(m.c,m.d)*view.cssW/view.worldW}}),
      missingSources: objects.filter(o => o.frame && !o.frame.source).map(o => ({ name: o.name, texture: o.texture?.key })) };
  });
}

async function compactEndpointResize(label) {
  if(!COMPACT)return;
  report.endpointResizes??=[];
  const before=await page.evaluate(async()=>{const {session}=await import('/src/game/session.ts'),sc=window.__game.scene.getScenes(true)[0];window.__bossQa.endpoint={sc,data:sc.sys.settings.data,json:JSON.stringify(sc.sys.settings.data),save:JSON.stringify(session.save)};return{scene:sc.scene.key,view:window.__view(),frames:window.__bossQa.renders};});
  for(const height of [HEIGHT+160,HEIGHT]) {
    await page.setViewportSize({width:WIDTH,height});await page.waitForTimeout(400);
    const state=await page.evaluate(async()=>{const {session}=await import('/src/game/session.ts'),sc=window.__game.scene.getScenes(true)[0],b=window.__bossQa.endpoint;return{sceneSame:sc===b.sc,dataSame:sc.sys.settings.data===b.data,jsonSame:JSON.stringify(sc.sys.settings.data)===b.json,saveSame:JSON.stringify(session.save)===b.save,frames:window.__bossQa.renders};});
    if(!state.sceneSame||!state.dataSame||!state.jsonSame||!state.saveSame||state.frames<=before.frames)throw new Error(label+': endpoint resize changed result/save identity or stopped real rendering');
    const evidence=await sceneEvidence();report.endpointResizes.push({label,height,state,evidence});
    const visible=evidence.texts.filter(o=>{const b=o.bounds,c=o.clip;return b.y+b.height>0&&b.y<evidence.view.uiHeight&&(!c||b.y+b.height>c[0]&&b.y<c[1]);});
    if(visible.some(o=>parseFloat(o.fontSize)*evidence.view.cssW/evidence.view.worldW<11.99))throw new Error(label+': visible endpoint text below12CSS');
    if(evidence.targets.some(t=>!Number.isFinite(t.width)||!Number.isFinite(t.height)||t.width<43.99||t.height<43.99))throw new Error(label+': endpoint touch target below44CSS');
  }
}

async function compactBattleResize() {
  if(!COMPACT||!TELEGRAM)return;
  report.compactResizes=[];
  for(const top of [156,136]) {
    const before=await page.evaluate(async()=>{
      const {session}=await import('/src/game/session.ts'),sc=window.__game.scene.getScene('Battle');
      window.__bossQa.resize={scene:sc,result:sc.result,cursor:sc.cursor,clock:sc.clock,units:JSON.stringify(sc.result.units),save:JSON.stringify(session.save)};
      return{view:window.__view(),clock:sc.clock,cursor:sc.cursor};
    });
    await page.evaluate(top=>{const t=window.Telegram.WebApp;t.contentSafeAreaInset.top=top-t.safeAreaInset.top;for(const fn of window.__qaTgEvents.contentSafeAreaChanged??[])fn();},top);
    await page.waitForFunction(previous=>Math.abs(window.__view().uiHeight-previous)>1,before.view.uiHeight,{timeout:5000});
    const after=await page.evaluate(async()=>{
      const {session}=await import('/src/game/session.ts'),sc=window.__game.scene.getScene('Battle'),b=window.__bossQa.resize;
      return{sceneSame:sc===b.scene,resultSame:sc.result===b.result,cursorSame:sc.cursor===b.cursor,clockSame:sc.clock===b.clock,unitsSame:JSON.stringify(sc.result.units)===b.units,saveSame:JSON.stringify(session.save)===b.save,view:window.__view()};
    });
    if(['sceneSame','resultSame','cursorSame','clockSame','unitsSame','saveSame'].some(k=>!after[k]))throw new Error('Compact Telegram inset resize changed live battle state: '+JSON.stringify(after));
    await step(1);report.compactResizes.push({top,before,after,evidence:await sceneEvidence()});
  }
  await page.screenshot({path:join(OUT,'battle-mid-compact.png')});
}

try {
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__game?.scene && !window.__game.scene.isActive('Boot') && window.__game.scene.getScenes(true).length && !window.__sprites.busy(), null, { timeout: 90000 });
  const prep = await page.evaluate(async stageId => {
    const { session, today } = await import('/src/game/session.ts');
    const { GAME } = await import('/src/game/content.ts');
    const { stageStatus, getStage } = await import('/src/core/index.ts');
    const hints = await import('/src/game/hints.ts');
    const ids = Object.keys(hints.HINT_TEXT);
    localStorage.setItem(hints.HINT_KEY, JSON.stringify(ids)); localStorage.setItem(hints.HINT_SHOWN_KEY, JSON.stringify(ids)); hints.reloadHints();
    const status = stageStatus(session.save, stageId, GAME);
    if (status === 'locked') throw new Error('Lawful snapshot has not unlocked ' + stageId);
    const g = window.__game;
    for (const sc of g.scene.getScenes(true)) g.scene.stop(sc.scene.key);
    g.scene.start('Stage', { stageId });
    return { status, day: today(), stage: getStage(GAME, stageId), squad: session.save.squad, heroes: session.save.heroes.filter(h => session.save.squad.includes(h.id)) };
  }, STAGE);
  report.preparation = prep;
  await page.waitForFunction(() => {const a=window.__game.scene.getScenes(true);return a.length===1&&a[0].scene.key==='Stage'&&!window.__sprites.busy();}, null, { timeout: 60000 });
  await page.waitForTimeout(400);
  const button = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('Stage');
    const walk = list => list.flatMap(o => [o, ...(o.list ? walk(o.list) : [])]);
    return walk(sc.children.list).find(o => o.type === 'Text' && o.text === 'В бой')?.text;
  });
  if (!button) throw new Error('Fight button missing');
  if(COMPACT)await page.evaluate(()=>{const url=new URL(location.href);url.searchParams.set('compact','1');history.replaceState(null,'',url);});
  await clickObject(button, true); current = 'Battle';
  for (let n = 0; n < 30; n++) {
    if (await page.evaluate(() => window.__game.scene.isActive('Battle'))) break;
    const dialogue = await page.evaluate(() => window.__game.scene.getScenes(true)[0]?.children.getByName('dialogue') !== null);
    if (dialogue) { try { await clickObject('Пропустить', true); } catch { /* text may appear on a later frame */ } }
    await page.waitForTimeout(150);
  }
  await page.waitForFunction(() => {const a=window.__game.scene.getScenes(true);return a.length===1&&a[0].scene.key==='Battle'&&a[0].ready&&a[0].viewList.length>=10&&!window.__sprites.busy();}, null, { timeout: 90000 });
  await page.evaluate(() => {
    const g = window.__game; g.loop.sleep();
    window.__bossQa = { time: performance.now(), wall:Date.now(), renders: 0, masks: new Map(), manual:true, originalDate:Date.now, originalPerformance:performance.now.bind(performance) };
    // Phaser TweenManager uses Date.now rather than the delta supplied to Game.step.
    // Keep animation time, battle time and UI reveal time on the same private frame clock.
    Date.now = () => window.__bossQa.wall;
    Object.defineProperty(performance,'now',{configurable:true,value:()=>window.__bossQa.time});
    g.events.on('postrender', renderer => { if(renderer) window.__bossQa.renders++; });
    // Reconstruct the current packed sprite frame using Phaser's origin/flip transform.
    // Pixel alpha at the displayed CSS resolution distinguishes empty sprite cells from covered heroes.
    window.__bossQa.mask = v => {
      const s = v.sprite, f = s.frame, wm = s.getWorldTransformMatrix();
      if (!f.source?.image || f.rotated || s.isCropped) throw new Error('Unsupported/missing current sprite frame');
      let x = -s.displayOriginX + f.x, y = -s.displayOriginY + f.y;
      if (s.flipX && !f.customPivot) x += -f.realWidth + s.displayOriginX * 2;
      if (s.flipY && !f.customPivot) y += -f.realHeight + s.displayOriginY * 2;
      const a = wm.a * (s.flipX ? -1 : 1), b = wm.b * (s.flipX ? -1 : 1), c = wm.c * (s.flipY ? -1 : 1), d = wm.d * (s.flipY ? -1 : 1), e = wm.e, ff = wm.f;
      const corners = [[x,y],[x+f.cutWidth,y],[x,y+f.cutHeight],[x+f.cutWidth,y+f.cutHeight]].map(([px,py]) => ({ x:a*px+c*py+e, y:b*px+d*py+ff }));
      const box = { left: Math.min(...corners.map(p => p.x)), right: Math.max(...corners.map(p => p.x)), top: Math.min(...corners.map(p => p.y)), bottom: Math.max(...corners.map(p => p.y)) };
      const canvas = document.createElement('canvas'), ratio = window.__view().cssW / window.__view().worldW;
      const ox = Math.floor(box.left * ratio), oy = Math.floor(box.top * ratio);
      canvas.width = Math.ceil(box.right * ratio) - ox + 1; canvas.height = Math.ceil(box.bottom * ratio) - oy + 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingEnabled = false;
      ctx.setTransform(a*ratio,b*ratio,c*ratio,d*ratio,e*ratio-ox,ff*ratio-oy);
      ctx.drawImage(f.source.image, f.cutX,f.cutY,f.cutWidth,f.cutHeight,x,y,f.cutWidth,f.cutHeight);
      const data = ctx.getImageData(0,0,canvas.width,canvas.height).data;
      let opaque = 0; for (let i=3;i<data.length;i+=4) if (data[i] >= 32) opaque++;
      return { box, ox, oy, w: canvas.width, h: canvas.height, data, opaque, ratio };
    };
    window.__bossQa.sample = () => {
      const sc = g.scene.getScene('Battle');
      const boss = sc.viewList.find(v => v.snap.side === 'B' && v.def.kind === 'boss');
      if (!boss) throw new Error('Boss view missing');
      const bm = window.__bossQa.mask(boss);
      const overlaps = sc.viewList.filter(v => v.snap.side === 'A' && v.alive && !v.shownDead && v.node.alpha > .1 && v.sprite.visible).map(hero => {
        const hm = window.__bossQa.mask(hero);
        const left = Math.max(bm.ox,hm.ox), right = Math.min(bm.ox+bm.w,hm.ox+hm.w), top = Math.max(bm.oy,hm.oy), bottom = Math.min(bm.oy+bm.h,hm.oy+hm.h);
        let common = 0;
        for(let y=top;y<bottom;y++) for(let x=left;x<right;x++) if(bm.data[((y-bm.oy)*bm.w+x-bm.ox)*4+3]>=32 && hm.data[((y-hm.oy)*hm.w+x-hm.ox)*4+3]>=32) common++;
        const bossAbove = boss.node.depth > hero.node.depth || (boss.node.depth === hero.node.depth && sc.children.list.indexOf(boss.node) > sc.children.list.indexOf(hero.node));
        const covering = boss.alive && !boss.shownDead && boss.node.alpha > .1 && boss.sprite.visible && bossAbove;
        return { hero: hero.def.name, uid: hero.snap.uid, depth: hero.node.depth, bossAbove, opaquePixels: hm.opaque, sharedPixels: common, coveredFraction: covering && hm.opaque ? common/hm.opaque : 0, rawFraction: hm.opaque ? common/hm.opaque : 0, heroBounds: hm.box };
      });
      const labels = sc.viewList.filter(v => v.labels.visible && v.labels.alpha>.05 && (v.nameText.alpha>.05 || v.castBack.visible)).map(v => {
        const b = v.nameText.alpha>.05 ? v.namePlate.getBounds() : v.castBack.getBounds();
        return { uid:v.snap.uid, text:v.nameText.text, nameAlpha:v.nameText.alpha, charging:v.charging, depth:v.labels.depth, bounds:{...b} };
      });
      const labelCollisions = [];
      for(let i=0;i<labels.length;i++) for(let j=i+1;j<labels.length;j++) { const a=labels[i].bounds,b=labels[j].bounds; if(Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)+1 && Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y)+1) labelCollisions.push([labels[i].uid,labels[j].uid]); }
      return { t:sc.clock, finished:sc.finished, frames:window.__bossQa.renders, boss:{ uid:boss.snap.uid,unitId:boss.snap.unitId,name:boss.def.name,spriteId:boss.spriteId,depth:boss.node.depth,alive:boss.alive,bounds:bm.box,opaquePixels:bm.opaque,currentFrame:boss.sprite.frame.name,scale:boss.sprite.scaleX,texture:boss.sprite.texture.key,nameAlpha:boss.nameText.alpha,labelDepth:boss.labels.depth }, overlaps,labels,labelCollisions };
    };
  });
  report.battle = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('Battle');
    return { duration:sc.result.duration, winner:sc.result.winner, seed:sc.result.seed, units:sc.result.units, renderer:window.__game.renderer.type, glVersion:window.__game.renderer.gl?.getParameter(window.__game.renderer.gl.VERSION), view:window.__view() };
  });
  await step(1);
  await page.screenshot({ path: join(OUT, 'battle-start.png') });
  let worst = -1, tapped = false;
  for (let n=0;n<900;n++) {
    const state = await step(6);
    if (!state.scenes.includes('Battle')) break;
    const sample = await page.evaluate(() => window.__bossQa.sample()); report.samples.push(sample);
    if(COMPACT&&n===75)await compactBattleResize();
    const value = Math.max(0,...sample.overlaps.map(o => o.coveredFraction));
    if (value > worst + .02) { worst = value; report.worst = sample; await page.screenshot({ path:join(OUT,'battle-overlap.png') }); }
    if(!report.maximumSample || value>report.maximumCovered) { report.maximumCovered=value; report.maximumSample=sample; }
    if(!report.midbattleShot && sample.t>=20 && sample.boss.alive) {
      report.midbattleShot=sample; await page.screenshot({path:join(OUT,'battle-mid.png')});
    }
    if(n%50===0) { flush(); console.log('FRAME',STAGE,sample.t.toFixed(2),'postrender',sample.frames); }
    if (!tapped && sample.t >= 5 && sample.boss.alive) {
      const p = await page.evaluate(() => {
        const sc = window.__game.scene.getScene('Battle'), v = sc.viewList.find(v => v.def.kind==='boss' && v.snap.side==='B');
        const m = window.__bossQa.mask(v), camera=sc.cameras.main;
        const rank=o=>camera.renderList.indexOf(o.sprite);
        const above=sc.viewList.filter(o=>o!==v && o.alive && !o.shownDead && o.node.alpha>.05 && o.sprite.visible && rank(o)>rank(v)).map(o=>window.__bossQa.mask(o));
        const candidates=[];
        for(let y=0;y<m.h;y++) for(let x=0;x<m.w;x++) {
          if(m.data[(y*m.w+x)*4+3]<128) continue;
          const cx=x+m.ox,cy=y+m.oy;
          if(above.some(o=>cx>=o.ox && cx<o.ox+o.w && cy>=o.oy && cy<o.oy+o.h && o.data[((cy-o.oy)*o.w+cx-o.ox)*4+3]>=32)) continue;
          const px=(cx+.5)/m.ratio,py=(cy+.5)/m.ratio;
          candidates.push({x:px,y:py,distance:Math.abs(px-v.node.x)+Math.abs(py-(m.box.top+m.box.bottom)/2)});
        }
        candidates.sort((a,b)=>a.distance-b.distance);
        for(const point of candidates) {
          // Visible pixels may still be intercepted by another sprite's larger rectangular hit area.
          // Query the same Phaser hit test and render-list sort used by the real pointer event.
          const canvas=camera.matrix.transformPoint(point.x-camera.scrollX,point.y-camera.scrollY);
          const pointer={x:canvas.x,y:canvas.y,camera};
          const hits=sc.input.manager.hitTest(pointer,sc.input._list,camera,[]);
          sc.input.sortGameObjects(hits,pointer);
          if(hits[0]===v.sprite) return {...point,canvasX:canvas.x,canvasY:canvas.y,visibleCandidates:candidates.length,hitTarget:v.snap.uid,v:window.__view()};
        }
        throw new Error('No visible opaque boss pixel is reachable by a real Phaser pointer; tap coverage is incomplete');
      });
      const box = await page.locator('canvas').boundingBox();
      await page.mouse.click(box.x+p.canvasX*box.width/p.v.backW,box.y+p.canvasY*box.height/p.v.backH); await step(1);
      const tappedState=await page.evaluate(() => window.__bossQa.sample());
      report.bossTap=tappedState; report.interactions.push({ selector:'visible boss opaque figure with actual Phaser hit test',worldPoint:{x:p.x,y:p.y},canvasPoint:{x:p.canvasX,y:p.canvasY},visibleCandidates:p.visibleCandidates,hitTarget:p.hitTarget,nameAlpha:tappedState.boss.nameAlpha });
      await page.screenshot({path:join(OUT,'battle-name.png')}); tapped=true;
    }
    if (sample.finished) break;
  }
  if (!report.samples.length || !report.samples.at(-1).finished) throw new Error('Battle did not finish within 180 s of rendered game time');
  // Return to native RAF before Result.create schedules its real-time reveal.
  // This also lets native input-shield timers run normally during modal clicks.
  await page.evaluate(() => {
    const q=window.__bossQa; Date.now=q.originalDate;
    Object.defineProperty(performance,'now',{configurable:true,value:q.originalPerformance});
    q.manual=false; window.__game.loop.wake();
  });
  await page.waitForFunction(() => window.__game.scene.isActive('Result') && window.__game.scene.getScene('Result').ready, null, {timeout:30000,polling:100});
  await step(21);
  // Core-only lawful snapshots may have pending one-time feature announcements.
  // Dismiss them through actual buttons, preserving their normal save changes.
  let quiet=0;
  for(let n=0;n<40;n++) {
    const pending=await page.evaluate(()=>{const sc=window.__game.scene.getScenes(true)[0];return{banner:!!sc?.children.getByName('unlockBanner'),dialogue:!!sc?.children.getByName('dialogue')};});
    if(pending.dialogue) { quiet=0;await clickObject('Пропустить',true);await step(21); }
    else if(pending.banner) { quiet=0;await clickObject('Позже',true);await step(21); }
    else { await step(27);if(++quiet===2)break; }
  }
  if(await page.evaluate(() => !!window.__game.scene.getScenes(true)[0]?.children.getByName('unlockBanner'))) throw new Error('Feature announcements did not finish; statistics coverage is incomplete');
  current='Result'; report.result=await sceneEvidence();
  if(!report.result.scenes.includes('Result') || !await page.evaluate(() => window.__game.scene.getScene('Result').ready)) throw new Error('Expected a ready Result scene');
  await page.screenshot({path:join(OUT,'result.png')});
  await compactEndpointResize('result');
  await clickObject('resultStats'); await step(15); report.stats=await sceneEvidence();
  if(!report.stats.named.some(o=>o.name==='bottomSheet')) throw new Error('Statistics sheet did not open');
  await page.screenshot({path:join(OUT,'result-stats.png')});
  const box=await page.locator('canvas').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height*.65); await page.mouse.wheel(0,420); await step(15);
  report.statsScrolled=await sceneEvidence(); await page.screenshot({path:join(OUT,'result-stats-enemies.png')});
  await compactEndpointResize('statistics');
  await clickObject('sheetClose'); await step(15); report.statsClosed=await sceneEvidence();
  if(report.statsClosed.named.some(o=>o.name==='bottomSheet')) report.failures.push('Statistics sheet did not close');
  await page.waitForTimeout(180);
  await clickObject('К кампании',true); await step(15); report.campaignReturn=await sceneEvidence();
  if(!report.campaignReturn.scenes.includes('Campaign')) report.failures.push('Result campaign button did not reach Campaign');
  if(!report.bossTap || (COMPACT ? Math.abs(report.bossTap.boss.nameAlpha-1)>1e-6 : report.bossTap.boss.nameAlpha<.5)) report.failures.push(COMPACT ? 'Real boss tap did not fully reveal the boss name (alpha1 required)' : 'Real boss tap did not reveal the boss name');
  if(report.samples.some(s=>s.labelCollisions.length)) report.failures.push('Visible battle label rectangles overlap');
  if(report.samples.some((s,i)=>i>0 && s.frames<=report.samples[i-1].frames)) report.failures.push('No successful postrender between battle samples');
  if([report.result,report.stats,report.statsScrolled,report.statsClosed].some(d=>d.missingSources.length)) report.failures.push('Live image lost a texture source');
  report.maximumCovered=Math.max(0,...report.samples.flatMap(s=>s.overlaps.map(o=>o.coveredFraction)));
  report.finished=new Date().toISOString(); flush();
  console.log(JSON.stringify({stage:STAGE,samples:report.samples.length,winner:report.battle.winner,duration:report.battle.duration,maximumCovered:report.maximumCovered,bossTapNameAlpha:report.bossTap?.boss.nameAlpha,renderer:report.battle.renderer,errors:report.errors.length,failures:report.failures}));
} catch(e) { report.fatal=e.stack; console.error(e); }
finally { clearTimeout(deadline); flush(); await context.close().catch(()=>{}); await browser.close().catch(()=>{}); }
if(report.deadlineExceeded || report.fatal || report.errors.length || report.failures.length) process.exitCode=1;
