#!/usr/bin/env node
/** Offline, bounded rendering/input QA. Fixtures are private UI states, not a playthrough. */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = (k, fallback) => { const i = process.argv.indexOf('--' + k); return i < 0 ? fallback : process.argv[i + 1]; };
const SAVE = arg('save'), CLOCK = arg('clock');
if (!SAVE || !CLOCK) throw new Error('--save and --clock are required');
const save = JSON.parse(readFileSync(SAVE, 'utf8')), clock = JSON.parse(readFileSync(CLOCK, 'utf8'));
const ORIGIN = arg('origin', 'http://127.0.0.1:5523'), OUT = resolve(arg('out', '/tmp/night-adventure-modes'));
const WIDTH = Number(arg('width', '360')), HEIGHT = Number(arg('height', '640'));
const RENDERER = arg('renderer', 'webgl1'), SCENE = arg('scene', 'Expeditions');
const AUDIT = arg('audit', '0') === '1', COMPACT = arg('compact', '1') === '1';
const LOCKED = arg('locked', '0') === '1';
const EXERCISE = arg('exercise', AUDIT || LOCKED ? '0' : '1') === '1';
const REDUCED = arg('reduced-motion', '1') === '1';
const PARTY_RACE = arg('party-race', '0') === '1';
const TIPS = arg('tips', '0') === '1';
const NATIVE_RESIZE = arg('native-resize', '0') === '1';
const DEADLINE = Number(arg('max-seconds', '240')) * 1000;
if (!['webgl1', 'canvas'].includes(RENDERER) || !['Expeditions', 'Tower', 'Hunt', 'Autobattler'].includes(SCENE) || !Number.isFinite(DEADLINE) || DEADLINE < 1000) throw new Error('Invalid renderer, scene or deadline');
const moduleRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE ? resolve(process.env.PLAYWRIGHT_MODULE) : join(moduleRoot, 'playwright', 'index.mjs')).href);
mkdirSync(OUT, { recursive: true });
const report = { origin: ORIGIN, save: SAVE, clock, lawfulClears: save.campaign.cleared.length, viewport: { width: WIDTH, height: HEIGHT }, rendererRequested: RENDERER, scene: SCENE, compactDevOverride: COMPACT, method: 'Lawful campaign snapshot in private browser; hints suppressed for UI input; actual Adventure tile and pointer clicks. Any prepared expedition/event states use core actions and a private clock shift. This is UI proof, not a playthrough.', errors: [], failures: [], snapshots: [], interactions: [] };
report.reducedMotion=REDUCED;
report.firstVisitTips=TIPS;
report.source = Object.fromEntries(['scripts/night-adventure-modes-qa.mjs','src/game/scenes/ExpeditionsScene.ts','src/game/scenes/HuntScene.ts','src/game/scenes/TowerScene.ts','src/game/scenes/AutobattlerScene.ts','src/game/adventureModeLayout.ts','src/game/adventureModePanel.ts','src/game/expeditionPartyPicker.ts','src/game/expeditionEventModal.ts','src/game/screen.ts','src/game/ui.ts','src/game/viewport.ts'].map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
const flush = () => writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, hasTouch: true, isMobile: true, timezoneId: 'UTC' });
const page = await context.newPage();
page.on('pageerror', e => { report.errors.push({ message: e.message, stack: e.stack }); flush(); });
page.on('console', m => { if (m.type() === 'error') report.errors.push({ console: m.text() }); });
const timer = setTimeout(() => { report.deadlineExceeded = true; flush(); void browser.close(); }, DEADLINE);
await context.route('**/*', route => { const u = new URL(route.request().url()); return ['http:', 'https:'].includes(u.protocol) && !['localhost', '127.0.0.1'].includes(u.hostname) ? route.abort() : route.continue(); });
await page.addInitScript(({ save, clock, renderer, height, reduced }) => {
  window.__modeQaConsole = [];
  const consoleError = console.error;
  console.error = (...args) => { window.__modeQaConsole.push({ message:args.map(String).join(' '),stack:new Error().stack }); consoleError(...args); };
  localStorage.clear(); localStorage.setItem('chronoworld.save.v1', JSON.stringify(save));
  localStorage.setItem('chronoworld.timeShift', String(Math.max(0, clock.now - Date.now())));
  localStorage.setItem('chronoworld.reduceMotion', reduced?'1':'0'); localStorage.setItem('chronoworld.fpsCap', '30');
  window.__tgEvents = {}; window.__tgBack = null;
  window.Telegram = { WebApp: { version: '9.0', platform: 'ios', initData: '', isFullscreen: true, isExpanded: true, viewportHeight: height, viewportStableHeight: height,
    safeAreaInset: { top: 47, bottom: 34, left: 0, right: 0 }, contentSafeAreaInset: { top: 89, bottom: 0, left: 0, right: 0 },
    ready() {}, expand() {}, requestFullscreen() {}, lockOrientation() {}, disableVerticalSwipes() {}, setHeaderColor() {}, setBackgroundColor() {}, setBottomBarColor() {},
    BackButton: { show() {}, hide() {}, onClick(fn) { window.__tgBack = fn; }, offClick(fn) { if (window.__tgBack === fn) window.__tgBack = null; } },
    onEvent(name, fn) { (window.__tgEvents[name] ??= []).push(fn); }, offEvent(name, fn) { window.__tgEvents[name] = (window.__tgEvents[name] ?? []).filter(x => x !== fn); } } };
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type === 'webgl2' || renderer === 'canvas' && ['webgl', 'experimental-webgl'].includes(type) ? null : original.call(this, type, ...args); };
}, { save, clock, renderer: RENDERER, height: HEIGHT, reduced:REDUCED });

const active = () => page.evaluate(() => window.__game.scene.getScenes(true).map(s => s.scene.key));
async function assertScene(key) {
  await page.waitForFunction(key => { const a=window.__game?.scene.getScenes(true);return a?.length===1&&a[0].scene.key===key&&!window.__sprites.busy(); }, key, { timeout: 20000 });
  await page.waitForTimeout(550);
  const before = await page.evaluate(() => window.__modeQaFrames);
  await page.waitForFunction(before => window.__modeQaFrames > before, before, { timeout: 5000 });
  const after = await page.evaluate(() => window.__modeQaFrames);
  if (!(after > before)) throw new Error(`Actual postrender stalled in ${key}: ${before}→${after}`);
  if (report.errors.length) throw new Error('Runtime error; see report.errors');
}
async function object(selector, textMatch = false) {
  return page.evaluate(([selector, textMatch]) => {
    const sc = window.__game.scene.getScenes(true)[0], walk = a => a.flatMap(o => [o, ...(o.list ? walk(o.list) : [])]);
    const shown = o => { for (let p=o;p;p=p.parentContainer) if (!p.visible || p.alpha < .05) return false; return true; };
    const root=o=>{while(o.parentContainer)o=o.parentContainer;return o;};
    const matches=walk(sc.children.list).filter(o=>(textMatch?o.type==='Text'&&o.text===selector:o.name===selector)&&shown(o));
    matches.sort((a,b)=>root(a).depth-root(b).depth||sc.children.list.indexOf(root(a))-sc.children.list.indexOf(root(b)));
    const o = matches.at(-1);
    if (!o) return null;
    const b = o.getBounds(), center = o.type === 'Text' ? { x:b.centerX,y:b.centerY } : o.getWorldTransformMatrix().transformPoint(0, 0);
    let clip = null; for (let p=o;p;p=p.parentContainer) if (p.getData?.('clip')) { clip=p.getData('clip'); break; }
    return { ...center, clip, name:o.name, v:window.__view() };
  }, [selector, textMatch]);
}
async function click(selector, textMatch = false) {
  await page.waitForFunction(() => window.__game.input.enabled !== false, null, { timeout: 6000 });
  let p = await object(selector, textMatch); if (!p) throw new Error(`Missing visible target: ${selector}`);
  for (let n=0;p.clip && (p.y<p.clip[0]+20 || p.y>p.clip[1]-20) && n<20;n++) {
    const canvas = await page.locator('canvas').boundingBox(), s = canvas.width/p.v.worldW;
    await page.mouse.move(canvas.x+canvas.width/2, canvas.y+((p.clip[0]+p.clip[1])/2-p.v.worldY)*s);
    await page.mouse.wheel(0,p.y<p.clip[0] ? -600 : 600); await page.waitForTimeout(120); p=await object(selector,textMatch);
  }
  if (p.clip && (p.y<p.clip[0] || p.y>p.clip[1])) throw new Error(`Target remains clipped: ${selector}`);
  const canvas = await page.locator('canvas').boundingBox(), s = canvas.width/p.v.worldW;
  const x=canvas.x+(p.x-p.v.worldX)*s,y=canvas.y+(p.y-p.v.worldY)*s;
  if(x<canvas.x || x>canvas.x+canvas.width || y<canvas.y || y>canvas.y+canvas.height) throw new Error(`Target outside canvas: ${selector} (${x},${y})`);
  const beforeOffset=await page.evaluate(()=>window.__game.scene.getScenes(true)[0]?.area?.offset);
  await page.mouse.click(x,y); await page.waitForTimeout(550);
  const afterOffset=await page.evaluate(()=>window.__game.scene.getScenes(true)[0]?.area?.offset);
  const result={selector,x,y,active:await active(),beforeOffset,afterOffset};report.interactions.push(result);return result;
}
async function back(key) { await page.evaluate(()=>window.__tgBack?.());await assertScene(key); }
async function currentSave() { return page.evaluate(async()=>{const {session}=await import('/src/game/session.ts');return session.save;}); }
async function resizePair(key,label) {
  const before=JSON.stringify(await currentSave());
  await page.setViewportSize({width:WIDTH,height:HEIGHT+160});await assertScene(key);await snapshot(label+'-expanded');
  await page.setViewportSize({width:WIDTH,height:HEIGHT});await assertScene(key);await snapshot(label+'-resized');
  if(JSON.stringify(await currentSave())!==before)throw new Error(label+': viewport resize changed the actual save');
}
async function telegramInsetPair(key) {
  const saveBefore=JSON.stringify(await currentSave());
  for(const top of [156,136]) {
    const heightBefore=await page.evaluate(()=>window.__view().uiHeight);
    await page.evaluate(top=>{const t=window.Telegram.WebApp;t.contentSafeAreaInset.top=top-t.safeAreaInset.top;for(const fn of window.__tgEvents.contentSafeAreaChanged??[])fn();},top);
    await page.waitForFunction(h=>Math.abs(window.__view().uiHeight-h)>1,heightBefore,{timeout:5000});
    await assertScene(key);await snapshot('tg-top-'+top);
  }
  if(JSON.stringify(await currentSave())!==saveBefore)throw new Error('Telegram inset change modified the actual save');
}
async function nativeSizePair(key) {
  const before=JSON.stringify(await currentSave()),other=WIDTH===360?{width:390,height:844}:{width:360,height:640};
  await page.setViewportSize(other);await assertScene(key);await snapshot('native-other-size');
  await page.setViewportSize({width:WIDTH,height:HEIGHT});await assertScene(key);await snapshot('native-size-restored');
  if(JSON.stringify(await currentSave())!==before)throw new Error('Native viewport width/height change modified the actual save');
}
async function snapshot(label, expected = SCENE) {
  await assertScene(expected);
  const state = await page.evaluate(() => {
    const g=window.__game, sc=g.scene.getScenes(true)[0], v=window.__view(), ratio=v.cssW/v.worldW;
    const walk = a => a.flatMap(o=>[o,...(o.list?walk(o.list):[])]);
    const visible = o => { for(let p=o;p;p=p.parentContainer) if(!p.visible || p.alpha<.05)return false;return true; };
    const clip = o => { for(let p=o;p;p=p.parentContainer) if(p.getData?.('clip'))return p.getData('clip');return null; };
    const a=walk(sc.children.list).filter(visible).map(o=>{const m=o.getWorldTransformMatrix?.(),h=o.input?.hitArea;return{name:o.name,type:o.type,text:o.text,fontCss:o.type==='Text'?parseFloat(o.style.fontSize)*ratio:undefined,interactive:!!o.input?.enabled,hitCss:h?{width:(h.width??h.radius*2)*Math.hypot(m.a,m.b)*ratio,height:(h.height??h.radius*2)*Math.hypot(m.c,m.d)*ratio}:undefined,bounds:{...o.getBounds?.()},clip:clip(o)}});
    const scrollAreas=walk(sc.children.list).filter(o=>o.getData?.('clip')).map(o=>({name:o.name,clip:o.getData('clip'),offset:o.getData('clip')[0]-o.getWorldTransformMatrix().ty}));
    const tips=walk(sc.children.list).filter(o=>o.name==='firstTip'&&o.getData?.('tipBox')).map(o=>{const b=o.getData('tipBox'),m=o.getWorldTransformMatrix();return{...b,y:b.y+m.ty};});
    return {active:sc.scene.key,view:v,renderer:g.renderer.type,glVersion:g.renderer.gl?.getParameter(g.renderer.gl.VERSION),frames:window.__modeQaFrames,area:sc.area?{offset:sc.area.offset,clip:sc.area.content.getData('clip')}:null,scrollAreas,tips,named:a.filter(o=>o.name),texts:a.filter(o=>o.type==='Text'),targets:a.filter(o=>o.interactive),missingSources:walk(sc.children.list).filter(o=>o.frame&&!o.frame.source).map(o=>({name:o.name,texture:o.texture?.key}))};
  });
  if(!AUDIT) {
    const badTargets=state.targets.filter(o=>!o.hitCss||!Number.isFinite(o.hitCss.width)||!Number.isFinite(o.hitCss.height)||o.hitCss.width<43.99||o.hitCss.height<43.99);
    const smallText=state.texts.filter(o=>o.fontCss<11.99);
    const invalid=state.texts.filter(o=>/undefined|NaN|\bnull\b/.test(o.text));
    if(badTargets.length)report.failures.push(label+': targets below44CSS or unmeasured: '+badTargets.map(o=>o.name||o.type).join(','));
    if(smallText.length)report.failures.push(label+': text below12CSS: '+smallText.map(o=>o.text).join(','));
    if(invalid.length)throw new Error(label+': invalid visible text '+invalid.map(o=>o.text).join(','));
    if(state.missingSources.length)throw new Error(label+': rendered objects lost their texture source');
    if(TIPS&&state.area&&state.tips.some(b=>b.y+b.h>state.area.clip[1]+1))report.failures.push(label+': first-visit tip overlaps the fixed mode footer');
  }
  const path=join(OUT,label+'.png');await page.screenshot({path});report.snapshots.push({label,...state});flush();return state;
}
async function expeditionExercise() {
  const loc=await page.evaluate(async()=>{
    const {session,now}=await import('/src/game/session.ts'),{GAME}=await import('/src/game/content.ts'),{expeditionStatus}=await import('/src/core/index.ts');
    return expeditionStatus(session.save,now(),GAME).find(v=>v.unlocked&&!v.active&&v.party?.ok)?.location.id;
  });
  if(!loc)throw new Error('Fixture has no legally available expedition location');
  const selectedHeroes=()=>page.evaluate(()=>{const sc=window.__game.scene.getScenes(true)[0],walk=a=>a.flatMap(o=>[o,...(o.list?walk(o.list):[])]);return walk(sc.children.list).filter(o=>o.name?.startsWith('expeditionPartyHero_')&&walk(o.list??[]).some(t=>t.type==='Text'&&t.text.startsWith('✓ '))).map(o=>o.name).sort();});
  await click('party_'+loc);const cancelled=await snapshot('party-cancel-open');
  const originalSelection=await selectedHeroes(),saveBeforeCancel=JSON.stringify(await currentSave());
  const first=cancelled.named.find(o=>o.name.startsWith('expeditionPartyHero_'))?.name;
  if(!first)throw new Error('No free party hero to exercise cancellation');
  await click(first);await back('Expeditions');
  if(JSON.stringify(await currentSave())!==saveBeforeCancel)throw new Error('Cancelling a party picker changed the save');
  await click('party_'+loc);let party=await snapshot('party-open');
  if(JSON.stringify(await selectedHeroes())!==JSON.stringify(originalSelection))throw new Error('Cancelled selection leaked into the next party picker');
  if(PARTY_RACE) {
    const race=await page.evaluate(async loc=>{
      const {session,commit,now}=await import('/src/game/session.ts'),{GAME}=await import('/src/game/content.ts'),{startExpedition}=await import('/src/core/index.ts');
      const sc=window.__game.scene.getScenes(true)[0],walk=a=>a.flatMap(o=>[o,...(o.list?walk(o.list):[])]);
      const ids=walk(sc.children.list).filter(o=>o.name?.startsWith('expeditionPartyHero_')&&walk(o.list??[]).some(t=>t.type==='Text'&&t.text.startsWith('✓ '))).map(o=>o.name.replace('expeditionPartyHero_',''));
      commit(startExpedition(session.save,loc,GAME.meta.expeditions.durations[0].hours,now(),GAME,ids));
      return{location:loc,heroIds:ids,method:'Explicit private UI race: the same expedition starts concurrently with public core action while its picker is open.'};
    },loc);
    const raceSave=JSON.stringify(await currentSave());
    await click('expeditionPartyChoose');const blocked=await snapshot('party-unavailable');
    if(!blocked.named.some(o=>o.name==='expeditionPartyPicker')||!blocked.texts.some(o=>o.text.includes('Состав изменился')))throw new Error('Party picker accepted heroes that became busy');
    if(JSON.stringify(await currentSave())!==raceSave)throw new Error('Rejected busy-hero selection changed the save');
    await back('Expeditions');
    await page.evaluate(async loc=>{const {session,commit,now,today,shiftTime}=await import('/src/game/session.ts'),{GAME}=await import('/src/game/content.ts'),{actClaimExpedition}=await import('/src/core/index.ts');shiftTime(12*3600000);commit(actClaimExpedition(session.save,today(),loc,now(),GAME).save);},race.location);
    await back('Adventure');await click('expeditionsTile');await assertScene('Expeditions');
    await click('party_'+loc);party=await snapshot('party-open-after-race');report.expedition={availabilityRace:race};
  }
  if(!party.named.some(o=>o.name==='expeditionPartyPicker'))throw new Error('Party picker did not open');
  await page.mouse.move(WIDTH/2,350);await page.mouse.wheel(0,600);await page.waitForTimeout(200);
  const scrolled=await snapshot('party-scrolled');
  const offset=scrolled.scrollAreas.find(o=>o.name==='expeditionPartyPickerBody')?.offset;
  if(!(offset>0))throw new Error('Party list did not actually scroll');
  const clipped=scrolled.named.filter(o=>o.name.startsWith('expeditionPartyHero_')&&o.clip&&o.bounds.y+o.bounds.height/2<o.clip[0]&&o.bounds.y+o.bounds.height/2>=o.clip[0]-136).at(-1);
  if(!clipped)throw new Error('No party hero under the fixed header to exercise the clip guard');
  const p=await object(clipped.name),canvas=await page.locator('canvas').boundingBox(),ratio=canvas.width/p.v.worldW;
  const x=canvas.x+(p.x-p.v.worldX)*ratio,y=canvas.y+(p.y-p.v.worldY)*ratio,selectionBeforeClip=JSON.stringify(await selectedHeroes());
  await page.mouse.click(x,y);await page.waitForTimeout(250);await snapshot('party-clipped-tap');
  if(JSON.stringify(await selectedHeroes())!==selectionBeforeClip)throw new Error('A masked hero responded behind the fixed modal header');
  report.expedition={...report.expedition,cancelledWithoutCommit:true,nativeClippedTap:{selector:clipped.name,x,y,clip:p.clip,selectedUnchanged:true}};
  await page.setViewportSize({width:WIDTH,height:HEIGHT+160});await assertScene('Expeditions');await snapshot('party-expanded');
  await page.setViewportSize({width:WIDTH,height:HEIGHT});await assertScene('Expeditions');const resized=await snapshot('party-resized');
  if(Math.abs((resized.scrollAreas.find(o=>o.name==='expeditionPartyPickerBody')?.offset??-1)-offset)>1)throw new Error('Party list offset lost on resize');
  const last=resized.named.filter(o=>o.name.startsWith('expeditionPartyHero_')).at(-1)?.name;
  if(!last)throw new Error('No legal free party heroes');
  await click(last);await snapshot('party-last-hero');
  const additions=await page.evaluate(()=>{
    const sc=window.__game.scene.getScenes(true)[0],walk=a=>a.flatMap(o=>[o,...(o.list?walk(o.list):[])]);
    return walk(sc.children.list).filter(o=>o.name?.startsWith('expeditionPartyHero_')).map(o=>({name:o.name,selected:walk(o.list??[]).some(t=>t.type==='Text'&&t.text.startsWith('✓ '))}));
  });
  const selected=additions.filter(o=>o.selected).length;
  for(const h of additions.filter(o=>!o.selected).slice(0,5-selected))await click(h.name);
  await snapshot('party-five-heroes');
  await click('expeditionPartyChoose');await assertScene('Expeditions');
  await click('send_'+loc);await assertScene('Expeditions');await snapshot('sent');
  report.expedition={...report.expedition,...await page.evaluate(async loc=>{
    const {session,now,shiftTime}=await import('/src/game/session.ts');
    const e=session.save.bounties.active.find(e=>e.location===loc);if(!e)throw new Error('Actual send did not create an expedition');
    const event=e.events?.find(e=>e.choice===undefined);if(!event)throw new Error('Fixture expedition has no event to exercise');
    shiftTime(Math.max(0,event.at-now()+1000));return {location:loc,heroIds:e.heroIds,startedAt:e.startedAt,endsAt:e.endsAt,event:{id:event.id,at:event.at},fixture:'Core start via actual send; private clock shifted to first event.'};
  },loc)};
  if(!report.expedition.heroIds.includes(last.replace('expeditionPartyHero_','')))throw new Error('Chosen hero was not used by actual core send');
  if(report.expedition.heroIds.length!==5)throw new Error('Five-hero party was not used by actual core send');
  await page.waitForTimeout(1250);await assertScene('Expeditions');await click('event_'+loc);const event=await snapshot('event-open');
  if(!event.named.some(o=>o.name==='expEventModal'))throw new Error('Pending event did not open');
  await page.setViewportSize({width:WIDTH,height:HEIGHT+160});await assertScene('Expeditions');await snapshot('event-expanded');
  await page.setViewportSize({width:WIDTH,height:HEIGHT});await assertScene('Expeditions');await snapshot('event-resized');
  const choice=await page.evaluate(async loc=>{
    const {session,now}=await import('/src/game/session.ts'),{GAME}=await import('/src/game/content.ts'),{expeditionEventViews}=await import('/src/core/index.ts');
    const v=expeditionEventViews(session.save,loc,now(),GAME).find(v=>v.pending);return v?.choices.find(c=>c.isDefault)?.id??v?.choices[0]?.id;
  },loc);
  if(!choice)throw new Error('No actual event choice available');
  await click('choice_'+choice);const outcome=await snapshot('event-outcome');
  if(!outcome.named.some(o=>o.name==='eventOk'))throw new Error('Event outcome confirmation absent');
  await click('eventOk');await assertScene('Expeditions');
  await page.evaluate(async()=>{const {shiftTime}=await import('/src/game/session.ts');shiftTime(12*3600000);});
  await page.waitForTimeout(1250);await assertScene('Expeditions');await snapshot('returned');
  await click('claim_'+loc);await assertScene('Expeditions');await page.waitForTimeout(1000);await snapshot('claimed');
  const remaining=await page.evaluate(async loc=>{const {session}=await import('/src/game/session.ts');return session.save.bounties.active.some(e=>e.location===loc);},loc);
  if(remaining)throw new Error('Claim did not remove the completed expedition');
  await page.evaluate(()=>window.__tgBack?.());await assertScene('Expeditions');
  await click('expChronicle');await snapshot('chronicle');await page.evaluate(()=>window.__tgBack?.());await assertScene('Expeditions');
}
async function huntExercise() {
  const rankBefore=report.snapshots.at(-1).texts.find(o=>o.name==='huntRank')?.text;
  if(!rankBefore)throw new Error('Initial legal Hunt rank label is missing');
  const lower=await click('huntPrev');await assertScene('Hunt');const picked=await snapshot('hunt-lower-rank');
  const rankAfter=picked.texts.find(o=>o.name==='huntRank')?.text;
  if(rankBefore===rankAfter)throw new Error('Hunt rank click did not select a lower unlocked rank');
  if(Math.abs(lower.beforeOffset-lower.afterOffset)>1)throw new Error('Rank selection lost the body scroll offset');
  const rulesClick=await click('huntInfo'),beforeRules=rulesClick.beforeOffset;
  await snapshot('hunt-rules');await resizePair('Hunt','hunt-rules');
  await page.mouse.move(WIDTH/2,340);await page.mouse.wheel(0,600);await page.waitForTimeout(200);await snapshot('hunt-rules-scrolled');
  await back('Hunt');const closed=await snapshot('hunt-rules-closed');
  if(Math.abs(closed.area.offset-beforeRules)>1)throw new Error('Rules modal scrolled the underlying Hunt body');
  report.hunt=await page.evaluate(async()=>{
    const {shiftTime,now}=await import('/src/game/session.ts');
    const next=new Date(now());next.setUTCHours(24,0,1,0);shiftTime(next.getTime()-now());return{fixture:'Private clock advanced to next UTC day, preserving lawful historical hunt records.'};
  });
  await page.waitForTimeout(5500);await assertScene('Hunt');await snapshot('hunt-next-day');
  const before=await currentSave();
  await click('huntSweep');await assertScene('Hunt');const outcome=await snapshot('hunt-sweep-outcome');
  if(!outcome.named.some(o=>o.name==='huntOutcome'))throw new Error('Actual sweep outcome did not open');
  const earned=await currentSave();
  if(earned.hunt.used!==1)throw new Error('Actual sweep did not consume exactly one fresh-day attempt');
  if(earned.resources.gold<before.resources.gold)throw new Error('Sweep unexpectedly removed gold');
  await resizePair('Hunt','hunt-outcome');
  await page.mouse.move(WIDTH/2,330);await page.mouse.wheel(0,600);await page.waitForTimeout(200);await snapshot('hunt-outcome-scrolled');
  await click('huntOutcomeOk');await assertScene('Hunt');
  if(JSON.stringify(await currentSave())!==JSON.stringify(earned))throw new Error('Closing the earned Hunt result changed resources');
  await back('Adventure');await click('huntTile');await assertScene('Hunt');const resumed=await snapshot('hunt-resumed');
  if(resumed.named.some(o=>o.name==='huntOutcome'))throw new Error('Consumed Hunt result replayed after returning');
  if(JSON.stringify(await currentSave())!==JSON.stringify(earned))throw new Error('Returning to Hunt repeated an earned grant');
  report.hunt={...report.hunt,rankBefore,rankAfter,attemptsUsed:earned.hunt.used,earnedGold:earned.resources.gold-before.resources.gold};
}
async function towerExercise() {
  if(report.snapshots.at(-1).named.some(o=>o.name==='towerSummary')) {
    await click('towerSummaryOk');await assertScene('Tower');await snapshot('tower-earned-summary-closed');
  }
  await click('towerUpgradesBtn');const upgrades=await snapshot('tower-upgrades');await resizePair('Tower','tower-upgrades');
  const available=await page.evaluate(async()=>{
    const {session}=await import('/src/game/session.ts'),{GAME}=await import('/src/game/content.ts'),{runConfig}=await import('/src/core/index.ts');
    const i=runConfig(GAME).upgrades.findIndex(u=>{const lv=session.save.tower.upgrades?.[u.id]??0;return lv<u.costs.length&&session.save.tower.shards>=u.costs[lv];});return i>=0?'towerUpgrade'+i:null;
  });
  const before=await currentSave();await click(available??'towerUpgrade0');const bought=await currentSave();
  if(available) {
    if(!(bought.tower.shards<before.tower.shards))throw new Error('Actual upgrade did not spend shards');
    const levelsBefore=Object.values(before.tower.upgrades??{}).reduce((n,x)=>n+x,0),levelsAfter=Object.values(bought.tower.upgrades??{}).reduce((n,x)=>n+x,0);
    if(levelsAfter!==levelsBefore+1)throw new Error('Upgrade did not apply exactly one level');
  } else if(JSON.stringify(bought)!==JSON.stringify(before))throw new Error('Maxed Tower upgrade changed the actual save');
  await snapshot('tower-upgrade-bought');await back('Tower');await snapshot('tower-upgrades-closed');
  await click('towerInfo');await snapshot('tower-rules');await resizePair('Tower','tower-rules');await back('Tower');
  await click('towerStart');await assertScene('Tower');const started=await snapshot('tower-started');
  const runBefore=(await currentSave()).tower.run;
  if(!runBefore?.pending||!started.named.some(o=>o.name==='towerBlessing'))throw new Error('Lawful upgraded Tower start did not offer its earned card');
  await back('Tower');await snapshot('tower-pending-closed');
  if(JSON.stringify((await currentSave()).tower.run)!==JSON.stringify(runBefore))throw new Error('Back consumed a pending Tower card');
  await click('towerGo');await snapshot('tower-pending-reopened');await resizePair('Tower','tower-card');
  const last='towerCard'+(runBefore.pending.options.length-1);await click(last);await assertScene('Tower');const picked=await snapshot('tower-card-picked');
  const runPicked=(await currentSave()).tower.run;
  if(runPicked.pending||runPicked.cards.length!==1)throw new Error('Actual Tower card selection was not saved exactly once');
  await click('towerCards');await snapshot('tower-cards-sheet');await resizePair('Tower','tower-cards-sheet');await back('Tower');
  await back('Adventure');await click('towerTile');await assertScene('Tower');await snapshot('tower-resumed');
  if(JSON.stringify((await currentSave()).tower.run)!==JSON.stringify(runPicked))throw new Error('Tower exit/resume changed the actual run');
  report.tower={shardsSpent:before.tower.shards-bought.tower.shards,startedSeed:runBefore.seed,earnedCard:runPicked.cards[0],actualResume:true};
  // Presentation-only stress fixture: no campaign unlock or reward is claimed by this preparation.
  report.tower.syntheticDraft=await page.evaluate(async()=>{
    const {session,commit}=await import('/src/game/session.ts'),{GAME}=await import('/src/game/content.ts'),{runConfig,TowerRunSchema}=await import('/src/core/index.ts');
    const r=session.save.tower.run,c=runConfig(GAME),leg=c.blessings.filter(b=>b.rarity==='legendary').map(b=>b.id),cap=r.draftRules.legendaryCap;
    const cards=leg.slice(0,cap),incoming=leg[cap];if(!incoming)throw new Error('No distinct MVP card for replacement fixture');
    const fixture={...r,floor:20,cards:[...cards,'deviruchi'],pending:{kind:'blessing',source:'boss',minRarity:'legendary',rolls:0,options:[incoming,...leg.filter(id=>!cards.includes(id)&&id!==incoming).slice(0,3)]}};
    const prepared=TowerRunSchema.parse(fixture);commit({...session.save,tower:{...session.save.tower,run:prepared}});window.__game.scene.getScenes(true)[0].scene.restart();
    return{kind:'Synthetic UI stress fixture, NOT a playthrough: full MVP cap, four pending offers, comparison/exchange. Save schema validated.',cards:prepared.cards,incoming};
  });
  await assertScene('Tower');await snapshot('tower-synthetic-four-offers');await click('towerCard0');await snapshot('tower-synthetic-comparison');
  await resizePair('Tower','tower-comparison');await click('towerReplace0');await snapshot('tower-synthetic-replacement');
  const compareBefore=(await currentSave()).tower.run;await click('towerDraftBack');await snapshot('tower-comparison-back');
  if(JSON.stringify((await currentSave()).tower.run)!==JSON.stringify(compareBefore))throw new Error('Comparison Back spent a card');
  await click('towerCard0');await click('towerReplace0');await click('towerDraftConfirm');await assertScene('Tower');await snapshot('tower-replacement-confirmed');
  const exchanged=(await currentSave()).tower.run;
  if(exchanged.pending||!exchanged.cards.includes(report.tower.syntheticDraft.incoming)||exchanged.cards.includes(report.tower.syntheticDraft.cards[0]))throw new Error('Explicit replacement did not apply exactly once');
  report.tower.syntheticEvent=await page.evaluate(async()=>{
    const {session,commit}=await import('/src/game/session.ts');const r=session.save.tower.run;
    commit({...session.save,tower:{...session.save.tower,run:{...r,pending:{kind:'event',event:'scribe'}}}});window.__game.scene.getScenes(true)[0].scene.restart();
    return{kind:'Synthetic UI pending event fixture, NOT an earned floor: Scribe exchange with full MVP cap.'};
  });
  await assertScene('Tower');await snapshot('tower-synthetic-event');await resizePair('Tower','tower-event');
  await back('Tower');const pending=(await currentSave()).tower.run.pending;await click('towerGo');await snapshot('tower-event-reopened');
  if(JSON.stringify((await currentSave()).tower.run.pending)!==JSON.stringify(pending))throw new Error('Event exit/resume changed its pending choice');
  await click('towerEventOpt0');await assertScene('Tower');await snapshot('tower-event-chosen');
  if((await currentSave()).tower.run.pending?.kind!=='blessing')throw new Error('Scribe exchange did not open the actual pending comparison draft');
  await click('towerDraftKeep');await assertScene('Tower');await snapshot('tower-event-keep');
  await click('towerGiveUp');await snapshot('tower-surrender-confirm');await click('Сдаться',true);await assertScene('Tower');await snapshot('tower-surrendered');
  if((await currentSave()).tower.run)throw new Error('Actual surrender did not close the run');
  await resizePair('Tower','tower-summary');await back('Tower');const seen=(await currentSave()).tower.last;
  if(!seen?.seen)throw new Error('Back did not acknowledge the displayed Tower summary');
  await back('Adventure');await click('towerTile');await assertScene('Tower');const clean=await snapshot('tower-summary-consumed');
  if(clean.named.some(o=>o.name==='towerSummary'))throw new Error('Closed Tower summary replayed on returning');
}
async function arenaExercise() {
  if(report.snapshots.at(-1).named.some(o=>o.name==='autobattlerLast')) {
    const earned=await currentSave();await click('autobattlerLast');await snapshot('arena-earned-summary');await resizePair('Autobattler','arena-summary');
    await click('autobattlerSummaryOk');await assertScene('Autobattler');
    if(JSON.stringify(await currentSave())!==JSON.stringify(earned))throw new Error('Historical Arena summary reissued a reward');
  }
  await click('autobattlerStart');await assertScene('Autobattler');await snapshot('arena-started');
  const started=(await currentSave()).autobattler.run;if(!started)throw new Error('Actual Arena start created no run');
  await click('autobattlerOpponent');await snapshot('arena-opponent');await resizePair('Autobattler','arena-opponent');await back('Autobattler');
  await click('autobattlerSynergies');await snapshot('arena-synergies');await back('Autobattler');
  const offer=await click('autobattlerOffer0');await assertScene('Autobattler');const bought=await snapshot('arena-offer-bought');
  const afterBuy=(await currentSave()).autobattler.run;
  if(afterBuy.gold!==started.gold-3)throw new Error('Actual Arena offer did not spend exactly one hero cost');
  if(Math.abs(offer.beforeOffset-offer.afterOffset)>1)throw new Error('Shop purchase lost the scroll position');
  for(const name of ['autobattlerRound','autobattlerLives','autobattlerGold']) {
    const n=bought.named.find(o=>o.name===name);if(!n||n.bounds.top<150||n.bounds.bottom>bought.area.clip[0])throw new Error(name+': status disappeared into shop scrolling');
  }
  const beforeReroll=await currentSave();await click('autobattlerReroll');await assertScene('Autobattler');await snapshot('arena-rerolled');
  const rolled=await currentSave();
  if(rolled.autobattler.run.gold!==beforeReroll.autobattler.run.gold-2)throw new Error('Actual reroll did not spend exactly its cost');
  await click('autobattlerTrain');const training=await snapshot('arena-training');await resizePair('Autobattler','arena-training');
  const affordance=training.named.find(o=>o.name==='autobattlerTrainConfirm');if(!affordance)throw new Error('Training confirmation is missing');
  const blockedBefore=await currentSave();await click('autobattlerTrainConfirm');const blocked=await snapshot('arena-training-blocked');
  if(JSON.stringify(await currentSave())!==JSON.stringify(blockedBefore))throw new Error('Unaffordable training changed the save');
  if(!blocked.texts.some(o=>o.text.includes('Не хватает монет для подготовки')))throw new Error('Unaffordable training gave no understandable reason');
  await back('Autobattler');
  await click('autobattlerSlot0');await snapshot('arena-slot');await resizePair('Autobattler','arena-slot');
  const fromSlot=started.squad.findIndex((id,i)=>i>0&&id),replacement=started.heroes.find(h=>h.id===started.squad[fromSlot]);if(!replacement)throw new Error('No lawful teammate for a native slot swap');
  await click('autobattlerPick_'+replacement.templateId);await assertScene('Autobattler');await snapshot('arena-slot-swapped');
  const swapped=(await currentSave()).autobattler.run;
  if(swapped.squad[0]!==started.squad[fromSlot]||swapped.squad[fromSlot]!==started.squad[0])throw new Error('Actual slot choice did not save a one-to-one swap');
  await click('autobattlerReserve');const reserve=await snapshot('arena-reserve');
  const first=reserve.named.find(o=>o.name?.startsWith('autobattlerReserve_'));if(!first)throw new Error('Arena reserve did not list its legal heroes');
  await click(first.name);await snapshot('arena-companion');await resizePair('Autobattler','arena-companion');await back('Autobattler');
  await click('autobattlerInfo');await snapshot('arena-rules');await resizePair('Autobattler','arena-rules');await back('Autobattler');
  const beforeResume=await currentSave();await back('Adventure');await click('autobattlerTile');await assertScene('Autobattler');await snapshot('arena-resumed');
  if(JSON.stringify((await currentSave()).autobattler.run)!==JSON.stringify(beforeResume.autobattler.run))throw new Error('Arena exit/resume changed round, coins, offers or squad');
  report.arena={actualStart:true,round:started.round,goldBefore:started.gold,goldAfter:beforeResume.autobattler.run.gold,actualBuy:true,actualReroll:true,actualSlotSwap:true,actualResume:true,training:'Unaffordable after buy+reroll; the locked tap leaves the save unchanged and explains the exact cost restriction. No synthetic match currency added.'};
}
try {
  await page.goto(ORIGIN+(COMPACT?'/?compact=1':'/'), {waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.__game?.scene && window.__game.scene.getScenes(true).length>0 && !window.__game.scene.isActive('Boot') && !window.__sprites.busy(),null,{timeout:60000});
  await page.waitForTimeout(750);
  await page.evaluate(async({tips,scene})=>{
    const hints=await import('/src/game/hints.ts'), ids=Object.keys(hints.HINT_TEXT).filter(id=>!tips||id!=='tip_'+scene.toLowerCase());
    localStorage.setItem(hints.HINT_KEY,JSON.stringify(ids));localStorage.setItem(hints.HINT_SHOWN_KEY,JSON.stringify(ids));hints.reloadHints();
    const { session, commit } = await import('/src/game/session.ts');
    const { GAME } = await import('/src/game/content.ts');
    const { pendingUnlocks, markUnlocksSeen } = await import('/src/core/index.ts');
    commit(markUnlocksSeen(session.save, pendingUnlocks(session.save, GAME).map(f => f.id)));
    if(tips&&scene==='Tower') { const {markTowerSummarySeen}=await import('/src/core/index.ts');commit(markTowerSummarySeen(session.save)); }
    window.__modeQaFrames=0;window.__game.events.on('postrender',r=>{if(r)window.__modeQaFrames++;});
    for(const s of window.__game.scene.getScenes(true))window.__game.scene.stop(s.scene.key);window.__game.scene.start('Adventure');
  },{tips:TIPS,scene:SCENE});
  await assertScene('Adventure');
  const tile={Expeditions:'expeditionsTile',Hunt:'huntTile',Tower:'towerTile',Autobattler:'autobattlerTile'}[SCENE];
  const beforeEntry=JSON.stringify(await currentSave());
  await click(tile);
  if(LOCKED) {
    await assertScene('Adventure');const rejected=await snapshot('locked-entry','Adventure');
    if(JSON.stringify(await currentSave())!==beforeEntry)throw new Error('A locked Adventure tile changed the actual save');
    if(!rejected.texts.some(o=>/откроется/i.test(o.text)))throw new Error('Locked entry did not explain its campaign requirement');
    report.locked={nativeEntryRejected:true,saveUnchanged:true,sceneInstantiation:'Explicit synthetic UI coverage of the normally inaccessible locked scene, not a playthrough.'};
    await page.evaluate(key=>{window.__game.scene.stop('Adventure');window.__game.scene.start(key);},SCENE);
  }
  await assertScene(SCENE);
  const initial=await snapshot('initial');
  if(TIPS&&!initial.tips.length)throw new Error('First-visit tip requested but not actually rendered');
  if(initial.renderer!==(RENDERER==='canvas'?1:2)||RENDERER==='webgl1'&&!/^WebGL 1\.0/.test(initial.glVersion??''))throw new Error('The requested renderer was not actually used');
  if(!AUDIT) {
    const offset=initial.area?.offset??0;
    if(NATIVE_RESIZE)await nativeSizePair(SCENE);
    await page.setViewportSize({width:WIDTH,height:HEIGHT+160});await assertScene(SCENE);await snapshot('expanded');
    await page.setViewportSize({width:WIDTH,height:HEIGHT});await assertScene(SCENE);const back=await snapshot('resized-back');
    if(initial.area && Math.abs((back.area?.offset??0)-offset)>1)throw new Error('List offset changed during resize');
    await telegramInsetPair(SCENE);
    if(EXERCISE&&SCENE==='Expeditions')await expeditionExercise();
    if(EXERCISE&&SCENE==='Hunt')await huntExercise();
    if(EXERCISE&&SCENE==='Tower')await towerExercise();
    if(EXERCISE&&SCENE==='Autobattler')await arenaExercise();
    await page.evaluate(()=>window.__tgBack?.());await assertScene('Adventure');await snapshot('back','Adventure');
  }
  report.ok=report.errors.length===0&&report.failures.length===0;flush();console.log(JSON.stringify({ok:report.ok,out:OUT,snapshots:report.snapshots.length,targets:initial.targets.length,minimumTarget:Math.min(...initial.targets.filter(o=>o.hitCss).map(o=>Math.min(o.hitCss.width,o.hitCss.height))),minimumFont:Math.min(...initial.texts.map(o=>o.fontCss))}));
}catch(e){report.failures.push(e.stack||String(e));try{report.consoleDiagnostics=await page.evaluate(()=>window.__modeQaConsole);}catch{}flush();console.error(e.message);process.exitCode=1;}
finally{clearTimeout(timer);await context.close();await browser.close();flush();}
if(report.errors.length||report.failures.length||report.deadlineExceeded)process.exitCode=1;
