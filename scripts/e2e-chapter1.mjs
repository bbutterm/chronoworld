#!/usr/bin/env node
// Прохождение главы 1 через интерфейс, как новый игрок: новая игра (Алан, Бран, Вика — зелёные карточки ур. 1) →
// этапы 1–18 (глава 1 растянута: порядок — data/campaign/chapter1.json, босс ch1_s10 последний; карта — двумя участками)
// (Кампания → этап → «В бой» → «Пропустить»; поражение — «Повторить»), после каждой победы опыт из общего
// запаса тратится кнопкой «Улучшить» на карточке героя (по уровню самому низкому герою отряда). Сюжетные диалоги:
// вступление главы пролистывается касаниями, остальные закрываются «Пропустить» (кнопка проверяется на перекрытие,
// как и остальные). После ch1_s5 (6-й этап; подарок Таверны: гемы и 10 свитков) — как игрок: Город → Таверна → «Бесплатно»
// и «Призыв ×10» (свитками) → карты открываются сами → «Готово»; на экране этапа «Авто» ставит сильнейших (и перед каждым боем после Таверны).
// Ведущее обучение (src/game/hints.ts): каждая показанная подсказка записывается (id) и проверяется — плашка не закрывает
// кнопки (hintOverlap 0); шаги выполняются, как их показывает указатель. В конце — реальное время главы (бои на «Пропустить»).
// В журнале у каждой попытки — мощь отряда против рекомендуемой (stagePowerCheck). Падает при ошибках в консоли или если глава не пройдена. Нужен глобальный Playwright.
//   npm run e2e:chapter1        (скриншоты — в E2E_SHOTS_DIR или во временной папке; экран — E2E_VIEWPORT, например 360x640)
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { browserOptions, loadPlaywright } from './lib/perf-browser.mjs';

const PORT = Number(process.env.E2E_PORT ?? 5174);
const URL = `http://localhost:${PORT}/`;
const SHOTS = resolve(process.env.E2E_SHOTS_DIR ?? join(tmpdir(), `idle-rpg-ch1-${Date.now()}`));
const GAME_W = 1080;
const MAX_TRIES = 5;
const log = (...a) => console.log('[ch1]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { chromium } = await loadPlaywright();

mkdirSync(SHOTS, { recursive: true });
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
for (let i = 0; i < 150; i++) {
  try {
    if ((await fetch(URL)).ok) break;
  } catch {}
  await sleep(200);
}
const browser = await chromium.launch(browserOptions());
// E2E_VIEWPORT=390x844 — прогон на другом экране телефона (раскладка подсказок и кнопок); по умолчанию 540×960.
const [VW, VH] = (process.env.E2E_VIEWPORT ?? '540x960').split('x').map(Number);
const page = await browser.newPage({ viewport: { width: VW, height: VH } });
const problems = [];
page.on('console', (m) => m.type() === 'error' && !/favicon/.test(m.location()?.url ?? '') && problems.push(`console.error: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
let shotN = 0;
const shot = async (name) => page.screenshot({ path: join(SHOTS, `${String(++shotN).padStart(2, '0')}-${name}.png`) });
const waitScene = async (key, timeout = 20000) => {
  try {
    await page.waitForFunction((k) => window.__game?.scene?.isActive(k) && !window.__sprites?.busy() && window.__game.scene.getScene(k).ready !== false, key, { timeout });
  } catch (e) {
    const st = await page.evaluate((k) => ({
      active: window.__game?.scene?.getScenes(true).map((x) => x.scene.key),
      busy: window.__sprites?.busy(),
      ready: window.__game?.scene?.getScene(k)?.ready,
      stats: window.__sprites?.stats(),
    }), key).catch(() => null);
    throw new Error(`сцена ${key} не готова за ${timeout} мс: ${JSON.stringify(st)}\n${e.message}`);
  }
  await sleep(300);
};
const clickGame = async (gx, gy) => {
  const box = await page.locator('canvas').boundingBox();
  // Холст показывает мир с полями (src/game/viewport.ts): левый верхний угол — не 0,0, если окно не 9:16.
  const v = (await page.evaluate(() => window.__view?.())) ?? { worldX: 0, worldY: 0, worldW: GAME_W };
  const s = box.width / v.worldW;
  await page.mouse.click(box.x + (gx - v.worldX) * s, box.y + (gy - v.worldY) * s);
};
/** Текст в сцене (точное совпадение; last — самый верхний по глубине, например кнопка модального окна). */
const findText = (sceneKey, label, last = false) =>
  page.evaluate(
    ([k, l, lst]) => {
      const all = (list) => list.flatMap((o) => (o.list ? [o, ...all(o.list)] : [o]));
      const found = all(window.__game.scene.getScene(k).children.list).filter((o) => o.type === 'Text' && o.text === l && o.visible);
      const o = lst ? found[found.length - 1] : found[0];
      if (!o) return null;
      const b = o.getBounds();
      return [b.centerX, b.centerY];
    },
    [sceneKey, label, last],
  );
/**
 * Не перекрыт ли текст чем-то, что рисуется поверх (игрок бы его не увидел). Смотрим объекты верхнего уровня
 * в порядке отрисовки (после сортировки по глубине): всё непрозрачное позже предка текста, накрывающее его центр, — помеха.
 */
const coveredBy = (sceneKey, label, last = false) =>
  page.evaluate(
    ([k, l, lst]) => {
      const sc = window.__game.scene.getScene(k);
      const all = (list) => list.flatMap((o) => (o.list ? [o, ...all(o.list)] : [o]));
      const found = all(sc.children.list).filter((o) => o.type === 'Text' && o.text === l && o.visible);
      const t = lst ? found[found.length - 1] : found[0];
      if (!t) return null;
      let top = t;
      while (top.parentContainer) top = top.parentContainer;
      sc.children.depthSort();
      const order = sc.children.list;
      const b = t.getBounds();
      const i = order.indexOf(top);
      for (const o of order.slice(i + 1)) {
        // Подсказка новичку — рамка вокруг цели, прозрачная в середине: не помеха.
        if (!o.visible || !o.getBounds || o.name === 'hint') continue;
        // Ульта временно затемняет всю сцену до alpha=0.5, но её Rectangle не ловит ввод
        // и не скрывает подпись кнопки. Интерактивные шторки диалогов/модалок всё ещё блокируют.
        if ((o.alpha ?? 1) < 0.9 && !o.input?.enabled) continue;
        // Контейнер большого спрайта включает прозрачные поля всей atlas-клетки;
        // без интерактивного потомка на точке клика это не блокирующий слой.
        if (o.type === 'Container' && !o.input?.enabled &&
            !o.list?.some((c) => c.input?.enabled && c.getBounds?.().contains(b.centerX, b.centerY))) continue;
        // Фигура юнита, догрузившаяся после кнопок (лист по требованию), — кадр атласа с прозрачными полями:
        // не ловит ввод и в точке клика прозрачна — не помеха.
        if ((o.type === 'Sprite' || o.type === 'Image') && !o.input?.enabled && o.getLocalPoint && o.frame) {
          const p = o.getLocalPoint(b.centerX, b.centerY);
          const fx = Math.floor(p.x), fy = Math.floor(p.y);
          const inside = fx >= 0 && fy >= 0 && fx < o.frame.width && fy < o.frame.height;
          if (!inside || !sc.textures.getPixelAlpha(fx, fy, o.texture.key, o.frame.name)) continue;
        }
        // Фигура-обводка без заливки (кольцо текущего этапа, рамка выделения) не прячет то, что под ней.
        if (o.isFilled === false || o.fillAlpha === 0) continue;
        // Прокручиваемый список виден только в своей полосе (маска): ниже/выше неё он ничего не закрывает.
        const clip = o.getData?.('clip');
        if (clip && (b.centerY < clip[0] || b.centerY > clip[1])) continue;
        const ob = o.getBounds();
        if (ob.contains(b.centerX, b.centerY)) return `${o.type}${o.name ? ' ' + o.name : ''} (${Math.round(ob.width)}×${Math.round(ob.height)})`;
      }
      return '';
    },
    [sceneKey, label, last],
  );
const clickText = async (sceneKey, label, last = false) => {
  const pos = await findText(sceneKey, label, last);
  if (!pos) throw new Error(`В сцене ${sceneKey} нет текста «${label}»`);
  // Короткое перекрытие (затемнение экрана на ульте в бою) пережидаем; постоянное — ошибка.
  let cover = await coveredBy(sceneKey, label, last);
  for (let i = 0; cover && i < 10; i++) {
    await sleep(300);
    cover = await coveredBy(sceneKey, label, last);
  }
  if (cover) throw new Error(`В сцене ${sceneKey} «${label}» перекрыт: ${cover} — игрок его не видит`);
  await clickGame(pos[0], pos[1]);
};
/** Именованные кнопки встречаются и в дочерних модальных контейнерах. */
const namedPosition = (sceneKey, name) => page.evaluate(
    ([k, n]) => {
      const all = (list) => list.flatMap((o) => o.list ? [o, ...all(o.list)] : [o]);
      const o = all(window.__game.scene.getScene(k).children.list).find((o) => o.name === n);
      if (!o) return null;
      const b = o.getBounds();
      return [b.centerX, b.centerY];
    },
    [sceneKey, name],
  );
/** Кликнуть по объекту с именем (setName), включая «‹» в шапке и варианты состава. */
const clickNamed = async (sceneKey, name) => {
  const pos = await namedPosition(sceneKey, name);
  if (!pos) throw new Error(`В сцене ${sceneKey} нет объекта «${name}»`);
  await clickGame(pos[0], pos[1]);
};
const hasTextPrefix = (sceneKey, prefix) =>
  page.evaluate(
    ([k, p]) => {
      const all = (list) => list.flatMap((o) => (o.list ? [o, ...all(o.list)] : [o]));
      return all(window.__game.scene.getScene(k).children.list).some((o) => o.type === 'Text' && o.visible && o.text.startsWith(p));
    },
    [sceneKey, prefix],
  );
const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('chronoworld.save.v1')));
/** Открыт ли сюжетный диалог (src/game/dialogue.ts, слой 'dialogue') на сцене. */
const dialogueOpen = (sceneKey) =>
  page.evaluate((k) => !!window.__game.scene.isActive(k) && !!window.__game.scene.getScene(k).children.getByName('dialogue'), sceneKey);
/** Закрыть все сюжетные сцены на экране кнопкой «Пропустить» (первую — со скриншотом). */
const skipDialogues = async (sceneKey, shotName) => {
  for (let n = 0; n < 6 && (await dialogueOpen(sceneKey)); n++) {
    await sleep(700);
    if (shotName && n === 0) await shot(shotName);
    await clickText(sceneKey, 'Пропустить');
    await sleep(400);
    if (!(await dialogueOpen(sceneKey))) seenDialogues++;
  }
  // После сюжета — баннеры «Новая функция!» (открытия этапов, data/unlocks.json): закрываем «Позже», как игрок.
  await dismissUnlocks(sceneKey);
};
/** Заголовок открытого баннера «Новая функция!» (src/game/unlockBanner.ts) или null. */
const unlockTitle = (sceneKey) =>
  page.evaluate(
    (k) => (window.__game.scene.isActive(k) && window.__game.scene.getScene(k).children.getByName('unlockBanner')?.getData('title')) || null,
    sceneKey,
  );
/** Все показанные баннеры (заголовки) — для итоговой проверки: каждый ровно один раз. */
const unlockTitles = [];
const dismissUnlocks = async (sceneKey) => {
  for (let n = 0; n < 10; n++) {
    await sleep(400);
    const title = await unlockTitle(sceneKey);
    if (!title) return;
    if (!unlockTitles.length || title === 'Таверна') await shot(`unlock-${unlockTitles.length + 1}`);
    unlockTitles.push(title);
    log(`баннер «Новая функция!»: ${title}`);
    await clickText(sceneKey, 'Позже', true);
  }
};
/** Пролистать диалог касаниями по экрану: первое дописывает строку, второе — следующая. */
const tapThroughDialogue = async (sceneKey, shotName) => {
  let taps = 0;
  for (; taps < 40 && (await dialogueOpen(sceneKey)); taps++) {
    await sleep(350);
    if (taps === 3 && shotName) await shot(shotName);
    await clickGame(GAME_W / 2, 600);
  }
  if (await dialogueOpen(sceneKey)) throw new Error(`диалог на ${sceneKey} не закрылся касаниями`);
  seenDialogues++;
  log(`диалог пролистан касаниями: ${taps}`);
};
let seenDialogues = 0;

/** Подсказки обучения, увиденные за прогон: id → сколько раз (шаг может указывать дважды: вкладка → цель). */
const hintsSeen = new Map();
/** Экран:подсказка, для которых уже снят скриншот (одна подсказка бывает на нескольких экранах: вкладка → цель). */
const hintShots = new Set();
/** Записать подсказку на экране (hints.ts): id и перекрытие кнопок плашкой. */
const recordHint = async (sceneKey) => {
  // Плашку hintPointer раскладывает на следующем кадре (и после диалога/баннера) — подождать, пока она встанет.
  for (let i = 0; i < 25; i++) {
    const pending = await page.evaluate((k) => {
      if (!window.__game.scene.isActive(k)) return false;
      return window.__game.scene.getScene(k).children.list.some((o) => o.name === 'hint' && o.active && !o.getData?.('hintBox'));
    }, sceneKey);
    if (!pending) break;
    await sleep(200);
  }
  const h = await page.evaluate((k) => {
    if (!window.__game.scene.isActive(k)) return null;
    const list = window.__game.scene.getScene(k).children.list;
    const c = list.find((o) => o.getData?.('hintBox') && o.active);
    const txt = c?.list?.find((o) => o.type === 'Text' && o.name !== 'hintSkip')?.text;
    const count = list.filter((o) => o.name === 'hint' && o.active).length;
    return c ? { id: c.getData('hintId') ?? txt, overlap: c.getData('hintOverlap'), side: c.getData('hintSide'), mode: c.getData('hintMode'), count } : null;
  }, sceneKey);
  if (!h) return null;
  // Одна подсказка за раз (MT-07): hintPointer убирает прежнюю.
  if (h.count > 1) problems.push(`[${sceneKey}] на экране ${h.count} подсказки сразу`);
  if (!hintsSeen.has(h.id) || !hintShots.has(`${sceneKey}:${h.id}`)) {
    hintShots.add(`${sceneKey}:${h.id}`);
    log(`подсказка [${sceneKey}]: ${h.id}${h.mode === 'ring' ? ' (плашке нет места — рамка и сообщение)' : ''}`);
    await shot(`hint-${sceneKey}-${String(h.id).replace(/[^a-z0-9_]/gi, '').slice(0, 24) || 'text'}`);
  }
  hintsSeen.set(h.id, (hintsSeen.get(h.id) ?? 0) + 1);
  if (h.overlap !== 0) problems.push(`[${sceneKey}] подсказка ${h.id}: плашка закрывает кнопки (перекрытие ${h.overlap}, сторона ${h.side})`);
  return h.id;
};

/**
 * «Улучшить» через интерфейс: Герои → карточка героя (самого низкого уровня в отряде) → «Улучшить», пока опыта и
 * золота хватает (уровень в сохранении перестал расти — стоп). Возвращает число поднятых уровней.
 */
const levelUpSquad = async (shotName) => {
  await clickText('Campaign', 'Герои');
  await waitScene('Heroes');
  await recordHint('Heroes');
  let levels = 0;
  const stuck = new Set();
  for (let n = 0; n < 40; n++) {
    const s = await save();
    const squad = s.heroes.filter((h) => s.squad.includes(h.id) && !stuck.has(h.id)).sort((a, b) => a.level - b.level);
    if (!squad.length) break;
    const hero = squad[0];
    await page.evaluate((id) => {
      const active = window.__game.scene.getScenes(true)[0];
      active.scene.start('Hero', { heroId: id });
    }, hero.id);
    await waitScene('Hero');
    // Подсказки карточки героя («Улучшить», «Вознести», трофеи) — не закрывают вкладки и кнопки (LT-10).
    await recordHint('Hero');
    if (!(await findText('Hero', 'Улучшить'))) {
      stuck.add(hero.id);
      continue;
    }
    if (shotName && levels === 0) await shot(shotName);
    await clickText('Hero', 'Улучшить');
    await sleep(400);
    await waitScene('Hero');
    const after = (await save()).heroes.find((h) => h.id === hero.id);
    if (after.level > hero.level) levels += after.level - hero.level;
    else stuck.add(hero.id);
  }
  // Вкладка «Кампания» прямо с карточки героя. Не через список «Герои»: там при длинном ростере (после Таверны)
  // карточка под нижним краем списка (скрыта маской) перехватывает нажатие на вкладки навигации — баг ScrollArea.
  await clickText('Hero', 'Кампания');
  await waitScene('Campaign');
  return levels;
};

/**
 * Шаг обучения «вознесение» (указатель на вкладку «Герои»): как игрок — карточка героя, которого можно вознести копиями
 * (flow.ts ascendReady) → «Вознести» → «Авто» (корм) → «Вознести» → подтверждение → «Отлично!» → «Кампания».
 */
const ascendStep = async () => {
  const heroId = await page.evaluate(async () => {
    const [{ ascendReady }, { GAME }, { session }] = await Promise.all([
      import('/src/game/flow.ts'),
      import('/src/game/content.ts'),
      import('/src/game/session.ts'),
    ]);
    return ascendReady(session.save, GAME)[0]?.id ?? null;
  });
  if (!heroId) throw new Error('указатель «вознести», но вознести некого');
  const before = (await save()).heroes.find((h) => h.id === heroId);
  await clickText('Campaign', 'Герои');
  await waitScene('Heroes');
  // Тело в фигурных скобках: scene.start возвращает ScenePlugin (циклический граф) — его сериализация вешает evaluate.
  await page.evaluate((id) => {
    window.__game.scene.getScenes(true)[0].scene.start('Hero', { heroId: id });
  }, heroId);
  await waitScene('Hero');
  await clickText('Hero', 'Вознести');
  await waitScene('Ascend');
  await clickText('Ascend', 'Авто');
  await sleep(500);
  // Синий → фиолетовый: сначала ветка второй профессии (плитки branchTile_<job>), без неё «Вознести» неактивна.
  const branchTile = await page.evaluate(() =>
    window.__game.scene.getScene('Ascend').children.list.find((o) => o.name?.startsWith('branchTile_'))?.name ?? null,
  );
  if (branchTile) {
    await clickNamed('Ascend', branchTile);
    await sleep(500);
    log(`вознесение: выбрана ветка ${branchTile.slice('branchTile_'.length)}`);
  }
  await shot('ascend');
  // Кнопка — «Вознести · N золота» (цена в подписи).
  const ascLabel = await page.evaluate(() => {
    const all = (list) => list.flatMap((o) => (o.list ? [o, ...all(o.list)] : [o]));
    return all(window.__game.scene.getScene('Ascend').children.list).find((o) => o.type === 'Text' && o.visible && o.text.startsWith('Вознести'))?.text ?? null;
  });
  if (!ascLabel) throw new Error('на экране вознесения нет кнопки «Вознести…»');
  await clickText('Ascend', ascLabel);
  await sleep(500);
  // Подтверждение (confirm): кнопка «Вознести» модального окна — самая верхняя.
  await clickText('Ascend', 'Вознести', true);
  await sleep(1500);
  const after = (await save()).heroes.find((h) => h.id === heroId);
  if (!after || after.rarity === before.rarity) throw new Error(`вознесение ${before.templateId} ${before.rarity} не прошло`);
  log(`обучение: вознесение ${before.templateId} ${before.rarity} → ${after.rarity}`);
  if (await findText('Ascend', 'Отлично!', true)) {
    // Подпись существует раньше кнопки: анимация хранит её в прозрачном родительском контейнере.
    await page.waitForFunction(() => {
      const game = window.__game;
      const sc = game?.scene.getScene('Ascend');
      const done = sc?.children.getByName('ascendReveal')?.getByName('revealDone');
      if (!sc?.sys.isActive() || !sc.input.enabled || !game.input.enabled || !done?.input?.enabled) return false;
      for (let p = done; p; p = p.parentContainer) {
        if (!p.visible || (p.alpha ?? 1) < 0.99 || !p.willRender(sc.cameras.main)) return false;
      }
      return true;
    }, null, { timeout: 10000 });
    await clickText('Ascend', 'Отлично!', true);
    await waitScene('Hero');
  }
  const active = await page.evaluate(() => window.__game.scene.getScenes(true)[0].scene.key);
  await clickText(active, 'Кампания');
  await waitScene('Campaign');
  await skipDialogues('Campaign');
};

/** Мощь отряда против рекомендуемой мощи этапа (для отчёта при поражении; считает ядро в браузере). */
const powerLine = (stageId) =>
  page.evaluate(async (id) => {
    // Модули уже загружены vite-сервером — тот же экземпляр, что у игры.
    const [{ stagePowerCheck }, { GAME }, { session }] = await Promise.all([
      import('/src/core/features/power.ts'),
      import('/src/game/content.ts'),
      import('/src/game/session.ts'),
    ]);
    const c = stagePowerCheck(session.save, id, GAME);
    return `мощь отряда ${c.squad} / рекомендуемая ${c.recommended} (${Math.round(c.ratio * 100)}%, ${c.verdict})`;
  }, stageId);

/**
 * Таверна после этапа 5 (подарок открытия уже выдан кампанией): Кампания → вкладка «Город» → плитка «Таверна» →
 * «Бесплатно» (если есть) и «Призыв ×10» (свитки подарка) → карты открываются сами (момент редкой уходит сам) → итог
 * (скриншот) → «Готово» → «‹ Назад» в «Город».
 */
const visitTavern = async () => {
  await recordHint('Campaign');
  await clickText('Campaign', 'Город');
  await waitScene('Home');
  await skipDialogues('Home');
  await recordHint('Home');
  await clickText('Home', 'Таверна');
  await waitScene('Tavern');
  await sleep(600);
  await shot('tavern');
  // Подарок Гаррета кампания выдаёт сама (grantTavernWelcome) — указатель на ×10.
  await recordHint('Tavern');
  const before = (await save()).heroes.length;
  const pulls = [];
  if (await findText('Tavern', 'Бесплатно')) pulls.push('Бесплатно');
  pulls.push('Призыв ×10');
  const phase = () => page.evaluate(() => window.__game.scene.getScene('Tavern').reveal?.phase ?? null);
  for (const label of pulls) {
    const total = (await save()).summon.total;
    await clickText('Tavern', label);
    // Призыв записан в сохранение, сцена перезапущена с показом.
    await page.waitForFunction((n) => JSON.parse(localStorage.getItem('chronoworld.save.v1')).summon.total > n, total, { timeout: 10000 });
    await page.waitForFunction(() => ['pick', 'done'].includes(window.__game.scene.getScene('Tavern').reveal?.phase), null, { timeout: 20000 });
    await page.waitForFunction(() => window.__game.scene.getScene('Tavern').reveal?.phase === 'done', null, { timeout: 60000 });
    await sleep(800);
    if (label === 'Призыв ×10') await shot('tavern-x10');
    await clickText('Tavern', 'Готово', true);
    // «Готово» перезапускает зал: показ закрыт.
    await page.waitForFunction(() => window.__game.scene.isActive('Tavern') && window.__game.scene.getScene('Tavern').reveal === null, null, { timeout: 10000 });
    await waitScene('Tavern');
    log(`Таверна: «${label}» — призывов ${(await save()).summon.total}`);
  }
  const s = await save();
  const got = s.heroes.slice(before).map((h) => `${h.templateId} ${h.rarity}`);
  log(`Таверна: +${got.length} карт (${got.join(', ')}), свитков ${s.currency.scrolls}, гемов ${s.currency.gems}`);
  if (got.length < 10) throw new Error(`Таверна: после «Призыв ×10» новых карт ${got.length}, ждали не меньше 10`);
  await clickNamed('Tavern', 'backButton');
  await waitScene('Home');
  await clickText('Home', 'Кампания');
  await waitScene('Campaign');
  await skipDialogues('Campaign');
};

/** Применить «Авто», явно подтвердив предложенный вариант состава, как это делает игрок. */
const applyAutoSquad = async () => {
  await clickText('Stage', 'Авто');
  // Новый состав может потребовать загрузку личных спрайтов; дождаться завершения перезапуска сцены.
  await waitScene('Stage');
  // После первого ×10 «Авто» предлагает настоящие альтернативы. Открытие листа ещё не меняет отряд.
  if (await namedPosition('Stage', 'chooseSquad_healing')) {
    await clickNamed('Stage', 'chooseSquad_healing');
    log('Авто: выбран состав с лечением');
  }
  // Имя листа снимается в начале анимации закрытия. Дождаться её конца и защиты от сквозного тапа.
  await page.waitForFunction(() => {
    const game = window.__game;
    const sc = game.scene.getScene('Stage');
    return !sc.choosingSquad && game.input.enabled &&
      !sc.children.list.some((o) => o.name === 'bottomSheet' || o.getData?.('closing'));
  });
  await waitScene('Stage');
};
/** Экран этапа → «Авто» (сильнейшие герои по ролям) → «‹ Назад» на карту. */
const autoSquad = async (stage, shotName) => {
  await clickText('Campaign', `1-${stage}`);
  await waitScene('Stage');
  if ((await recordHint('Stage')) !== 'prep_auto') problems.push('после Таверны на расстановке нет подсказки «Авто»');
  await applyAutoSquad();
  if (shotName) await shot(shotName);
  await clickNamed('Stage', 'backButton');
  await waitScene('Campaign');
  await skipDialogues('Campaign');
};

/**
 * T1-03: после финала главы — экран «Глава пройдена»: заголовок, карточка Греты, «История» (список увиденных сцен,
 * пересмотр одной сцены), «Глава 2 ›» ведёт на карту главы 2.
 */
const chapterDone = async () => {
  await waitScene('ChapterDone');
  // Летопись главы (lore-route §5.3) открывается сама через ~1,4 с — прочитать (скриншот) и закрыть.
  await page.waitForFunction(() => !!window.__game.scene.getScene('ChapterDone').children.getByName('dialogue'), null, { timeout: 8000 }).catch(() => {});
  if (!(await dialogueOpen('ChapterDone'))) throw new Error('на «Глава пройдена» не открылась летопись главы');
  await sleep(500);
  await shot('chapter-chronicle');
  await skipDialogues('ChapterDone');
  await sleep(400);
  await shot('chapter-done');
  if (!(await findText('ChapterDone', 'Глава 1 пройдена!'))) throw new Error('нет заголовка «Глава 1 пройдена!»');
  // RN-02: при полном отряде Грета приходит в запас — «Грета с вами — но не в отряде» (кнопка «Взять в отряд»).
  if (!(await hasTextPrefix('ChapterDone', 'Грета присоединяется')) && !(await hasTextPrefix('ChapterDone', 'Грета с вами')))
    throw new Error('нет карточки нового героя (Грета)');
  await clickText('ChapterDone', 'История');
  await sleep(600);
  await shot('chapter-history');
  if (!(await findText('ChapterDone', '▶  Финал главы'))) throw new Error('в «Истории» нет финала главы');
  // NB-01: все сцены главы (13) — список прокручивается, первая — «Вступление»; к финалу — колесом вниз.
  if (!(await findText('ChapterDone', '▶  Вступление'))) throw new Error('в «Истории» нет «Вступления» (видны не все сцены)');
  {
    const box = await page.locator('canvas').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 3000);
    await sleep(400);
  }
  await clickText('ChapterDone', '▶  Финал главы');
  await sleep(600);
  if (!(await dialogueOpen('ChapterDone'))) throw new Error('«История»: сцена не открылась');
  await skipDialogues('ChapterDone');
  await clickText('ChapterDone', 'Глава 2 ›');
  await waitScene('Campaign');
  await skipDialogues('Campaign');
  if (!(await hasTextPrefix('Campaign', 'Глава 2'))) throw new Error('«Глава 2 ›» открыл не карту главы 2');
  await shot('chapter2-map');
  log('экран «Глава пройдена» показан, «Глава 2 ›» — карта главы 2');
};


/** После поражения: «Кампания» (бесплатные быстрые награды и сундук — на ней же) → «Улучшить» отряд. */
const afterLoss = async () => {
  await clickText('Result', 'К кампании');
  await waitScene('Campaign');
  await skipDialogues('Campaign');
  if (await findText('Campaign', 'Бесплатно')) {
    await clickText('Campaign', 'Бесплатно');
    await sleep(500);
    await clickText('Campaign', 'Забрать', true);
    await sleep(800);
    await waitScene('Campaign');
    await skipDialogues('Campaign');
    log('после поражения: бесплатные быстрые награды');
  }
  // Как живой игрок: подождать сундук офлайн-наград (код «12» в «Настройки → Коды»: часы игры на 12 ч вперёд), собрать
  // и улучшить героев.
  await clickText('Campaign', 'Город');
  await waitScene('Home');
  await clickNamed('Home', 'settings');
  await sleep(450);
  await clickText('Home', 'Коды');
  await sleep(450);
  await page.evaluate(() => {
    const input = document.querySelector('input[name="cwCode"]');
    input.value = '12';
    input.dispatchEvent(new Event('input'));
  });
  await clickText('Home', 'Ввести');
  await sleep(900);
  await waitScene('Home');
  log('после поражения: код «12» — часы на 12 ч вперёд');
  await clickText('Home', 'Кампания');
  await waitScene('Campaign');
  await skipDialogues('Campaign');
  if (await findText('Campaign', 'Собрать')) {
    await clickText('Campaign', 'Собрать');
    await sleep(900);
    await waitScene('Campaign');
    await skipDialogues('Campaign');
    log('после поражения: сундук собран');
  }
  const levels = await levelUpSquad();
  log(`после поражения: «Улучшить» +${levels} ур.`);
};

let ok = false;
try {
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  // Игра открывается на странице «Кампания» (вступление главы — там же).
  await waitScene('Campaign', 60000);
  await shot('campaign-new');
  const t0 = Date.now();
  // Порядок этапов главы 1 — порядок массива (вставные ch1_s11… между выпущенными; босс ch1_s10 — последний).
  const order = JSON.parse(readFileSync('data/campaign/chapter1.json', 'utf8')).stages.map((x) => x.id);
  const TAVERN = order.indexOf('ch1_s5') + 1;
  const LAST = order.length;
  const MID = Math.ceil(LAST / 2);
  const splits = [];
  for (let stage = 1; stage <= LAST; stage++) {
    const stageId = order[stage - 1];
    const ts = Date.now();
    let won = false;
    for (let t = 1; t <= MAX_TRIES && !won; t++) {
      // После поражения — как игрок: бесплатные быстрые награды на главной, «Улучшить» и снова в бой.
      if (t > 1) await afterLoss();
      {
        const active = await page.evaluate(() => window.__game.scene.getScenes(true)[0].scene.key);
        if (active !== 'Campaign') await clickText(active, 'Кампания');
        await waitScene('Campaign');
        // Вступление главы — при первом входе на карту.
        if (stage === 1) {
          if (!(await dialogueOpen('Campaign'))) throw new Error('нет вступления главы на карте кампании');
          await tapThroughDialogue('Campaign', 'dialogue-intro');
        }
        await skipDialogues('Campaign');
        const ch = await recordHint('Campaign');
        if (stage === 1 && ch !== 'home_campaign') problems.push(`новичок: на карте нет подсказки «В бой» (${ch})`);
        // Быстрые награды — шаг обучения: бесплатно раз в день, указатель на кнопку.
        if (ch === 'fast_rewards') {
          await clickText('Campaign', 'Бесплатно');
          await sleep(500);
          await clickText('Campaign', 'Забрать', true);
          await sleep(800);
          await waitScene('Campaign');
          await skipDialogues('Campaign');
          log('обучение: быстрые награды забраны');
        }
        // Вознесение копиями — шаг после Таверны: указатель на «Герои», игрок возносит героя.
        if ((await recordHint('Campaign')) === 'ascend') await ascendStep();
        // Задания дня — последний шаг: Город → плитка «Задания» → назад.
        if ((await recordHint('Campaign')) === 'quests_open') {
          await clickText('Campaign', 'Город');
          await waitScene('Home');
          await skipDialogues('Home');
          if ((await recordHint('Home')) !== 'quests_open') problems.push('в Городе нет указателя на задания');
          await clickText('Home', 'Задания');
          await waitScene('Quests');
          await sleep(400);
          await shot('quests');
          await clickText('Quests', 'Кампания');
          await waitScene('Campaign');
          await skipDialogues('Campaign');
          log('обучение: задания открыты');
        }
        await clickText('Campaign', `1-${stage}`);
        await waitScene('Stage');
        const prepHint = await recordHint('Stage');
        if (prepHint === 'prep_auto' && stage <= TAVERN) problems.push(`этап ${stage}: подсказка «Авто» до первого призыва в Таверне`);
        // Как игрок с новыми героями из Таверны: перед боем — «Авто» (сильнейшие по ролям).
        if (stage > TAVERN || prepHint === 'prep_auto') {
          await applyAutoSquad();
        }
        if (stage === 1 || stage === TAVERN || stage === LAST) await shot(`stage${stage}`);
        await clickText('Stage', 'В бой');
        // Сюжет перед боем: бой не начнётся, пока диалог открыт.
        await sleep(500);
        await skipDialogues('Stage', stage === LAST ? 'dialogue-boss' : undefined);
      }
      await waitScene('Battle');
      // Скорость ×2 — шаг обучения (открывается на ch1_s2): как игрок, один раз нажать кнопку скорости.
      if ((await recordHint('Battle')) === 'battle_speed') {
        await clickText('Battle', '1x');
        log('обучение: скорость боя ×2');
      }
      // Бой: первый этап, Таверна, середина главы и босс.
      if (stage === 1 || stage === TAVERN || stage === MID || stage === LAST) {
        await sleep(stage === LAST ? 5000 : 2500);
        await shot(`battle${stage}`);
      }
      // Затемнение ульты накрывает экран на ~1 с — дождаться, пока оно сойдёт, и только тогда жать «Пропустить».
      for (let i = 0; i < 20 && (await coveredBy('Battle', 'Пропустить')); i++) await sleep(200);
      // Короткий бой (этап 1 — ~2 с) может закончиться сам, пока ждали скриншот: «Пропустить» уже убрана — ждём итоги.
      if ((await page.evaluate(() => window.__game.scene.isActive('Battle'))) && (await findText('Battle', 'Пропустить'))) await clickText('Battle', 'Пропустить');
      await waitScene('Result');
      await sleep(500);
      // Сюжет после первой победы — поверх итогов.
      await skipDialogues('Result', stage === LAST ? 'dialogue-outro' : undefined);
      won = (await save()).campaign.cleared.includes(stageId);
      if (won && stage < LAST) await recordHint('Result');
      log(`этап ${stage} (${stageId}), попытка ${t}: ${won ? 'победа' : 'поражение'} | ${await powerLine(stageId)}`);
    }
    if (!won) throw new Error(`этап ${stage} (${stageId}) не пройден за ${MAX_TRIES} попыток`);
    splits.push(`${stage}:${Math.round((Date.now() - ts) / 1000)}с`);
    if (stage === LAST) {
      await chapterDone();
      continue;
    }
    await clickText('Result', 'К кампании');
    await waitScene('Campaign');
    await skipDialogues('Campaign');
    if (stage === TAVERN) {
      // Подарок Таверны выдан за этап с Таверной — призыв ×10 свитками, новые герои в отряд (Авто), затем «Улучшить».
      if (!(await save()).summon?.welcomeGiven) throw new Error('после открытия Таверны не выдан подарок Таверны');
      await visitTavern();
      await autoSquad(TAVERN + 1, 'squad-auto');
      const s = await save();
      log(`отряд после «Авто»: ${s.squad.map((id) => { const h = s.heroes.find((x) => x.id === id); return h ? `${h.templateId} ${h.rarity} ${h.level}` : '—'; }).join(', ')}`);
    }
    // Сундук — шаг обучения: «Собрать» на карте, когда указатель на нём.
    if ((await recordHint('Campaign')) === 'chest_claim') {
      await clickText('Campaign', 'Собрать');
      await sleep(900);
      await waitScene('Campaign');
      await skipDialogues('Campaign');
      log('обучение: сундук собран');
    }
    const levels = await levelUpSquad(stage === 2 ? 'hero-levelup' : undefined);
    const s = await save();
    log(`«Улучшить»: +${levels} ур. | ${s.heroes.map((h) => `${h.templateId} ${h.level}`).join(', ')} | в запасе ${s.resources.heroExp}`);
    if (stage === 2 && levels === 0) throw new Error('после этапа 2 «Улучшить» не подняло ни одного уровня');
  }
  const minutes = (Date.now() - t0) / 60000;
  log(`время главы 1 через интерфейс (бои — «Пропустить»): ${minutes.toFixed(1)} мин; по этапам ${splits.join(' ')}`);
  log(`подсказки обучения: ${[...hintsSeen].map(([id, n]) => `${id}×${n}`).join(', ')}`);
  // Вознесение (ascend) — не обязательный шаг: три копии одного героя зависят от удачи в Таверне; показан — выполняем.
  for (const id of ['home_campaign', 'stage_fight', 'battle_speed', 'result_next', 'chest_claim', 'level_up', 'tavern_summon', 'prep_auto', 'fast_rewards', 'quests_open']) {
    if (!hintsSeen.has(id)) problems.push(`подсказка обучения ${id} не показалась`);
  }
  const s = await save();
  log('итог:', s.heroes.map((h) => `${h.templateId} ${h.rarity} ${h.level}`).join(', '), '| пройдено этапов:', s.campaign.cleared.length);
  if (!s.heroes.some((h) => h.templateId === 'greta')) throw new Error('после босса главы нет Греты');
  if (!s.summon?.welcomeGiven) throw new Error('после открытия Таверны не выдан подарок Таверны');
  log(`сюжетных сцен закрыто: ${seenDialogues}, в сохранении увидено: ${(s.seenScenes ?? []).join(', ')}`);
  if (!(s.seenScenes ?? []).includes('ch1_outro')) throw new Error('финальная сцена главы не показана');
  // Открытия главы 1 (data/unlocks.json): каждый баннер показан ровно один раз и отмечен в сохранении.
  log(`баннеры «Новая функция!»: ${unlockTitles.join(', ')}; в сохранении: ${(s.seenUnlocks ?? []).join(', ')}`);
  if (new Set(unlockTitles).size !== unlockTitles.length) throw new Error(`баннер показан дважды: ${unlockTitles.join(', ')}`);
  const ch1Unlocks = JSON.parse(readFileSync('data/unlocks.json', 'utf8')).features.filter((f) => f.stage.startsWith('ch1_'));
  for (const f of ch1Unlocks) {
    if (!(s.seenUnlocks ?? []).includes(f.id)) throw new Error(`после главы 1 баннер ${f.id} не показан`);
    if (!unlockTitles.includes(f.title)) throw new Error(`баннер «${f.title}» не показывался`);
  }
  await shot('final');
  ok = problems.length === 0;
} catch (e) {
  problems.push(String(e?.stack ?? e));
  await shot('fail').catch(() => {});
} finally {
  await browser.close();
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {}
}
log(`скриншоты: ${SHOTS}`);
if (problems.length) console.error(problems.join('\n'));
process.exit(ok ? 0 : 1);
