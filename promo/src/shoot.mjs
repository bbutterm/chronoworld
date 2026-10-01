#!/usr/bin/env node
// Скриншоты для промо: экран телефона 390×844 CSS px × 1080/390 = 1080×2338 (PROMO_VIEW=405x720 — ровно 1080×1920). Сохранения — promo/src/saves.ts и
// scripts/tower-shots-save.ts (папка promo/.work). Бой — цикл Phaser вручную (game.step по 16.7 мс, как
// scripts/skillfx-shots.mjs): ульты касаются сразу, «сбивающие» ульты ждут заряда босса; кадры — в моменты ульт,
// «Заряд!» и «Сбито!». Кнопки тестировщика спрятаны (?tester=0). Playwright — глобальный (npm root -g).
//   node promo/src/shoot.mjs [battle|hunt|tower|screens …]   → promo/.work/raw/*.png
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.PROMO_PORT ?? 5251);
const URL = `http://localhost:${PORT}/?tester=0`;
const WORK = 'promo/.work';
const RAW = join(WORK, 'raw');
mkdirSync(RAW, { recursive: true });
const only = process.argv.slice(2);
// Экран телефона в CSS px (ширина × 1080/VW = 1080 px): 390×844 — iPhone (кадр 1080×2338), 405×720 — 9:16.
const [VW, VH] = (process.env.PROMO_VIEW ?? '390x844').split('x').map(Number);
const want = (k) => !only.length || only.includes(k);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[promo]', ...a);
const saves = JSON.parse(readFileSync(join(WORK, 'saves.json'), 'utf8'));
const tower = JSON.parse(readFileSync(join(WORK, 'tower-saves.json'), 'utf8'));

const HINTS = ['home_campaign', 'stage_fight', 'prep_auto', 'battle_speed', 'result_next', 'result_home', 'chest_claim', 'level_up',
  'tavern_summon', 'ascend', 'fast_rewards', 'quests_open', 'tower_open', 'equip_gear', 'branch_pick', 'tip_tower', 'tip_hunt',
  'tip_evening', 'tip_expedition', 'tip_boss_charge'];

const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
const { chromium } = await import(pathToFileURL(join(root, 'playwright', 'index.mjs')).href);

async function startVite() {
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let out = '';
  vite.stdout.on('data', (d) => (out += d));
  vite.stderr.on('data', (d) => (out += d));
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return vite;
    } catch {
      /* ещё не поднялся */
    }
    await sleep(200);
  }
  throw new Error(`vite не ответил:\n${out}`);
}

/** Сдвиг часов игры (дней вперёд), чтобы MVP дня был нужным: bosses[dayNumber mod 14]. */
function dayNumber(day) {
  let y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10));
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}
function shiftForMvp(unit) {
  const list = JSON.parse(readFileSync('data/hunt.json', 'utf8')).bosses.map((b) => b.unit);
  const idx = list.indexOf(unit);
  for (let k = 0; k < 60; k++) {
    const t = new Date(Date.now() + k * 86_400_000);
    const local = new Date(t.getTime() - t.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    if (((dayNumber(local) % list.length) + list.length) % list.length === idx) return k;
  }
  throw new Error(unit);
}

let browser;
async function open(save, { shiftDays = 0, scene = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1080 / VW });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('pageerror', String(e).slice(0, 200)));
  await page.addInitScript(([save, shift, hints]) => {
    if (sessionStorage.getItem('promo-init')) return;
    localStorage.clear();
    localStorage.setItem('chronoworld.save.v1', save);
    if (shift) localStorage.setItem('chronoworld.timeShift', String(shift));
    localStorage.setItem('chronoworld.battleAutoUlt', '0');
    localStorage.setItem('chronoworld.hint.manualUlt', '1');
    localStorage.setItem('chronoworld.hint.bossCharge', '9');
    localStorage.setItem('chronoworld.hints', JSON.stringify(hints));
    localStorage.setItem('chronoworld.hintsShown', JSON.stringify(hints));
    localStorage.setItem('chronoworld.audio', JSON.stringify({ music: 0, sfx: 0, muted: true }));
    sessionStorage.setItem('promo-init', '1');
  }, [save, shiftDays * 86_400_000 + 3_600_000, HINTS]);
  await page.goto(URL, { timeout: 180000 });
  await page.waitForFunction(() => window.__game?.scene?.getScenes(true).some((s) => !['Boot', 'Preload'].includes(s.scene.key)), null, { timeout: 90000, polling: 200 });
  await sleep(1500);
  if (scene) await go(page, scene.key, scene.data);
  return page;
}

async function go(page, key, data = {}) {
  await page.evaluate(([k, d]) => {
    const g = window.__game;
    for (const s of g.scene.getScenes(true)) g.scene.stop(s.scene.key);
    g.scene.start(k, d);
  }, [key, data]);
  await sleep(2200);
}

async function shot(page, name) {
  const f = join(RAW, `${name}.png`);
  const t0 = Date.now();
  await page.evaluate(() => 1);
  const t1 = Date.now();
  await page.screenshot({ path: f, timeout: 180000 });
  if (Date.now() - t0 > 3000) log("slow shot", t1 - t0, Date.now() - t1);
  log(f);
}

/**
 * Бой кадр за кадром. startData — данные сцены Battle. Возвращает число кадров.
 * Кадры: intro (1.5 с), ult_<навык>_<мс>, charge_<мс>, break_<мс>, end.
 */
async function battle(page, tag, startData, { maxShots = 60, holdBreakers = true } = {}) {
  maxShots = Number(process.env.PROMO_MAX ?? maxShots);
  await page.evaluate((d) => {
    const g = window.__game;
    for (const s of g.scene.getScenes(true)) g.scene.stop(s.scene.key);
    g.scene.start('Battle', d);
  }, startData);
  await page.waitForFunction(() => window.__game.scene.getScene('Battle')?.ready === true, null, { timeout: 60000, polling: 100 });
  await page.evaluate((hold) => {
    const g = window.__game;
    g.loop.sleep();
    const sc = g.scene.getScene('Battle');
    window.__cap = { t: performance.now(), last: 0, queue: [{ at: sc.time.now + 1500, name: 'intro' }], sc, hold, seenUlt: {}, readySince: {} };
  }, holdBreakers);
  let n = 0;
  for (let guard = 0; guard < 4000 && n < maxShots; guard++) {
    const due = await page.evaluate(() => {
      const c = window.__cap;
      const g = window.__game;
      const sc = c.sc;
      for (let f = 0; f < 900; f++) {
        const ready = c.queue.findIndex((q) => q.at <= sc.time.now);
        if (ready >= 0) return c.queue.splice(ready, 1)[0];
        if (sc.finished || !g.scene.isActive('Battle')) return c.queue.length ? c.queue.shift() : { end: true };
        c.t += 1000 / 60;
        g.step(c.t, 1000 / 60);
        const log = sc.result.log;
        for (; c.last < sc.cursor; c.last++) {
          const e = log[c.last];
          const v = sc.views.get(e.unit);
          if (e.type === 'ult' && v?.snap.side === 'A') {
            const k = (c.seenUlt[e.skill] = (c.seenUlt[e.skill] ?? 0) + 1);
            if (k <= 2) for (const o of [250, 600]) c.queue.push({ at: sc.time.now + o, name: `ult_${e.skill}_${k}_${o}` });
          }
          if (e.type === 'cast' && e.charge && e.action !== 'interrupt') {
            c.chargeAt = sc.time.now;
            for (const o of [120]) c.queue.push({ at: sc.time.now + o, name: `charge_${Math.round(e.t)}_${o}` });
            for (const o of [500, 1000]) c.queue.push({ at: sc.time.now + o, name: `charge_${Math.round(e.t)}_${o}` });
          }
          if (e.type === 'cast' && e.action === 'interrupt' && e.reason === 'break') {
            for (const o of [150, 400, 750]) c.queue.push({ at: sc.time.now + o, name: `break_${Math.round(e.t)}_${o}` });
          }
        }
        // Ульты: обычные — сразу; сбивающие заряд — на заряде (или если до заряда > 8 с).
        if (sc.manual && !sc.finished) {
          const nextCharge = log.slice(sc.cursor).find((e) => e.type === 'cast' && e.charge && e.action !== 'interrupt');
          for (const [uid] of sc.ultSkill) {
            if (!sc.heroPanel?.isReady(uid)) continue;
            const breaker = sc.heroPanel.items?.find?.((x) => x.uid === uid)?.breaks ?? false;
            const sk = sc.ultSkill.get(uid);
            const brk = sk.effects.some((x) => x.type === 'status' && (x.status.stun || x.status.interrupt));
            const soon = nextCharge && nextCharge.t - sc.clock < 8;
            const charging = c.chargeAt !== undefined && sc.time.now - c.chargeAt < 2500;
            if (c.hold && (brk || breaker) && ((soon && !charging) || (charging && sc.time.now - c.chargeAt < 1300))) continue;
            sc.tapUlt(uid);
          }
        }
      }
      return { wait: true };
    });
    if (due.end) break;
    if (due.wait) continue;
    log("due", JSON.stringify(due));
    await shot(page, `${tag}_${due.name}`);
    n++;
  }
  await shot(page, `${tag}_end`);
  return n;
}

const vite = await startVite();
try {
  browser = await chromium.launch({ headless: true });
  if (want('screens')) {
    const p = await open(saves.storm);
    await shot(p, 'home');
    await go(p, 'Heroes');
    await shot(p, 'heroes');
    const ids = await p.evaluate(() => JSON.parse(localStorage.getItem('chronoworld.save.v1')).heroes.map((h) => [h.id, h.templateId]));
    for (const t of ['lira', 'vika', 'alan', 'kai']) {
      await go(p, 'Hero', { heroId: ids.find((x) => x[1] === t)[0] });
      await shot(p, `hero_${t}`);
    }
    await go(p, 'Tavern');
    await shot(p, 'tavern_summon');
    await go(p, 'Campaign');
    await shot(p, 'campaign');
    // Вечер в таверне: модуль сцены из vite (тот же экземпляр, что у игры).
    for (const id of ['tav_ch1', 'tav_ch5', 'tav_ch9']) {
      await p.evaluate(async (id) => {
        const g = window.__game;
        const m = await import('/src/game/scenes/TavernEveningScene.ts');
        const from = g.scene.getScenes(true)[0];
        m.startTavernEvening(from, { mode: 'evening', id, back: { to: 'Home' } });
      }, id);
      await sleep(2500);
      await shot(p, `evening_${id}_1`);
      for (let k = 2; k <= 4; k++) {
        await p.mouse.click(200, 400);
        await sleep(1400);
        await shot(p, `evening_${id}_${k}`);
      }
    }
    await p.evaluate(async () => {
      const g = window.__game;
      const m = await import('/src/game/scenes/TavernEveningScene.ts');
      m.startTavernEvening(g.scene.getScenes(true)[0], { mode: 'hub', back: { to: 'Home' } });
    });
    await sleep(2500);
    await shot(p, 'evening_hub');
    await p.context().close();
  }
  if (want('battle')) {
    for (const name of (process.env.PROMO_SQUADS ?? Object.keys(saves).join(',')).split(',')) {
      const save = saves[name];
      const p = await open(save);
      log(name, 'кадров', await battle(p, `battle_${name}`, { mode: 'stage', stageId: process.env.PROMO_STAGE ?? 'ch9_s18' }));
      await p.context().close();
    }
  }
  if (want('hunt')) {
    for (const mvp of (process.env.PROMO_MVPS ?? 'mvp_dracula,mvp_baphomet,mvp_pharaoh,mvp_osiris').split(',')) {
      const p = await open(saves.storm, { shiftDays: shiftForMvp(mvp) });
      await go(p, 'Hunt');
      await shot(p, `hunt_${mvp}_screen`);
      log(mvp, 'кадров', await battle(p, `hunt_${mvp}`, { mode: 'hunt' }, { maxShots: 30 }));
      await p.context().close();
    }
  }
  if (want('tower')) {
    for (const k of ['lobby', 'run', 'bless', 'event']) {
      const p = await open(tower[k]);
      await go(p, 'Tower');
      await shot(p, `tower_${k}`);
      await p.context().close();
    }
    const p = await open(tower.battle);
    log('tower battle', await battle(p, 'tower_battle', { mode: 'tower' }, { maxShots: 16 }));
    await p.context().close();
  }
} finally {
  await browser?.close();
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    vite.kill('SIGKILL');
  }
}
