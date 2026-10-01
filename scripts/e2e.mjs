#!/usr/bin/env node
// Дымовой e2e-прогон игры в браузере: сам поднимает vite, прокликивает основной путь игрока
// и падает при ошибках в консоли. Нужен Playwright, установленный глобально (npm root -g),
// и уже скачанный Chromium — скрипт ничего не устанавливает. В CI не запускается.
// Подробности: docs/content/e2e.md.
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
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

// Номера этапов и открытия — из данных (глава 1 растянута до 18 этапов, вставные ch1_s11… стоят между выпущенными):
// подпись «1-N» — позиция этапа в data/campaign/chapter1.json, как stageLabel() в ядре.
const CH1_ORDER = JSON.parse(readFileSync('data/campaign/chapter1.json', 'utf8')).stages.map((x) => x.id);
const UNLOCKS = JSON.parse(readFileSync('data/unlocks.json', 'utf8')).features;
const unlockOf = (id) => UNLOCKS.find((f) => f.id === id);
const ch1Label = (stageId) => `1-${CH1_ORDER.indexOf(stageId) + 1}`;
/** Все этапы главы 1 до stageId включительно (в порядке прохождения). */
const ch1Upto = (stageId) => CH1_ORDER.slice(0, CH1_ORDER.indexOf(stageId) + 1);
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
    /**
     * «Пропустить» боя — только пока активна сцена Battle. Проверка и нажатие — одним вызовом в странице (кнопка вызывает
     * BattleScene.skip()): иначе бой успевал закончиться между проверкой и кликом мышью, и клик попадал в «Пропустить»
     * страницы находки на итогах («нет страницы находки после первой победы на этапе 1»).
     */
    const skipBattle = async () => {
      const done = await page.evaluate(() => {
        const g = window.__game;
        if (!g.scene.isActive('Battle')) return false;
        const sc = g.scene.getScene('Battle');
        if (typeof sc.skip !== 'function') return false;
        sc.skip();
        return true;
      });
      if (done) log('бой: «Пропустить»');
      return done;
    };
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
     * Баннеры «Новая функция!» (src/game/unlockBanner.ts, слой 'unlockBanner') — закрыть «Позже» все подряд.
     * Первый — со скриншотом shotName. Возвращает заголовки показанных баннеров.
     */
    const dismissUnlocks = async (sceneKey, shotName) => {
      const titles = [];
      for (let n = 0; n < 10; n++) {
        await sleep(400);
        const title = await page.evaluate(
          (k) => window.__game.scene.isActive(k) && (window.__game.scene.getScene(k).children.getByName('unlockBanner')?.getData('title') ?? null),
          sceneKey,
        );
        if (!title) break;
        if (shotName && n === 0) await shot(shotName);
        titles.push(title);
        await clickText(sceneKey, 'Позже');
      }
      if (titles.length) log(`баннеры «Новая функция!»: ${titles.join(', ')}`);
      return titles;
    };
    /**
     * S: плашка подсказки не закрывает другие элементы управления. hintPointer кладёт в контейнер
     * hintOverlap (площадь перекрытия; 0 — чисто).
     */
    const checkHint = async (sceneKey, what) => {
      // Плашку hintPointer раскладывает на следующем кадре — дождаться её (до 5 с).
      await page
        .waitForFunction((k) => window.__game.scene.getScene(k).children.list.some((o) => o.name === 'hint' && o.getData?.('hintBox')), sceneKey, { timeout: 5000 })
        .catch(() => {});
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
      // Кампания догружает фон главы, пока придержка ещё висит: снятый unroute уже отдал запрос сам — не ошибка.
      await route.continue().catch(() => {});
    });
    await page.reload();
    await page.waitForFunction(() => window.__game?.scene?.getScene("Boot")?.load?.isLoading(), null, { timeout: 15000, polling: 20 });
    await sleep(100);
    await shot('loading');
    // Игра открывается на странице «Кампания» (как в AFK Arena); новичку там же — вступление главы.
    await waitScene('Campaign', 30000);
    await page.unroute(/\.(png|webp|jpg)$/);
    if (!(await page.locator('canvas').count())) throw new Error('canvas не найден');
    await shot('campaign-intro');
    // Перед вступлением главы — страница «Эпизод 1» (lore-route §5.1; слой 'dialogue', «Пропустить» закрывает все страницы).
    if (!(await hasText('Campaign', 'ЭПИЗОД 1'))) problems.push('нет страницы «Эпизод 1» при первом входе в главу');
    if (!(await skipDialogues('Campaign'))) problems.push('нет вступления главы на карте кампании');
    await shot('campaign');
    // Навигация — 4 вкладки; на «Кампании» — «В бой · этап 1», сундук офлайн-наград и быстрые награды (закрыты до своего этапа, data/unlocks.json).
    for (const t of ['Кампания', 'Герои', 'Город', 'Приключения', 'В бой · этап 1-1', 'Сундук офлайн-наград', 'Быстрые', 'Закрыто']) {
      if (!(await hasText('Campaign', t))) problems.push(`кампания новичка: нет «${t}»`);
    }
    // Письмо «Добро пожаловать» и вход дня — красный кружок на вкладке «Город».
    if (!(await page.evaluate(() => !!window.__game.scene.getScene('Campaign').children.getByName('navBadge_Home')))) problems.push('нет значка на вкладке «Город» (письмо, вход дня)');
    // R: новичку показана подсказка на «В бой»; она не закрывает другие кнопки.
    await checkHint('Campaign', 'кампания');
    if (!(await hasText('Campaign', 'Первый этап ждёт'))) problems.push('нет подсказки новичку на кампании');

    // События новичка: вкладка «Город» → иконка «События» в шапке → «Вход 7 дней» → забрать день 1 нажатием.
    await clickText('Campaign', 'Город');
    await waitScene('Home');
    await shot('city');
    for (const t of ['Таверна', 'Лавка', 'Задания', 'Достижения', `Откроется на этапе ${ch1Label(unlockOf('tavern').stage)}`]) if (!(await hasText('Home', t))) problems.push(`город новичка: нет «${t}»`);
    // Онлайн (друзья, рекорды) — только в Telegram: вне его кнопки «Друзья» нет и сеть не трогается.
    if (await page.evaluate(() => !!window.__game.scene.getScene('Home').children.getByName('friendsBtn'))) problems.push('вне Telegram видна кнопка «Друзья»');
    {
      const saveNow = () => page.evaluate(() => JSON.parse(localStorage.getItem('chronoworld.save.v1')));
      const s0 = await saveNow();
      if (!s0.mail?.letters?.some((l) => l.source === 'welcome')) problems.push('новая игра: нет письма «Добро пожаловать»');
      await clickNamed('Home', 'eventsIcon');
      await waitScene('Events');
      await shot('events-login');
      await clickNamed('Events', 'loginClaim_1');
      await sleep(700);
      await waitScene('Events');
      const s1 = await saveNow();
      if (!s1.events?.loginClaimed?.includes(1)) problems.push(`вход 7 дней: день 1 не получен (${JSON.stringify(s1.events)})`);
      else if (s1.currency.scrolls <= s0.currency.scrolls) problems.push('вход 7 дней: награда дня 1 не пришла');
      else log('вход 7 дней: день 1 получен');
      await shot('events-login-claimed');
      await clickText('Events', 'Город');
      await waitScene('Home');
    }

    // «Приключения»: Башня, экспедиции и охота — пока под замками.
    await clickText('Home', 'Приключения');
    await waitScene('Adventure');
    await shot('adventure');
    for (const t of ['Башня испытаний', 'Экспедиции', 'Охота на босса', `Откроется на этапе ${ch1Label(unlockOf('tower').stage)}`]) if (!(await hasText('Adventure', t))) problems.push(`приключения новичка: нет «${t}»`);

    // 2. Кампания → этап 1 → В бой.
    await clickText('Adventure', 'Кампания');
    await waitScene('Campaign');
    if (await skipDialogues('Campaign')) problems.push('вступление главы показано второй раз');
    await clickText('Campaign', '1-1');
    await waitScene('Stage');
    await shot('stage');
    await checkHint('Stage', 'этап');
    // Подготовка: героя из слота 0 перетаскиваем в слот 4 (обмен), потом обратно. Цель — под «призраком»
    // героя, он на 70 единиц выше пальца (src/game/squadEditor.ts, GHOST_LIFT).
    {
      const squadNow = async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('chronoworld.save.v1')))).squad;
      const slot = (i) => page.evaluate((i) => window.__game.scene.getScene('Stage').editor.slotPos(i), i);
      const toCss = async (g) => {
        const box = await page.locator('canvas').boundingBox();
        const v = (await page.evaluate(() => window.__view?.())) ?? { worldX: 0, worldY: 0, worldW: GAME_W };
        const s = box.width / v.worldW;
        return { x: box.x + (g.x - v.worldX) * s, y: box.y + (g.y - v.worldY) * s };
      };
      const dragSlot = async (from, to) => {
        const a = await toCss(await slot(from));
        const t = await slot(to);
        const b = await toCss({ x: t.x, y: t.y + 70 });
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(b.x, b.y, { steps: 10 });
        await sleep(100);
        await page.mouse.up();
        await sleep(400);
      };
      const before = await squadNow();
      await dragSlot(0, 4);
      const swapped = await squadNow();
      if (swapped[4] !== before[0] || swapped[0] !== before[4]) problems.push(`подготовка: перетаскивание 0→4 не поменяло слоты: ${JSON.stringify(before)} → ${JSON.stringify(swapped)}`);
      await dragSlot(4, 0);
      if (JSON.stringify(await squadNow()) !== JSON.stringify(before)) problems.push('подготовка: обратное перетаскивание не вернуло отряд');
      else log('подготовка: перетаскивание между слотами работает');
    }
    await clickText('Stage', 'В бой');
    // Сюжет перед первым боем этапа.
    await sleep(500);
    if (!(await skipDialogues('Stage'))) problems.push('нет сюжета перед этапом 1');
    await waitScene('Battle');

    // 3. Бой: скорость ×2 закрыта до своего этапа (data/unlocks.json, speed_x2) — касание «1x» оставляет 1x и показывает тост;
    // что 2x запоминается, проверяем в настройках после этапа 5 (раздел 6). Ждём баннер ульты, затем «Пропустить».
    await clickText('Battle', '1x');
    await sleep(150);
    const speed = await page.evaluate(() => localStorage.getItem('chronoworld.battleSpeed'));
    const speedLabel = ch1Label(unlockOf('speed_x2').stage);
    if (speed === '2') problems.push(`скорость ×2 включилась на этапе 1 — должна быть закрыта до этапа ${speedLabel}`);
    if (!(await hasText('Battle', `Скорость боя ×2: откроется на этапе ${speedLabel}`))) problems.push(`нет тоста «Скорость боя ×2: откроется на этапе ${speedLabel}»`);
    await sleep(1500);
    await shot('battle');
    await skipBattle();
    await waitScene('Result');
    await sleep(600);
    // Находка этапа 1 (lore-route §5.4) — страница поверх итогов после первой победы; «Пропустить».
    if (await page.evaluate(() => !!window.__game.scene.getScene('Result').children.getByName('dialogue'))) {
      await shot('result-finding');
      await skipDialogues('Result');
      if (!(await hasText('Result', 'Находка: '))) problems.push('итоги: нет строки «Находка: …» после страницы находки');
    } else if ((await page.evaluate(() => JSON.parse(localStorage.getItem('chronoworld.save.v1')))).campaign.cleared.includes('ch1_s1')) problems.push('нет страницы находки после первой победы на этапе 1');
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
    await skipBattle();
    await waitScene('Result');
    // Отсчёт идёт 2 с: придерживаем его таймер, снимаем экран, отпускаем и отменяем касанием.
    const counting = await page.evaluate(() => {
      const sc = window.__game.scene.getScene('Result');
      const on = sc.children.list.some((o) => o.type === 'Text' && o.visible && o.text.startsWith('Этап 1-3 через'));
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
    // 4. Итог → К кампании (после поражения кнопка — «Кампания», T1-07) → Герои → герой → назад.
    await clickText('Result', (await hasText('Result', 'К кампании')) ? 'К кампании' : 'Кампания');
    await waitScene('Campaign');
    // Этап 2 (пройден в авто-режиме) открыл функции с stage = ch1_s2 (data/unlocks.json; сейчас — скорость ×2) —
    // баннеры на карте, один раз.
    if ((await page.evaluate(() => JSON.parse(localStorage.getItem('chronoworld.save.v1')))).campaign.cleared.includes('ch1_s2')) {
      const want = UNLOCKS.filter((f) => f.stage === 'ch1_s2').map((f) => f.title);
      const got = await dismissUnlocks('Campaign', 'unlock-banner');
      if (got.join('|') !== want.join('|')) problems.push(`после этапа 2: баннеры ${JSON.stringify(got)}, ждали ${JSON.stringify(want)}`);
      if ((await dismissUnlocks('Campaign')).length) problems.push('баннер показан второй раз');
      // На «Кампании» сундук с «Собрать»; быстрые награды — «Бесплатно», если уже открыты, иначе «Закрыто».
      await waitScene('Campaign');
      const fastOpen = CH1_ORDER.indexOf(unlockOf('fast_rewards').stage) <= CH1_ORDER.indexOf('ch1_s2');
      if (!(await hasText('Campaign', fastOpen ? 'Бесплатно' : 'Закрыто'))) problems.push(`кампания после этапа 2: быстрые награды не «${fastOpen ? 'Бесплатно' : 'Закрыто'}»`);
      if (!(await hasText('Campaign', 'Собрать'))) problems.push('кампания после этапа 2: нет «Собрать» у сундука');
      await shot('campaign-chest');
    }
    await clickText('Campaign', 'Герои');
    await waitScene('Heroes');
    // H4: коллекция — сетка карточек, фильтры, сортировка, «Коллекция N/M».
    await shot('heroes');
    for (const t of ['Коллекция ', 'Сила ↕', 'Алан', 'Опыт в запасе']) if (!(await hasText('Heroes', t))) problems.push(`коллекция героев: нет «${t}»`);
    await clickText('Heroes', 'Алан'); // плитка Алана
    await waitScene('Hero');
    await shot('hero');
    // Карточка героя (H4): класс, редкость, мощь, «Улучшить» за опыт из общего запаса, вкладки.
    for (const t of ['Мечник', 'Зелёный', 'Улучшить', 'Мощь', 'Навыки', 'Снаряжение', 'История']) if (!(await hasText('Hero', t))) problems.push(`карточка героя: нет «${t}»`);
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('chronoworld.save.v1')));
    const h1 = before.heroes.find((h) => h.templateId === 'alan');
    await clickText('Hero', 'Улучшить');
    await sleep(700);
    await waitScene('Hero');
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('chronoworld.save.v1')));
    const h1after = after.heroes.find((h) => h.id === h1.id);
    if (before.resources.heroExp >= 100 && h1after.level !== h1.level + 1) problems.push(`«Улучшить» не подняло уровень (${h1.level} → ${h1after.level}, запас ${before.resources.heroExp})`);
    // Уровень на карточке обновился на месте (без перезапуска экрана).
    if (h1after.level > h1.level && !(await hasText('Hero', `Ур. ${h1after.level}`))) problems.push(`карточка героя: не видно «Ур. ${h1after.level}» после «Улучшить»`);
    log(`«Улучшить»: ${h1.level} → ${h1after.level}, запас ${before.resources.heroExp} → ${after.resources.heroExp}`);
    await shot('hero-levelup');
    // Вкладка «История»: био и откуда брать копии героя (герои v2).
    await clickText('Hero', 'История');
    await waitScene('Hero');
    if (!(await hasText('Hero', 'Растёт копиями'))) problems.push('карточка героя: во вкладке «История» нет «Растёт копиями»');
    // История героя кусочками (каждые 10 уровней): кнопка во вкладке «История» открывает страницу во весь экран.
    {
      const pos = await page.evaluate(() => {
        const all = (list) => list.flatMap((o) => (o.list ? [o, ...all(o.list)] : [o]));
        const b = all(window.__game.scene.getScene('Hero').children.list).find((o) => o.name === 'heroStoryBtn');
        if (!b) return null;
        const r = b.getBounds();
        return [r.centerX, r.centerY];
      });
      if (!pos) problems.push('карточка героя: во вкладке «История» нет кнопки «История героя»');
      else {
        await clickGame(pos[0], pos[1]);
        await sleep(600);
        const open = await page.evaluate(() => !!window.__game.scene.getScene('Hero').children.getByName('heroStory'));
        if (!open) problems.push('кнопка «История героя» не открыла страницу истории');
        else {
          // Герой без ветки: общие кусочки 10–50 и по строке на каждую ветку второй профессии (ур. 60–100).
          for (const t of ['ИСТОРИЯ ГЕРОЯ', 'Открыто ', 'Ур. 50 · откроется на ур. 50', 'Ур. 60–100 · путь «']) if (!(await hasText('Hero', t))) problems.push(`страница истории героя: нет «${t}»`);
          await shot('hero-story');
          await clickText('Hero', 'Закрыть');
          await sleep(500);
          await waitScene('Hero');
          if (await page.evaluate(() => !!window.__game.scene.getScene('Hero').children.getByName('heroStory'))) problems.push('страница истории героя не закрылась');
        }
      }
    }
    await clickText('Hero', 'Навыки');
    await waitScene('Hero');
    // Экран вознесения: слоты копий, откуда брать копии и кнопка «Вознести».
    await clickText('Hero', 'Вознести');
    await waitScene('Ascend');
    for (const t of ['Где взять копии', 'Предел уровня', 'Вознести']) if (!(await hasText('Ascend', t))) problems.push(`вознесение: нет «${t}»`);
    await shot('ascend');
    await clickNamed('Ascend', 'backButton');
    await waitScene('Hero');
    await clickNamed('Hero', 'backButton');
    await waitScene('Heroes');

    // 5. Настройки (S): шестерёнка в шапке «Города» → окно → «Тестовый бой» → экран отряда.
    await clickText('Heroes', 'Город');
    await waitScene('Home');
    await clickNamed('Home', 'settings');
    await sleep(200);
    if (!(await hasText('Home', 'Версия '))) problems.push('в настройках нет версии');
    if (!(await hasText('Home', 'Начать заново'))) problems.push('в настройках нет «Начать заново»');
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

    // 6. H5 Таверна: после ch1_s5 (сохранение с пройденными этапами главы до ch1_s5 по порядку data/campaign — s1, s2, s11,
    // s3, s4, s5; подарок не забран) — баннер «Таверна» →
    // «Перейти» → Таверна → «‹ Назад» в «Город» → плитка Таверны → «Забрать подарок» → «Призыв ×10» → карта,
    // «Открыть все» → (фиолетовая — крупный показ) → итог.
    // Герои v2: первый ×10 гарантирует синюю (пакет V3 — одну; фиолетовая — 2%, не гарантирована).
    const tavernStage = unlockOf('tavern').stage;
    const seenBefore = await page.evaluate((ids) => {
      const s = JSON.parse(localStorage.getItem('chronoworld.save.v1'));
      s.campaign.cleared = [...new Set([...s.campaign.cleared, ...ids])];
      s.summon.welcomeGiven = false;
      // Гемы первой сессии (достижения, башня, задания) — вместе с подарком хватает на ×10.
      s.currency.gems = 120;
      localStorage.setItem('chronoworld.save.v1', JSON.stringify(s));
      return s.seenUnlocks ?? [];
    }, ch1Upto(tavernStage));
    await page.reload();
    await waitScene('Campaign', 30000);
    // Открытия пройденных этапов, чьи баннеры ещё не показаны (data/unlocks.json; сейчас — только Таверна: скорость ×2
    // показана после этапа 2) — баннеры на кампании после загрузки: остальные — «Позже», у Таверны — «Перейти»: он ведёт
    // в Таверну, её «Назад» — на страницу «Город».
    const wantBanners = UNLOCKS.filter((f) => ch1Upto(tavernStage).includes(f.stage) && !seenBefore.includes(f.id)).map((f) => f.title);
    const opened = [];
    for (let n = 0; n < 6; n++) {
      await sleep(400);
      const title = await page.evaluate(() => window.__game.scene.getScene('Campaign').children.getByName('unlockBanner')?.getData('title') ?? null);
      if (!title) break;
      if (!n) await shot('unlock-banner-campaign');
      opened.push(title);
      await clickText('Campaign', title === 'Таверна' ? 'Перейти' : 'Позже');
      if (title === 'Таверна') break;
    }
    if (!wantBanners.includes('Таверна')) problems.push(`баннер «Таверна» не ожидается после ${tavernStage} (${JSON.stringify(wantBanners)})`);
    for (const t of wantBanners) if (!opened.includes(t)) problems.push(`кампания после ${tavernStage}: нет баннера «${t}» (${JSON.stringify(opened)})`);
    for (const t of opened) if (!wantBanners.includes(t)) problems.push(`кампания после ${tavernStage}: лишний баннер «${t}» (ждали ${JSON.stringify(wantBanners)})`);
    if (opened.at(-1) === 'Таверна') {
      await waitScene('Tavern');
      await clickNamed('Tavern', 'backButton');
      await waitScene('Home');
      log('баннер «Таверна» → «Перейти» → Таверна → «Назад» → Город');
    } else {
      problems.push('баннер «Таверна» не последний — «Перейти» не проверен');
      await clickText('Campaign', 'Город');
      await waitScene('Home');
    }
    // Скорость ×2 открыта: в настройках 1x → 2x, выбор запоминается.
    await clickNamed('Home', 'settings');
    await sleep(200);
    await clickText('Home', '1x');
    await sleep(150);
    const speed2 = await page.evaluate(() => localStorage.getItem('chronoworld.battleSpeed'));
    if (speed2 !== '2') problems.push(`скорость ×2 не запомнилась после открытия: ${speed2}`);
    await clickText('Home', 'Закрыть');
    await sleep(300);
    await clickNamed('Home', 'tavernTile');
    await waitScene('Tavern');
    await sleep(400);
    await shot('tavern');
    for (const t of ['До синей: 10', 'До фиолетовой: 50', 'Первый призыв ×10', 'Бесплатно']) if (!(await hasText('Tavern', t))) problems.push(`Таверна: нет «${t}»`);
    await clickText('Tavern', 'Забрать подарок');
    await waitScene('Tavern');
    await sleep(300);
    const gemsAfterGift = await page.evaluate(() => JSON.parse(localStorage.getItem('chronoworld.save.v1')).currency.gems);
    if (gemsAfterGift !== 270) problems.push(`Таверна: после подарка гемов ${gemsAfterGift}, ждали 270`);
    await clickText('Tavern', 'Призыв ×10 (270)');
    await page.waitForFunction(() => window.__game.scene.getScene('Tavern').reveal?.phase === 'pick', null, { timeout: 20000 });
    const reveal = await page.evaluate(() => {
      const r = window.__game.scene.getScene('Tavern').reveal;
      return { rarities: r.results.map((x) => x.rarity), first: { x: r.cards[0].slot.x, y: r.cards[0].slot.y } };
    });
    log(`Таверна: ×10 → ${reveal.rarities.join(', ')}`);
    if (reveal.rarities.length !== 10) problems.push(`Таверна: карт ${reveal.rarities.length}, ждали 10`);
    if (reveal.rarities.filter((r) => r !== 'green').length < 1) problems.push('Таверна: в первом ×10 нет синей');
    const hasPurple = reveal.rarities.includes('purple');
    await clickGame(reveal.first.x, reveal.first.y);
    // В headless-браузере (программная отрисовка) кадров мало, а время игры идёт по кадрам — ждём по состоянию, не по часам.
    const flipped = await page
      .waitForFunction(() => window.__game.scene.getScene('Tavern').reveal.cards[0].flipped, null, { timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    await sleep(400);
    await shot('tavern-reveal-mid');
    if (!flipped) problems.push('Таверна: нажатие не перевернуло карту');
    await clickText('Tavern', 'Открыть все');
    const showcase = hasPurple
      ? await page
          .waitForFunction(() => window.__game.scene.getScene('Tavern').reveal?.phase === 'showcase', null, { timeout: 60000, polling: 50 })
          .then(() => true)
          .catch(() => false)
      : false;
    if (!hasPurple) log('Таверна: фиолетовой в ×10 нет — крупного показа не ждём');
    else if (showcase) {
      await sleep(2500);
      await shot('tavern-purple');
      // Касание по затемнению показа (мимо будущих кнопок итога — показ мог уже закрыться сам).
      await clickGame(540, 1420);
    } else problems.push('Таверна: нет крупного показа фиолетовой');
    // Если фиолетовая была первой картой, её показ открылся от первого касания и «Открыть все» ушло в затемнение
    // показа — тогда жмём «Открыть все» ещё раз (и закрываем повторный показ), пока не дойдём до итога.
    for (let i = 0; i < 4; i++) {
      const done = await page
        .waitForFunction(() => window.__game.scene.getScene('Tavern').reveal?.phase === 'done', null, { timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      if (done) break;
      const phase = await page.evaluate(() => window.__game.scene.getScene('Tavern').reveal?.phase);
      if (i === 3) throw new Error(`Таверна: итог не наступил, фаза ${phase}`);
      if (phase === 'showcase') await clickGame(540, 1420);
      else await clickText('Tavern', 'Открыть все');
    }
    await sleep(500);
    await shot('tavern-results');
    for (const t of ['Итог призыва', 'К героям', 'Ещё ×10']) if (!(await hasText('Tavern', t))) problems.push(`Таверна, итог: нет «${t}»`);
    const saved = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('chronoworld.save.v1'));
      return { rare: s.heroes.filter((h) => h.rarity !== 'green').length, firstTenDone: s.summon.firstTenDone, gems: s.currency.gems };
    });
    if (saved.rare < 1 || !saved.firstTenDone || saved.gems !== 0) problems.push(`Таверна: сохранение после ×10 ${JSON.stringify(saved)}`);
    else log('Таверна: подарок, ×10 с гарантированной синей, итог — ок');

    // 6а. Башня (BUG-182): вернулись из боя этажа (данные сцены { fight }) — касание второго пути развилки переключает
    // выбор и превью, итог боя («Этаж 1 пройден!») не повторяется. Забег — в сохранении (этаж 1, развилка «бой / событие»).
    await page.evaluate(
      ([cleared, features]) => {
        const s = JSON.parse(localStorage.getItem('chronoworld.save.v1'));
        s.campaign.cleared = [...new Set([...s.campaign.cleared, ...cleared])];
        // Баннеры «Новая функция!» за этапы, пройденные «вручную», — уже увидены (не закрывают следующие шаги).
        s.seenUnlocks = [...new Set([...(s.seenUnlocks ?? []), ...features])];
        s.tower.run = {
          seed: 1,
          tier: 1,
          floor: 1,
          squad: s.squad,
          hp: {},
          fallen: [],
          cards: [],
          paths: ['battle', 'event'],
          shards: 1,
          rerolls: 0,
          lives: 0,
          loot: { gold: 0, jobExp: 0 },
          battles: 1,
          best: 0,
          gems: 0,
        };
        localStorage.setItem('chronoworld.save.v1', JSON.stringify(s));
        localStorage.setItem('chronoworld.hints', JSON.stringify([...JSON.parse(localStorage.getItem('chronoworld.hints') ?? '[]'), 'tip_tower']));
      },
      [ch1Upto(unlockOf('tower').stage), UNLOCKS.filter((f) => ch1Upto(unlockOf('tower').stage).includes(f.stage)).map((f) => f.id)],
    );
    await page.reload();
    await page.waitForFunction(() => window.__game?.scene?.getScenes(true).length > 0, null, { timeout: 30000 });
    await sleep(1500);
    // Только Башня: всё, что поднялось после перезагрузки, — остановить (иначе следующие шаги видят несколько сцен).
    const only = (key, data) =>
      page.evaluate(
        ([k, d]) => {
          const g = window.__game;
          for (const sc of g.scene.getScenes(true)) if (sc.scene.key !== k) g.scene.stop(sc.scene.key);
          g.scene.start(k, d);
        },
        [key, data],
      );
    await only('Tower', { fight: { floor: 1, win: true, events: [] } });
    await waitScene('Tower');
    const towerToasts = () =>
      page.evaluate(() => {
        const all = (l) => l.flatMap((o) => (o.list ? [o, ...all(o.list)] : [o]));
        return all(window.__game.scene.getScene('Tower').children.list).filter((o) => o.type === 'Text' && /пройден!/.test(o.text)).length;
      });
    if ((await towerToasts()) !== 1) problems.push('Башня: после боя нет тоста «Этаж 1 пройден!»');
    await clickNamed('Tower', 'towerPath1');
    await sleep(700);
    await shot('tower-fork-second');
    if (!(await hasText('Tower', 'Неизвестная встреча'))) problems.push('Башня: касание второго пути не переключило превью на «Событие»');
    if (!(await hasText('Tower', 'Войти'))) problems.push('Башня: на втором пути нет кнопки «Войти»');
    if ((await towerToasts()) !== 0) problems.push('Башня: касание пути повторило тост «Этаж 1 пройден!» (прежние данные сцены)');
    await clickNamed('Tower', 'towerPath0');
    await sleep(700);
    if (!(await hasText('Tower', 'Бой · этаж 2'))) problems.push('Башня: обратно на первый путь — нет превью «Бой · этаж 2»');
    if (!problems.length) log('Башня: развилка после боя переключается, итог боя не повторяется');
    await only('Tavern');
    await waitScene('Tavern');

    // 7. «Начать заново» (настройки): два подтверждения → перезагрузка → экран нового игрока (Эпизод 1, вступление главы,
    // «В бой · этап 1-1»), часы тестировщика без сдвига, ключей игры кроме сохранения нет.
    await page.evaluate(() => {
      localStorage.setItem('chronoworld.timeShift', String(12 * 3600_000));
      localStorage.setItem('chronoworld.hints', '["home_campaign"]');
    });
    await page.evaluate(() => window.__game.scene.getScene('Tavern').scene.start('Home'));
    await waitScene('Home');
    await clickNamed('Home', 'settings');
    await sleep(200);
    await clickText('Home', 'Начать заново');
    await sleep(300);
    await shot('start-over-confirm');
    if (!(await hasText('Home', 'Весь прогресс будет удалён'))) problems.push('«Начать заново»: нет первого подтверждения');
    await clickText('Home', 'Удалить');
    await sleep(300);
    if (!(await hasText('Home', 'Точно?'))) problems.push('«Начать заново»: нет второго подтверждения');
    await Promise.all([page.waitForEvent('load'), clickText('Home', 'Да, заново')]);
    await waitScene('Campaign', 30000);
    await shot('start-over-new-player');
    if (!(await hasText('Campaign', 'ЭПИЗОД 1'))) problems.push('после «Начать заново» нет страницы «Эпизод 1»');
    await skipDialogues('Campaign');
    if (!(await hasText('Campaign', 'В бой · этап 1-1'))) problems.push('после «Начать заново» кампания не с этапа 1-1');
    const fresh = await page.evaluate(() => ({
      keys: Object.keys(localStorage).filter((k) => k.startsWith('chronoworld.')),
      save: JSON.parse(localStorage.getItem('chronoworld.save.v1')),
    }));
    if (fresh.save.campaign.cleared.length) problems.push(`после «Начать заново» пройдены этапы: ${fresh.save.campaign.cleared}`);
    if (fresh.save.heroes.some((h) => h.rarity !== 'green')) problems.push('после «Начать заново» остались герои из Таверны');
    // Настройки устройства (звук, вибрация, скорость боя, FPS, «меньше движения») «Начать заново» не трогает (BUG-165).
    const SETTINGS = ['chronoworld.audio', 'chronoworld.haptics', 'chronoworld.battleSpeed', 'chronoworld.fpsCap', 'chronoworld.reduceMotion'];
    const extra = fresh.keys.filter((k) => !['chronoworld.save.v1', 'chronoworld.hints', ...SETTINGS].includes(k));
    if (extra.length) problems.push(`после «Начать заново» остались ключи: ${extra.join(', ')}`);
    if (fresh.keys.includes('chronoworld.timeShift')) problems.push('после «Начать заново» не сброшен сдвиг часов');
    if (!problems.length) log('«Начать заново»: новая игра, вступление главы 1, ключи очищены');
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
