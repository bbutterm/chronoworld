#!/usr/bin/env node
// Private local UI acceptance; UI stock and read flags are explicit, not progression evidence.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {tsImport}=require('tsx/esm/api');
const ROOT=path.resolve(__dirname,'..');
const BASE=new URL(process.env.URL || 'http://127.0.0.1:5596/?compact=1');
assert(['127.0.0.1','localhost','[::1]'].includes(BASE.hostname),'Private localhost only');
const ORIGIN=BASE.origin;
const OUT=path.resolve(process.env.OUT || '/tmp/chronoworld-night-inventory-native');
const report={url:ORIGIN,privateUI:true,devCompact:BASE.searchParams.get('compact')==='1',syntheticMvpStock:true,bundleHashes:{},sourceRequests:[],legalFixture:'tests/fixtures/boot-late-save.json',runs:[],passed:false};
fs.mkdirSync(OUT,{recursive:true});
const flush=()=>fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));
(async()=>{
 const from=pathToFileURL(path.join(ROOT,'scripts/qa.cjs')).href;
 const [core,{loadFullContext}]=await Promise.all([tsImport('../src/core/index.ts',from),tsImport('./lib/content-node.ts',from)]);
 const GAME=loadFullContext();
 let original=JSON.parse(fs.readFileSync(path.join(ROOT,'tests/fixtures/boot-late-save.json'),'utf8'));
 const card=GAME.hunt.cards.find(c=>original.inventory.items.some(i=>!i.card&&GAME.equipment.items[i.itemId]?.slot===c.slot));
 assert(card);original.hunt.cards[card.id]=2;
 original.seenUnlocks=GAME.unlocks.features.map(f=>f.id);
 original.storyQueue=[];
 for(const chapter of GAME.content.chapters) original=core.markPageSeen(original,core.episodePageId(chapter.id));
 const hints=[...fs.readFileSync(path.join(ROOT,'src/game/hints.ts'),'utf8').split('export type HintId =')[1].split(';')[0].matchAll(/'([^']+)'/g)].map(m=>m[1]);
 report.fixtureSha256=crypto.createHash('sha256').update(JSON.stringify(original)).digest('hex');
 report.sourceHashes=Object.fromEntries(['src/game/scenes/InventoryScene.ts','src/game/inventoryScreenLayout.ts','src/game/screen.ts','src/game/modalBack.ts','src/game/viewLayout.ts'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,f))).digest('hex')]));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME || '/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const deadline=setTimeout(()=>{report.deadline=true;flush();void browser.close();},300000);
 try {
  for(const [width,height,mode] of [[360,640,'canvas'],[390,844,'webgl1']]){
   const run={width,height,mode,phases:[],errors:[]};report.runs.push(run);
   const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,deviceScaleFactor:1});
   await context.route('**/*',async r=>{
    const u=new URL(r.request().url());
    if(u.pathname.endsWith('telegram-web-app.js'))return r.fulfill({contentType:'application/javascript',body:''});
    if(u.origin!==ORIGIN||!['GET','HEAD'].includes(r.request().method()))return r.abort();
    if(/\/assets\/index-[^/]+\.js$/.test(u.pathname)){
     const response=await r.fetch(),code=await response.text();
     const gm=/([\w$]+)=new\s*[\w$.]+\.Game\(\{type:/.exec(code),vm=/function [\w$]+\(\)\{return ([\w$]+)\.adaptive\?Math.max\(/.exec(code);
     assert(gm&&vm,'Compiled observation unavailable');
     report.bundleHashes[u.pathname]=crypto.createHash('sha256').update(code).digest('hex');
     return r.fulfill({response,body:code+';window.__game='+gm[1]+';window.__view=()=>'+vm[1]+';'});
    }
    if(/\/(src|@vite)\//.test(u.pathname))report.sourceRequests.push(u.pathname);
    return r.continue();
   });
   await context.addInitScript(({save,mode,hints})=>{
    localStorage.setItem('chronoworld.save.v1',JSON.stringify(save));localStorage.setItem('chronoworld.reduceMotion','1');
    localStorage.setItem('chronoworld.hints',JSON.stringify(hints));localStorage.setItem('chronoworld.hintsShown',JSON.stringify(hints));
    const DateOriginal=Date,started=performance.now(),baseClock=save.offline.lastClaimAt+200000,clock=()=>baseClock+performance.now()-started;
    window.Date=class extends DateOriginal{constructor(...args){super(...(args.length?args:[clock()]));}static now(){return clock();}};
    const getContext=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl2'||mode==='canvas'&&/webgl/.test(type)?null:getContext.call(this,type,...args);};
    const events={};const backs=new Set();window.__qaBack=()=>[...backs].forEach(fn=>fn());
    window.Telegram={WebApp:{version:'9.0',platform:'ios',initData:'',isFullscreen:true,safeAreaInset:{top:47,bottom:34,left:0,right:0},contentSafeAreaInset:{top:89,bottom:0,left:0,right:0},ready(){},expand(){},onEvent(n,f){(events[n]??=new Set()).add(f);},offEvent(n,f){events[n]?.delete(f);},BackButton:{show(){},hide(){},onClick(f){backs.add(f);},offClick(f){backs.delete(f);}}}};
    window.__qaInset=top=>{window.Telegram.WebApp.contentSafeAreaInset.top=top-47;for(const fn of events.contentSafeAreaChanged??[])fn();};
   },{save:original,mode,hints});
   const page=await context.newPage();page.on('pageerror',e=>run.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')run.errors.push(m.text());});
   await page.goto(BASE.href,{waitUntil:'domcontentloaded',timeout:60000});
   await page.waitForFunction(()=>window.__game?.scene&&!window.__game.scene.isActive('Boot')&&window.__game.scene.getScenes(true).length,null,{timeout:60000});
   await page.evaluate(()=>{window.__qaWalk=list=>list.flatMap(o=>[o,...(o.list?window.__qaWalk(o.list):[])]);});
   async function ready(key){await page.waitForFunction(key=>{const s=window.__game.scene.getScene(key),v=window.__view();if(!s?.sys.isActive()||!s.input.enabled||!s.sys.game.input.enabled)return false;const a=s.cameras.main.getWorldPoint(0,0);return Math.abs(a.x-v.worldX)<.5&&Math.abs(a.y-v.worldY)<.5;},key,{timeout:30000});}
   async function named(key,name){await ready(key);const pt=await page.evaluate(({key,name})=>{const s=window.__game.scene.getScene(key),o=window.__qaWalk(s.children.list).find(o=>o.name===name&&o.scene);if(!o)return null;const b=o.getBounds(),v=window.__view();return{x:v.cssLeft+(b.centerX-v.worldX)*v.zoom,y:v.cssTop+(b.centerY-v.worldY)*v.zoom};},{key,name});assert(pt,'Missing native '+key+'/'+name);await page.touchscreen.tap(pt.x,pt.y);}
   await ready('Campaign');await named('Campaign','nav_Heroes');await ready('Heroes');await named('Heroes','inventoryBtn');await ready('Inventory');
   const state=()=>page.evaluate(()=>{const s=window.__game.scene.getScene('Inventory'),a=s.area;return{offset:a?.offset,clip:a?.content.getData('clip'),data:s.data0,save:localStorage.getItem('chronoworld.save.v1'),contentHeight:a?.height,rows:a?.content.list.map(o=>o.name).filter(Boolean),height:window.__view().uiHeight};});
   const target=(name,part)=>page.evaluate(({name,part})=>{const s=window.__game.scene.getScenes(true).at(-1),v=window.__view(),o=window.__qaWalk(s.children.list).find(o=>o.name===name&&o.scene);if(!o)return null;const b=o.getBounds(),k=v.cssW/v.worldW;let clip=[0,v.uiHeight];for(let p=o;p;p=p.parentContainer)if(p.getData?.('clip')){clip=p.getData('clip');break;}const bx=part==null?b.centerX:b.left+b.width*(part+.5)/3;return{x:v.cssLeft+(bx-v.worldX)*k,y:v.cssTop+(b.centerY-v.worldY)*k,worldY:b.centerY,clip,scale:k,height:(o.input?.hitArea?.height??o.height??b.height)*k,view:v};},{name,part});
   async function tap(name,part){await page.waitForFunction(()=>{const s=window.__game.scene.getScenes(true).at(-1);return s?.input.enabled&&s.sys.game.input.enabled;});for(let i=0;i<100;i++){const t=await target(name,part);assert(t,'Missing '+name);if(t.worldY>=t.clip[0]+66&&t.worldY<=t.clip[1]-66){await page.touchscreen.tap(t.x,t.y);await page.waitForTimeout(650);run.phases.push({tap:name,part});return t;}await page.mouse.move(width/2,t.view.cssTop+((t.clip[0]+t.clip[1])/2-t.view.worldY)*t.scale);await page.mouse.wheel(0,(t.worldY>t.clip[1]-66?1:-1)*(Math.abs(t.worldY-(t.clip[0]+t.clip[1])/2)>2000?900:150));await page.waitForTimeout(150);}run.revealFailure={name,target:await target(name,part),scene:await page.evaluate(()=>{const s=window.__game.scene.getScene('Inventory');return{enabled:s.input.enabled,gameEnabled:s.sys.game.input.enabled,clips:window.__qaWalk(s.children.list).filter(o=>o.getData?.('clip')).map(o=>({name:o.name,y:o.y,clip:o.getData('clip'),parent:o.parentContainer?.name})),camZoom:s.cameras.main.zoom,view:window.__view()};})};flush();await page.screenshot({path:path.join(OUT,'failure.png')});throw Error('Cannot reveal '+name);}
   async function resize(){const before=await state();await page.setViewportSize({width,height:height+120});await page.waitForTimeout(550);const expanded=await state();await page.setViewportSize({width,height});await page.waitForTimeout(550);const after=await state();assert.equal(after.save,before.save);assert.deepEqual(after.data,before.data);const expected=before.clip?Math.min(before.offset,Math.max(0,before.contentHeight-(expanded.clip[1]-expanded.clip[0]))):before.offset;assert(Math.abs((after.offset??0)-(expected??0))<.001,'Illegal offset clamp after resize');run.phases.push({resize:true,beforeClip:before.clip,expandedClip:expanded.clip,afterClip:after.clip,beforeOffset:before.offset,afterOffset:after.offset,expected});}
   const first=await state();assert.equal(first.height,(height-170)*1080/width);assert.equal(first.clip[1],first.height-180);await resize();
   // Filters use separate input targets; toggling does not mutate the legal save.
   const filters=await page.evaluate(()=>{const s=window.__game.scene.getScene('Inventory');return window.__qaWalk(s.children.list).filter(o=>o.name.startsWith('invFilter_')||o.name==='invFreeOnly').map(o=>({name:o.name,b:o.getBounds()}));});
   for(let i=0;i<filters.length;i++)for(let j=i+1;j<filters.length;j++){const a=filters[i].b,b=filters[j].b;assert(!(Math.max(a.left,b.left)<Math.min(a.right,b.right)&&Math.max(a.top,b.top)<Math.min(a.bottom,b.bottom)),'Overlapping filters');}
   await tap('invFreeOnly');await tap('invFreeOnly');assert.equal((await state()).save,first.save);
   const items=await page.evaluate(()=>window.__game.scene.getScene('Inventory').area.content.list.map(o=>o.name).filter(n=>n.startsWith('invItem_')));assert(items.length);await tap(items[0]);
   const controls=await page.evaluate(()=>{const s=window.__game.scene.getScene('Inventory'),v=window.__view();return window.__qaWalk(s.children.list).filter(o=>['itemLock','itemSell','itemWear','itemRefine','itemHero','itemLore'].includes(o.name)&&o.scene).map(o=>{const b=o.getBounds();return{name:o.name,left:b.left,right:b.right,top:b.top,bottom:b.bottom,heightCss:(o.input?.hitArea?.height??b.height)*v.zoom};});});
   for(const c of controls)assert(c.heightCss>=43.95,'Inventory action target below44CSS '+c.name);
   for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){const a=controls[i],b=controls[j];assert(!(Math.max(a.left,b.left)<Math.min(a.right,b.right)&&Math.max(a.top,b.top)<Math.min(a.bottom,b.bottom)),'Overlapping Inventory action rows '+a.name+'/'+b.name);}
   run.phases.push({modalControls:controls,nonOverlapping:true});
   await resize();
   await page.evaluate(()=>window.__qaBack());await page.waitForTimeout(700);assert.equal((await state()).save,first.save);assert.equal(await page.evaluate(()=>window.__game.scene.getScene('Inventory').area.locked),false);
   // Actual protection toggles only the chosen item; a new row after regrouping stays reachable.
   const itemId=items[0].slice('invItem_'.length),beforeProtection=JSON.parse((await state()).save);
   await tap(items[0]);await tap('itemLock');
   await page.waitForFunction(id=>JSON.parse(localStorage.getItem('chronoworld.save.v1')).inventory.items.find(i=>i.id===id)?.locked!==undefined,itemId);
   const protectedSave=JSON.parse((await state()).save);assert.equal(protectedSave.inventory.items.find(i=>i.id===itemId).locked,!beforeProtection.inventory.items.find(i=>i.id===itemId).locked);
   for(const field of ['resources','currency','heroes','squad','hunt','tavern'])assert.deepEqual(protectedSave[field],beforeProtection[field]);
   await ready('Inventory');await tap('invItem_'+itemId);await tap('itemLock');await ready('Inventory');
   const restoredProtection=JSON.parse((await state()).save);
   assert.equal(!!restoredProtection.inventory.items.find(i=>i.id===itemId).locked,!!beforeProtection.inventory.items.find(i=>i.id===itemId).locked);
   for(const field of ['resources','currency','heroes','squad','hunt','tavern'])assert.deepEqual(restoredProtection[field],beforeProtection[field]);
   run.phases.push({itemLockRoundTrip:itemId,resourcesAndPartyExact:true});
   await tap('invTabs',1);await resize();await page.screenshot({path:path.join(OUT,'cards-table-'+width+'.png')});
   await tap('cardsRarity_green');await tap('cardsRarity_green');
   await page.mouse.move(width/2,height/2);await page.mouse.wheel(0,800);await page.waitForTimeout(500);await resize();
   const table=await state();run.phases.push({tableRows:table.rows,tableClip:table.clip,tableOffset:table.offset});
   await tap('invTabs',2);await resize();await page.screenshot({path:path.join(OUT,'mvp-stock-'+width+'.png')});
   await tap('invTabs',0);await page.screenshot({path:path.join(OUT,'gear-'+width+'.png')});
   // The two MVP cards were added only to the private fixture before Boot; no browser source imports.
   await tap('invTabs',2);await tap('mvpCardInsert_'+card.id);
   await page.waitForFunction(()=>window.__game.scene.getScene('Inventory').children.list.some(o=>o.name==='cardTargetPicker'));
   await resize();
   const targetId=await page.evaluate(()=>window.__qaWalk(window.__game.scene.getScene('Inventory').children.list).filter(o=>o.name?.startsWith('cardTarget_')).at(-1)?.name);
   assert(targetId);await tap(targetId);
   await page.waitForFunction(()=>window.__game.scene.getScene('Inventory').children.list.some(o=>o.name==='confirmModal'&&o.getByName('popInner')?.scaleX===1&&o.getByName('popInner')?.alpha===1));
   // Cancel the irreversible insertion through the actual registered SDK Back.
   const beforeCancel=await state();await page.evaluate(()=>window.__qaBack());
   await page.waitForFunction(()=>!window.__game.scene.getScene('Inventory').children.list.some(o=>o.getData?.('screenModal')));
   assert.equal((await state()).save,beforeCancel.save);
   await tap('mvpCardInsert_'+card.id);await page.waitForFunction(()=>window.__qaWalk(window.__game.scene.getScene('Inventory').children.list).some(o=>o.name==='cardTargetPicker'));await tap(targetId);
   await page.waitForFunction(()=>window.__game.scene.getScene('Inventory').children.list.some(o=>o.name==='confirmModal'&&o.getByName('popInner')?.scaleX===1&&o.getByName('popInner')?.alpha===1));
   const beforeInsert=JSON.parse((await state()).save);
   const confirmInfo=await page.evaluate(()=>{const s=window.__game.scene.getScene('Inventory'),v=window.__view(),o=window.__qaWalk(s.children.list).find(o=>o.input&&o.parentContainer?.name==='popInner'&&o.list?.some(t=>t.type==='Text'&&t.text==='Вставить')),b=o?.getBounds();return b?{x:v.cssLeft+(b.centerX-v.worldX)*v.cssW/v.worldW,y:v.cssTop+(b.centerY-v.worldY)*v.cssW/v.worldW}:null;});
   assert(confirmInfo,'No actual insertion confirmation button');await page.touchscreen.tap(confirmInfo.x,confirmInfo.y);
   await page.waitForFunction(({cardId,itemId})=>{const save=JSON.parse(localStorage.getItem('chronoworld.save.v1'));return save.hunt.cards[cardId]===1&&save.inventory.items.find(i=>i.id===itemId)?.card===cardId;},{cardId:card.id,itemId:targetId.slice('cardTarget_'.length)});
   const expected=core.insertCard(beforeInsert,targetId.slice('cardTarget_'.length),card.id,GAME);
   const actual=JSON.parse((await state()).save);
   for(const field of ['hunt','inventory','heroes','resources','currency','squad','tavern','campaign'])assert.deepEqual(actual[field],expected[field],field+' changed beyond public insertCard');
   run.phases.push({cardInserted:card.id,targetId,exactlyOneConsumed:true,publicCoreFieldsExact:true});
   await page.screenshot({path:path.join(OUT,'card-inserted-'+width+'.png')});
   assert.deepEqual(run.errors,[]);if(Object.keys(report.bundleHashes).length)assert.deepEqual(report.sourceRequests,[]);run.passed=true;flush();await context.close();console.log(width+' '+mode+' PASS');
  }
  report.passed=true;
 }finally{clearTimeout(deadline);flush();await browser.close();}
})().catch(e=>{report.fatal=e.stack;flush();console.error(e);process.exitCode=1;});
