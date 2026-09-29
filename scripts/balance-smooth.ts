/**
 * Сила этапов по бою и плавная кривая сложности глав 4–7 (QA LT-02/LT-04: «рекомендуемая мощь скачет, стены чередуются
 * с проходными этапами»). docs/content/balance.md, раздел 6а.
 *
 * Σhp/Σatk этапа — плохая мера силы: у этапа с лекарем, щитами или «Благословением Изиды» порог победы в полтора раза
 * выше, чем у этапа с той же суммой статов. Прошлый подбор по времени прохождения (balance-fit, этап за этапом) поэтому
 * дал обрывы «0 из 10 / 10 из 10» между соседями. Здесь сила этапа меряется боем:
 *
 *   k* — множитель статов врагов (hp, atk, def — ровно как mult этапа), при котором отряд побеждает в половине боёв
 *   (двоичный поиск по log k, --seeds боёв на точку, --steps шагов). Отряды: пять эталонных (SMOOTH_SQUADS: фиолетовые
 *   ур. --level, ветка своей роли, без экипировки) и отряды модели игрока на дни --model-days (seed --model-squads, с
 *   экипировкой). Профиль отряда 1/k* по этапам нормирован на его среднее; D этапа — наибольший профиль (этап, неудобный
 *   хоть одному составу, торчит — его и опускаем) в масштабе эталонных отрядов («во сколько раз сильнее того, что
 *   фиолетовые ур. 45 побеждают через раз»).
 *   D линейна по mult: mult этапа × f → D × f (с точностью до округления статов) — поэтому замер нужен один раз.
 *
 * Цель — кривая по «якорям» глав: A[c] — D рядового этапа в конце главы c (A[3] — замер конца главы 3). Внутри главы c
 * рядовой этап j (1…n, n — рядовых в главе, 17) — A[c−1] × (A[c]/A[c−1])^(j/n), мини-босс — × --mini (1.1), босс — A[c] × шаг главы × --boss. Сила растёт без провалов,
 * босс — ступенька над своей главой, первый этап следующей главы — между последним рядовым и боссом.
 *
 *   npx tsx scripts/balance-smooth.ts                      замер D глав 3–7 (как есть)
 *   npx tsx scripts/balance-smooth.ts --anchors 0.8,1.1,1.5,1.9 --boss 1.1          записать mult по якорям
 *   npx tsx scripts/balance-smooth.ts --fit 8 --boss 1.1 --seeds-model 1,2,3        подобрать якоря по модели игрока:
 *       босс главы c пройден к часу --targets (по умолчанию 136,164,192,220 — дни 6, 7, 9, 10); якорь × (P(цель)/P(факт))^γ,
 *       P(t) — мощь отряда модели к моменту t (как balance-fit). Лучший вариант остаётся в data/campaign.
 *   … --fit 6 --anchors <прошлые якоря> --a3 <конец главы 3>       без нового замера: данные уже выставлены по этим якорям
 *   … --recommended --anchors <якоря> --a3 <конец главы 3>          power.recommendedStages глав 4–7 ∝ D (печатает JSON)
 *   … --recommended --load-d <замер текущих данных>                   то же по замеру (после ручных правок отдельных этапов)
 *   … --dry — только показать цели и проверку тренда (tests/chapters.test.ts), data/campaign не менять.
 * Лестница (29.09, «ровный темп»): --start 1.0 (начало глав 5–7 = босс прошлой главы × S), --stairs 0.333,0.667 и
 * --stair-share 0.6 (доля роста главы ступеньками — мягкие стены на трети и двух третях), --min-growth 1.2.
 * Опции: --level 45 (эталон), --seeds 8 (боёв на точку замера), --steps 9, --boss 1.12, --mini 1.1, --a3 (начало главы 4), --save-d/--load-d файл (замер D в JSON), --gamma 0.8, --days 11,
 * --model-squads 1,2,3,4 и --model-days 4,6,8 (отряды модели в замере), --seeds-model 1,2,3 (модели в подборе).
 * Затем: npm run balance -- --fit-recommended, --levels (docs/content/balance.md, разделы 4, 4а).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildUnit, enemySquad, stagePower, withGear, type UnitDef } from '../src/core';
import { ROOT } from './lib/content-node';
import { loadFullContext, PLAYER_MODEL, runBalance, smoothSquads, stageThreshold, type FullContext } from './lib/player-model';

const argv = process.argv.slice(2);
const flag = (name: string) => argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] !== undefined ? [argv[i + 1]] : []));
const num = (name: string, def: number) => (flag(name).length ? Number(flag(name).at(-1)) : def);
const list = (name: string, def: number[]) => (flag(name).length ? flag(name).at(-1)!.split(',').map(Number) : def);
const LEVEL = num('level', 45);
const SEEDS = num('seeds', 8);
const BOSS = num('boss', 1.12);
const GAMMA = num('gamma', 0.8);
const DAYS = num('days', 11);
const FIT = num('fit', 0);
const MODEL_SEEDS = list('seeds-model', [1, 2, 3]);
const TARGETS = list('targets', [136, 164, 192, 220]);
const FIT_CHAPTERS = ['chapter4', 'chapter5', 'chapter6', 'chapter7'];
const STEPS = num('steps', 9);
const MODEL_SQUAD_SEEDS = list('model-squads', [1, 2, 3, 4]);
const MODEL_SQUAD_DAYS = list('model-days', [4, 6, 8]);

const refSquads = (ctx: FullContext) => smoothSquads(ctx, LEVEL);
const threshold = (ctx: FullContext, squad: (UnitDef | null)[], enemies: (UnitDef | null)[]) => stageThreshold(ctx, squad, enemies, SEEDS, STEPS);

/**
 * Отряды модели игрока (с экипировкой, заточкой, золотыми героями — как в игре) на дни --model-days по seed --model-squads:
 * у живых составов свои «неудобные» этапы (лекарь врага против отряда без дальнего боя и т. п.).
 */
function modelSquads(ctx: FullContext): (UnitDef | null)[][] {
  const out: (UnitDef | null)[][] = [];
  for (const seedBase of MODEL_SQUAD_SEEDS) {
    for (const days of MODEL_SQUAD_DAYS) {
      const save = runBalance(ctx, days, { ...PLAYER_MODEL, seedBase }).save;
      const gear = withGear(ctx, save);
      out.push(save.squad.map((id) => (id ? buildUnit(save.heroes.find((h) => h.id === id)!, gear) : null)));
    }
  }
  return out;
}

/**
 * D этапов: для каждого отряда — профиль 1 / k*(этап), нормированный на его среднее геометрическое по всем замеряемым
 * этапам (отряды разной силы сравнимы); D = наибольший нормированный профиль × среднее геометрическое эталонных отрядов
 * (масштаб «фиолетовые ур. --level»). Этап, неудобный хоть одному составу, так виден в кривой — его и опускают.
 */
function measure(ctx: FullContext, chapters: Set<string>): Map<string, number> {
  const ref = refSquads(ctx);
  const squads: (UnitDef | null)[][] = [...ref, ...modelSquads(ctx)];
  const stages = ctx.content.stages.filter((s) => chapters.has(s.chapter));
  const enemies = new Map(stages.map((s) => [s.id, enemySquad(s.id, ctx)]));
  const logGeo = (xs: number[]) => xs.reduce((a, b) => a + Math.log(b), 0) / xs.length;
  const profiles = squads.map((squad) => stages.map((s) => 1 / threshold(ctx, squad, enemies.get(s.id)!)));
  const norms = profiles.map((p) => logGeo(p));
  const scale = norms.slice(0, ref.length).reduce((a, b) => a + b, 0) / ref.length;
  const out = new Map<string, number>();
  stages.forEach((s, i) => out.set(s.id, Math.exp(scale + Math.max(...profiles.map((p, j) => Math.log(p[i]) - norms[j])))));
  return out;
}

function print(ctx: FullContext, d: Map<string, number>, target?: Map<string, number>): void {
  let prev = 0;
  for (const s of ctx.content.stages) {
    const v = d.get(s.id);
    if (v === undefined) continue;
    const jump = prev ? `×${(v / prev).toFixed(2)}` : '';
    const t = target?.get(s.id);
    console.log(`${s.id.padEnd(8)} ${s.boss ? 'босс' : '    '} D ${v.toFixed(3)} ${jump.padStart(6)}${t ? `  цель ${t.toFixed(3)}` : ''}`);
    prev = v;
  }
}

/**
 * Мини-боссы середины глав (docs/content/campaign.md): первый этап главы с таким врагом — ступенька ×--mini над трендом
 * (мягкая стена внутри главы), дальше тренд идёт как шёл.
 */
const MINI_BOSS_UNITS = new Set(['mob4_ancient_mummy', 'mob5_munak_elder', 'mob6_bosun', 'mob7_bridge_warden']);
const MINI = num('mini', 1.1);

function miniBossStages(ctx: FullContext): Set<string> {
  const out = new Set<string>();
  for (const chapter of FIT_CHAPTERS) {
    const s = ctx.content.stages.find((x) => x.chapter === chapter && !x.boss && x.enemies.some((e) => e && MINI_BOSS_UNITS.has(e.unit)));
    if (s) out.add(s.id);
  }
  return out;
}

/**
 * Лестница внутри главы (29.09, «ровный темп»): после растяжки глав до 18 этапов сила росла плавно на 2–4% за этап, а за стену
 * босса модель игрока вырастала сильнее — и проходила следующую главу почти целиком за сессию. Теперь:
 *  --start S — начало глав 5–7 (значение «этапа 0» тренда) = сила босса прошлой главы × S (было — конец прошлой главы, ниже
 *    босса на ступеньку: первые 6–8 этапов после босса «пролетались»);
 *  --stairs 0.33,0.67 и --stair-share f — доля f роста главы (ln A[c]/начало) не плавная, а ступеньками на этих долях главы
 *    (этап round(доля × (n + 1)) и все после него выше на ступеньку): после ступеньки — мягкая стена «забери сундук», дальше
 *    серия побед до следующей. Остальной рост (1 − f) — плавный наклон.
 * Без флагов — прежняя кривая (--stair-share 0, начало = конец прошлой главы).
 */
const START = num('start', NaN);
const STAIRS = list('stairs', [1 / 3, 2 / 3]);
const STAIR_SHARE = num('stair-share', 0);
/** --min-growth: рядовые этапы главы растут не меньше чем ×N от начала до конца (иначе подбор «сплющивает» главу 7 — стен нет). */
const MIN_GROWTH = num('min-growth', 1.05);

/**
 * Цели D по якорям: a3 — начало главы 4 (конец главы 3 или явно), anchors — концы глав 4–7 (рядовой этап n). Рядовой этап j
 * (1…n, n — рядовых в главе, с вставными — 17) — from × e^(наклон·j + ступенька·[ступенек до j]); мини-босс — × --mini;
 * босс — to × e^наклон × --boss.
 */
function targetsFor(ctx: FullContext, a3: number, anchors: number[]): Map<string, number> {
  const out = new Map<string, number>();
  const mini = miniBossStages(ctx);
  let prevBoss = NaN;
  FIT_CHAPTERS.forEach((chapter, c) => {
    const prevEnd = c === 0 ? a3 : anchors[c - 1];
    const from = c > 0 && Number.isFinite(START) ? Math.max(prevEnd, prevBoss * START) : prevEnd;
    const to = Math.max(anchors[c], from * MIN_GROWTH);
    const stages = ctx.content.stages.filter((s) => s.chapter === chapter);
    const n = stages.filter((s) => !s.boss).length;
    const g = Math.log(to / from);
    const at = STAIRS.map((f) => Math.round(f * (n + 1)));
    const stair = (STAIR_SHARE * g) / at.length;
    const slope = ((1 - STAIR_SHARE) * g) / n;
    let j = 0;
    for (const s of stages) {
      if (s.boss) {
        prevBoss = to * Math.exp(slope) * BOSS;
        out.set(s.id, prevBoss);
      } else {
        j++;
        out.set(s.id, from * Math.exp(slope * j + stair * at.filter((p) => p <= j).length) * (mini.has(s.id) ? MINI : 1));
      }
    }
  });
  return out;
}

/** Та же проверка, что tests/chapters.test.ts (главы 4+): рядовой этап / линейный тренд главы (±15%), босс / тренд (1…1.35). */
function trendCheck(ctx: FullContext, d: Map<string, number>): void {
  for (const chapter of FIT_CHAPTERS) {
    const list = ctx.content.stages.filter((s) => s.chapter === chapter);
    const reg = list.filter((s) => !s.boss).map((s) => Math.log(d.get(s.id)!));
    const n = reg.length;
    const xm = (n - 1) / 2;
    const ym = reg.reduce((a, b) => a + b, 0) / n;
    const slope = reg.reduce((a, y, i) => a + (i - xm) * (y - ym), 0) / reg.reduce((a, _, i) => a + (i - xm) ** 2, 0);
    const r = list.map((s, i) => Math.exp(Math.log(d.get(s.id)!) - (ym + slope * (Math.min(i, n - 1) - xm))));
    const regR = r.slice(0, -1);
    console.log(
      `${chapter}: рост ×${Math.exp(slope).toFixed(3)}/этап, этап/тренд ${Math.min(...regR).toFixed(2)}…${Math.max(...regR).toFixed(2)}, босс/тренд ${r.at(-1)!.toFixed(2)}`,
    );
  }
}

/**
 * power.recommendedStages глав 4–7 ∝ D: модели игрока (2/4/6 сессий × --seeds-model) — мощь при последнем поражении и первой
 * победе на каждом этапе; порог этапа — середина (как fitRecommended), K_i = порог × 1.03 / D_i. K — геометрический тренд K_i по
 * этапам, опущенный до «пола» (все поражения и победы моделей — не ниже 0.86 рекомендуемой, тест balance.test.ts).
 * Коэффициент этапа — K × D / stagePower.
 */
function recommendFactors(ctx: FullContext, D: Map<string, number>): void {
  const per = new Map<string, { lo: number[]; hi: number[]; min: number }>();
  for (const sessionsPerDay of [2, 4, 6]) {
    for (const seedBase of MODEL_SEEDS) {
      const res = runBalance(ctx, DAYS, { ...PLAYER_MODEL, sessionsPerDay, hoursBetweenSessions: sessionsPerDay >= 6 ? 2.5 : 4, seedBase });
      for (const id of D.keys()) {
        const bs = res.battles.filter((b) => b.kind === 'stage' && b.target === id);
        const win = bs.find((b) => b.win);
        if (!win) continue;
        const losses = bs.filter((b) => !b.win);
        const r = per.get(id) ?? { lo: [], hi: [], min: Infinity };
        r.min = Math.min(r.min, win.squadPower, ...losses.map((b) => b.squadPower));
        if (losses.length) {
          r.lo.push(Math.max(...losses.map((b) => b.squadPower)));
          r.hi.push(win.squadPower);
        }
        per.set(id, r);
      }
    }
  }
  // K по этапу: мощь модели на пороге / D. Отношение мощи к силе боя меняется с прогрессом (редкость, уровень, вещи),
  // поэтому K — не константа, а геометрический тренд по номеру этапа (регрессия log K_i), опущенный целиком так, чтобы
  // «пол» выполнялся на каждом этапе.
  const ids = [...D.keys()];
  const pts: { i: number; k: number }[] = [];
  const caps: { i: number; cap: number }[] = [];
  ids.forEach((id, i) => {
    const r = per.get(id);
    if (!r) return;
    const d = D.get(id)!;
    caps.push({ i, cap: r.min / (0.86 * d) });
    if (!r.lo.length) return;
    const lo = median(r.lo);
    const hi = median(r.hi);
    pts.push({ i, k: (((lo + Math.min(hi, lo * 1.3)) / 2) * 1.03) / d });
  });
  const xm = pts.reduce((a, p) => a + p.i, 0) / pts.length;
  const ym = pts.reduce((a, p) => a + Math.log(p.k), 0) / pts.length;
  const slope = pts.reduce((a, p) => a + (p.i - xm) * (Math.log(p.k) - ym), 0) / pts.reduce((a, p) => a + (p.i - xm) ** 2, 0);
  const line = (i: number) => ym + slope * (i - xm);
  const shift = Math.min(0, ...caps.map((c) => Math.log(c.cap) - line(c.i)));
  const K = (i: number) => Math.exp(line(i) + shift);
  console.log(`K: тренд ${Math.exp(line(0)).toFixed(0)} → ${Math.exp(line(ids.length - 1)).toFixed(0)} (${pts.length} этапов с поражениями), пол опускает на ×${Math.exp(shift).toFixed(3)}`);
  const out: Record<string, number> = {};
  ids.forEach((id, i) => (out[id] = Math.round(((K(i) * D.get(id)!) / stagePower(id, ctx)) * 100) / 100));
  console.log(JSON.stringify(out));
}

// ---------- данные глав ----------

interface Enemy { unit: string; mult?: number }
interface ChapterJson { id: string; stages: { id: string; enemies: (Enemy | null)[] }[] }
const files = new Map<string, string>();
for (const f of readdirSync(join(ROOT, 'data/campaign')).filter((x) => x.endsWith('.json'))) {
  const path = join(ROOT, 'data/campaign', f);
  files.set((JSON.parse(readFileSync(path, 'utf8')) as ChapterJson).id, path);
}
const original = new Map(FIT_CHAPTERS.map((c) => [c, JSON.parse(readFileSync(files.get(c)!, 'utf8')) as ChapterJson]));

/** Записать mult: исходный mult × цель / замер (D линейна по mult). */
function write(d0: Map<string, number>, targets: Map<string, number>): void {
  for (const chapter of FIT_CHAPTERS) {
    const json = structuredClone(original.get(chapter)!);
    for (const st of json.stages) {
      const f = targets.get(st.id)! / d0.get(st.id)!;
      for (const e of st.enemies) if (e) e.mult = Math.round((e.mult ?? 1) * f * 1000) / 1000;
    }
    writeFileSync(files.get(chapter)!, JSON.stringify(json, null, 2) + '\n');
  }
}

const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};

// ---------- запуск ----------

const ctx0 = loadFullContext();
const anchorsArg = flag('anchors').length ? list('anchors', []) : null;
if (!anchorsArg && !FIT && !argv.includes('--recommended')) {
  console.log(`Эталон: фиолетовые ур. ${LEVEL}, ${SEEDS} seed на точку`);
  const d = measure(ctx0, new Set(['chapter3', ...FIT_CHAPTERS]));
  print(ctx0, d);
  // --save-d файл: замер в JSON, чтобы подбор (--fit --load-d файл) не мерил заново (~полчаса).
  if (flag('save-d').length) writeFileSync(flag('save-d').at(-1)!, JSON.stringify(Object.fromEntries(d), null, 1) + '\n');
  process.exit(0);
}

if (argv.includes('--recommended')) {
  // Рекомендуемая мощь глав 4–7 ∝ D (плавно, как сила этапов): коэффициент этапа = K × D / мощь врагов (stagePower).
  // D — замер текущих данных (--load-d, после ручных правок этапов) или цели по якорям (данные записаны по ним без правок).
  const a3r = num('a3', NaN);
  if (flag('load-d').length) {
    const all = new Map(Object.entries(JSON.parse(readFileSync(flag('load-d').at(-1)!, 'utf8')) as Record<string, number>));
    const late = new Set(ctx0.content.stages.filter((s) => FIT_CHAPTERS.includes(s.chapter)).map((s) => s.id));
    recommendFactors(ctx0, new Map([...all].filter(([id]) => late.has(id))));
    process.exit(0);
  }
  if (!anchorsArg || !Number.isFinite(a3r)) throw new Error('--recommended: нужны --load-d (замер) или --anchors (как у --fit) и --a3 (конец главы 3)');
  recommendFactors(ctx0, targetsFor(ctx0, a3r, anchorsArg));
  process.exit(0);
}

// --a3 с --anchors: данные уже выставлены по этим якорям (прошлый --fit) — D известна без замера (D линейна по mult).
const a3Arg = num('a3', NaN);
const known = anchorsArg && Number.isFinite(a3Arg);
const loaded = flag('load-d').length ? new Map(Object.entries(JSON.parse(readFileSync(flag('load-d').at(-1)!, 'utf8')) as Record<string, number>)) : null;
if (!known && !loaded) console.log(`Замер D (эталон — фиолетовые ур. ${LEVEL}, ${SEEDS} seed)…`);
// --load-d важнее: замер текущих данных, --anchors — тогда только стартовые якоря подбора.
const d0 = loaded ?? (known ? targetsFor(ctx0, a3Arg, anchorsArg) : measure(ctx0, new Set(['chapter3', ...FIT_CHAPTERS])));
// Конец главы 3 — по последним трём рядовым этапам (замер шумит на ±5%). Главы 1–3 не трогаем.
// --a3 без --anchors — начало главы 4 задано явно (ближе к боссу главы 3, чтобы после него глава 4 не проходилась
// целиком за одну сессию), иначе — замер конца главы 3.
const a3 = known || Number.isFinite(a3Arg) ? a3Arg : median(ctx0.content.stages.filter((s) => s.chapter === 'chapter3' && !s.boss).map((s) => d0.get(s.id)!).slice(-3));
let anchors = anchorsArg ?? FIT_CHAPTERS.map((chapter) => {
  const regular = ctx0.content.stages.filter((s) => s.chapter === chapter && !s.boss).map((s) => d0.get(s.id)!);
  return median(regular.slice(-3));
});
console.log(`конец главы 3: D ${a3.toFixed(3)}; якоря глав 4–7: ${anchors.map((a) => a.toFixed(3)).join(', ')}`);

if (!FIT) {
  const t = targetsFor(ctx0, a3, anchors);
  write(d0, t);
  print(ctx0, t);
  trendCheck(ctx0, t);
  process.exit(0);
}

let best = { score: Infinity, anchors };
for (let it = 0; it < FIT; it++) {
  write(d0, targetsFor(ctx0, a3, anchors));
  const ctx = loadFullContext();
  const runs = MODEL_SEEDS.map((seedBase) => {
    const res = runBalance(ctx, DAYS, { ...PLAYER_MODEL, seedBase });
    const t0 = res.rows[0].time_h;
    const end = res.rows[res.rows.length - 1].time_h - t0;
    const clear = new Map(res.firstClears.map((f) => [f.stageId, f.time_h - t0]));
    const battles = res.battles.map((b) => ({ t: b.t - t0, p: b.squadPower }));
    const P = (t: number) => {
      let p = 0;
      for (const b of battles) if (b.t <= t + 0.2) p = Math.max(p, b.p);
      return p || battles[0].p;
    };
    return { end, clear, P };
  });
  const P = (t: number) => median(runs.map((r) => r.P(t)));
  let score = 0;
  const line: string[] = [];
  const next = anchors.map((a, c) => {
    const boss = ctx.content.stages.filter((s) => s.chapter === FIT_CHAPTERS[c]).at(-1)!.id;
    const t = median(runs.map((r) => r.clear.get(boss) ?? r.end + 24));
    score += Math.abs(Math.log((t + 2) / (TARGETS[c] + 2)));
    line.push(`${boss} ${t.toFixed(0)} ч (цель ${TARGETS[c]})`);
    const f = Math.pow(P(TARGETS[c]) / P(t), GAMMA);
    return a * Math.min(1.25, Math.max(0.8, f));
  });
  // Якоря не убывают: глава не слабее предыдущей.
  for (let c = 1; c < next.length; c++) next[c] = Math.max(next[c], next[c - 1] * 1.05);
  console.log(`итерация ${it + 1}: ${anchors.map((a) => a.toFixed(3)).join(', ')} → ${line.join(', ')}; отклонение ${score.toFixed(3)}`);
  if (score < best.score) best = { score, anchors };
  anchors = next;
}
write(d0, targetsFor(ctx0, a3, best.anchors));
console.log(`лучшие якоря: ${best.anchors.map((a) => a.toFixed(3)).join(',')} (отклонение ${best.score.toFixed(3)}) — записаны в data/campaign`);
print(ctx0, targetsFor(ctx0, a3, best.anchors));
trendCheck(ctx0, targetsFor(ctx0, a3, best.anchors));
