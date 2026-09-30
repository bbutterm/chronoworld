#!/usr/bin/env node
// Аудит атласов RO на навыках (docs/content/skills-vfx.md, «Аудит атласов»): каждый навык из effects.json → skills
// проигрывается ОТДЕЛЬНО в настоящем бою (этап, цикл Phaser усыплён, часы боя стоят) теми же путями, что BattleScene:
// cast — castCue на кастере, projectile — flyAtlas от кастера к цели (и обратно — проверка зеркала), hit — fx() на цели
// в момент попадания, debuff — catalogFlash на цели, buff — fx() на союзнике, ground — groundCue по целям.
// Навык героя (job_*) — кастер слева (отряд A), монстра — справа (отряд B). Серия кадров на навык и склейка в строку.
//   npx tsx scripts/skillfx-save.ts > /tmp/squads.json
//   SHOTS_PORT=5491 node scripts/skillfx-atlas.mjs /tmp/squads.json <папка> [id навыка…]
// В папке: <навык>.png (кадры SHOTS_OFFSETS мс слева направо, кроп поля боя) и index.json. Playwright глобальный.
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.SHOTS_PORT ?? 5491);
const URL = `http://localhost:${PORT}/`;
const [squadsFile, outDir, ...onlySkills] = process.argv.slice(2);
if (!squadsFile || !outDir) throw new Error('usage: skillfx-atlas.mjs <squads.json> <out dir> [skill ids]');
const OFFSETS = (process.env.SHOTS_OFFSETS ?? '60,200,380,560,800,1200').split(',').map(Number);
const [VW, VH] = (process.env.SHOTS_SIZE ?? '390x844').split('x').map(Number);
const FLIGHT = 420;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const catalog = JSON.parse(readFileSync('assets/effects/effects.json', 'utf8'));
const skills = Object.entries(catalog.skills).filter(([id]) => !onlySkills.length || onlySkills.includes(id));

async function loadPlaywright() {
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return import(pathToFileURL(join(root, 'playwright', 'index.mjs')).href);
}
async function startVite() {
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let out = '';
  vite.stdout.on('data', (d) => (out += d));
  vite.stderr.on('data', (d) => (out += d));
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(URL)).ok) return vite;
    } catch {
      // ещё не поднялся
    }
    await sleep(200);
  }
  throw new Error(`vite не ответил:\n${out}`);
}

const sq = JSON.parse(readFileSync(squadsFile, 'utf8'))[0];
const { chromium } = await loadPlaywright();
const vite = await startVite();
const index = {};
let browser;
mkdirSync(outDir, { recursive: true });
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: Number(process.env.SHOTS_DPR ?? 2) });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((save) => {
    if (!sessionStorage.getItem('skillfx-init')) {
      localStorage.clear();
      localStorage.setItem('chronoworld.save.v1', save);
      sessionStorage.setItem('skillfx-init', '1');
    }
  }, sq.save);
  await page.goto(`${URL}?warm=${process.env.SHOTS_WARM ?? 300}`, { timeout: 180000 });
  await page.waitForFunction(() => window.__game?.scene?.isActive('Campaign'), null, { timeout: 60000, polling: 100 });
  await page.evaluate((stageId) => {
    const g = window.__game;
    for (const s of g.scene.getScenes(true)) if (s.scene.key !== 'Battle') g.scene.stop(s.scene.key);
    g.scene.start('Battle', { mode: 'stage', stageId });
  }, process.env.SHOTS_STAGE ?? 'ch2_s3');
  await page.waitForFunction(() => window.__game.scene.getScene('Battle')?.ready === true, null, { timeout: 60000, polling: 100 });
  // Часы боя идут ~1 с (фигуры встают), затем стоят: introLeft — как баннер босса.
  await page.evaluate(async (ids) => {
    const g = window.__game;
    g.loop.sleep();
    const sc = g.scene.getScene('Battle');
    const assets = await import('/src/game/assets.ts');
    await assets.holdAnimatedFx(sc, ids);
    window.__sig = await import('/src/game/skillSigs.ts');
    window.__content = (await import('/src/game/content.ts')).CONTENT;
    let t = performance.now();
    window.__t = () => t;
    window.__step = (ms) => {
      for (let i = 0; i < Math.round(ms / (1000 / 60)); i++) {
        t += 1000 / 60;
        g.step(t, 1000 / 60);
      }
    };
    while (sc.introLeft > 0) window.__step(100);
    window.__step(Number(new URLSearchParams(location.search).get('warm') ?? 300));
    sc.introLeft = 1e12;
    window.__step(600);
  }, catalog.effects.map((e) => e.id));

  const clip = await page.evaluate(() => {
    const r = window.__game.canvas.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  for (const [skill, roles] of skills) {
    for (const reverse of roles.projectile ? [false, true] : [false]) {
      const info = await page.evaluate(([skill, roles, reverse, FLIGHT]) => {
        const sc = window.__game.scene.getScene('Battle');
        const S = window.__sig;
        const hero = skill.startsWith('job_') || skill.startsWith('swordman_');
        let side = hero ? 'A' : 'B';
        if (reverse) side = side === 'A' ? 'B' : 'A';
        const alive = sc.viewList.filter((v) => v.alive && !v.shownDead);
        const mine = alive.filter((v) => v.snap.side === side).sort((a, b) => a.node.y - b.node.y);
        const foes = alive.filter((v) => v.snap.side !== side).sort((a, b) => a.node.y - b.node.y);
        if (!mine.length || !foes.length) return { err: 'нет юнитов' };
        const c = mine[Math.floor(mine.length / 2)];
        const t = foes.reduce((b, v) => (Math.abs(v.node.y - c.node.y) < Math.abs(b.node.y - c.node.y) ? v : b), foes[0]);
        const ally = mine.find((v) => v !== c) ?? c;
        sc.floats.cancel();
        sc.sfx.cancel();
        const def = window.__content.skills[skill] ?? { id: skill, range: 'ranged' };
        const at = roles.projectile ? FLIGHT : 0;
        if (roles.cast) sc.castCue(c, skill);
        if (roles.projectile) S.flyAtlas(sc.sfx, roles.projectile, sc.point(c), sc.point(t), FLIGHT, 0, Math.min(120, Math.abs(t.node.x - c.node.x) * 0.18));
        if (roles.buff) sc.fx(ally, roles.buff, 1.2, 400);
        if (roles.ground) sc.groundCue(c, def, foes.slice(0, 3), at);
        sc.sfx.later(at, () => {
          if (roles.hit) sc.fx(t, roles.hit, 0.45, 200, 0.5);
          if (roles.debuff) sc.floats.catalogFlash(t.node.x, t.node.y, roles.debuff, 220);
        });
        // Кроп: кастер и цель с запасом (единицы игры → CSS-пиксели холста).
        const cam = sc.cameras.main;
        const k = window.__game.canvas.getBoundingClientRect().width / window.__game.scale.width;
        const toCss = (x, y) => [(x - cam.worldView.x) * cam.zoom * k, (y - cam.worldView.y) * cam.zoom * k];
        const [x0, y0] = toCss(Math.min(c.node.x, t.node.x) - 200, Math.min(c.node.y, t.node.y) - 520);
        const [x1, y1] = toCss(Math.max(c.node.x, t.node.x) + 200, Math.max(c.node.y, t.node.y) + 120);
        return { caster: c.def.id, target: t.def.id, box: [x0, y0, x1, y1] };
      }, [skill, roles, reverse, FLIGHT]);
      if (info.err) {
        console.log('[atlas]', skill, info.err);
        continue;
      }
      const name = reverse ? `${skill}__reverse` : skill;
      const files = [];
      let now = 0;
      for (const o of OFFSETS) {
        await page.evaluate((ms) => window.__step(ms), o - now);
        now = o;
        const f = join(outDir, `${name}_${o}.png`);
        const [x0, y0, x1, y1] = info.box;
        const bx = Math.max(0, clip.x + x0);
        const by = Math.max(0, clip.y + y0);
        await page.screenshot({ path: f, clip: { x: bx, y: by, width: Math.min(VW - bx, x1 - x0), height: Math.min(VH - by, y1 - y0) } });
        files.push(f);
      }
      await page.evaluate((ms) => window.__step(ms), 1500);
      index[name] = { roles, ...info, files };
    }
  }
  console.log('[atlas] ошибок страницы:', errors.length, errors.slice(0, 3).join('\n'));
} finally {
  await browser?.close();
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    vite.kill('SIGKILL');
  }
}
writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 1));
console.log('[atlas] готово:', Object.keys(index).length);
