#!/usr/bin/env node
// Дымовой e2e-прогон игры в браузере: сам поднимает vite, прокликивает основной путь игрока
// и падает при ошибках в консоли. Нужен Playwright, установленный глобально (npm root -g),
// и уже скачанный Chromium — скрипт ничего не устанавливает. В CI не запускается.
// Подробности: docs/content/e2e.md.
import { execSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.E2E_PORT ?? 5173);
const URL = `http://localhost:${PORT}/`;
const HEADLESS = process.env.E2E_HEADED ? false : true;
const SHOTS = resolve(process.env.E2E_SHOTS_DIR ?? join(tmpdir(), `idle-rpg-e2e-${Date.now()}`));
const GAME_W = 1080;
/** Задержка ответа на картинки при первой загрузке — чтобы увидеть экран загрузки. */
const ASSET_DELAY_MS = 700;
/** Чуть дольше отсчёта авто-прохождения (AUTO_DELAY_MS в src/game/state.ts). */
const AUTO_WAIT_MS = 2300;

const log = (...a) => console.log('[e2e]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadPlaywright() {
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  const entry = join(root, 'playwright', 'index.mjs');
  try {
    return await import(pathToFileURL(entry).href);
  } catch (e) {
    throw new Error(`Не найден глобальный Playwright (${entry}). Он нужен заранее установленным: e2e ничего не ставит.\n${e.message}`);
  }
}

/** Запустить vite и дождаться, пока он ответит. */
async function startVite() {
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let out = '';
  vite.stdout.on('data', (d) => (out += d));
  vite.stderr.on('data', (d) => (out += d));
  let exited = null;
  vite.on('exit', (code) => (exited = code));
  for (let i = 0; i < 150; i++) {
    if (exited !== null) throw new Error(`vite завершился с кодом ${exited} (порт ${PORT} занят?):\n${out}`);
    try {
      const r = await fetch(URL);
      if (r.ok) return vite;
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
    if (process.platform !== 'win32') process.kill(-vite.pid, 'SIGTERM');
    else vite.kill('SIGTERM');
  } catch {
    vite.kill('SIGKILL');
  }
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const { chromium } = await loadPlaywright();
  const vite = await startVite();
  log(`vite: ${URL}`);
  let browser;
  let page;
  const problems = [];
  try {
    browser = await chromium.launch({ headless: HEADLESS });
    page = await browser.newPage({ viewport: { width: 540, height: 960 } });
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (/favicon/.test(m.location()?.url ?? '')) return;
      problems.push(`console.error: ${m.text()} ${m.location()?.url ?? ''}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

    let shotN = 0;
    const shot = async (name) => {
      const file = join(SHOTS, `${String(++shotN).padStart(2, '0')}-${name}.png`);
      await page.screenshot({ path: file });
      log(`скриншот ${file}`);
    };
    /** Активна ли сцена (window.__game есть только в dev-сборке). */
    const waitScene = async (key, timeout = 15000) => {
      await page.waitForFunction((k) => window.__game?.scene?.isActive(k), key, { timeout });
      await sleep(250);
      log(`сцена ${key}`);
    };
    /** Клик в координатах игры (1080×1920) — канвас масштабирован под окно. */
    const clickGame = async (gx, gy) => {
      const box = await page.locator('canvas').boundingBox();
      if (!box) throw new Error('canvas не найден');
      const s = box.width / GAME_W;
      await page.mouse.click(box.x + gx * s, box.y + gy * s);
    };
    /** Найти текст в активной сцене (точное совпадение) и кликнуть по его центру. */
    const clickText = async (sceneKey, label) => {
      const pos = await page.evaluate(
        ([k, l]) => {
          const sc = window.__game.scene.getScene(k);
          const found = sc.children.list
            .flatMap((o) => (o.list ? [o, ...o.list] : [o]))
            .find((o) => o.type === 'Text' && o.text === l && o.visible);
          if (!found) return null;
          const b = found.getBounds();
          return [b.centerX, b.centerY];
        },
        [sceneKey, label],
      );
      if (!pos) throw new Error(`В сцене ${sceneKey} нет текста «${label}»`);
      await clickGame(pos[0], pos[1]);
    };
    /** Есть ли в сцене видимый текст, начинающийся с prefix (в контейнерах тоже). */
    const hasText = (sceneKey, prefix) =>
      page.evaluate(
        ([k, p]) =>
          window.__game.scene
            .getScene(k)
            .children.list.flatMap((o) => (o.list ? [o, ...o.list] : [o]))
            .some((o) => o.type === 'Text' && o.visible && o.text.startsWith(p)),
        [sceneKey, prefix],
      );

    // 1. Чистый старт: пустой localStorage, картинки чуть придержаны — видно экран загрузки.
    await page.goto(URL);
    await page.evaluate(() => localStorage.clear());
    await page.route(/\.(png|webp|jpg)$/, async (route) => {
      await sleep(ASSET_DELAY_MS);
      await route.continue();
    });
    await page.reload();
    await page.waitForFunction(() => window.__game?.scene?.getScene("Boot")?.load?.isLoading(), null, { timeout: 15000, polling: 20 });
    await sleep(100);
    await shot('loading');
    await waitScene('Home', 30000);
    await page.unroute(/\.(png|webp|jpg)$/);
    if (!(await page.locator('canvas').count())) throw new Error('canvas не найден');
    await shot('home');
    // R: новичку на главной показана подсказка «В кампанию»; она не перехватывает нажатия.
    if (!(await hasText('Home', 'Начните с кампании'))) problems.push('нет подсказки новичку на главной');

    // 2. Главная → Кампания → этап 1 → В бой.
    await clickText('Home', 'Кампания');
    await waitScene('Campaign');
    await clickText('Campaign', '1');
    await waitScene('Stage');
    await shot('stage');
    await clickText('Stage', 'В бой');
    await waitScene('Battle');

    // 3. Бой: скорость 2x запоминается; ждём баннер ульты (если случится), затем «Пропустить».
    await clickText('Battle', '1x');
    await sleep(100);
    const speed = await page.evaluate(() => localStorage.getItem('chronoworld.battleSpeed'));
    if (speed !== '2') problems.push(`кнопка скорости не запомнила 2x: ${speed}`);
    await sleep(1500);
    await shot('battle');
    if (await page.evaluate(() => window.__game.scene.isActive('Battle'))) await clickText('Battle', 'Пропустить');
    await waitScene('Result');
    await sleep(600);
    await shot('result');

    // R: «Авто: следующий этап» — включаем, ждём сам старт этапа 2, на его итоге отсчёт отменяем касанием.
    await clickText('Result', 'Авто: следующий этап');
    await waitScene('Battle', 10000);
    const autoFlag = await page.evaluate(() => localStorage.getItem('chronoworld.autoAdvance'));
    if (autoFlag !== '1') problems.push(`авто-прохождение не запомнилось: ${autoFlag}`);
    if (await page.evaluate(() => window.__game.scene.isActive('Battle'))) await clickText('Battle', 'Пропустить');
    await waitScene('Result');
    // Отсчёт идёт 2 с: придерживаем его таймер, снимаем экран, отпускаем и отменяем касанием.
    const counting = await page.evaluate(() => {
      const sc = window.__game.scene.getScene('Result');
      const on = sc.children.list.some((o) => o.type === 'Text' && o.visible && o.text.startsWith('Этап 3 через'));
      if (on && sc.autoTimer) sc.autoTimer.paused = true;
      return on;
    });
    if (counting) {
      await shot('result-auto');
      await page.evaluate(() => {
        const t = window.__game.scene.getScene('Result').autoTimer;
        if (t) t.paused = false;
      });
      await clickGame(540, 200); // касание по баннеру «Победа» — отмена
      await sleep(AUTO_WAIT_MS);
      if (!(await page.evaluate(() => window.__game.scene.isActive('Result')))) problems.push('касание не отменило авто-прохождение');
      else if (!(await hasText('Result', 'Авто отменено'))) problems.push('нет подписи «Авто отменено»');
    } else log('этап 2 не выигран — отсчёта авто нет');
    // 4. Итог → К кампании → Главная → Герои → герой → назад.
    await clickText('Result', 'К кампании');
    await waitScene('Campaign');
    await clickText('Campaign', 'Главная');
    await waitScene('Home');
    await clickText('Home', 'Герои');
    await waitScene('Heroes');
    await clickGame(540, 430); // карточка первого героя
    await waitScene('Hero');
    await shot('hero');
    await clickText('Hero', '‹ Назад');
    await waitScene('Heroes');

    // 5. Тестовый бой (отряды из data/phase0.json) — там бой длинный: ждём баннер ульты для скриншота.
    await page.evaluate(() => window.__game.scene.getScene('Heroes').scene.start('Battle', { mode: 'test', seed: 7 }));
    await waitScene('Battle');
    const banner = await page
      .waitForFunction(
        () => {
          // Баннер виден целиком — сразу ставим бой на паузу (в том же кадре), чтобы скриншот его поймал.
          const ok = (window.__game.scene.getScene('Battle').ult?.banner?.alpha ?? 0) > 0.95;
          if (ok) window.__game.scene.pause('Battle');
          return ok;
        },
        null,
        { timeout: 30000, polling: 50 },
      )
      .then(() => true)
      .catch(() => false);
    if (banner) {
      await sleep(100);
      await shot('battle-ult');
      await page.evaluate(() => window.__game.scene.resume('Battle'));
    } else log('ульта не случилась за 30 с — скриншот баннера пропущен');
    await clickText('Battle', 'Пропустить');
    await waitScene('Result');
    await sleep(600);
    await shot('result-test');
  } catch (e) {
    problems.push(`сценарий: ${e.message}`);
    // Для разбора: какие сцены активны и как выглядел экран в момент падения.
    const active = await page
      ?.evaluate(() => window.__game?.scene?.getScenes(true).map((s) => s.scene.key) ?? 'нет window.__game')
      .catch(() => '?');
    problems.push(`активные сцены: ${JSON.stringify(active)}`);
    await page?.screenshot({ path: join(SHOTS, 'fail.png') }).catch(() => {});
  } finally {
    await browser?.close().catch(() => {});
    stopVite(vite);
  }

  log(`скриншоты: ${SHOTS}`);
  if (problems.length) {
    console.error(`[e2e] ПРОВАЛ (${problems.length}):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  log('OK');
  process.exit(0);
}

main().catch((e) => {
  console.error('[e2e] ПРОВАЛ:', e.message);
  process.exit(1);
});
