#!/usr/bin/env node
// Проверка собранной v1: native касания, короткие подписи, настройки и выход из финала.
// QA_FINAL_SAVE/QA_FINAL_CLOCK — итог законного scripts/night-playthrough.ts.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { browserOptions, loadPlaywright, startVite, stopVite } from '../../../../scripts/lib/perf-browser.mjs';

const out = resolve(process.env.QA_V1_OUT ?? '/tmp/chronoworld-v1-showcase');
const port = Number(process.env.QA_V1_PORT ?? 5199);
const url = process.env.QA_V1_URL;
assert.ok(url && new URL(url).protocol === 'https:', 'Требуется HTTPS production URL');
const allowedHost = new URL(url).hostname;
const proxyServer = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
const finalSave = JSON.parse(readFileSync(process.env.QA_FINAL_SAVE, 'utf8'));
const clock = JSON.parse(readFileSync(process.env.QA_FINAL_CLOCK, 'utf8'));
assert.equal(finalSave.campaign.cleared.length, 180, 'требуется полное законное прохождение');
// Изолированная UI-приёмка: прогресс/ресурсы законного профиля не меняются, обучение считается просмотренным.
finalSave.seenUnlocks = JSON.parse(readFileSync('data/unlocks.json', 'utf8')).features.map(f => f.id);
finalSave.seenScenes = readdirSync('data/story').filter(f => f.endsWith('.json')).flatMap(f => JSON.parse(readFileSync(join('data/story', f), 'utf8')).scenes?.map(s => s.id) ?? []);
finalSave.storyQueue = [];
finalSave.pendingChapterDone = 'chapter10';
mkdirSync(out, { recursive: true });
const { chromium } = await loadPlaywright();
const vite = undefined;
const html = await (await fetch(url)).text();
const phaserFile = html.match(/\/assets\/(phaser-[^" ]+\.js)/)?.[1];
assert.ok(phaserFile);
const report = [];
try {
  for (const spec of [{ name: 'webgl390', width: 390, height: 844, args: [] }, { name: 'canvas360', width: 360, height: 640, args: ['--disable-webgl'] }]) {
    const browser = await chromium.launch({ ...browserOptions(), ...(proxyServer ? { proxy: { server: proxyServer } } : {}), args: spec.args });
    try {
      const page = await browser.newPage({ viewport: { width: spec.width, height: spec.height }, hasTouch: true });
      const errors = [], external = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await page.route('**/*', route => {
        if (!['GET', 'HEAD'].includes(route.request().method()) || new URL(route.request().url()).hostname !== allowedHost) { external.push(route.request().url()); return route.abort(); }
        return route.continue();
      });
      await page.addInitScript(({ save, now }) => {
        localStorage.setItem('chronoworld.save.v1', JSON.stringify(save));
        localStorage.setItem('chronoworld.timeShift', String(Math.max(0, now - Date.now())));
        localStorage.setItem('chronoworld.reduceMotion', '1');
        localStorage.setItem('chronoworld.fpsCap', '30');
      }, { save: finalSave, now: clock.now });
      await page.goto(url);
      await page.waitForFunction(() => performance.getEntriesByName('cw:home').length > 0);
      assert.equal(await page.evaluate(() => !!window.__game), false, 'production не раскрывает dev game export');
      const cdp = await page.context().newCDPSession(page);
      const proto = await cdp.send('Runtime.evaluate', { expression: `import('/assets/${phaserFile}').then(m => { for (const v of Object.values(m)) { const p=typeof v==='function'?v():v; if(p?.Game&&p?.Scene) return p.Game.prototype; } throw Error('Phaser export missing'); })`, awaitPromise: true });
      const games = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId });
      const call = async (fn, ...args) => {
        const result = await cdp.send('Runtime.callFunctionOn', { objectId: games.objects.objectId, functionDeclaration: fn.toString(), arguments: args.map(value => ({ value })), returnByValue: true });
        if (result.exceptionDetails) throw Error(result.exceptionDetails.text + ': ' + JSON.stringify(result.exceptionDetails.exception));
        return result.result.value;
      };
      const renderer = await call(function () { return this[0].renderer.type; });
      assert.equal(renderer, spec.name === 'canvas360' ? 1 : 2, 'требуется фактический Canvas/WebGL renderer');
      const scene = () => call(function () { return this[0].scene.getScenes(true).map(s => s.scene.key).join(','); });
      const ready = async key => { for (let n=0;n<100;n++) { if (await scene() === key) { await page.waitForTimeout(200); return; } await page.waitForTimeout(100); } throw Error(`Missing scene ${key}`); };
      const start = async (key, data = {}) => { await call(function (key, data) { for (const s of this[0].scene.getScenes(true)) this[0].scene.stop(s.scene.key); this[0].scene.start(key, data); }, key, data); await ready(key); };
      const tap = async label => {
        const target = await call(function (label) {
          const game=this[0], sc=game.scene.getScenes(true)[0], walk=a=>a.flatMap(o=>[o,...(o.list?walk(o.list):[])]);
          const shown=o=>{for(let p=o;p;p=p.parentContainer)if(!p.visible||p.alpha<.05)return false;return true;};
          const o=walk(sc.children.list).filter(o=>(o.name===label||o.type==='Text'&&o.text===label)&&shown(o)).at(-1);
          if(!o)return null;const b=o.getBounds(),v=sc.cameras.main.getWorldPoint(0,0);
          return {x:b.centerX,y:b.centerY,left:v.x,top:v.y,worldW:game.canvas.width/sc.cameras.main.zoom};
        }, label);
        assert.ok(target, `цель ${label}`);
        const box = await page.locator('canvas').boundingBox();
        await page.touchscreen.tap(box.x+(target.x-target.left)*box.width/target.worldW, box.y+(target.y-target.top)*box.width/target.worldW);
        await page.waitForTimeout(250);
      };
      // Конечный экран регистрируется лениво через нормальный Boot → Campaign → ChapterDone.
      await ready('ChapterDone');
      await page.waitForTimeout(2000);
      // Сюжетный лист закрывается обычной кнопкой, если он есть.
      const pageVisible = await call(function () { const walk=a=>a.flatMap(o=>[o,...(o.list?walk(o.list):[])]); return walk(this[0].scene.getScenes(true)[0].children.list).some(o=>o.type==='Text'&&o.text==='Пропустить'&&o.visible); });
      if (pageVisible) await tap('Пропустить');
      await page.screenshot({ path: join(out, `${spec.name}-chapter-final.png`) });
      await tap('К приключениям'); await ready('Adventure');
      await start('Campaign');
      await page.screenshot({ path: join(out, `${spec.name}-campaign-complete.png`) });
      await tap('К приключениям'); await ready('Adventure');
      await start('Home');
      await call(function () { this[0].scene.getScene('Home').openSettings(); });
      const texts = await call(function () { const walk=a=>a.flatMap(o=>[o,...(o.list?walk(o.list):[])]); return walk(this[0].scene.getScene('Home').children.list).filter(o=>o.type==='Text').map(o=>o.text); });
      assert.ok(texts.includes('Chronoworld · версия 1.0.0'));
      await tap('settingsClose');
      const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('chronoworld.save.v1')));
      assert.equal(persisted.campaign.cleared.length, 180);
      assert.equal(persisted.pendingChapterDone, undefined);
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      report.push({ case: spec.name, renderer, status: 'PASS', errors, external, completed: persisted.campaign.cleared.length });
    } finally { await browser.close(); }
  }
} finally { if (vite) stopVite(vite); writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report));
