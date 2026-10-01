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
// Статика из корня репозитория (страница берёт ../../assets, ../shots): простой сервер python (vite отдавал 500).
const vite = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { stdio: 'ignore', detached: true });
for (let i = 0; i < 300; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break;
  } catch {
    /* ждём */
  }
  await sleep(200);
}
const browser = await chromium.launch({ headless: true });
let CUTS = [];
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  page.setDefaultTimeout(300000);
  page.on('console', (m) => m.type() !== 'log' && console.log('[page]', m.text()));
  await page.goto(`http://127.0.0.1:${PORT}/promo/src/video.html`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  CUTS = await page.evaluate(() => window.CUTS ?? []);
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

// Звук (01.10): «Backattack!!» (music_battle_desert — бой в пирамидах, самый быстрый и плотный трек игры по огибающей
// громкости и частоте атак) с 5.19 с — вступление идёт под логотип, удар барабанов ложится на касание ульты (3.0 с), с ~17 с
// трек ещё плотнее. Звуки RO на сменах сцен: свуш на каждом стыке (CUTS из video.html), удар на логотипе, звук Асуры и
// тяжёлый удар на 4.4 с, лёд на снежной буре, удары на боссах, призыв в таверне, касание кнопки «Играть».
// Громкость выровнена (loudnorm −14 LUFS), затухание с 28 с.
const ff = execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' }).trim();
const sfx = [
  ['crit', 0.6, 0.9],
  ['skl_asura', 3.05, 0.8],
  ['charge_break', 4.4, 1.1],
  ['cast_ice', 6.4, 0.7],
  ['hit_blunt', 8.6, 0.8], ['hit_blunt', 9.8, 0.8], ['hit_blunt', 11.0, 0.8],
  ['crit_v2', 12.2, 0.8],
  ['summon_epic', 17.0, 0.6],
  ['level_up', 25.45, 0.6],
  ['ui_tap', 28.2, 0.9],
  ...CUTS.filter((c) => c > 1 && ![4.4, 8.6, 12.2].includes(c)).map((c) => ['swing', Math.max(0, c - 0.08), 0.55]),
];
const inputs = ['-framerate', String(FPS), '-i', join(FRAMES, 'f%04d.jpg'), '-ss', '5.19', '-t', String(DUR), '-i', 'assets/audio/music_battle_desert.ogg'];
const chains = ['[1:a]volume=0.9,afade=t=in:st=0:d=0.2[m]'];
sfx.forEach(([name, at, vol], i) => {
  inputs.push('-i', `assets/audio/${name}.ogg`);
  const ms = Math.round(at * 1000);
  chains.push(`[${i + 2}:a]aformat=channel_layouts=stereo,adelay=${ms}|${ms},volume=${vol}[s${i}]`);
});
chains.push(`[m]${sfx.map((_, i) => `[s${i}]`).join('')}amix=inputs=${sfx.length + 1}:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=9,afade=t=out:st=28:d=2,alimiter=limit=0.95[a]`);
const args = [
  '-y', '-hide_banner', '-loglevel', 'error',
  ...inputs,
  '-filter_complex', chains.join(';'),
  '-map', '0:v', '-map', '[a]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-maxrate', '4.5M', '-bufsize', '9M', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1',
  '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
  '-t', String(DUR), '-movflags', '+faststart',
  OUT,
];
execFileSync(ff, args, { stdio: 'inherit' });
console.log('готово:', OUT);
