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
  const root = process.env.PLAYWRIGHT_MODULE ? '' : execSync('npm root -g', { encoding: 'utf8' }).trim();
  const entry = process.env.PLAYWRIGHT_MODULE ? resolve(process.env.PLAYWRIGHT_MODULE) : join(root, 'playwright', 'index.mjs');
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
      // U: листы юнитов грузятся по требованию — ждём, пока экран их догрузит (бой строится после загрузки).
      await page.waitForFunction(
        (k) => window.__game?.scene?.isActive(k) && !window.__sprites?.busy() && window.__game.scene.getScene(k).ready !== false,
        key,
        { timeout },
      );
      await sleep(250);
      log(`сцена ${key}`);
    };
    /** Клик в координатах игры (1080×1920) — канвас масштабирован под окно. */
    const clickGame = async (gx, gy) => {
      const box = await page.locator('canvas').boundingBox();
      if (!box) throw new Error('canvas не найден');
      // Холст показывает мир с полями (src/game/viewport.ts): левый верхний угол — не 0,0, если окно не 9:16.
      const v = (await page.evaluate(() => window.__view?.())) ?? { worldX: 0, worldY: 0, worldW: GAME_W };
      const s = box.width / v.worldW;
      await page.mouse.click(box.x + (gx - v.worldX) * s, box.y + (gy - v.worldY) * s);
    };
    /** Найти текст в активной сцене (точное совпадение, в том числе во вложенных контейнерах) и кликнуть по его центру. */
    const clickText = async (sceneKey, label) => {
      const pos = await page.evaluate(
        ([k, l]) => {
          const all = (list) => list.flatMap((o) => (o.list ? [o, ...all(o.list)] : [o]));
          const found = all(window.__game.scene.getScene(k).children.list).find((o) => o.type === 'Text' && o.text === l && o.visible);
          if (!found) return null;
          const b = found.getBounds();
          return [b.centerX, b.centerY];
        },
        [sceneKey, label],
      );
      if (!pos) throw new Error(`В сцене ${sceneKey} нет текста «${label}»`);
      await clickGame(pos[0], pos[1]);
    };
    /** Кликнуть по объекту с именем (setName) — для кнопок без подписи, например шестерёнки настроек. */
    const clickNamed = async (sceneKey, name) => {
      const pos = await page.evaluate(
        ([k, n]) => {
          const o = window.__game.scene.getScene(k).children.getByName(n);
          if (!o) return null;
          const b = o.getBounds();
          return [b.centerX, b.centerY];
        },
        [sceneKey, name],
      );
      if (!pos) throw new Error(`В сцене ${sceneKey} нет объекта «${name}»`);
      await clickGame(pos[0], pos[1]);
    };
    /** Есть ли в сцене видимый текст, начинающийся с prefix (во вложенных контейнерах тоже). */
    /** Сюжетный диалог (src/game/dialogue.ts) на сцене — закрыть «Пропустить» (все сцены подряд). */
    const skipDialogues = async (sceneKey) => {
      for (let n = 0; n < 6; n++) {
        const open = await page.evaluate((k) => window.__game.scene.isActive(k) && !!window.__game.scene.getScene(k).children.getByName('dialogue'), sceneKey);
        if (!open) return n;
        await sleep(300);
        await clickText(sceneKey, 'Пропустить');
        await sleep(300);
      }
      return 6;
    };
    const hasText = (sceneKey, prefix) =>
      page.evaluate(
        ([k, p]) => {
          const all = (list) => list.flatMap((o) => (o.list ? [o, ...all(o.list)] : [o]));
          return all(window.__game.scene.getScene(k).children.list).some((o) => o.type === 'Text' && o.visible && o.text.startsWith(p));
        },
        [sceneKey, prefix],
      );
    /**
     * S: плашка подсказки не закрывает другие элементы управления. hintPointer кладёт в контейнер
     * hintOverlap (площадь перекрытия; 0 — чисто).
     */
    const checkHint = async (sceneKey, what) => {
      const h = await page.evaluate((k) => {
        const c = window.__game.scene.getScene(k).children.list.find((o) => o.getData?.('hintBox'));
        return c ? { overlap: c.getData('hintOverlap'), side: c.getData('hintSide') } : null;
      }, sceneKey);
      if (!h) problems.push(`${what}: подсказки нет`);
      else if (h.overlap !== 0) problems.push(`${what}: плашка подсказки закрывает кнопки (перекрытие ${h.overlap}, сторона ${h.side})`);
      else log(`${what}: подсказка ${h.side === 'above' ? 'над' : 'под'} целью, кнопки не закрыты`);
    };

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
    await checkHint('Home', 'главная');

    // 2. Главная → Кампания → этап 1 → В бой.
    await clickText('Home', 'КАМПАНИЯ');
    await waitScene('Campaign');
    // Сюжет: вступление главы при первом входе на карту.
    if (!(await skipDialogues('Campaign'))) problems.push('нет вступления главы на карте кампании');
    await clickText('Campaign', '1');
    await waitScene('Stage');
    await shot('stage');
    await checkHint('Stage', 'этап');
    await clickText('Stage', 'В бой');
    // Сюжет перед первым боем этапа.
    await sleep(500);
    if (!(await skipDialogues('Stage'))) problems.push('нет сюжета перед этапом 1');
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
    // S: таблица итогов не наезжает на строку «Авто: следующий этап».
    const lay = await page.evaluate(() => {
      const sc = window.__game.scene.getScene('Result');
      return { tableEnd: sc.tableEnd, autoTop: sc.autoTop };
    });
    if (!(lay.tableEnd <= lay.autoTop)) problems.push(`итог: таблица (низ ${lay.tableEnd}) наезжает на «Авто» (верх ${lay.autoTop})`);

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
    await clickText('Campaign', 'ГЛАВНАЯ');
    await waitScene('Home');
    await clickText('Home', 'ГЕРОИ');
    await waitScene('Heroes');
    await clickGame(540, 430); // карточка первого героя
    await waitScene('Hero');
    await shot('hero');
    await clickText('Hero', '‹ Назад');
    await waitScene('Heroes');

    // 5. Настройки (S): шестерёнка в шапке главной → окно → «Тестовый бой» → экран отряда.
    await clickText('Heroes', 'ГЛАВНАЯ');
    await waitScene('Home');
    await clickNamed('Home', 'settings');
    await sleep(200);
    if (!(await hasText('Home', 'Версия '))) problems.push('в настройках нет версии');
    if (!(await hasText('Home', 'Сбросить прогресс'))) problems.push('в настройках нет «Сбросить прогресс»');
    await shot('settings');
    // U: ограничение FPS — 30 запоминается и включает ограничитель цикла Phaser; возвращаем 60.
    await clickText('Home', '60 FPS');
    await sleep(150);
    const cap = await page.evaluate(() => ({ saved: localStorage.getItem('chronoworld.fpsCap'), limit: window.__game.loop.hasFpsLimit }));
    if (cap.saved !== '30' || !cap.limit) problems.push(`30 FPS не включился: ${JSON.stringify(cap)}`);
    await clickText('Home', '30 FPS');
    await sleep(150);
    if (await page.evaluate(() => window.__game.loop.hasFpsLimit)) problems.push('60 FPS: ограничитель не снялся');
    await clickText('Home', 'Тестовый бой');
    await waitScene('Prep');
    // Тестовый бой (отряды из data/phase0.json, seed 7) — там бой длинный: ждём баннер ульты для скриншота.
    await page.evaluate(() => window.__game.scene.getScene('Prep').scene.start('Battle', { mode: 'test', seed: 7 }));
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
    // U: окно потеряло фокус (Mini App свёрнут) — игра спит и часы боя стоят; вернулись — бой идёт без скачка.
    if (await page.evaluate(() => window.__game.scene.isActive('Battle'))) {
      const clock = () => page.evaluate(() => window.__game.scene.getScene('Battle').clock);
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await sleep(100);
      const c0 = await clock();
      await sleep(1000);
      const c1 = await clock();
      const asleep = await page.evaluate(() => !window.__game.loop.running);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await sleep(60);
      const c2 = await clock();
      if (!asleep || c1 !== c0) problems.push(`пауза при потере фокуса не сработала: цикл спит ${asleep}, часы ${c0} → ${c1}`);
      else if (c2 - c1 > 0.6) problems.push(`после паузы бой прыгнул вперёд на ${(c2 - c1).toFixed(2)} с`);
      else log(`пауза: часы боя стояли (${c0.toFixed(2)} с), после возврата +${(c2 - c1).toFixed(2)} с`);
    }
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
