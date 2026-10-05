#!/usr/bin/env node
// Локальная UI-приёмка: отдельный browser context, явный mock transport, внешний доступ заблокирован.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => {
  if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]);
  return pairs;
}, []));
const origin = new URL(args.origin || 'http://127.0.0.1:5538');
assert(['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname), 'Только локальный dev/preview origin');
const width = Number(args.width || 360);
const renderer = args.renderer || (width === 360 ? 'canvas' : 'webgl1');
assert(['canvas', 'webgl1', 'webgl'].includes(renderer));
const out = resolve(args.out || '/tmp/night-events-friends-qa');
const baseline = !!args.baseline;
mkdirSync(out, { recursive: true });
const playwrightPath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(playwrightPath ? pathToFileURL(playwrightPath).href : 'playwright');
const [{ loadFullContext }, core] = await Promise.all([
  tsImport('./lib/content-node.ts', import.meta.url), tsImport('../src/core/index.ts', import.meta.url),
]);
const ctx = loadFullContext();
const fixedNow = Date.UTC(2026, 9, 5, 12);
let save = core.touchEvents(core.newGame(ctx, fixedNow), '2026-10-05', ctx);
save = core.trackAchievement(save, 'stages_cleared', 3, 'max');
save.campaign.cleared = ctx.content.stages.slice(0, 3).map(s => s.id); // Явный synthetic UI fixture, не доказательство прохождения.
save.storyQueue = [];
save.seenScenes = ctx.story.scenes.map(s => s.id);
for (const chapter of ctx.content.chapters) save = core.markPageSeen(save, core.episodePageId(chapter.id));
let day7Save = save;
for (let day = 1; day < 7; day++) day7Save = core.touchEvents(day7Save, `2026-10-${String(5 + day).padStart(2, '0')}`, ctx);
const hintsSource = readFileSync(new URL('../src/game/hints.ts', import.meta.url), 'utf8');
const hints = [...hintsSource.split('export type HintId =')[1].split(';')[0].matchAll(/'([^']+)'/g)].map(m => m[1]);
const report = {
  origin: origin.origin, width, renderer, baseline, fixture: 'synthetic UI-only newGame + touchEvents + first3 cleared slots/counter; deterministic local Friends responses',
  sourceHashes: Object.fromEntries(['src/game/scenes/EventsScene.ts', 'src/game/scenes/FriendsScene.ts'].map(p => [p, createHash('sha256').update(readFileSync(new URL(`../${p}`, import.meta.url))).digest('hex')])),
  steps: [], assertions: [], errors: [], blockedExternal: [], passed: false,
};
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const deadline = setTimeout(() => { report.deadlineReached = true; void browser.close(); }, 240000);
let context;
try {
  context = await browser.newContext({ viewport: { width, height: 640 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith('/telegram-web-app.js')) return route.fulfill({ contentType: 'application/javascript', body: '' });
    if (url.origin !== origin.origin || !['GET', 'HEAD'].includes(request.method())) {
      report.blockedExternal.push({ url: url.origin + url.pathname, method: request.method() });
      return route.abort('blockedbyclient');
    }
    if (/\/assets\/index-[^/]+\.js$/.test(url.pathname)) {
      const response = await route.fetch(), code = await response.text();
      const game = /([\w$]+)=new\s*[\w$.]+\.Game\(\{type:/.exec(code);
      const view = /function [\w$]+\(\)\{return ([\w$]+)\.adaptive\?Math.max\(/.exec(code);
      assert(game && view, 'Compiled debug matcher не совпал; продукт не изменён');
      report.bundleSha256 = createHash('sha256').update(code).digest('hex');
      return route.fulfill({ response, body: `${code};window.__game=${game[1]};window.__view=()=>${view[1]};` });
    }
    return route.continue();
  });
  await context.addInitScript(({ renderer, fixedNow, save, day7Save, hints }) => {
    const qaCase = new URLSearchParams(location.search).get('qaCase') || '';
    if (qaCase.startsWith('day7')) { fixedNow += 6 * 86400000; save = day7Save; }
    const ActualDate = Date;
    const actualStart = ActualDate.now(), qaNow = () => fixedNow + ActualDate.now() - actualStart;
    class FixedDate extends ActualDate { constructor(...args) { super(...(args.length ? args : [qaNow()])); } static now() { return qaNow(); } }
    window.Date = FixedDate;
    localStorage.setItem('chronoworld.save.v1', save);
    localStorage.setItem('chronoworld.hints', JSON.stringify(hints));
    localStorage.setItem('chronoworld.hintsShown', JSON.stringify(hints));
    const nativeContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(name, ...args) {
      if ((renderer === 'canvas' && /webgl|experimental/i.test(name)) || (renderer === 'webgl1' && name === 'webgl2')) return null;
      return nativeContext.call(this, name, ...args);
    };
    window.__tgEvents = {}; window.__tgBack = []; window.__tgLinks = [];
    window.Telegram = { WebApp: {
      initData: qaCase === 'offline' ? '' : 'offline-qa-fixture-never-sent', platform: 'ios', version: '9.0', isFullscreen: true,
      safeAreaInset: { top: 47, bottom: 34, left: 0, right: 0 }, contentSafeAreaInset: { top: 89, bottom: 0, left: 0, right: 0 },
      ready() {}, expand() {}, requestFullscreen() {}, setHeaderColor() {}, setBackgroundColor() {}, setBottomBarColor() {}, disableVerticalSwipes() {},
      onEvent(name, fn) { (window.__tgEvents[name] ??= []).push(fn); },
      offEvent(name, fn) { window.__tgEvents[name] = (window.__tgEvents[name] ?? []).filter(f => f !== fn); },
      openTelegramLink(url) { window.__tgLinks.push(url); }, openLink(url) { window.__tgLinks.push(url); },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {}, selectionChanged() {} },
      BackButton: { show() { this.visible = true; }, hide() { this.visible = false; }, onClick(fn) { window.__tgBack.push(fn); }, offClick(fn) { window.__tgBack = window.__tgBack.filter(f => f !== fn); } },
    } };
    const friends = Array.from({ length: 20 }, (_, i) => ({ id: 101 + i, name: i === 0 ? 'Маргарита-Звёздная-Длинноименная' : `Друг ${i + 1}`, chapter: 1 + i % 10, stage: 1 + i % 18, power: 1234567 - i * 23000, towerBest: 7 + i, giftSent: i === 1, giftWaiting: i < 2 }));
    window.__qaTransport = { calls: [], pending: [], fail: qaCase === 'friends-error' ? { friends:1 } : qaCase === 'board-error' ? { board:1 } : {}, holds: {}, friends, friendsMode: qaCase === 'friends-empty' ? 'empty' : 'list', boardMode: qaCase === 'board-empty' ? 'empty' : 'list', grantReady: false };
    const nativeFetch = window.fetch;
    window.fetch = async function(input, init) {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (!url.pathname.endsWith('/cw-api')) return nativeFetch.call(this, input, init);
      const payload = JSON.parse(init?.body || '{}'), action = payload.action, t = window.__qaTransport;
      t.calls.push({ action, payload, at: performance.now() });
      let body = { ok: true }, status = 200;
      if ((t.fail[action] || 0) > 0) { t.fail[action]--; status = 500; }
      else if (action === 'hello') body = { ok: true, id: 100, name: 'Тестовый герой', protocol: 2, fresh: false, cloudSave: null, giftsWaiting: 2, refBonus: 0 };
      else if (action === 'friends') body = { ok: true, friends: t.friendsMode === 'empty' ? [] : t.friends };
      else if (action === 'board') {
        const top = Array.from({ length: 32 }, (_, i) => ({ place: i + 1, name: i === 3 ? 'Это тестовый герой' : `Участник ${i + 1}`, me: i === 3, chapter: 10 - i % 10, stage: 18 - i % 18, power: 999999 - i * 12000, value: payload.board === 'tower' ? 80 - i : 999999 - i * 12000 }));
        body = { ok: true, week: payload.board === 'tower' || payload.board === 'mvp' ? '2026-W41' : '', top: t.boardMode === 'empty' ? [] : top, mine: t.boardMode === 'empty' ? null : { ...top[3] } };
      } else if (['reward_claim', 'gift_claim', 'ref_claim'].includes(action)) body = { ok: true, grants: t.grantReady ? [{ id: '00000000-0000-4000-8000-000000000007', kind: 'gift', units: 2, gems: 40 }] : [] };
      else if (action === 'save_put') status = 500; // Нет даже тестовой удалённой записи.
      else if (action === 'save_get') body = { ok: true, save: null };
      if (t.holds[action]) await new Promise(resolve => t.pending.push({ action, resolve }));
      if (action === 'gift_send' && status === 200) { const f = t.friends.find(f => f.id === payload.to); if (f) f.giftSent = true; }
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    };
    const setItem = Storage.prototype.setItem;
    window.__qaSaveWrites = [];
    Storage.prototype.setItem = function(key, value) { if (key === 'chronoworld.save.v1') window.__qaSaveWrites.push(value); return setItem.call(this, key, value); };
  }, { renderer, fixedNow, save: core.serialize(save), day7Save: core.serialize(day7Save), hints });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.stack || error.message));
  page.on('console', msg => { if (msg.type() === 'error') report.errors.push(msg.text()); });
  const url = new URL(origin); url.searchParams.set('compact', '1');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__game?.scene && !window.__game.scene.isActive('Boot') && window.__game.scene.getScenes(true).some(s => s.scene.key !== 'Boot'), null, { timeout: 120000 });
  await page.evaluate(() => {
    window.__qaWalk = list => list.flatMap(o => [o, ...(o.list ? window.__qaWalk(o.list) : [])]);
    window.__qaFrames = 0; window.__game.events.on('postrender', () => window.__qaFrames++);
    window.__qaCreates = {}; for (const key of ['Events', 'Friends']) window.__game.scene.getScene(key).events.on('create', () => window.__qaCreates[key] = (window.__qaCreates[key] || 0) + 1);
  });
  const start = async (key, data = {}) => {
    await page.evaluate(({ key, data }) => { const current = window.__game.scene.getScenes(true).at(-1); current.scene.start(key, data); }, { key, data });
    await page.waitForFunction(key => window.__game.scene.getScenes(true).at(-1)?.scene.key === key, key, { timeout: 20000 });
    const frames = await page.evaluate(() => window.__qaFrames);
    await page.waitForFunction(frames => window.__qaFrames >= frames + 2, frames, { timeout: 20000 });
    await page.waitForTimeout(650);
  };
  const shot = async label => {
    const data = await page.evaluate(() => {
      const scene = window.__game.scene.getScenes(true).at(-1), v = window.__view(), scale = v.cssW / v.worldW, all = window.__qaWalk(scene.children.list);
      return { scene: scene.scene.key, view: v, rendererType:window.__game.renderer.type, webglVersion:window.__game.renderer.gl?.getParameter(window.__game.renderer.gl.VERSION), frames: window.__qaFrames, creates: window.__qaCreates, save: localStorage.getItem('chronoworld.save.v1'), writes: window.__qaSaveWrites.length,
        controls: all.filter(o => o.name && o.input?.hitArea).map(o => { const m = o.getWorldTransformMatrix(), b = o.getBounds(); return { name: o.name, width: o.input.hitArea.width * Math.hypot(m.a,m.b) * scale, height: o.input.hitArea.height * Math.hypot(m.c,m.d) * scale, y: m.ty, bounds: { top:b.top,bottom:b.bottom,left:b.left,right:b.right } }; }),
        named: all.filter(o => o.name).map(o => { const b = o.getBounds?.(); return { name:o.name,text:o.text,y:o.getWorldTransformMatrix?.().ty,bounds:b?{top:b.top,bottom:b.bottom,left:b.left,right:b.right}:null }; }),
        fonts: all.filter(o => o.type === 'Text').map(o => ({ text:o.text,size:parseFloat(o.style.fontSize)*Math.hypot(o.getWorldTransformMatrix().a,o.getWorldTransformMatrix().b)*scale })),
        clips: all.filter(o => o.getData?.('clip')).map(o => ({ name:o.name,clip:o.getData('clip'),y:o.y })), calls:window.__qaTransport.calls.map(c=>c.action) };
    });
    report.steps.push({ label,...data });
    await page.screenshot({ path: resolve(out, `${label}.png`) });
    return data;
  };
  const inset = async top => { await page.evaluate(top => { window.Telegram.WebApp.contentSafeAreaInset.top = top - 47; for (const fn of window.__tgEvents.contentSafeAreaChanged || []) fn(); }, top); await page.waitForTimeout(250); };
  const check = (label, condition) => { report.assertions.push({ label, passed:!!condition }); assert(condition, label); };
  const waitScene = key => page.waitForFunction(key => window.__game.scene.getScenes(true).at(-1)?.scene.key === key, key, { timeout:20000 });
  const quiet = async () => { const frames = await page.evaluate(() => window.__qaFrames); await page.waitForFunction(frames => window.__qaFrames >= frames + 2,frames,{timeout:20000}); await page.waitForTimeout(400); };
  const targetPoint = (name, segment = null) => page.evaluate(({ name, segment }) => {
    const scene = window.__game.scene.getScenes(true).at(-1), all = window.__qaWalk(scene.children.list);
    let node = all.find(o => o.name === name && o.scene);
    if (!node) throw Error(`Нет ${name} в ${scene.scene.key}`);
    if (segment !== null) node = node.list.filter(o => o.type === 'Zone')[segment];
    else if (!node.input && node.list) node = window.__qaWalk(node.list).find(o => o.input?.enabled) || node;
    if (!node) throw Error(`Нет цели ввода ${name}`);
    const m = node.getWorldTransformMatrix(), v = window.__view(), scale = v.cssW / v.worldW;
    let clip = null; for (let parent=node.parentContainer;parent;parent=parent.parentContainer) if(parent.getData('clip')) { clip=parent.getData('clip');break; }
    window.__qaTarget = node;
    return { x:v.cssLeft+(m.tx-v.worldX)*scale, y:v.cssTop+(m.ty-v.worldY)*scale, wy:m.ty, clip, scale, cssTop:v.cssTop,worldY:v.worldY };
  }, { name,segment });
  const reveal = async (name, segment = null) => {
    for(let i=0;i<24;i++) {
      const p=await targetPoint(name,segment);
      if(!p.clip || (p.wy>=p.clip[0]+68 && p.wy<=p.clip[1]-68)) return p;
      const mid=(p.clip[0]+p.clip[1])/2;
      await page.mouse.move(width/2,p.cssTop+(mid-p.worldY)*p.scale);
      await page.mouse.wheel(0,Math.max(-450,Math.min(450,p.wy-mid)));
      await page.waitForTimeout(90);
    }
    throw Error(`Не удалось прокрутить к ${name}`);
  };
  const tap = async (name, segment = null, pause = 380) => {
    const p=await reveal(name,segment);
    await page.mouse.move(p.x,p.y); await page.waitForTimeout(50);
    const hit=await page.evaluate(() => {
      const scene=window.__game.scene.getScenes(true).at(-1),pointer=scene.input.activePointer;
      const hits=scene.input.manager.hitTest(pointer,scene.input._list,scene.cameras.main);
      scene.input.sortGameObjects(hits);
      return { expected:window.__qaTarget?.name,top:hits[0]?.name,matches:hits[0]===window.__qaTarget };
    });
    check(`native hit ${name}${segment===null?'':`[${segment}]`}`,hit.matches);
    await page.mouse.click(p.x,p.y); if(pause) await page.waitForTimeout(pause);
  };
  const sdkBack = async expected => { await page.evaluate(() => { const callbacks=[...window.__tgBack]; if(!callbacks.length) throw Error('Нет SDK Back callback'); callbacks.forEach(fn=>fn()); }); await waitScene(expected); await quiet(); };
  const state = () => page.evaluate(() => {
    const scene=window.__game.scene.getScenes(true).at(-1);
    return { scene:scene.scene.key,creates:window.__qaCreates,save:localStorage.getItem('chronoworld.save.v1'),writes:window.__qaSaveWrites.length,opts:scene.opts,tab:scene.tab,day:scene.day,offset:scene.area?.offset,calls:window.__qaTransport.calls.map(c=>c.action) };
  });
  const count = action => page.evaluate(action => window.__qaTransport.calls.filter(c=>c.action===action).length,action);
  const config = changes => page.evaluate(changes => Object.assign(window.__qaTransport,changes),changes);
  const release = async (action,index=0) => { await page.evaluate(({action,index})=>{const t=window.__qaTransport; const matches=t.pending.filter(p=>p.action===action),p=matches[index];if(!p)throw Error(`Нет pending ${action}[${index}]`);t.pending=t.pending.filter(q=>q!==p);p.resolve();},{action,index}); await page.waitForTimeout(180); };
  const reloadCase = async qaCase => {
    const next=new URL(url);next.searchParams.set('qaCase',qaCase);
    await page.goto(next.href,{waitUntil:'domcontentloaded',timeout:120000});
    await page.waitForFunction(()=>window.__game?.scene&&!window.__game.scene.isActive('Boot')&&window.__game.scene.getScenes(true).some(s=>s.scene.key!=='Boot'),null,{timeout:120000});
    await page.evaluate(()=>{
      window.__qaWalk=list=>list.flatMap(o=>[o,...(o.list?window.__qaWalk(o.list):[])]);
      window.__qaFrames=0;window.__game.events.on('postrender',()=>window.__qaFrames++);
      window.__qaCreates={};for(const key of ['Events','Friends'])window.__game.scene.getScene(key).events.on('create',()=>window.__qaCreates[key]=(window.__qaCreates[key]||0)+1);
    }); await quiet();
  };
  await start('Events'); await shot('events-login-before');
  await start('Events', { tab:'newbie' }); await shot('events-newbie-before');
  await start('Friends'); await shot('friends-list-before');
  await start('Friends', { tab:'records',board:'tower' }); const boardBefore = await shot('friends-records-before');
  await inset(156); const boardAfter = await shot('friends-records-shorter');
  report.baselineFindings = {
    boardBottomBefore: boardBefore.named.find(o=>o.name==='myPlace')?.bounds?.bottom,
    boardBottomAfter: boardAfter.named.find(o=>o.name==='myPlace')?.bounds?.bottom,
    safeContentBottomAfter: boardAfter.view.safeBottom - 190,
    minFontCSS: Math.min(...boardAfter.fonts.map(t=>t.size)),
  };
  if (!baseline) assert(report.baselineFindings.boardBottomAfter <= report.baselineFindings.safeContentBottomAfter + 1, 'myPlace перекрывает нижнюю навигацию после TG inset');
  if (!baseline) {
    const before=await state();await inset(136);await quiet();const after=await state();
    check('TG resize preserves Friends save/write counters/scene/selection',before.save===after.save&&before.writes===after.writes&&JSON.stringify(before.creates)===JSON.stringify(after.creates)&&JSON.stringify(before.opts)===JSON.stringify(after.opts));
    await tap('boardTabs',1);await quiet();let selected=await state();check('native board selection',selected.opts.board==='progress');
    await tap('scopeTabs',1);await quiet();selected=await state();check('native scope selection',selected.opts.scope==='friends');
    await page.mouse.move(width/2,420);await page.mouse.wheel(0,650);await quiet();
    const scrolled=await state();check('native records scroll',scrolled.offset>0);
    await page.setViewportSize({width:width===360?390:360,height:720});await quiet();let resized=await state();
    check('window resize preserves Friends save/create/selection and scroll',scrolled.save===resized.save&&scrolled.writes===resized.writes&&JSON.stringify(scrolled.creates)===JSON.stringify(resized.creates)&&JSON.stringify(scrolled.opts)===JSON.stringify(resized.opts)&&resized.offset>0);
    await page.setViewportSize({width,height:640});await quiet();await shot('friends-records-resized');
    await sdkBack('Home');check('SDK Back to root hides BackButton',await page.evaluate(()=>!window.Telegram.WebApp.BackButton.visible));

    await start('Events',{tab:'login'});await tap('loginClaim_1',null,0);await waitScene('Events');await quiet();
    let claimed=JSON.parse((await state()).save);check('login reward exactly once',claimed.events.loginClaimed.filter(d=>d===1).length===1&&claimed.resources.gold===1000&&claimed.currency.scrolls===1);
    const writes=(await state()).writes;await tap('loginDay_1');check('already claimed login has no write',(await state()).writes===writes);
    await tap('loginDay_7');check('locked login explains without reward',JSON.stringify(JSON.parse((await state()).save).events.loginClaimed)===JSON.stringify(claimed.events.loginClaimed));
    await shot('events-login-bottom');
    let eventState=await state();await inset(156);await quiet();let eventResized=await state();
    check('Events resize keeps save/create/tab/day/scroll',eventState.save===eventResized.save&&eventState.writes===eventResized.writes&&JSON.stringify(eventState.creates)===JSON.stringify(eventResized.creates)&&eventState.tab===eventResized.tab&&eventState.day===eventResized.day&&eventResized.offset>0);
    await tap('eventsTabs',1);await quiet();await tap('nbDays',6);await quiet();await reveal('nbLockedDay');
    const locked=await shot('events-newbie-day7-locked');check('locked day explanation visible',locked.named.some(n=>n.name==='nbLockedDay'&&n.text.includes('Откроется')));
    await tap('nbDays',0);await quiet();
    const taskPoint=await reveal('nbTask_nb1_stages');
    await tap('nbTask_nb1_stages',null,0);await page.waitForTimeout(100);await page.mouse.click(taskPoint.x,taskPoint.y);await quiet();
    check('rapid task double tap stays in Events',(await state()).scene==='Events');
    claimed=JSON.parse((await state()).save);check('newbie task counted once',claimed.events.newbieTasks.filter(id=>id==='nb1_stages').length===1);
    await shot('events-newbie-claimed');await sdkBack('Home');

    await reloadCase('day7');await start('Events',{tab:'login'});await tap('loginClaim_7',null,0);await waitScene('HeroPick');await quiet();
    const contract=await state();check('day7 contract reward is pending once',JSON.parse(contract.save).pendingPicks.length===1);
    await sdkBack('Events');const returned=await state();check('contract Back restores Events/save/scroll',returned.save===contract.save&&returned.tab==='login'&&returned.offset>0);await shot('events-contract-return');

    await reloadCase('friends-empty');await start('Friends',{tab:'friends'});await page.waitForFunction(()=>window.__qaWalk(window.__game.scene.getScenes(true).at(-1).children.list).some(o=>o.name==='friendsEmpty'),null,{timeout:15000});
    await tap('inviteFriend');check('invite uses fake SDK only',await page.evaluate(()=>window.__tgLinks.length===1&&window.__tgLinks[0].startsWith('https://t.me/share/url?')));await shot('friends-empty');

    await reloadCase('friends-error');await start('Friends',{tab:'friends'});await page.waitForFunction(()=>window.__qaWalk(window.__game.scene.getScenes(true).at(-1).children.list).some(o=>o.name==='friendsRetry'),null,{timeout:15000});
    await shot('friends-network-error');const failedCount=await count('friends');await tap('friendsRetry',null,0);await quiet();
    check('one native retry reloads friends',(await count('friends'))===failedCount+1);await shot('friends-retry-success');

    await reloadCase('board-empty');await start('Friends',{tab:'records',board:'mvp',scope:'friends'});await quiet();await shot('friends-board-empty');
    await reloadCase('board-error');await start('Friends',{tab:'records',board:'mvp',scope:'friends'});await quiet();await shot('friends-board-error');await tap('friendsRetry');await quiet();await shot('friends-board-retry');

    await reloadCase('offline');await start('Friends');await reveal('openBot');const offlineState=await state();await page.setViewportSize({width,height:500});await quiet();await tap('openBot');
    check('offline Friends keeps state and opens only fake SDK',(await state()).save===offlineState.save&&await page.evaluate(()=>window.__tgLinks.length===1));await shot('friends-offline-short');
    await sdkBack('Home');await page.setViewportSize({width,height:640});

    await reloadCase('requests');await start('Friends',{tab:'friends'});await quiet();
    const sends=await count('gift_send'), lockedWrites=(await state()).writes;
    await tap('ring_102');check('already sent bell explains without request/write',(await count('gift_send'))===sends&&(await state()).writes===lockedWrites);
    await config({holds:{gift_send:true}});await tap('ring_101',null,0);
    await page.waitForFunction(()=>window.__qaTransport.pending.filter(p=>p.action==='gift_send').length===1,null,{timeout:5000});
    await page.waitForTimeout(350);await tap('ring_101',null,0);
    check('repeated ring while pending has one request',(await count('gift_send'))===sends+1);
    await sdkBack('Home');await start('Friends',{tab:'friends'});await quiet();
    await tap('ring_103',null,0);await page.waitForFunction(()=>window.__qaTransport.pending.filter(p=>p.action==='gift_send').length===2,null,{timeout:5000});
    const freshState=await state();await release('gift_send',0);await tap('ring_104',null,0);
    check('old ring acknowledgement keeps new request busy',(await count('gift_send'))===sends+2&&JSON.stringify((await state()).creates)===JSON.stringify(freshState.creates));
    await release('gift_send',0);await config({holds:{}});await quiet();await tap('ring_103');
    check('successful new ring is sent once',(await count('gift_send'))===sends+2);await shot('friends-pending-acknowledged');

    await config({fail:{reward_claim:1}});const claimBefore=await state();await tap('bellsClaim');await quiet();
    check('failed gift claim leaves save intact',(await state()).save===claimBefore.save);await shot('friends-claim-error');
    await config({grantReady:true,holds:{reward_claim:true}});const claims=await count('reward_claim');
    await tap('bellsClaim',null,0);await page.waitForFunction(()=>window.__qaTransport.pending.some(p=>p.action==='reward_claim'),null,{timeout:5000});
    await page.waitForTimeout(350);await tap('bellsClaim',null,0);check('repeated gift claim has one request',(await count('reward_claim'))===claims+1);
    const gemsBefore=JSON.parse((await state()).save).currency.gems;
    await sdkBack('Home');await start('Friends',{tab:'records',board:'mvp',scope:'friends'});await quiet();const recordState=await state();
    await release('reward_claim');await config({holds:{}});await quiet();let granted=await state(), grantedSave=JSON.parse(granted.save);
    check('late gift grant applies once without changing new tab',granted.opts.tab==='records'&&JSON.stringify(granted.creates)===JSON.stringify(recordState.creates)&&grantedSave.currency.gems===gemsBefore+40&&grantedSave.online.appliedGrantIds.filter(id=>id==='00000000-0000-4000-8000-000000000007').length===1);
    await start('Friends',{tab:'friends'});await quiet();await tap('bellsClaim');await quiet();
    grantedSave=JSON.parse((await state()).save);check('replayed stable grant does not duplicate gems',grantedSave.currency.gems===gemsBefore+40);await shot('friends-grant-deduplicated');

    await reloadCase('stale-board');await config({holds:{board:true}});await start('Friends',{tab:'records',board:'tower'});
    await tap('boardTabs',0,0);await page.waitForFunction(()=>window.__qaTransport.pending.filter(p=>p.action==='board').length===2,null,{timeout:5000});
    const newBoard=await state();await release('board',0);await quiet();
    check('late old board does not paint over chosen board',(await state()).opts.board==='power'&&JSON.stringify((await state()).creates)===JSON.stringify(newBoard.creates)&&!await page.evaluate(()=>window.__qaWalk(window.__game.scene.getScenes(true).at(-1).children.list).some(o=>o.name==='boardWeek')));
    await release('board',0);await config({holds:{}});await quiet();await shot('friends-board-stale-result');
    await tap('backButton');await waitScene('Home');await quiet();check('native header Back reaches parent root',(await state()).scene==='Home');

    for(const step of report.steps.filter(step=>['Events','Friends'].includes(step.scene))) {
      check(`${step.label} actual renderer`,step.rendererType===(renderer==='canvas'?1:2));
      check(`${step.label} adaptive layout`,step.view.adaptive);
      check(`${step.label} fonts >=12CSS`,step.fonts.every(font=>font.size>=11.99));
      for(const control of step.controls.filter(control=>control.name.startsWith('ring_')||control.name==='friendsRetry'||control.name==='bellsClaim'||control.name==='openBot')) check(`${step.label} ${control.name} >=44CSS`,control.width>=43.99&&control.height>=43.99);
    }
    const endingHashes=Object.fromEntries(Object.keys(report.sourceHashes).map(p=>[p,createHash('sha256').update(readFileSync(new URL(`../${p}`,import.meta.url))).digest('hex')]));
    check('owned source hashes unchanged through browser run',JSON.stringify(endingHashes)===JSON.stringify(report.sourceHashes));
  }
  assert.deepEqual(report.errors, [], 'Ошибки браузера');
  assert.deepEqual(report.blockedExternal, [], 'Продукт попытался выполнить внешний запрос в offline fixture');
  report.passed = true;
} catch(error) { report.failure = error.stack || String(error); }
finally { clearTimeout(deadline); await context?.close(); await browser.close(); writeFileSync(resolve(out,'report.json'), JSON.stringify(report,null,2)+'\n'); }
console.log(JSON.stringify({ passed:report.passed,baselineFindings:report.baselineFindings,steps:report.steps.length,errors:report.errors.length,failure:report.failure,out },null,2));
if (!report.passed) process.exitCode = 1;
