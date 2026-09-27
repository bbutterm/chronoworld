#!/usr/bin/env node
// Прохождение главы 1 через интерфейс, как новый игрок: новая игра (Алан, Бран, Вика — зелёные карточки ур. 1) →
// этапы 1–10 (Кампания → этап → «В бой» → «Пропустить»; поражение — «Повторить»), после каждой победы опыт из общего
// запаса тратится кнопкой «Улучшить» на карточке героя (по уровню самому низкому герою отряда). Сюжетные диалоги:
// вступление главы пролистывается касаниями, остальные закрываются «Пропустить» (кнопка проверяется на перекрытие,
// как и остальные). После этапа 5 (подарок Таверны: гемы и 10 свитков) — как игрок: Главная → Таверна → «Бесплатно»
// и «Свитки ×10» → «Открыть все» → «Готово»; на экране этапа «Авто» ставит сильнейших (и перед каждым боем с этапа 6).
// В журнале у каждой попытки — мощь отряда против рекомендуемой (stagePowerCheck). Падает при ошибках в консоли или если глава не пройдена. Нужен глобальный Playwright.
//   npm run e2e:chapter1        (скриншоты — в E2E_SHOTS_DIR или во временной папке)
import { execSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.E2E_PORT ?? 5174);
const URL = `http://localhost:${PORT}/`;
const SHOTS = resolve(process.env.E2E_SHOTS_DIR ?? join(tmpdir(), `idle-rpg-ch1-${Date.now()}`));
const GAME_W = 1080;
const MAX_TRIES = 5;
const log = (...a) => console.log('[ch1]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
const { chromium } = await import(pathToFileURL(join(root, 'playwright', 'index.mjs')).href);

mkdirSync(SHOTS, { recursive: true });
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
for (let i = 0; i < 150; i++) {
  try {
    if ((await fetch(URL)).ok) break;
  } catch {}
  await sleep(200);
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
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

/**
 * «Улучшить» через интерфейс: Герои → карточка героя (самого низкого уровня в отряде) → «Улучшить», пока опыта и
 * золота хватает (уровень в сохранении перестал расти — стоп). Возвращает число поднятых уровней.
 */
const levelUpSquad = async (shotName) => {
  await clickText('Campaign', 'ГЕРОИ');
  await waitScene('Heroes');
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
  await clickText('Hero', 'КАМПАНИЯ');
  await waitScene('Campaign');
  return levels;
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
 * Таверна после этапа 5 (подарок открытия уже выдан кампанией): Кампания → Главная → плитка «Таверна» →
 * «Бесплатно» (если есть) и «Свитки ×10» → «Открыть все» → итог (скриншот) → «Готово» → «‹ Назад» на главную.
 */
const visitTavern = async () => {
  await clickText('Campaign', 'ГЛАВНАЯ');
  await waitScene('Home');
  await skipDialogues('Home');
  await clickText('Home', 'Таверна');
  await waitScene('Tavern');
  await sleep(600);
  await shot('tavern');
  const before = (await save()).heroes.length;
  const pulls = [];
  if (await findText('Tavern', 'Бесплатно')) pulls.push('Бесплатно');
  pulls.push('Свитки ×10');
  const phase = () => page.evaluate(() => window.__game.scene.getScene('Tavern').reveal?.phase ?? null);
  for (const label of pulls) {
    const total = (await save()).summon.total;
    await clickText('Tavern', label);
    // Призыв записан в сохранение, сцена перезапущена с показом.
    await page.waitForFunction((n) => JSON.parse(localStorage.getItem('chronoworld.save.v1')).summon.total > n, total, { timeout: 10000 });
    await page.waitForFunction(() => ['pick', 'done'].includes(window.__game.scene.getScene('Tavern').reveal?.phase), null, { timeout: 20000 });
    await sleep(300);
    if ((await phase()) === 'pick') await clickText('Tavern', label === 'Свитки ×10' ? 'Открыть все' : 'Открыть', true);
    await page.waitForFunction(() => window.__game.scene.getScene('Tavern').reveal?.phase === 'done', null, { timeout: 30000 });
    await sleep(800);
    if (label === 'Свитки ×10') await shot('tavern-x10');
    await clickText('Tavern', 'Готово', true);
    // «Готово» перезапускает зал: показ закрыт.
    await page.waitForFunction(() => window.__game.scene.isActive('Tavern') && window.__game.scene.getScene('Tavern').reveal === null, null, { timeout: 10000 });
    await waitScene('Tavern');
    log(`Таверна: «${label}» — призывов ${(await save()).summon.total}`);
  }
  const s = await save();
  const got = s.heroes.slice(before).map((h) => `${h.templateId} ${h.rarity}`);
  log(`Таверна: +${got.length} карт (${got.join(', ')}), свитков ${s.currency.scrolls}, гемов ${s.currency.gems}`);
  if (got.length < 10) throw new Error(`Таверна: после «Свитки ×10» новых карт ${got.length}, ждали не меньше 10`);
  await clickText('Tavern', '‹ Назад');
  await waitScene('Home');
  await clickText('Home', 'КАМПАНИЯ');
  await waitScene('Campaign');
  await skipDialogues('Campaign');
};

/** Экран этапа → «Авто» (сильнейшие герои по ролям) → «‹ Назад» на карту. */
const autoSquad = async (stage, shotName) => {
  await clickText('Campaign', String(stage));
  await waitScene('Stage');
  await clickText('Stage', 'Авто');
  await sleep(500);
  if (shotName) await shot(shotName);
  await clickText('Stage', '‹ Назад');
  await waitScene('Campaign');
  await skipDialogues('Campaign');
};

/**
 * T1-03: после финала главы — экран «Глава пройдена»: заголовок, карточка Греты, «История» (список увиденных сцен,
 * пересмотр одной сцены), «Глава 2 ›» ведёт на карту главы 2.
 */
const chapterDone = async () => {
  await waitScene('ChapterDone');
  await sleep(900);
  await shot('chapter-done');
  if (!(await findText('ChapterDone', 'Глава 1 пройдена!'))) throw new Error('нет заголовка «Глава 1 пройдена!»');
  if (!(await hasTextPrefix('ChapterDone', 'Грета присоединяется'))) throw new Error('нет карточки нового героя (Грета)');
  await clickText('ChapterDone', 'История');
  await sleep(600);
  await shot('chapter-history');
  if (!(await findText('ChapterDone', '▶  Финал главы'))) throw new Error('в «Истории» нет финала главы');
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

let ok = false;
try {
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await waitScene('Home', 60000);
  await shot('home-new');
  for (let stage = 1; stage <= 10; stage++) {
    let won = false;
    for (let t = 1; t <= MAX_TRIES && !won; t++) {
      if (t === 1) {
        await clickText(await page.evaluate(() => window.__game.scene.getScenes(true)[0].scene.key), 'КАМПАНИЯ');
        await waitScene('Campaign');
        // Вступление главы — при первом входе на карту.
        if (stage === 1) {
          if (!(await dialogueOpen('Campaign'))) throw new Error('нет вступления главы на карте кампании');
          await tapThroughDialogue('Campaign', 'dialogue-intro');
        }
        await skipDialogues('Campaign');
        await clickText('Campaign', String(stage));
        await waitScene('Stage');
        // Как игрок с новыми героями из Таверны: перед боем — «Авто» (сильнейшие по ролям).
        if (stage > 5) {
          await clickText('Stage', 'Авто');
          await sleep(400);
        }
        if (stage === 1 || stage === 5 || stage === 10) await shot(`stage${stage}`);
        await clickText('Stage', 'В бой');
        // Сюжет перед боем (этапы 1, 4, 7, 10): бой не начнётся, пока диалог открыт.
        await sleep(500);
        await skipDialogues('Stage', stage === 10 ? 'dialogue-boss' : undefined);
      } else await clickText('Result', 'Повторить');
      await waitScene('Battle');
      // Бой: первый этап, середина главы (новые монстры — Рокер, Мандрагора) и босс.
      if (stage === 1 || stage === 5 || stage === 8 || stage === 10) {
        await sleep(stage === 10 ? 5000 : 2500);
        await shot(`battle${stage}`);
      }
      // Затемнение ульты накрывает экран на ~1 с — дождаться, пока оно сойдёт, и только тогда жать «Пропустить».
      for (let i = 0; i < 20 && (await coveredBy('Battle', 'Пропустить')); i++) await sleep(200);
      if (await page.evaluate(() => window.__game.scene.isActive('Battle'))) await clickText('Battle', 'Пропустить');
      await waitScene('Result');
      await sleep(500);
      // Сюжет после первой победы (этапы 4 и 10) — поверх итогов.
      await skipDialogues('Result', stage === 10 ? 'dialogue-outro' : undefined);
      won = (await save()).campaign.cleared.includes(`ch1_s${stage}`);
      log(`этап ${stage}, попытка ${t}: ${won ? 'победа' : 'поражение'} | ${await powerLine(`ch1_s${stage}`)}`);
    }
    if (!won) throw new Error(`этап ${stage} не пройден за ${MAX_TRIES} попыток`);
    if (stage === 10) {
      await chapterDone();
      continue;
    }
    await clickText('Result', 'К кампании');
    await waitScene('Campaign');
    await skipDialogues('Campaign');
    if (stage === 5) {
      // Подарок Таверны выдан за этап 5 — призыв ×10 свитками, новые герои в отряд (Авто), затем «Улучшить».
      if (!(await save()).summon?.welcomeGiven) throw new Error('после этапа 5 не выдан подарок Таверны');
      await visitTavern();
      await autoSquad(6, 'squad-auto');
      const s = await save();
      log(`отряд после «Авто»: ${s.squad.map((id) => { const h = s.heroes.find((x) => x.id === id); return h ? `${h.templateId} ${h.rarity} ${h.level}` : '—'; }).join(', ')}`);
    }
    const levels = await levelUpSquad(stage === 2 ? 'hero-levelup' : undefined);
    const s = await save();
    log(`«Улучшить»: +${levels} ур. | ${s.heroes.map((h) => `${h.templateId} ${h.level}`).join(', ')} | в запасе ${s.resources.heroExp}`);
    if (stage === 2 && levels === 0) throw new Error('после этапа 2 «Улучшить» не подняло ни одного уровня');
  }
  const s = await save();
  log('итог:', s.heroes.map((h) => `${h.templateId} ${h.rarity} ${h.level}`).join(', '), '| пройдено этапов:', s.campaign.cleared.length);
  if (!s.heroes.some((h) => h.templateId === 'greta')) throw new Error('после босса главы нет Греты');
  if (!s.summon?.welcomeGiven) throw new Error('после этапа 5 не выдан подарок Таверны');
  log(`сюжетных сцен закрыто: ${seenDialogues}, в сохранении увидено: ${(s.seenScenes ?? []).join(', ')}`);
  if (!(s.seenScenes ?? []).includes('ch1_outro')) throw new Error('финальная сцена главы не показана');
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
