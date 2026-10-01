#!/usr/bin/env node
// Рендер React-промо в mp4 той же анимацией, что на странице: dist (vite build) раздаётся `python3 -m http.server`,
// Chromium (Playwright из глобального npm root) открывает ?render=1, на каждый кадр зовёт window.seek(t) — анимации
// посчитаны от времени, кадр детерминирован. Кадры JPEG → ffmpeg (pip install imageio-ffmpeg) → H.264 yuv420p +
// AAC (музыка + удары из window.promo.IMPACTS), faststart.
//   node render.mjs                              — out/chronoworld_react_30s.mp4 (1080×1920, 30 fps)
//   node render.mjs preview 390x844 1,4.2,8.4    — снимки живой страницы (с кнопками) в .work/preview
//   node render.mjs frames 0.9,8.3               — отдельные кадры рендера в .work/preview
import { execFileSync, execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, 'dist');
const WORK = join(HERE, '.work');
const OUT = join(HERE, 'out', 'chronoworld_react_30s.mp4');
const PORT = Number(process.env.PROMO_REACT_PORT ?? 5262);
const FPS = 30;
const W = 1080;
const H = 1920;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [mode, a1, a2] = process.argv.slice(2);

const ffmpeg = execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' }).trim();
if (!existsSync(join(DIST, 'index.html')) || process.env.PROMO_BUILD !== '0') {
  execSync('npx vite build', { cwd: HERE, stdio: 'inherit' });
}

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', DIST], { stdio: 'ignore' });
const base = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {
    /* ждём сервер */
  }
  await sleep(100);
}

const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
const { chromium } = await import(pathToFileURL(join(root, 'playwright', 'index.mjs')).href);
const browser = await chromium.launch({ headless: true });

try {
  if (mode === 'preview') await preview(a1 ?? '390x844', (a2 ?? '1,4.2,8.6,13,22,33.5').split(',').map(Number));
  else if (mode === 'frames') await frames((a1 ?? '0.9,8.3').split(',').map(Number));
  else await render();
} finally {
  await browser.close();
  server.kill();
}

async function openRender() {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120000);
  await page.goto(`${base}?render=1`);
  await page.evaluate(() => window.promoReady);
  return page;
}

async function preview(size, times) {
  const [w, h] = size.split('x').map(Number);
  mkdirSync(join(WORK, 'preview'), { recursive: true });
  for (const t of times) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: w < 600 ? 2 : 1 });
    await page.goto(`${base}?t=${t}`);
    await page.evaluate(() => window.promoReady);
    await page.evaluate((x) => window.seek(x), t);
    await sleep(700); // подгрузка кадров живой страницы
    await page.evaluate(() => Promise.all([...document.images].map((im) => im.decode().catch(() => {}))));
    await page.evaluate((x) => window.seek(x), t);
    const file = join(WORK, 'preview', `${size}_${String(t).replace('.', '_')}.png`);
    await page.screenshot({ path: file });
    console.log(file);
    await page.close();
  }
}

async function frames(times) {
  mkdirSync(join(WORK, 'preview'), { recursive: true });
  const page = await openRender();
  for (const t of times) {
    await page.evaluate((x) => window.seek(x), t);
    const file = join(WORK, 'preview', `render_${String(t).replace('.', '_')}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
    console.log(file);
  }
}

async function render() {
  const page = await openRender();
  const { DUR, IMPACTS } = await page.evaluate(() => window.promo);
  const n = Math.round(DUR * FPS);
  mkdirSync(dirname(OUT), { recursive: true });
  mkdirSync(WORK, { recursive: true });
  const silent = join(WORK, 'video.mp4');
  rmSync(silent, { force: true });

  // Кадры потоком в ffmpeg (mjpeg по трубе) — без тысячи файлов на диске.
  const enc = spawn(
    ffmpeg,
    ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', process.env.PROMO_CRF ?? '24', '-pix_fmt', 'yuv420p', '-r', String(FPS), silent],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await page.evaluate((x) => window.seek(x), i / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
    if (!enc.stdin.write(buf)) await new Promise((r) => enc.stdin.once('drain', r));
    if (i % 60 === 0) console.log(`кадр ${i}/${n} · ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  }
  enc.stdin.end();
  await new Promise((r, j) => enc.on('close', (c) => (c === 0 ? r() : j(new Error(`ffmpeg ${c}`)))));

  // Звук: музыка (35 с, уже с затуханием) + удары в моменты IMPACTS — тот же микс, что на странице.
  const audio = join(DIST, 'audio');
  const inputs = ['-i', silent, '-i', join(audio, 'music_promo.ogg')];
  const parts = ['[1:a]volume=0.55[m]'];
  IMPACTS.forEach((imp, k) => {
    inputs.push('-i', join(audio, `${imp.s}.ogg`));
    const ms = Math.round(imp.t * 1000);
    parts.push(`[${k + 2}:a]aresample=44100,volume=${(0.5 + imp.f * 0.4).toFixed(2)},adelay=${ms}|${ms}[s${k}]`);
  });
  const mix = `[m]${IMPACTS.map((_, k) => `[s${k}]`).join('')}amix=inputs=${IMPACTS.length + 1}:normalize=0:duration=first,alimiter=limit=0.95[a]`;
  execFileSync(ffmpeg, [
    '-y', '-loglevel', 'error', ...inputs, '-filter_complex', [...parts, mix].join(';'),
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-t', String(DUR),
    '-movflags', '+faststart', OUT,
  ], { stdio: 'inherit' });
  const mb = statSync(OUT).size / 1048576;
  console.log(`${OUT}: ${mb.toFixed(1)} МБ, ${n} кадров, ${((Date.now() - t0) / 1000).toFixed(0)} с`);
}
