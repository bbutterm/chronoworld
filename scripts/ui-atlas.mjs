#!/usr/bin/env node
// Атлас экранов: снимки всех экранов игры для каждого сохранения (new/mid/late) и размера окна — для проходов полировки UI.
//   npm run ui:atlas -- [--out ui-atlas] [--sizes 390x844,360x640] [--saves new,mid,late] [--only Home,Stage]
//                       [--parallel 3] [--dpr 1] [--png]
// Сохранения — scripts/ui-atlas-save.ts (детерминированные; часы — «сейчас»). Сам поднимает vite на ATLAS_PORT (5195).
// Экраны открываются напрямую (window.__game.scene.start, только dev-сборка), бой проигрывается по кадрам вручную
// (как scripts/behavior-shots.mjs): кадр на 3-й секунде, кадр ульты, затем «Пропустить» → итоги.
// Выход: <save>_<WxH>_<Экран>.jpg, index.html (листы по экранам), errors.txt (ошибки консоли по экранам).
// Playwright глобальный (npm root -g), Chromium — из PLAYWRIGHT_BROWSERS_PATH; скрипт ничего не устанавливает.
import { execFileSync, execSync, spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const PORT = Number(process.env.ATLAS_PORT ?? 5195);
const URL = `http://localhost:${PORT}/`;
const OUT = resolve(arg('out', 'ui-atlas'));
const SIZES = arg('sizes', '390x844,360x640')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const SAVES = arg('saves', 'new,mid,late').split(',').filter(Boolean);
const ONLY = arg('only', '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const PARALLEL = Math.max(1, Number(arg('parallel', '3')));
const DPR = Number(arg('dpr', '1'));
const PNG = process.argv.includes('--png');
const EXT = PNG ? 'png' : 'jpg';
const SAVE_KEY = 'chronoworld.save.v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[atlas]', ...a);

async function loadPlaywright() {
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return import(pathToFileURL(join(root, 'playwright', 'index.mjs')).href);
}

async function startVite() {
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let out = '';
  let exited = null;
  vite.stdout.on('data', (d) => (out += d));
  vite.stderr.on('data', (d) => (out += d));
  vite.on('exit', (code) => (exited = code));
  for (let i = 0; i < 150; i++) {
    if (exited !== null) throw new Error(`vite завершился с кодом ${exited} (порт ${PORT} занят? ATLAS_PORT=…):\n${out}`);
    try {
      if ((await fetch(URL)).ok) return vite;
    } catch {
      // ещё не поднялся
    }
    await sleep(200);
  }
  throw new Error(`vite не ответил за 30 с:\n${out}`);
}

function stopVite(vite) {
  if (!vite || vite.exitCode !== null) return;
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    vite.kill('SIGKILL');
  }
}

/**
 * Экраны по порядку. key — сцена Phaser; data(meta) — данные create(); prep — правка сохранения перед показом (на время
 * снимка, потом сохранение возвращается); add — модуль сцены, которую игра регистрирует при первом показе.
 * Бой — последним: он меняет сохранение.
 */
const SCREENS = [
  { name: 'Home', key: 'Home' },
  { name: 'Campaign', key: 'Campaign' },
  { name: 'Adventure', key: 'Adventure' },
  { name: 'Stage', key: 'Stage', data: (m) => ({ stageId: m.stageId }) },
  { name: 'Squad', key: 'Squad', data: (m) => ({ back: { to: 'Stage', data: { stageId: m.stageId } } }) },
  { name: 'Prep', key: 'Prep' },
  { name: 'Heroes', key: 'Heroes' },
  { name: 'Hero', key: 'Hero', data: (m) => ({ heroId: m.heroId }) },
  { name: 'HeroGear', key: 'Hero', data: (m) => ({ heroId: m.heroId, tab: 'gear' }) },
  { name: 'Ascend', key: 'Ascend', data: (m) => ({ heroId: m.heroId }) },
  { name: 'HeroPick', key: 'HeroPick', prep: 'pick' },
  { name: 'Tavern', key: 'Tavern' },
  { name: 'TavernEvening', key: 'TavernEvening', add: ['/src/game/scenes/TavernEveningScene.ts', 'TavernEveningScene'] },
  { name: 'Shop', key: 'Shop' },
  { name: 'Quests', key: 'Quests' },
  { name: 'Events', key: 'Events' },
  { name: 'Mail', key: 'Mail' },
  { name: 'Friends', key: 'Friends' },
  { name: 'Tower', key: 'Tower' },
  { name: 'Hunt', key: 'Hunt' },
  { name: 'Expeditions', key: 'Expeditions' },
  { name: 'Inventory', key: 'Inventory' },
  { name: 'Achievements', key: 'Achievements' },
  { name: 'Chronicle', key: 'Chronicle' },
  // Страница летописи главы всплывает через 1,4 с — снимаем её (ChapterDonePage), закрываем и снимаем сам экран.
  {
    name: 'ChapterDone',
    key: 'ChapterDone',
    data: (m) => ({ chapterId: m.chapterId }),
    add: ['/src/game/scenes/ChapterDoneScene.ts', 'ChapterDoneScene'],
    settle: 2600,
    pageShot: 'ChapterDonePage',
  },
  { name: 'UnlockBanner', key: 'Home', prep: 'unlock', modal: 'unlockBanner' },
  { name: 'Battle', battle: true },
  { name: 'BattleUlt', battle: true },
  { name: 'Result', battle: true },
];
const want = (name) => !ONLY.length || ONLY.includes(name.toLowerCase()) || (ONLY.includes('battle') && ['BattleUlt', 'Result'].includes(name));
const screens = SCREENS.filter((s) => want(s.name));

/** Ждать, пока сцена активна, листы догружены и экран построен. */
async function waitScene(page, key, timeout = 20000) {
  await page.waitForFunction(
    (k) => window.__game?.scene?.isActive(k) && !window.__sprites?.busy() && window.__game.scene.getScene(k).ready !== false,
    key,
    { timeout, polling: 100 },
  );
}

/** Клик по видимому тексту сцены (как в e2e.mjs): координаты мира → окно. */
async function clickText(page, key, label) {
  const pos = await page.evaluate(
    ([k, l]) => {
      const all = (list) => list.flatMap((o) => (o.list ? [o, ...all(o.list)] : [o]));
      const found = all(window.__game.scene.getScene(k).children.list).find((o) => o.type === 'Text' && o.text === l && o.visible);
      if (!found) return null;
      const b = found.getBounds();
      const v = window.__view?.() ?? { worldX: 0, worldY: 0, worldW: 1080 };
      return [b.centerX, b.centerY, v.worldX, v.worldY, v.worldW];
    },
    [key, label],
  );
  if (!pos) return false;
  const box = await page.locator('canvas').boundingBox();
  const s = box.width / pos[4];
  await page.mouse.click(box.x + (pos[0] - pos[2]) * s, box.y + (pos[1] - pos[3]) * s);
  return true;
}

/** Закрыть сюжетные диалоги поверх экрана («Пропустить»). Возвращает, сколько закрыто. */
async function skipDialogues(page, key) {
  let n = 0;
  for (; n < 6; n++) {
    const open = await page.evaluate((k) => window.__game.scene.isActive(k) && !!window.__game.scene.getScene(k).children.getByName('dialogue'), key);
    if (!open) break;
    await sleep(300);
    if (!(await clickText(page, key, 'Пропустить'))) break;
    await sleep(400);
  }
  return n;
}

/** Какая сцена сейчас на экране (кроме служебных). */
const activeScenes = (page) => page.evaluate(() => window.__game.scene.getScenes(true).map((s) => s.scene.key));

/** Остановить все сцены и открыть key (зарегистрировать сцену, если игра добавляет её при первом показе). */
async function openScene(page, key, data, add) {
  await page.evaluate(
    async ([k, d, a]) => {
      const g = window.__game;
      if (a && !g.scene.getScene(k)) {
        const mod = await import(/* @vite-ignore */ a[0]);
        g.scene.add(k, mod[a[1]], false);
      }
      for (const s of g.scene.getScenes(true)) g.scene.stop(s.scene.key);
      g.scene.start(k, d ?? {});
    },
    [key, data ?? null, add ?? null],
  );
}

/** Правка сохранения на время снимка (через session/commit игры); возвращает, удалось ли. */
async function prepSave(page, kind) {
  return page.evaluate(async (kind) => {
    const S = await import('/src/game/session.ts');
    const save = S.session.save;
    window.__atlasPrev = save;
    if (kind === 'pick') {
      if (!save.pendingPicks?.length) S.commit({ ...save, pendingPicks: [{ rarity: 'purple', source: 'atlas' }] });
      return true;
    }
    if (kind === 'unlock') {
      const seen = save.seenUnlocks ?? [];
      if (!seen.length) return false;
      S.commit({ ...save, seenUnlocks: seen.slice(0, -1) });
      return true;
    }
    return false;
  }, kind);
}

async function restoreSave(page) {
  await page.evaluate(async () => {
    if (!window.__atlasPrev) return;
    const S = await import('/src/game/session.ts');
    S.commit({ ...window.__atlasPrev, revision: S.session.save.revision });
    window.__atlasPrev = null;
  });
}

/**
 * Бой этапа по кадрам: игровой цикл усыплён, шаги — вручную (как behavior-shots.mjs). until(c) — условие в странице
 * (c: { clock, ult, finished }). Возвращает итоговое состояние.
 */
async function stepBattle(page, until, extraFrames = 0) {
  return page.evaluate(
    ([untilSrc, extra]) => {
      const g = window.__game;
      const sc = g.scene.getScene('Battle');
      // eslint-disable-next-line no-new-func
      const cond = new Function('c', `return (${untilSrc})(c)`);
      window.__atlasT ??= performance.now();
      const state = () => {
        const log = sc.result?.log ?? [];
        let ult = false;
        for (let i = 0; i < Math.min(sc.cursor, log.length); i++) if (log[i].type === 'ult' && i >= (window.__atlasUltFrom ?? 0)) ult = true;
        return { clock: sc.clock, ult, finished: sc.finished || !g.scene.isActive('Battle'), cursor: sc.cursor };
      };
      let c = state();
      for (let f = 0; f < 60 * 90 && !c.finished && !cond(c); f++) {
        window.__atlasT += 1000 / 60;
        g.step(window.__atlasT, 1000 / 60);
        c = state();
      }
      for (let f = 0; f < extra && !c.finished; f++) {
        window.__atlasT += 1000 / 60;
        g.step(window.__atlasT, 1000 / 60);
        c = state();
      }
      return c;
    },
    [until.toString(), extraFrames],
  );
}

/** Снять один прогон: сохранение × размер. Возвращает список { screen, file?, skip?, note? }. */
async function runCombo(browser, saveName, meta, size, hints) {
  const [vw, vh] = size.split('x').map(Number);
  const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: DPR, hasTouch: false });
  const page = await context.newPage();
  const tag = `${saveName}_${size}`;
  let current = 'Boot';
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${tag} ${current}: pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' || /favicon/.test(m.location()?.url ?? '')) return;
    errors.push(`${tag} ${current}: console.error: ${m.text()}`);
  });
  await page.addInitScript(
    ([key, save, hints]) => {
      if (sessionStorage.getItem('atlas-init')) return;
      localStorage.clear();
      localStorage.setItem(key, save);
      localStorage.setItem('chronoworld.hints', JSON.stringify(hints));
      localStorage.setItem('chronoworld.hintsShown', JSON.stringify(hints));
      localStorage.setItem('chronoworld.battleAutoUlt', '1');
      localStorage.setItem('chronoworld.hint.manualUlt', '1');
      localStorage.setItem('chronoworld.hint.bossCharge', '1');
      sessionStorage.setItem('atlas-init', '1');
    },
    [SAVE_KEY, meta.save, hints],
  );
  const results = [];
  const shoot = async (name, note) => {
    const file = `${tag}_${name}.${EXT}`;
    await page.screenshot({ path: join(OUT, file), ...(PNG ? {} : { type: 'jpeg', quality: 85 }) });
    results.push({ save: saveName, size, screen: name, file, note });
  };
  const skip = (name, why) => {
    results.push({ save: saveName, size, screen: name, skip: why });
    log(`${tag} ${name}: пропущен — ${why}`);
  };
  try {
    await page.goto(URL);
    await page.waitForFunction(() => window.__game?.scene?.getScenes(true).some((s) => s.scene.key !== 'Boot'), null, { timeout: 90000, polling: 200 });
    await sleep(500);
    let battleDone = false;
    for (const sc of screens) {
      current = sc.name;
      if (sc.battle) {
        if (battleDone) continue;
        battleDone = true;
        await battleShots(page, meta, shoot, skip);
        continue;
      }
      try {
        if (sc.prep && !(await prepSave(page, sc.prep))) {
          skip(sc.name, 'нечего показать в этом сохранении');
          continue;
        }
        await openScene(page, sc.key, sc.data?.(meta), sc.add);
        await waitScene(page, sc.key);
        await sleep(350);
        if (sc.settle) await sleep(sc.settle);
        if (sc.pageShot && (await page.evaluate((k) => !!window.__game.scene.getScene(k).children.getByName('dialogue'), sc.key))) await shoot(sc.pageShot);
        await skipDialogues(page, sc.key);
        if (sc.modal) {
          const hasModal = ([k, n]) => !!window.__game.scene.getScene(k).children.getByName(n);
          const shown = await page
            .waitForFunction(hasModal, [sc.key, sc.modal], { timeout: 4000, polling: 100 })
            .then(() => true)
            .catch(() => false);
          if (!shown) {
            // Экран не позвал баннер сам (бывает, если сохранение поменялось между create и снимком) — зовём напрямую.
            await page.evaluate(async (k) => {
              const S = await import('/src/game/session.ts');
              const seen = S.session.save.seenUnlocks ?? [];
              if (window.__atlasPrev && seen.length >= (window.__atlasPrev.seenUnlocks ?? []).length) S.commit({ ...S.session.save, seenUnlocks: seen.slice(0, -1) });
              const U = await import('/src/game/unlockBanner.ts');
              U.showUnlockBanners(window.__game.scene.getScene(k));
            }, sc.key);
            await page.waitForFunction(hasModal, [sc.key, sc.modal], { timeout: 4000, polling: 100 });
          }
        }
        await sleep(650);
        const active = await activeScenes(page);
        const note = active.includes(sc.key) ? undefined : `открылся ${active.join(', ')}`;
        await shoot(sc.name, note);
        if (note) log(`${tag} ${sc.name}: ${note}`);
      } catch (e) {
        const active = await activeScenes(page).catch(() => []);
        skip(sc.name, `${String(e.message ?? e).split('\n')[0]} (на экране: ${active.join(', ') || '—'})`);
      } finally {
        if (sc.prep) await restoreSave(page).catch(() => {});
      }
    }
  } catch (e) {
    skip('Boot', String(e.message ?? e).split('\n')[0]);
  } finally {
    await context.close();
  }
  log(`${tag}: снимков ${results.filter((r) => r.file).length}, пропущено ${results.filter((r) => r.skip).length}, ошибок консоли ${errors.length}`);
  return { results, errors };
}

/** Бой этапа: 3-я секунда, момент ульты, итоги. */
async function battleShots(page, meta, shoot, skip) {
  const wanted = (n) => screens.some((s) => s.name === n);
  try {
    await openScene(page, 'Battle', { mode: 'stage', stageId: meta.stageId });
    await waitScene(page, 'Battle', 40000);
    await skipDialogues(page, 'Battle');
    await page.evaluate(() => {
      window.__game.loop.sleep();
      window.__atlasT = performance.now();
    });
    let c = await stepBattle(page, (c) => c.clock >= 3);
    if (wanted('Battle')) {
      if (c.finished) skip('Battle', 'бой кончился раньше 3 с');
      else await shoot('Battle');
    }
    if (wanted('BattleUlt')) {
      await page.evaluate(() => (window.__atlasUltFrom = window.__game.scene.getScene('Battle').cursor));
      c = await stepBattle(page, (c) => c.ult, 24);
      if (c.finished || !c.ult) skip('BattleUlt', 'ульты до конца боя не было');
      else await shoot('BattleUlt');
    }
    if (wanted('Result')) {
      await page.evaluate(() => {
        const g = window.__game;
        const sc = g.scene.getScene('Battle');
        if (g.scene.isActive('Battle') && !sc.finished) sc.skip();
        g.loop.wake();
      });
      await waitScene(page, 'Result', 30000);
      // Итоги проявляются по одной (ResultScene.ready — кнопки на экране, сюжет уже открыт).
      await page.waitForFunction(() => window.__game.scene.getScene('Result').ready, null, { timeout: 8000, polling: 100 }).catch(() => {});
      await sleep(400);
      await skipDialogues(page, 'Result');
      await sleep(1200);
      await shoot('Result');
    }
  } catch (e) {
    const active = await activeScenes(page).catch(() => []);
    skip('Battle', `${String(e.message ?? e).split('\n')[0]} (на экране: ${active.join(', ') || '—'})`);
  } finally {
    await page.evaluate(() => window.__game.loop.wake()).catch(() => {});
  }
}

function writeIndex(all, labels, seconds) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const names = [...new Set(SCREENS.flatMap((s) => (s.pageShot ? [s.name, s.pageShot] : [s.name])))].filter((n) => all.some((r) => r.screen === n));
  const sections = names
    .map((n) => {
      const rows = all.filter((r) => r.screen === n);
      const cells = rows
        .map((r) =>
          r.file
            ? `<figure><a href="${esc(r.file)}" target="_blank"><img loading="lazy" src="${esc(r.file)}" alt="${esc(r.file)}"></a><figcaption>${esc(r.save)} · ${esc(r.size)}${r.note ? ` · <b>${esc(r.note)}</b>` : ''}</figcaption></figure>`
            : `<figure class="skip"><div>пропущен</div><figcaption>${esc(r.save)} · ${esc(r.size)}<br>${esc(r.skip)}</figcaption></figure>`,
        )
        .join('\n');
      return `<section id="${esc(n)}"><h2>${esc(n)}</h2><div class="row">${cells}</div></section>`;
    })
    .join('\n');
  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Атлас экранов</title>
<style>
body{margin:0;padding:16px;background:#15130f;color:#e8e0cc;font:14px/1.4 system-ui,sans-serif}
h1{margin:0 0 4px;font-size:20px} h2{margin:24px 0 8px;font-size:17px;border-bottom:1px solid #3a342a;padding-bottom:4px}
nav a{color:#e0b860;margin-right:10px;text-decoration:none} nav{margin:8px 0 12px;line-height:1.9}
.row{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start}
figure{margin:0;width:220px} img{width:220px;height:auto;display:block;border:1px solid #3a342a;background:#000}
figcaption{font-size:12px;color:#b8ab8e;margin-top:3px} .skip div{height:120px;display:flex;align-items:center;justify-content:center;border:1px dashed #6a5a40;color:#c08060}
.meta{color:#b8ab8e;font-size:12px}
</style></head><body>
<h1>Атлас экранов</h1>
<div class="meta">${esc(new Date().toISOString())} · ${seconds} с · снимков ${all.filter((r) => r.file).length}, пропущено ${all.filter((r) => r.skip).length}<br>${labels.map(esc).join('<br>')}</div>
<nav>${names.map((n) => `<a href="#${esc(n)}">${esc(n)}</a>`).join(' ')}</nav>
${sections}
</body></html>
`;
  writeFileSync(join(OUT, 'index.html'), html);
}

async function main() {
  const t0 = Date.now();
  log(`сохранения: ${SAVES.join(', ')}; размеры: ${SIZES.join(', ')}; экранов: ${screens.length}`);
  const raw = execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/ui-atlas-save.ts', '--saves', SAVES.join(',')], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const { saves, hints } = JSON.parse(raw);
  mkdirSync(OUT, { recursive: true });
  // Старые снимки — прочь (иначе index.html и папка расходятся).
  for (const f of readdirSync(OUT)) if (/\.(jpg|png)$/.test(f) || f === 'index.html' || f === 'errors.txt') rmSync(join(OUT, f));
  const { chromium } = await loadPlaywright();
  const vite = await startVite();
  log(`vite: ${URL}`);
  let browser;
  const all = [];
  const errors = [];
  try {
    browser = await chromium.launch({ headless: true });
    const jobs = SAVES.filter((s) => saves[s]).flatMap((s) => SIZES.map((size) => [s, size]));
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const [s, size] = jobs[next++];
        const r = await runCombo(browser, s, saves[s], size, hints);
        all.push(...r.results);
        errors.push(...r.errors);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, jobs.length) }, worker));
  } finally {
    await browser?.close();
    stopVite(vite);
  }
  const order = (r) => [SAVES.indexOf(r.save), SIZES.indexOf(r.size)];
  all.sort((a, b) => order(a)[0] - order(b)[0] || order(a)[1] - order(b)[1]);
  const seconds = Math.round((Date.now() - t0) / 1000);
  writeIndex(all, SAVES.filter((s) => saves[s]).map((s) => saves[s].label), seconds);
  writeFileSync(join(OUT, 'errors.txt'), errors.length ? errors.join('\n') + '\n' : 'ошибок нет\n');
  const shots = all.filter((r) => r.file);
  const skipped = all.filter((r) => r.skip);
  log(`готово за ${seconds} с: снимков ${shots.length}, пропущено ${skipped.length}, ошибок консоли ${errors.length}`);
  for (const r of skipped) log(`  пропуск ${r.save}_${r.size} ${r.screen}: ${r.skip}`);
  for (const r of shots.filter((x) => x.note)) log(`  внимание ${r.file}: ${r.note}`);
  log(`открыть: ${join(OUT, 'index.html')}`);
}

await main();
