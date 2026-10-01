#!/usr/bin/env node
// Рендер промо-ролика: promo/src/video.html (seek(t)) → 900 кадров JPEG (30 fps × 30 с) → ffmpeg H.264 yuv420p + AAC,
// faststart → promo/video/chronoworld_promo_30s.mp4. ffmpeg — из pip-пакета imageio-ffmpeg (pip install imageio-ffmpeg).
//   node promo/src/render.mjs            — весь ролик
//   node promo/src/render.mjs 0 3        — только кадры с 0 по 3 с (проверка), без кодирования
import { execFileSync, execSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.PROMO_PORT ?? 5255);
const FPS = 30;
const DUR = 30;
const FRAMES = 'promo/.work/frames';
const OUT = 'promo/video/chronoworld_promo_30s.mp4';
// Проверка: `render.mjs 0.7,11.2,27.5` — отдельные кадры в promo/.work/preview, без кодирования.
const LIST = process.argv[2]?.includes(',') ? process.argv[2].split(',').map(Number) : null;
const [from, to] = LIST ? [] : process.argv.slice(2).map(Number);
const partial = Number.isFinite(from) || !!LIST;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!partial) rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
mkdirSync('promo/video', { recursive: true });
const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
const { chromium } = await import(pathToFileURL(join(root, 'playwright', 'index.mjs')).href);
// Статика из корня репозитория (страница берёт ../../assets, ../shots) — vite как простой сервер.
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
for (let i = 0; i < 300; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
  } catch {
    /* ждём */
  }
  await sleep(200);
}
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  page.setDefaultTimeout(300000);
  page.on('console', (m) => m.type() !== 'log' && console.log('[page]', m.text()));
  await page.goto(`http://localhost:${PORT}/promo/src/video.html`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  if (LIST) {
    mkdirSync('promo/.work/preview', { recursive: true });
    for (const t of LIST) {
      await page.evaluate((t) => window.seek(t), t);
      await page.screenshot({ path: `promo/.work/preview/t${t.toFixed(2)}.jpg`, type: 'jpeg', quality: 85 });
    }
  }
  const f0 = LIST ? 1 : partial ? Math.round(from * FPS) : 0;
  const f1 = LIST ? 0 : partial ? Math.round((to ?? from) * FPS) : DUR * FPS - 1;
  for (let f = f0; f <= f1; f++) {
    await page.evaluate((t) => window.seek(t), f / FPS);
    await page.screenshot({ path: join(FRAMES, `f${String(f).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 92 });
    if (f % 60 === 0) console.log('кадр', f);
  }
} finally {
  await browser.close();
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    vite.kill('SIGKILL');
  }
}
if (partial) process.exit(0);

// Звук: «Risk Your Life» (бой с боссом) с 7.4 с трека — вступление ложится на удар логотипа; удар на «Сбито!» (11 с)
// и на логотип (0.6 с); затухание с 27.5 с.
const ff = execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' }).trim();
const args = [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-framerate', String(FPS), '-i', join(FRAMES, 'f%04d.jpg'),
  '-ss', '7.4', '-t', String(DUR), '-i', 'assets/audio/music_boss.ogg',
  '-i', 'assets/audio/charge_break.ogg',
  '-i', 'assets/audio/crit.ogg',
  '-filter_complex',
  [
    `[1:a]volume=0.85,afade=t=in:st=0:d=0.3,afade=t=out:st=27.5:d=2.5[m]`,
    `[2:a]adelay=11000|11000,volume=1.4[b]`,
    `[3:a]asplit=2[c1][c2]`,
    `[c1]adelay=600|600,volume=0.9[s1]`,
    `[c2]adelay=25600|25600,volume=0.7[s2]`,
    `[m][b][s1][s2]amix=inputs=4:duration=first:normalize=0,alimiter=limit=0.95[a]`,
  ].join(';'),
  '-map', '0:v', '-map', '[a]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-maxrate', '5M', '-bufsize', '10M', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1',
  '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
  '-t', String(DUR), '-movflags', '+faststart',
  OUT,
];
execFileSync(ff, args, { stdio: 'inherit' });
console.log('готово:', OUT);
