#!/usr/bin/env node
// Прохождение главы 1 через интерфейс, как новый игрок: новая игра → этапы 1–10 (Кампания → этап → «В бой» →
// «Пропустить»; поражение — «Повторить»), на джобе 10 — смена профессии каждому герою кнопкой «Профессия ›» на итогах
// (после выбора — показ новой профессии и возврат на итоги; следующий герой сам не открывается). Падает при ошибках в консоли или если глава не пройдена. Нужен глобальный Playwright.
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
const FIRST_JOBS = ['Мечник', 'Лучник', 'Аколит', 'Маг', 'Вор'];
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
  await page.waitForFunction((k) => window.__game?.scene?.isActive(k) && !window.__sprites?.busy() && window.__game.scene.getScene(k).ready !== false, key, { timeout });
  await sleep(300);
};
const clickGame = async (gx, gy) => {
  const box = await page.locator('canvas').boundingBox();
  const s = box.width / GAME_W;
  await page.mouse.click(box.x + gx * s, box.y + gy * s);
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
        if (!o.visible || (o.alpha ?? 1) < 0.5 || !o.getBounds || o.name === 'hint') continue;
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
        await clickText('Campaign', String(stage));
        await waitScene('Stage');
        if (stage === 1 || stage === 5 || stage === 10) await shot(`stage${stage}`);
        await clickText('Stage', 'В бой');
      } else await clickText('Result', 'Повторить');
      await waitScene('Battle');
      if (stage === 1 || stage === 10) {
        await sleep(stage === 10 ? 5000 : 2500);
        await shot(`battle${stage}`);
      }
      if (await page.evaluate(() => window.__game.scene.isActive('Battle'))) await clickText('Battle', 'Пропустить');
      await waitScene('Result');
      await sleep(500);
      won = (await save()).campaign.cleared.includes(`ch1_s${stage}`);
      log(`этап ${stage}, попытка ${t}: ${won ? 'победа' : 'поражение'}`);
    }
    if (!won) throw new Error(`этап ${stage} не пройден за ${MAX_TRIES} попыток`);
    const s = await save();
    const ready = s.heroes.filter((h) => h.job === 'novice' && h.jobLevel >= 10);
    if (ready.length) {
      await shot(`result${stage}-jobchange`);
      // Смена профессии через интерфейс: «Профессия ›» на итогах → выбор → показ новой профессии → снова итоги.
      // Следующий готовый герой сам не открывается — на итогах снова кнопка «Профессия ›».
      for (const [k, h] of ready.entries()) {
        await clickText('Result', 'Профессия ›');
        await waitScene('JobChange');
        const i = s.heroes.findIndex((x) => x.id === h.id);
        await clickText('JobChange', FIRST_JOBS[i]);
        await sleep(300);
        if (k === 0) await shot('jobchange');
        await clickText('JobChange', 'Выбрать');
        await sleep(300);
        await clickText('JobChange', 'Выбрать', true);
        await page.waitForFunction(() => window.__game.scene.getScene('JobChange').revealing === true, null, { timeout: 5000 });
        await sleep(900);
        if (k === 0) await shot('jobchange-reveal');
        await clickGame(540, 1500);
        await waitScene('Result');
        const job = (await save()).heroes[i].job;
        log(`${h.name} → ${job}`);
        if (job === 'novice') throw new Error(`${h.name}: профессия не сменилась`);
        const more = k < ready.length - 1;
        const hasBtn = (await findText('Result', 'Профессия ›')) !== null;
        if (hasBtn !== more) throw new Error(`итоги после смены профессии: кнопка «Профессия ›» ${more ? 'пропала' : 'осталась'}`);
      }
      await shot('result-after-jobchange');
      // Экран выбора для героя, который уже сменил профессию, недоступен: сразу возврат туда, откуда пришли.
      await page.evaluate((id) => window.__game.scene.getScene('Result').scene.start('JobChange', { heroId: id, from: { to: 'Campaign' } }), ready[0].id);
      await waitScene('Campaign');
      if (await page.evaluate(() => window.__game.scene.isActive('JobChange'))) throw new Error('экран выбора профессии открылся повторно');
      await clickText('Campaign', 'ГЕРОИ');
      await waitScene('Heroes');
      await clickGame(540, 430);
      await waitScene('Hero');
      await shot('hero-after-change');
    } else {
      await clickText('Result', 'К кампании');
      await waitScene('Campaign');
    }
  }
  const s = await save();
  log('итог:', s.heroes.map((h) => `${h.name} ${h.job} ${h.jobLevel}`).join(', '), '| пройдено этапов:', s.campaign.cleared.length);
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
