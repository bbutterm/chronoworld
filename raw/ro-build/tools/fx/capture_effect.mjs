#!/usr/bin/env node
/**
 * Capture one RO effect frame by frame from roBrowserLegacy's EffectViewer (Electron under Xvfb).
 * Based on the ro-effects skill capture script, adapted for this server:
 *  - Electron build (ELECTRON env) instead of a downloaded Chromium; CHROME env for a real Chrome;
 *  - the viewer UI lives in a shadow root: Playwright locators pierce it;
 *  - Playwright's fake clock empties performance.*, so Camera.js is imported by its fixed vite URL;
 *  - --zoom sets Camera.zoom (125 default); calibration reads the camera matrices;
 *  - the viewer's dummy target body is hidden (entity.renderEntity = noop); attached effects stay.
 *
 *   node capture_effect.mjs --url http://127.0.0.1:5173/applications/browser-examples/capture-scro.html \
 *        --effect 49 --out raw/x --fps 12 --max 4500 [--zoom 250 --size 1600x1200]
 * Output: <out>/frame_NNN.png (RGB on black) and <out>/meta.json.
 */
import { chromium, _electron } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const benign = e => /handleJavaScriptDialog|Target page, context or browser has been closed/.test(String(e && e.message));
process.on('uncaughtException', e => { if (benign(e)) return; console.error(e); process.exit(1); });
process.on('unhandledRejection', e => { if (benign(e)) return; console.error(e); process.exit(1); });

function args() {
	const a = { fps: 12, max: 4500, seed: 1, warm: 2500, size: '800x600', loop: false, tail: 4, zoom: 0, duration: 0 };
	const v = process.argv.slice(2);
	for (let i = 0; i < v.length; i++) {
		const k = v[i].replace(/^--/, '');
		if (k === 'loop') { a.loop = true; continue; }
		a[k] = v[++i];
	}
	for (const k of ['url', 'effect', 'out']) if (!a[k]) { console.error(`need --${k}`); process.exit(1); }
	for (const k of ['fps', 'max', 'seed', 'warm', 'tail', 'zoom', 'duration']) a[k] = +a[k];
	return a;
}

const A = args();
const [W, H] = A.size.split('x').map(Number);
const stepMs = 1000 / A.fps;
fs.mkdirSync(A.out, { recursive: true });

let browser = null, context, electronApp = null;
if (process.env.ELECTRON) {
	electronApp = await _electron.launch({
		executablePath: process.env.ELECTRON,
		args: ['--no-sandbox', new URL('./electron-main.cjs', import.meta.url).pathname],
		env: { ...process.env, CAP_SIZE: `${W + 40}x${H + 120}` }
	});
	context = electronApp.context();
} else {
	browser = await chromium.launch({
		executablePath: process.env.CHROME || undefined, headless: true,
		args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio']
	});
	context = await browser.newContext({ viewport: { width: W + 40, height: H + 120 }, deviceScaleFactor: 1 });
}
const finish = async code => {
	await Promise.race([electronApp ? electronApp.close() : browser.close(), new Promise(r => setTimeout(r, 5000))]).catch(() => {});
	process.exit(code);
};
setTimeout(() => { console.error('hard timeout'); process.exit(6); }, 240000).unref();

// all frames: seeded Math.random, black clear colour, preserved WebGL buffer (for toDataURL)
await context.addInitScript(seed => {
	let s = seed >>> 0;
	Math.random = () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const og = HTMLCanvasElement.prototype.getContext;
	HTMLCanvasElement.prototype.getContext = function (type, attrs) {
		if (/webgl/.test(String(type))) attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
		return og.call(this, type, attrs);
	};
	for (const C of [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext]) {
		if (!C) continue;
		const oc = C.prototype.clearColor;
		C.prototype.clearColor = function () { return oc.call(this, 0, 0, 0, 1); };
	}
}, A.seed);

await context.clock.install();
const page = electronApp ? await electronApp.firstWindow() : await context.newPage();
page.on('dialog', d => d.dismiss().catch(() => {}));
await page.goto(A.url, { waitUntil: 'load' });

let frame = null;
for (let i = 0; i < 120 && !frame; i++) {
	for (const f of page.frames()) {
		if (await f.$('#EffectViewer select').catch(() => null)) { frame = f; break; }
	}
	if (!frame) await page.waitForTimeout(500);
}
if (!frame) { console.error('EffectViewer not found: check --url / remoteClient'); await finish(2); }

const trigger = async id => {
	if (A.duration) {
		// cast auras etc.: duration normally comes from the packet (e.g. cast delayTime); spam directly like the client
		return frame.evaluate(async ([id, duration]) => {
			const S = (await import(new URL('/src/Engine/SessionStorage.js', location.origin).href)).default;
			const EM = (await import(new URL('/src/Renderer/EffectManager.js', location.origin).href)).default;
			EM.spam({ effectId: isNaN(id) ? id : Number(id), ownerAID: S.Entity.GID, otherAID: S.Entity.GID,
				position: S.Entity.position, duration, startTick: Date.now() });
		}, [String(id), A.duration]);
	}
	const sel = frame.locator('#EffectViewer select').first();
	if (!(await sel.locator(`option[value="${id}"]`).count())) throw new Error(`effect ${id} is not in the EffectViewer list`);
	await sel.selectOption(String(id));
};

const hidden = await frame.evaluate(async () => {
	const S = (await import(new URL('/src/Engine/SessionStorage.js', location.origin).href)).default;
	if (!S.Entity) return false;
	S.Entity.renderEntity = function () {};
	return true;
});
if (!hidden) { console.error('could not hide the EffectViewer dummy entity'); await finish(5); }

if (A.zoom) {
	await frame.evaluate(async zoom => {
		const Camera = (await import(new URL('/src/Renderer/Camera.js', location.origin).href)).default;
		Camera.zoom = Camera.zoomFinal = zoom;
	}, A.zoom);
}

// 1) warm-up in real time so textures and sprites load
try { await trigger(A.effect); } catch (e) { console.error(String(e.message || e)); await finish(1); }
await page.waitForTimeout(A.warm);

// 2) calibration: target feet on the canvas and screen px per sprite px
const calib = await frame.evaluate(async () => {
	const canvas = document.querySelector('canvas');
	const out = { canvas: [canvas.width, canvas.height], anchor: null, pxPerSpritePx: null, note: '' };
	const Camera = (await import(new URL('/src/Renderer/Camera.js', location.origin).href)).default;
	const mv = Camera.modelView, pr = Camera.projection;
	const mul = (m, v) => [0, 1, 2, 3].map(r => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]);
	const view = mul(mv, [0.5, 0, 0.5, 1]);
	const toScreen = v => {
		const c = mul(pr, v);
		return [(c[0] / c[3] * 0.5 + 0.5) * canvas.width, (1 - (c[1] / c[3] * 0.5 + 0.5)) * canvas.height];
	};
	const a = toScreen(view);
	const b = toScreen([view[0] + 1, view[1], view[2], view[3]]);
	out.anchor = a;
	out.pxPerSpritePx = (b[0] - a[0]) / 35; // 35 sprite px = 1 world unit
	out.zoom = Camera.zoomFinal;
	return out;
});

// 3) capture on the frozen clock
const now = await frame.evaluate(() => Date.now());
await context.clock.pauseAt(now + 1000);
await trigger(A.effect);
await page.waitForTimeout(600);

const grab = () => frame.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
let n = 0, firstContent = -1, emptyRun = 0;
const maxFrames = Math.ceil(A.max / stepMs);
for (; n < maxFrames; n++) {
	await context.clock.runFor(stepMs);
	const url = await grab();
	fs.writeFileSync(path.join(A.out, `frame_${String(n).padStart(3, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
	const empty = await frame.evaluate(() => {
		const c = document.querySelector('canvas');
		const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
		const g = t.getContext('2d'); g.drawImage(c, 0, 0);
		const d = g.getImageData(0, 0, t.width, t.height).data;
		for (let i = 0; i < d.length; i += 16) if (d[i] > 8 || d[i + 1] > 8 || d[i + 2] > 8) return false;
		return true;
	});
	if (!empty && firstContent < 0) firstContent = n;
	emptyRun = empty ? emptyRun + 1 : 0;
	if (!A.loop && firstContent >= 0 && emptyRun >= A.tail) { n++; break; }
}

const meta = { entityHidden: true, duration: A.duration || null, effectId: A.effect, stepMs, fps: A.fps, loop: A.loop, seed: A.seed, frames: n, firstContent,
	renderer: 'roBrowserLegacy EffectViewer', source: 'scRO GRF via tools/ro_remote_client.py', ...calib };
fs.writeFileSync(path.join(A.out, 'meta.json'), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta));
if (firstContent < 0) console.error('WARNING: no non-empty frame');
await finish(firstContent < 0 ? 3 : 0);
