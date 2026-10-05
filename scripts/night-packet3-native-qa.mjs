import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const opt = name => { const n = process.argv.indexOf('--' + name); return n < 0 ? undefined : process.argv[n + 1]; };
const ROOT = opt('root') ?? '/workspace/chronoworld';
const URL = opt('url') ?? 'http://127.0.0.1:5595/';
const ORIGIN = new globalThis.URL(URL);
const WIDTH = Number(opt('width') ?? 360), HEIGHT = Number(opt('height') ?? 640);
const RENDERER = opt('renderer') ?? 'canvas', SCOPE = opt('scope') ?? 'ascend';
const OUT = opt('out') ?? '/tmp/night-packet3-native-' + SCOPE + '-' + WIDTH + '-' + RENDERER;
const BASE = opt('save') ?? path.join(ROOT, 'docs/REPORTS/2026-10-05-night-adventure-modes/fixtures/lawful-36.save.json');
const CLOCK = opt('clock') ?? BASE.replace('.save.json', '.clock.json');
if (ORIGIN.search || ORIGIN.hash) throw Error('URL must not have query flags/hash');
if (!['ascend','sources','confirm','triple','full','late'].includes(SCOPE) || !['canvas','webgl'].includes(RENDERER)) throw Error('Unsupported scope or renderer');
fs.mkdirSync(OUT, { recursive: true });
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { started: new Date().toISOString(), url: URL, width: WIDTH, height: HEIGHT, renderer: RENDERER, scope: SCOPE, method: 'Private standalone stock UI fixture based on lawful campaign snapshot; normal Boot and actual navigation; compiled response only appends read-only observers; no scene forcing, browser core execution, source imports or query flags.', failures: [], errors: [], blocked: [], sourceRequests: [], bundles: {}, interactions: [], snapshots: [], checks: [] };
const assert = (condition, message) => { if (!condition) throw Error(message); report.checks.push(message); };
const clock = JSON.parse(fs.readFileSync(CLOCK, 'utf8'));
const rootRequire = createRequire(ROOT + '/package.json');
const { tsImport } = rootRequire('tsx/esm/api');
const [{ loadFullContext }, C] = await Promise.all([tsImport(ROOT + '/scripts/lib/content-node.ts', import.meta.url), tsImport(ROOT + '/src/core/index.ts', import.meta.url)]);
const GAME = loadFullContext();
const baseRaw = fs.readFileSync(BASE, 'utf8');
let save = C.deserialize(baseRaw, clock.day);
const originalClears = JSON.stringify(save.campaign.cleared);
const target = save.heroes.find(h => h.templateId === 'alan' && h.companion) ?? save.heroes.find(h => h.templateId === 'alan');
const targetId = target.id;
const fodderIds = [];
if (SCOPE !== 'late') {
save = { ...save, resources: { ...save.resources, gold: 100000000, heroExp: 100000000 } };
save = C.levelUpHero(save, targetId, GAME, 20 - target.level).save;
const greenIds = [];
for (let i = 0; i < 2; i++) { const card = C.addHeroCard(save, 'alan', 'green', { isNew: false }); save = card.save; greenIds.push(card.hero.id); }
save = C.ascendHero(save, targetId, greenIds, GAME).save;
for (let i = 0; i < 2; i++) { const card = C.addHeroCard(save, 'alan', 'blue', { isNew: false }); save = card.save; fodderIds.push(card.hero.id); }
save = C.ascendHero(save, targetId, fodderIds, GAME, { branch: 'knight' }).save;
fodderIds.length = 0;
for (let i = 0; i < 2; i++) { const card = C.addHeroCard(save, 'alan', 'purple', { isNew: false }); save = card.save; fodderIds.push(card.hero.id); }
const other = save.heroes.find(h => h.templateId === 'vika');
save = C.setSquad(save, [targetId, null, null, null, other.id]);
save = C.grantRewards(save, { heroPicks: [{ rarity: 'purple' }, { rarity: 'blue' }] }, GAME, 'private-independent-packet3-ui').save;
}
save = C.markUnlocksSeen(save, C.pendingUnlocks(save, GAME).map(f => f.id));
if (JSON.stringify(save.campaign.cleared) !== originalClears) throw Error('Fixture must preserve lawful campaign clears');
const raw = C.serialize(save);
fs.writeFileSync(OUT + '/fixture.save.json', raw);
report.fixture = { base: BASE, baseSha256: sha(baseRaw), clock, campaignClears: save.campaign.cleared.length, stock: SCOPE !== 'late', operations: SCOPE==='late'?'Lawful save; deserialize and public markUnlocksSeen only, no stock/campaign/resource changes':'Stock gold/heroExp only; public addHeroCard/levelUpHero/ascendHero/setSquad/grantRewards/markUnlocksSeen, no campaign alteration', sha256: sha(raw), targetId, fodderIds };
const adapterBytes=fs.readFileSync(fileURLToPath(import.meta.url));report.adapterSha256=sha(adapterBytes);fs.writeFileSync(OUT+'/adapter.mjs',adapterBytes);
report.rootCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const packetFiles = ['src/game/viewLayout.ts','src/game/viewport.ts','src/game/screen.ts','src/game/modalBack.ts','src/game/scenes/HeroesScene.ts','src/game/scenes/HeroScene.ts','src/game/scenes/AscendScene.ts','src/game/scenes/HeroPickScene.ts','src/game/scenes/StageScene.ts','src/game/scenes/SquadScene.ts','src/game/squadEditor.ts','src/game/squadPresets.ts','src/game/prepLayout.ts'];
report.sourceHashes = Object.fromEntries(packetFiles.map(f => [f, sha(fs.readFileSync(path.join(ROOT, f)))]));
const picks = C.pendingPicks(save), pickTid = picks.length?C.pickOptions(picks[0], GAME).at(-1):undefined;
const pickBranch = pickTid?GAME.content.heroes[pickTid].branches[0].job:undefined;
report.fixture.pickTid = pickTid; report.fixture.pickBranch = pickBranch;
const stageId = GAME.content.stages.find(s=>C.stageStatus(save,s.id,GAME)==='open')?.id;
report.fixture.stageId=stageId;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
let browser, context, page;
const deadline = setTimeout(async () => { report.failures.push('Bounded native QA deadline exceeded'); report.timedOut = true; flush(); await context?.close().catch(()=>{}); await browser?.close().catch(()=>{}); }, Number(opt('deadline-ms') ?? 180000));
function flush() { fs.writeFileSync(OUT + '/report.json', JSON.stringify(report, null, 2)); }
async function current(key) {
  return page.evaluate(key => {
    const game = window.__packetGame, scene = game.scene.getScene(key), all = list => list.flatMap(o => o.list ? [o, ...all(o.list)] : [o]);
    const area = scene.tabArea ?? scene.body ?? scene.area;
    const clip = area?.content.getData('clip');
    if (!window.__packetIds.has(scene)) window.__packetIds.set(scene, ++window.__packetSeq);
    if (!window.__packetIds.has(scene.cameras.main)) window.__packetIds.set(scene.cameras.main, ++window.__packetSeq);
    const modalHits=scene.children.list.filter(o=>o.getData?.('screenModal')).flatMap(layer=>all([layer]).filter(o=>o.type==='Graphics'&&o.input?.hitArea).map(o=>{const r=o.input.hitArea,m=o.getWorldTransformMatrix();const p=m.transformPoint(r.x,r.y),q=m.transformPoint(r.x+r.width,r.y+r.height);return {layer:layer.name,type:o.type,rect:{x:r.x,y:r.y,width:r.width,height:r.height},world:{x:p.x,y:p.y,right:q.x,bottom:q.y},parent:o.parentContainer?.name,parentPosition:{x:o.parentContainer?.x,y:o.parentContainer?.y}};}));
    return { active: game.scene.getScenes(true).map(s => s.scene.key), renderer: game.renderer.type, glVersion: game.renderer.gl?.getParameter(game.renderer.gl.VERSION), view: window.__packetView(), identity: window.__packetIds.get(scene), cameraIdentity: window.__packetIds.get(scene.cameras.main), frames: window.__packetFrames, cameraFrames: window.__packetCameraFrames[key], saved: localStorage.getItem('chronoworld.save.v1'), stageId: scene.stageId, heroId: scene.heroId, tab: scene.tab, selected: scene.selected ?? scene.editor?.selected, chosen: scene.chosen, branch: scene.branch, back: scene.back, bodyOffset: area?.offset, bodyClip: clip, bodyMax: area && clip ? Math.max(0, area.height - (clip[1] - clip[0])) : undefined, bodyLocked: area?.locked, editorLocked: scene.editor?.locked, modals: scene.children.list.filter(o => o.getData?.('screenModal')).map(o => o.name), modalHits, tg: { visible: window.__packetTg.visible, handlers: window.__packetTg.handlers.size }, texts: all(scene.children.list).filter(o => o.type === 'Text').map(o => ({ name: o.name, text: o.text })) };
  }, key);
}
async function ready(key) {
  await page.waitForFunction(key => {
    const g = window.__packetGame, v = window.__packetView?.();
    if (!g || !v || !g.input.enabled || g.scene.getScenes(true).map(s => s.scene.key).join(',') !== key) return false;
    const s = g.scene.getScene(key); if (!s.input.enabled) return false;
    const all = list => list.flatMap(o => o.list ? [o, ...all(o.list)] : [o]);
    for (const layer of s.children.list.filter(o => o.getData?.('screenModal'))) for (const o of all([layer])) {
      if (o.name === 'popInner' && (o.alpha < .995 || Math.abs(o.scaleX - 1) > .002 || Math.abs(o.scaleY - 1) > .002)) return false;
    }
    const camera = s.cameras.main, a = camera.getWorldPoint(0, 0), b = camera.getWorldPoint(v.backW, v.backH);
    return Math.abs(a.x - v.worldX) < 2 && Math.abs(a.y - v.worldY) < 2 && Math.abs(b.x - v.worldX - v.worldW) < 2 && Math.abs(b.y - v.worldY - v.worldH) < 2;
  }, key, { timeout: 20000 });
  const before = await page.evaluate(key => {
    const s = window.__packetGame.scene.getScene(key);
    if (!window.__packetCameraObservers.has(s.cameras.main)) {
      window.__packetCameraObservers.add(s.cameras.main);
      s.cameras.main.on('postrender', () => window.__packetCameraFrames[key] = (window.__packetCameraFrames[key] ?? 0) + 1);
    }
    return { all: window.__packetFrames, camera: window.__packetCameraFrames[key] ?? 0 };
  }, key);
  await page.waitForFunction(({ key, before }) => window.__packetFrames > before.all + 1 && (window.__packetCameraFrames[key] ?? 0) > before.camera + 1, { key, before }, { timeout: 12000 });
}
async function object(key, name, byText = false) {
  return page.evaluate(({ key, name, byText }) => {
    const all = list => list.flatMap(o => o.list ? [o, ...all(o.list)] : [o]);
    const s = window.__packetGame.scene.getScene(key), v = window.__packetView();
    const o = all(s.children.list).filter(o => byText ? o.type === 'Text' && o.text === name : o.name === name).at(-1);
    if (!o) return null;
    let clip = [0, v.uiHeight], stable = true, visible = true;
    for (let p = o; p; p = p.parentContainer) {
      visible = visible && p.visible && p.alpha > .99;
      const c = p.getData?.('clip'); if (c) clip = c;
      if (p.name === 'popInner') stable = stable && Math.abs(p.scaleX - 1) < .002 && Math.abs(p.scaleY - 1) < .002 && p.alpha > .995;
    }
    const b = o.getBounds();
    let input = o; while (!input.input && input.parentContainer) input = input.parentContainer;
    return { name: o.name, text: o.text, clip, stable, visible, center: { x: b.centerX, y: b.centerY }, bounds: { x: b.x, y: b.y, width: b.width, height: b.height }, hitCss: (input.input?.hitArea?.height ?? b.height) * v.cssH / v.worldH, css: { x: v.cssLeft + (b.centerX - v.worldX) * v.cssW / v.worldW, y: v.cssTop + (b.centerY - v.worldY) * v.cssH / v.worldH }, view: v };
  }, { key, name, byText });
}
async function tap(key, name, byText = false) {
  await ready(key);
  let target;
  for (let i = 0; i < 45; i++) {
    target = await object(key, name, byText);
    if (!target) throw Error('Missing native target ' + key + '/' + name);
    const half = Math.min(66, target.bounds.height / 2);
    if (target.stable && target.visible && target.center.y >= target.clip[0] + half - 1 && target.center.y <= target.clip[1] - half + 1) break;
    if (!target.stable || !target.visible) { await pause(100); continue; }
    const v = target.view, y = (target.clip[0] + target.clip[1]) / 2;
    await page.mouse.move(v.cssLeft + v.cssW / 2, v.cssTop + (y - v.worldY) * v.cssH / v.worldH);
    await page.mouse.wheel(0, target.center.y > target.clip[1] - half ? 150 : -150);
    await pause(100);
    if (i === 44) throw Error('Native target unreachable ' + key + '/' + name);
  }
  assert(target.stable && target.visible, 'Ready native target ' + key + '/' + name);
  await page.mouse.click(target.css.x, target.css.y);
  report.interactions.push({ kind: 'native-click', key, name, target });
  await pause(220);
  return target;
}
async function snapshot(key, name) {
  await ready(key); const state = await current(key);
  await page.screenshot({ path: OUT + '/' + name + '.png' });
  report.snapshots.push({ name, key, savedSha256: sha(state.saved), ...state, saved: undefined }); flush(); return state;
}
async function back(key, expected) {
  await ready(key);
  const tg = (await current(key)).tg;
  assert(tg.visible && tg.handlers === 1, 'Exactly one visible TGBack handler on ' + key);
  await page.evaluate(() => [...window.__packetTg.handlers].forEach(fn => fn()));
  await ready(expected);
  report.interactions.push({ kind: 'sdk-back', key, expected });
}
async function setup() {
  const remote = !['127.0.0.1','localhost'].includes(ORIGIN.hostname);
  const proxy = remote && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
  browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH ?? '/usr/bin/chromium', proxy, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await context.route('**/*', async route => {
    const req = route.request(), url = new globalThis.URL(req.url());
    if (url.pathname.endsWith('/telegram-web-app.js')) return route.fulfill({ contentType: 'application/javascript', body: '' });
    if (url.origin !== ORIGIN.origin || !['GET', 'HEAD'].includes(req.method())) { report.blocked.push({ url: url.origin + url.pathname, method: req.method() }); return route.abort(); }
    if (url.pathname.startsWith('/src/') || url.pathname.includes('/@vite/')) { report.sourceRequests.push(url.pathname); return route.abort(); }
    if (/\/assets\/index-[^/]+\.js$/.test(url.pathname)) {
      const response = await route.fetch(), code = await response.text();
      const game = /([\w$]+)=new\s*[\w$.]+\.Game\(\{type:/.exec(code), view = /function [\w$]+\(\)\{return ([\w$]+)\.adaptive\?Math.max\(/.exec(code);
      if (!game || !view) throw Error('Compiled observer match failed');
      report.bundles[url.pathname] = sha(code);
      if(opt('bundle-sha')&&report.bundles[url.pathname]!==opt('bundle-sha')) throw Error('Remote bundle SHA differs from expected production build');
      return route.fulfill({ response, body: code + ';window.__packetGame=' + game[1] + ';window.__packetView=()=>'+view[1]+';window.__packetFrames=0;window.__packetCameraFrames={};window.__packetCameraObservers=new WeakSet();window.__packetIds=new WeakMap();window.__packetSeq=0;window.__packetGame.events.on("postrender",renderer=>{if(renderer)window.__packetFrames++});' });
    }
    return route.continue();
  });
  await context.addInitScript(({ raw, clock, renderer }) => {
    localStorage.setItem('chronoworld.save.v1', raw);
    const hints = ['home_campaign','stage_fight','prep_auto','battle_speed','result_next','result_home','chest_claim','level_up','tavern_summon','ascend','fast_rewards','quests_open','tower_open','equip_gear','branch_pick','tip_tower','tip_hunt','tip_evening','tip_expedition','tip_boss_charge'];
    localStorage.setItem('chronoworld.hints', JSON.stringify(hints)); localStorage.setItem('chronoworld.hintsShown', JSON.stringify(hints)); localStorage.setItem('chronoworld.reduceMotion', '1');
    const RealDate = Date, realStart = RealDate.now();
    const advancingNow = () => clock.now + RealDate.now() - realStart;
    window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [advancingNow()])); } static now() { return advancingNow(); } };
    if (renderer === 'canvas') {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /^(webgl2?|experimental-webgl)$/.test(type) ? null : original.call(this, type, ...args); };
    } else {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type === 'webgl2' ? null : original.call(this, type, ...args); };
    }
    const state = { visible: false, handlers: new Set(), events: {} }; window.__packetTg = state;
    window.Telegram = { WebApp: { version: '8.0', platform: 'ios', initData: '', isFullscreen: true, safeAreaInset: { top: 24, bottom: 34, left: 0, right: 0 }, contentSafeAreaInset: { top: 112, bottom: 0, left: 0, right: 0 }, onEvent(name, fn) { (state.events[name] ??= new Set()).add(fn); }, offEvent(name, fn) { state.events[name]?.delete(fn); }, BackButton: { show() { state.visible = true; }, hide() { state.visible = false; }, onClick(fn) { state.handlers.add(fn); }, offClick(fn) { state.handlers.delete(fn); } } } };
  }, { raw, clock, renderer: RENDERER });
  page = await context.newPage();
  page.on('pageerror', e => { report.errors.push(e.stack ?? String(e)); flush(); });
  page.on('console', m => { if (m.type() === 'error') { const location=m.location(); if (m.text().includes('Failed to load resource') && report.blocked.some(b=>b.url===location.url)) { (report.expectedBlockedConsole ??= []).push({text:m.text(),location}); } else { report.errors.push({text:m.text(),location}); } flush(); } });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__packetGame?.scene && window.__packetGame.scene.isActive('Campaign'), null, { timeout: 120000 });
  await ready('Campaign');
  let quiet=0;
  for (let i = 0; i < 16; i++) {
    const s = await current('Campaign');
    const skip = s.texts.find(t => t.text === 'Позже' || t.text === 'Пропустить');
    if (skip) { quiet=0;await tap('Campaign',skip.text,true); } else { quiet=s.modals.length?0:quiet+1;await pause(350);if(quiet>=3)break; }
  }
  assert(quiet>=3,'Normal Boot startup overlays actually settled before native navigation');
  const boot=await snapshot('Campaign','boot-campaign');
  assert(RENDERER==='canvas'?boot.renderer===1:boot.renderer===2&&boot.glVersion?.includes('WebGL 1.0'),'Actual requested renderer reached normal Boot '+RENDERER);
  await tap('Campaign', 'Герои', true); await ready('Heroes');
  if (SCOPE === 'late') return;
  await tap('Heroes', 'heroCard_' + targetId); await ready('Hero');
  await tap('Hero', 'ascendBtn'); await ready('Ascend');
}
async function sourcesProbe() {
  if (WIDTH > 360) { await page.setViewportSize({ width: 360, height: 640 }); await ready('Ascend'); }
  await tap('Ascend', 'copySources');
  const before = await snapshot('Ascend', 'ascend-sources-before-wheel');
  assert(before.modals.includes('noticeModal') && before.bodyMax > 0, 'Actual Ascend sources notice and meaningful scrollable body');
  const paragraph = before.texts.find(t => t.text.startsWith('Карты этого героя'));
  const title = await object('Ascend', paragraph?.text, true);
  assert(title && title.stable && title.visible && title.center.y > before.bodyClip[0] && title.center.y < before.bodyClip[1], 'Actual sources body text is inside underlying body clip');
  await page.mouse.move(title.css.x, title.css.y);
  const wheelDelta = before.bodyOffset > 0 ? -180 : 180;
  await page.mouse.wheel(0, wheelDelta); await pause(250);
  const after = await snapshot('Ascend', 'ascend-sources-after-wheel');
  report.sourcesWheel = { beforeOffset: before.bodyOffset, afterOffset: after.bodyOffset, bodyMax: before.bodyMax, wheelDelta, delta: after.bodyOffset - before.bodyOffset, exactSave: before.saved === after.saved, beforeLocked: before.bodyLocked, afterLocked: after.bodyLocked, pointerWorldY: title.center.y, modals: after.modals };
  const swiped=await modalSwipe('Ascend',title,'ascend-sources-after-touch');
  report.sourcesTouch={beforeOffset:after.bodyOffset,afterOffset:swiped.bodyOffset,delta:swiped.bodyOffset-after.bodyOffset,exactSave:after.saved===swiped.saved,modals:swiped.modals};
  assert(swiped.modals.includes('noticeModal')&&swiped.saved===after.saved&&swiped.bodyOffset===after.bodyOffset,'Sources modal native touch keeps exact body offset/save and notice open');
  await back('Ascend', 'Ascend');
  const closed = await snapshot('Ascend', 'ascend-sources-after-back');
  assert(!closed.modals.length && !closed.bodyLocked, 'TGBack closes sources notice and restores Ascend input');
  assert(before.saved === after.saved && after.saved === closed.saved, 'Sources modal wheel and cancel preserve exact save');
  assert(before.bodyOffset === after.bodyOffset && after.bodyOffset === closed.bodyOffset, 'Sources modal wheel and cancel preserve underlying Ascend body offset');
}
async function confirmProbe() {
  if (WIDTH > 360) { await page.setViewportSize({ width: 360, height: 640 }); await ready('Ascend'); }
  await tap('Ascend','autoFodder'); await ready('Ascend');
  const selected=await current('Ascend'); assert(selected.chosen?.length>0,'Native AutoFodder selected actual eligible copies');
  await tap('Ascend','ascendConfirm');
  const before=await snapshot('Ascend','ascend-confirm-before-wheel');
  assert(before.modals.includes('confirmModal')&&before.bodyMax>0,'Actual final Ascend confirmation and meaningful scrollable body');
  const question=before.texts.find(t=>t.text.startsWith('Алан:'));
  const target=await object('Ascend',question?.text,true);
  assert(target&&target.stable&&target.visible&&target.center.y>before.bodyClip[0]&&target.center.y<before.bodyClip[1],'Actual promotion confirmation text is inside underlying body clip');
  await page.mouse.move(target.css.x,target.css.y); const wheelDelta=before.bodyOffset>0?-180:180;
  await page.mouse.wheel(0,wheelDelta);await pause(250);
  const after=await snapshot('Ascend','ascend-confirm-after-wheel');
  report.confirmWheel={beforeOffset:before.bodyOffset,afterOffset:after.bodyOffset,bodyMax:before.bodyMax,wheelDelta,delta:after.bodyOffset-before.bodyOffset,exactSave:before.saved===after.saved,beforeLocked:before.bodyLocked,afterLocked:after.bodyLocked,pointerWorldY:target.center.y,chosen:after.chosen,modals:after.modals};
  const swiped=await modalSwipe('Ascend',target,'ascend-confirm-after-touch');
  report.confirmTouch={beforeOffset:after.bodyOffset,afterOffset:swiped.bodyOffset,delta:swiped.bodyOffset-after.bodyOffset,exactSave:after.saved===swiped.saved,chosen:swiped.chosen,modals:swiped.modals};
  assert(swiped.modals.includes('confirmModal')&&swiped.saved===after.saved&&swiped.bodyOffset===after.bodyOffset&&JSON.stringify(swiped.chosen)===JSON.stringify(after.chosen),'Final confirmation native touch keeps exact body offset/save/selection and modal open');
  await back('Ascend','Ascend');const closed=await snapshot('Ascend','ascend-confirm-after-back');
  assert(!closed.modals.length&&!closed.bodyLocked&&JSON.stringify(closed.chosen)===JSON.stringify(before.chosen),'TGBack cancels final promotion and preserves selected copies/restores input');
  assert(selected.saved===before.saved&&before.saved===after.saved&&after.saved===closed.saved,'Final promotion preview/wheel/cancel preserve exact save');
  assert(before.bodyOffset===after.bodyOffset&&after.bodyOffset===closed.bodyOffset,'Final promotion modal wheel/cancel preserve underlying Ascend body offset');
}
async function rapidConfirmProbe() {
  await tap('Ascend','autoFodder');await ready('Ascend');
  const before=await current('Ascend'), target=await object('Ascend','ascendConfirm');
  assert(before.chosen?.length>0&&target&&target.visible,'Rapid confirm starts from actual selected copies and visible CTA');
  await page.evaluate(()=>{
    const s=window.__packetGame.scene.getScene('Ascend');
    const state={destroyed:0,frames:[],refs:[]};window.__packetRapid=state;
    state.add=o=>{if(o.type!=='Container')return;state.refs.push(o);o.once('destroy',()=>{if(o.getData?.('screenModal'))state.destroyed++;});};
    state.frame=()=>state.frames.push(s.children.list.filter(o=>o.name==='confirmModal').length);
    s.events.on('addedtoscene',state.add);window.__packetGame.events.on('postrender',state.frame);
  });
  await page.mouse.dblclick(target.css.x,target.css.y,{delay:5});await ready('Ascend');
  const after=await snapshot('Ascend','ascend-native-rapid-confirm');
  const confirmCount=after.modals.filter(name=>name==='confirmModal').length;
  const observed=await page.evaluate(()=>{const r=window.__packetRapid,s=window.__packetGame.scene.getScene('Ascend');s.events.off('addedtoscene',r.add);window.__packetGame.events.off('postrender',r.frame);return {created:r.destroyed+s.children.list.filter(o=>o.getData?.('screenModal')).length,maxAlive:Math.max(0,...r.frames),frameSamples:r.frames.length};});
  assert(observed.created===1&&observed.maxAlive<=1&&observed.frameSamples>0,'Two real native CTA clicks create exactly one confirmation, with no overlapping layers');
  assert(confirmCount<=1&&before.saved===after.saved&&JSON.stringify(before.chosen)===JSON.stringify(after.chosen),'Native rapid doubleclick creates at most one confirmation and never spends/removes selected copies');
  if(confirmCount){await back('Ascend','Ascend');const closed=await current('Ascend');assert(!closed.modals.length&&!closed.bodyLocked&&closed.saved===before.saved,'Rapid confirmation cancels cleanly through native SDK Back');}
  report.interactions.push({kind:'native-rapid-ascend-cta',confirmCount,selected:after.chosen,exactSave:true,...observed});
}
async function modalSwipe(key,target,name) {
  const state=await current(key),deltaCss=state.bodyOffset>0?60:-60;
  const cdp=await context.newCDPSession(page),point={x:target.css.x,y:target.css.y};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,radiusX:1,radiusY:1,force:1,id:0}]});
  for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,y:point.y+deltaCss*i/8,radiusX:1,radiusY:1,force:1,id:0}]});await pause(15);}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();await pause(250);report.interactions.push({kind:'native-modal-touch',key,name,deltaCss,bodyOffset:state.bodyOffset,point});return snapshot(key,name);
}
async function invariantResize(key) {
  const originalSize = page.viewportSize(), before = await current(key);
  const alternative = originalSize.width === 360 ? { width: 390, height: 844 } : { width: 360, height: 640 };
  async function compare(after, previous, name) {
    assert(after.saved === previous.saved && after.identity === previous.identity && after.cameraIdentity === previous.cameraIdentity, name + ' preserves exact save/scene/camera in ' + key);
    for (const field of ['stageId','heroId','tab','selected','chosen','branch','back','modals','bodyLocked','editorLocked','tg']) assert(JSON.stringify(previous[field]) === JSON.stringify(after[field]), name + ' preserves ' + field + ' in ' + key);
    if (previous.bodyOffset !== undefined) assert(Math.abs(after.bodyOffset - Math.min(previous.bodyOffset, after.bodyMax)) < .01, name + ' preserves/clamps offset in ' + key);
    assert(after.frames > previous.frames && after.cameraFrames > previous.cameraFrames, name + ' has actual renderer/camera heartbeats in ' + key);
  }
  await page.setViewportSize(alternative); await ready(key); const resized = await snapshot(key, 'full-' + key + '-viewport-alt'); await compare(resized, before, 'Viewport resize');
  await page.setViewportSize(originalSize); await ready(key); const restored = await current(key); await compare(restored, resized, 'Viewport return');
  await page.evaluate(() => { window.Telegram.WebApp.contentSafeAreaInset.top = 132; for (const fn of window.__packetTg.events.contentSafeAreaChanged ?? []) fn(); });
  await ready(key); const inset = await current(key); await compare(inset, restored, 'Telegram safe-area event');
  assert(Math.abs(inset.view.cssTop - restored.view.cssTop - 20) < .5, 'Telegram event changes actual CSS top by20 in ' + key);
  await page.evaluate(() => { window.Telegram.WebApp.contentSafeAreaInset.top = 112; for (const fn of window.__packetTg.events.contentSafeAreaChanged ?? []) fn(); });
  await ready(key); const normal = await current(key); await compare(normal, inset, 'Telegram inset return');
  report.interactions.push({ kind: 'viewport-and-sdk-insets', key, before: { view: before.view, savedSha256: sha(before.saved), offset: before.bodyOffset }, after: { view: normal.view, savedSha256: sha(normal.saved), offset: normal.bodyOffset } });
}
async function readable(key) {
  const result = await page.evaluate(key => {
    const s=window.__packetGame.scene.getScene(key),v=window.__packetView(),all=list=>list.flatMap(o=>o.list?[o,...all(o.list)]:[o]);
    const visible=all(s.children.list).filter(o=>o.type==='Text'&&o.text&&o.visible&&o.alpha>.99).map(o=>{
      let show=true,scale=Math.abs(o.scaleY),clip=[0,v.uiHeight];
      for(let p=o.parentContainer;p;p=p.parentContainer){show=show&&p.visible&&p.alpha>.99;scale*=Math.abs(p.scaleY);if(p.getData?.('clip'))clip=p.getData('clip');}
      const b=o.getBounds();return {name:o.name,text:o.text,fontCss:parseFloat(o.style.fontSize)*scale*v.cssH/v.worldH,visible:show&&b.y>=0&&b.bottom<=v.uiHeight&&b.bottom>clip[0]&&b.y<clip[1]};
    }).filter(o=>o.visible);
    return {view:v,minimum:Math.min(...visible.map(t=>t.fontCss)),tiny:visible.filter(t=>t.fontCss<11.95),textCount:visible.length};
  },key);
  assert(result.view.adaptive && result.view.uiHeight < 1920 && result.textCount > 0 && !result.tiny.length, 'Production adaptive layout and visible text≥12CSS in ' + key + ': ' + JSON.stringify(result.tiny));
  (report.geometry ??= []).push({key,...result});
}
async function headerBalance(key) {
  const before=await current(key), saved=JSON.parse(before.saved);
  const target=await tap(key,'currencyBalanceTarget');
  assert(target.hitCss>=43.95,'Header balance action≥44CSS in '+key);
  const after=await current(key), message=after.texts.find(t=>t.text.startsWith('Баланс\n'))?.text;
  const digits=n=>String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g,'\u00a0');
  const expected='Баланс\nЗолото: '+digits(saved.resources.gold)+'\nГемы: '+digits(saved.currency.gems);
  assert(message?.replace(/\s/g,'')===expected.replace(/\s/g,''),'Header toast shows exact current gold and gems in '+key);
  assert(before.saved===after.saved,'Header balance toast preserves exact save in '+key);
  report.interactions.push({kind:'exact-header-balance',key,expected,message});
}
async function mouseSwap(key, from, to) {
  await ready(key);
  const before=await current(key), b=JSON.parse(before.saved);
  assert(b.squad[from]&&b.squad[to],'Actual swap starts with two occupied slots in '+key);
  const points=await page.evaluate(({key,from,to})=>{const s=window.__packetGame.scene.getScene(key),a=s.editor.slotPos(from),b=s.editor.slotPos(to),shift=s.body.content.y-s.body.top;return {from:{x:a.x,y:a.y+shift},to:{x:b.x,y:b.y+shift+70}};},{key,from,to});
  const v=before.view,css=p=>({x:v.cssLeft+(p.x-v.worldX)*v.cssW/v.worldW,y:v.cssTop+(p.y-v.worldY)*v.cssH/v.worldH});
  const a=css(points.from),z=css(points.to);
  assert(points.from.y>=before.bodyClip[0]&&points.from.y<=before.bodyClip[1]&&points.to.y>=before.bodyClip[0]&&points.to.y<=before.bodyClip[1],'Actual occupied slots visible before mouse swap in '+key);
  await page.mouse.move(a.x,a.y);await page.mouse.down();await ready(key);await page.mouse.move(z.x,z.y,{steps:8});await ready(key);await page.mouse.up();await ready(key);
  const after=await current(key), expected=[...b.squad];[expected[from],expected[to]]=[expected[to],expected[from]];
  const aSave=JSON.parse(after.saved);assert(JSON.stringify(aSave.squad)===JSON.stringify(expected),'Native immediate mouse swap '+from+'→'+to+' updates exact squad in '+key);
  const beforeOther={...b},afterOther={...aSave};delete beforeOther.squad;delete afterOther.squad;
  assert(JSON.stringify(beforeOther)===JSON.stringify(afterOther),'Native mouse swap preserves every other save field in '+key);
  report.interactions.push({kind:'native-mouse-swap',key,from,to,before:b.squad,after:aSave.squad,saveExceptSquadExact:true});
}
async function remainingFullFlow() {
  await invariantResize('Ascend'); await readable('Ascend');
  await back('Ascend','Hero'); await readable('Hero');
  await headerBalance('Hero'); await invariantResize('Hero');
  await tap('Hero','changeBranchBtn');
  let branch=await snapshot('Hero','full-hero-branch-modal');assert(branch.modals.includes('branchPicker')&&branch.bodyLocked,'Native Hero branch picker owns input');
  await invariantResize('Hero');
  await tap('Hero','branchDetails_knight');
  const nested=await snapshot('Hero','full-hero-branch-details');assert(nested.modals.includes('branchPicker')&&nested.modals.includes('branchDetailsSheet'),'Native nested branch details actually opened');
  await back('Hero','Hero');
  let closed=await current('Hero');assert(closed.modals.includes('branchPicker')&&!closed.modals.includes('branchDetailsSheet'),'TGBack closes exactly top nested branch sheet');
  await back('Hero','Hero');closed=await current('Hero');assert(!closed.modals.length&&!closed.bodyLocked&&closed.saved===branch.saved,'TGBack cancels branch picker without save change');
  await back('Hero','Heroes');await readable('Heroes');await headerBalance('Heroes');
  await tap('Heroes','classFilter');let rootModal=await snapshot('Heroes','full-heroes-root-modal');assert(rootModal.modals.length===1&&rootModal.bodyLocked&&rootModal.tg.handlers===1&&rootModal.tg.visible,'Root Heroes modal activates exactly one TGBack and locks list');
  await invariantResize('Heroes');await back('Heroes','Heroes');closed=await current('Heroes');assert(!closed.modals.length&&!closed.bodyLocked&&!closed.tg.visible&&closed.tg.handlers===0&&closed.saved===rootModal.saved,'TGBack closes root modal and hides SDKBack without changing save');
  await tap('Heroes','contractTile');await ready('HeroPick');await readable('HeroPick');
  await tap('HeroPick','pick_'+pickTid);const pickBefore=await current('HeroPick');assert(pickBefore.selected===pickTid,'Native contract tile selected');await invariantResize('HeroPick');
  const claimTarget=await tap('HeroPick','pickClaim');assert(claimTarget.hitCss>=43.95,'Contract claim action≥44CSS');
  await tap('HeroPick','branchName_'+pickBranch);await back('HeroPick','HeroPick');
  const pickCancelled=await current('HeroPick');assert(pickCancelled.selected===pickTid&&pickCancelled.saved===pickBefore.saved&&!pickCancelled.bodyLocked&&!pickCancelled.modals.length,'Contract branch cancel preserves selection and exact save');
  await tap('HeroPick','pickClaim');await tap('HeroPick','branchName_'+pickBranch);await tap('HeroPick','branchConfirm');
  await page.waitForFunction(()=>window.__packetGame.scene.getScene('HeroPick').children.list.some(o=>o.name==='pickReveal'),null,{timeout:12000});
  const claimed=await snapshot('HeroPick','full-contract-reveal');const expected=C.claimHeroPick(JSON.parse(pickBefore.saved),0,pickTid,pickBranch,GAME);
  assert(JSON.stringify(JSON.parse(claimed.saved))===JSON.stringify(JSON.parse(C.serialize(expected.save))),'Native contract commits exactly the public core expected save once');
  await invariantResize('HeroPick');await back('HeroPick','Hero');await back('Hero','Heroes');await tap('Heroes','Кампания',true);await ready('Campaign');
  await headerBalance('Campaign');await tap('Campaign','fightCta');await ready('Stage');await readable('Stage');
  let stage=await snapshot('Stage','full-stage-entry');assert(stage.stageId===stageId,'Campaign native Stage actually opened expected lawful stage');
  await invariantResize('Stage');await mouseSwap('Stage',0,4);await mouseSwap('Stage',4,0);
  const footer=await object('Stage','cta');assert(footer.hitCss>=43.95&&footer.center.y<footer.view.uiHeight,'Stage fight CTA visible and≥44CSS');
  await tap('Stage','stageScoutInfo');const scout=await current('Stage');assert(scout.modals.length&&scout.editorLocked&&scout.bodyLocked,'Native Stage scout locks editor and body');await invariantResize('Stage');await back('Stage','Stage');
  const stageClosed=await current('Stage');assert(!stageClosed.modals.length&&!stageClosed.editorLocked&&!stageClosed.bodyLocked&&stageClosed.saved===scout.saved,'Stage scout Back restores actual input without save change');
  await back('Stage','Campaign');await tap('Campaign','campaignSquadEdit');await ready('Squad');await readable('Squad');await invariantResize('Squad');
  await mouseSwap('Squad',0,4);await mouseSwap('Squad',4,0);await snapshot('Squad','full-squad-entry');
  const done=await tap('Squad','squadDone');assert(done.hitCss>=43.95,'Squad Done target≥44CSS');await ready('Campaign');const final=await snapshot('Campaign','full-final-native-campaign');assert(final.active.join(',')==='Campaign'&&!final.tg.visible&&!final.tg.handlers,'Native full navigation ends at actual root Campaign with SDKBack hidden');
}
async function lateFlow() {
  report.method='Private lawful late save without UI stock; normal Boot/native navigation; GET-only original compiled bundle with read-only observer append; advancing lawful clock, camera postrender and all modal popInner stability required.';
  await readable('Heroes');await headerBalance('Heroes');await invariantResize('Heroes');
  const card=await page.evaluate(()=>window.__packetGame.scene.getScene('Heroes').area.content.list.filter(o=>o.name?.startsWith('heroCard_')).at(-1)?.name);
  assert(card,'Late legal profile actually has collection cards');await tap('Heroes',card);await ready('Hero');await readable('Hero');await invariantResize('Hero');await snapshot('Hero','late-lawful-hero');
  await back('Hero','Heroes');await tap('Heroes','classFilter');const modal=await current('Heroes');assert(modal.modals.length&&modal.tg.visible&&modal.tg.handlers===1,'Late collection filter opens real root Telegram Back');
  await invariantResize('Heroes');await back('Heroes','Heroes');const final=await current('Heroes');assert(!final.modals.length&&!final.bodyLocked&&!final.tg.visible&&!final.tg.handlers&&final.saved===modal.saved,'Late root modal Back preserves exact save and restores root SDK state');
}
async function pickerProbe() {
  await snapshot('Ascend', 'ascend-before-picker');
  await tap('Ascend', 'fodderSlot_0');
  if (WIDTH > 360) {
    const original = await snapshot('Ascend', 'ascend-picker-before-viewport-resize');
    await page.setViewportSize({ width: 360, height: 640 }); await ready('Ascend');
    const resized = await snapshot('Ascend', 'ascend-picker-after-viewport-resize');
    assert(original.saved === resized.saved && original.identity === resized.identity && JSON.stringify(original.chosen) === JSON.stringify(resized.chosen) && JSON.stringify(original.modals) === JSON.stringify(resized.modals), 'Native viewport resize preserves Ascend scene/save/selection/modal');
  }
  const before = await snapshot('Ascend', 'ascend-picker-before-wheel');
  assert(before.modals.includes('fodderPicker'), 'Actual Ascend fodder picker opened');
  assert(before.bodyMax > 0, 'Underlying Ascend body is actually scrollable for meaningful modal isolation probe');
  const header = await object('Ascend', 'Алан, фиолетовый', true);
  assert(header && header.stable && header.visible, 'Native fodder header present and stable');
  const v = before.view, worldY = header.center.y;
  assert(worldY > before.bodyClip[0] && worldY < before.bodyClip[1], 'Fodder modal header intersects underlying body clip for meaningful wheel/touch probe');
  await page.mouse.move(header.css.x, header.css.y);
  const wheelDelta = before.bodyOffset > 0 ? -180 : 180;
  await page.mouse.wheel(0, wheelDelta); await pause(250);
  const after = await snapshot('Ascend', 'ascend-picker-after-wheel');
  report.backgroundWheel = { beforeOffset: before.bodyOffset, afterOffset: after.bodyOffset, bodyMax: before.bodyMax, wheelDelta, delta: after.bodyOffset - before.bodyOffset, exactSave: before.saved === after.saved, beforeLocked: before.bodyLocked, afterLocked: after.bodyLocked, pointerWorldY: worldY, beforeModals: before.modals, afterModals: after.modals };
  flush();
  assert(before.saved === after.saved, 'Fodder modal wheel preserves exact save');
  const cdp = await context.newCDPSession(page);
  const point = { x: header.css.x, y: header.css.y };
  const touchDeltaCss=after.bodyOffset>0?60:-20;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, radiusX: 1, radiusY: 1, force: 1, id: 0 }] });
  for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, y: point.y + touchDeltaCss * i / 8, radiusX: 1, radiusY: 1, force: 1, id: 0 }] }); await pause(15); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach(); await pause(250);
  const swiped = await snapshot('Ascend', 'ascend-picker-after-touch');
  report.backgroundTouch = { beforeOffset: after.bodyOffset, afterOffset: swiped.bodyOffset, touchDeltaCss, delta: swiped.bodyOffset - after.bodyOffset, exactSave: after.saved === swiped.saved, modals: swiped.modals };
  assert(after.saved === swiped.saved, 'Fodder modal touch preserves exact save');
  assert(swiped.modals.includes('fodderPicker'), 'Native fodder header swipe leaves modal open');
  await back('Ascend', 'Ascend');
  const closed = await snapshot('Ascend', 'ascend-picker-after-back');
  assert(!closed.modals.length && !closed.bodyLocked, 'Ascend Back closes fodder picker and unlocks body');
  assert(before.bodyOffset === after.bodyOffset, 'Fodder modal wheel preserves underlying Ascend body offset');
  assert(after.bodyOffset === swiped.bodyOffset, 'Fodder modal touch preserves underlying Ascend body offset');
}
try {
  await setup();
  if (SCOPE === 'late') {
    await lateFlow();
  } else if (SCOPE === 'confirm') {
    await confirmProbe();
  } else if (SCOPE === 'sources') {
    await sourcesProbe();
  } else if (SCOPE === 'triple') {
    await pickerProbe();await sourcesProbe();await confirmProbe();await rapidConfirmProbe();
  } else {
    await pickerProbe();
    if(SCOPE==='full'){
      if(page.viewportSize().width!==WIDTH||page.viewportSize().height!==HEIGHT){await page.setViewportSize({width:WIDTH,height:HEIGHT});await ready('Ascend');}
      await rapidConfirmProbe();await remainingFullFlow();
    }
  }
  assert(!report.errors.length && !report.sourceRequests.length && !report.timedOut, 'No page errors, browser source imports or deadline expiry');
  report.pass = true;
} catch (error) {
  report.pass = false; report.failures.push(error.stack ?? String(error));
  if (page && !page.isClosed()) { try { report.final = await page.evaluate(() => ({ active: window.__packetGame?.scene.getScenes(true).map(s=>s.scene.key), frames:window.__packetFrames })); await page.screenshot({ path: OUT + '/failure.png' }); } catch {} }
} finally {
  clearTimeout(deadline);await context?.close(); await browser?.close(); report.finished = new Date().toISOString(); flush();
  console.log(JSON.stringify({ pass: report.pass, out: OUT, backgroundWheel: report.backgroundWheel, failures: report.failures, errors: report.errors }));
  if (!report.pass) process.exitCode = 1;
}
