/**
 * Генераторы заготовок контента для `npm run content:new` (scripts/content-new.ts) — чистая логика без process.exit,
 * чтобы её проверял тест (tests/content-new.test.ts пишет заготовки во временную копию data/).
 *
 *   unit <id> [--from <id>] [--kind hero|monster|boss]   юнит (копия или пустой шаблон)
 *   skill <id> [--from <id>]                             навык (копия или пустой шаблон)
 *   chapter <id> [--name "…"] [--order N] [--prefix chN] [--mobs a,b,c] [--boss <unitId>] [--no-story]
 *                                                        глава: 10 этапов (9 обычных + босс) + сюжет data/story/<id>.json
 *   stage <chapterId> [--from <stageId>] [--append]      этап: копия соседнего, перед босс-этапом (или в конец с --append)
 *   story <chapterId>                                    сюжет главы: вступление, сцена перед боссом (bossIntro), финал
 *   boss <id> [--from <unitId>] [--sprite <spriteId>] [--name "…"]   босс + своя ульта <id>_ult
 *   hero <id> --class <jobId> --gender m|f [--rarity green|blue|purple] [--story] [--form <jobId>] [--after <stageId>]
 *        [--name "…"] [--sprite <spriteId>]            карточка героя data/heroes/<id>.json (docs/design/heroes.md)
 *
 * Все заготовки сразу проходят `npm run content:check`: ссылки только на существующие юниты, навыки и спрайты.
 * Места, которые надо дописать руками (названия, реплики, баланс), помечены строкой «TODO» — content:check
 * показывает их предупреждениями (findTodos), а не ошибками. Существующие файлы никогда не перезаписываются,
 * кроме главы в команде stage (в неё добавляется этап).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

type Json = Record<string, unknown>;
interface Reward {
  jobExp: number;
  gold: number;
}
interface Slot {
  unit: string;
  mult?: number;
}
interface Stage {
  id: string;
  name: string;
  boss?: boolean;
  enemies: (Slot | null)[];
  rewards: Reward;
  offlinePerMinute: Reward;
}
interface Chapter {
  $schema?: string;
  $comment?: string;
  id: string;
  name: string;
  order: number;
  stages: Stage[];
}
interface Unit {
  id: string;
  name: string;
  kind: string;
  skills: { basic: string; ult?: string; actives?: string[]; passives?: string[] };
  visual: { sprite: string } & Json;
}

export const TODO = 'TODO';
const ID_RE = /^[a-z][a-z0-9_]*$/;

export class ContentNewError extends Error {}

export interface GenResult {
  /** Созданные или изменённые файлы (относительно root). */
  written: string[];
  /** Что сделать дальше — для вывода в консоль. */
  notes: string[];
}

/** Разбор argv: позиционные аргументы и --опции (флаг без значения — 'true'). */
export function parseArgs(argv: readonly string[]): { pos: string[]; opts: Record<string, string> } {
  const pos: string[] = [];
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      pos.push(a);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      opts[a.slice(2)] = next;
      i++;
    } else opts[a.slice(2)] = 'true';
  }
  return { pos, opts };
}

export const USAGE = [
  'Использование: npm run content:new -- <что> <id> [опции]',
  '  unit <id> [--from <id>] [--kind hero|monster|boss]',
  '  skill <id> [--from <id>]',
  '  chapter <id> [--name "…"] [--order N] [--prefix chN] [--mobs a,b,c] [--boss <unitId>] [--no-story]',
  '  stage <chapterId> [--from <stageId>] [--append]',
  '  story <chapterId>',
  '  boss <id> [--from <unitId>] [--sprite <spriteId>] [--name "…"]',
  '  hero <id> --class <jobId> --gender m|f [--rarity green|blue|purple] [--story] [--form <jobId>] [--after <stageId>] [--name "…"] [--sprite <spriteId>]',
].join('\n');

// ---------- файлы ----------

const readJson = <T>(root: string, rel: string): T => JSON.parse(readFileSync(join(root, rel), 'utf8')) as T;
const exists = (root: string, rel: string) => existsSync(join(root, rel));

function writeNew(root: string, rel: string, data: unknown, out: GenResult, overwrite = false): void {
  const abs = join(root, rel);
  if (!overwrite && existsSync(abs)) throw new ContentNewError(`${rel} уже есть — не перезаписываю`);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(data, null, 2) + '\n');
  out.written.push(rel);
}

function checkId(id: string | undefined, what: string): string {
  if (!id || !ID_RE.test(id)) throw new ContentNewError(`${what}: нужен id из латиницы в нижнем регистре, цифр и _ (получено: ${id ?? 'ничего'})`);
  return id;
}

function chapters(root: string): Chapter[] {
  const dir = join(root, 'data/campaign');
  if (!existsSync(dir)) return [];
  return readJsonDirNames(dir).map((f) => readJson<Chapter>(root, `data/campaign/${f}`));
}

function readJsonDirNames(abs: string): string[] {
  return readdirSync(abs).filter((f) => f.endsWith('.json')).sort();
}

function chapterFile(root: string, chapterId: string): string {
  const rel = `data/campaign/${chapterId}.json`;
  if (exists(root, rel)) return rel;
  // id главы может не совпадать с именем файла.
  for (const f of readJsonDirNames(join(root, 'data/campaign'))) {
    if (readJson<Chapter>(root, `data/campaign/${f}`).id === chapterId) return `data/campaign/${f}`;
  }
  throw new ContentNewError(`глава ${chapterId} не найдена в data/campaign`);
}

/** Префикс id этапов главы: ch4_s1 → ch4. */
const stagePrefix = (c: Chapter) => c.stages[0]?.id.replace(/_s\d+$/, '') ?? c.id;

function unit(root: string, id: string): Unit {
  const rel = `data/units/${id}.json`;
  if (!exists(root, rel)) throw new ContentNewError(`юнит ${id} не найден (${rel})`);
  return readJson<Unit>(root, rel);
}

// ---------- unit / skill (как было) ----------

export function genUnit(root: string, id: string, opts: Record<string, string>): GenResult {
  const out: GenResult = { written: [], notes: [] };
  checkId(id, 'unit');
  const rel = `data/units/${id}.json`;
  let data: Json;
  if (opts.from) {
    const src = `data/units/${opts.from}.json`;
    if (!exists(root, src)) throw new ContentNewError(`Нет ${src}`);
    data = { ...readJson<Json>(root, src), id, name: `${id} (копия ${opts.from})` };
    data.visual = { ...(data.visual as object), sprite: id };
  } else {
    data = {
      $schema: '../schema/unit.schema.json',
      id,
      name: id,
      kind: opts.kind ?? 'hero',
      role: 'damage',
      stats: { hp: 1000, atk: 100, def: 20, spd: 100 },
      skills: { basic: 'basic_melee', passives: [] },
      visual: { sprite: id, hitFx: 'fx_hit' },
    };
  }
  writeNew(root, rel, data, out);
  out.notes.push(`visual.sprite = "${id}": пока спрайта нет, будет плейсхолдер (content:check предупредит).`);
  return out;
}

export function genSkill(root: string, id: string, opts: Record<string, string>): GenResult {
  const out: GenResult = { written: [], notes: [] };
  checkId(id, 'skill');
  let data: Json;
  if (opts.from) {
    const src = `data/skills/${opts.from}.json`;
    if (!exists(root, src)) throw new ContentNewError(`Нет ${src}`);
    data = { ...readJson<Json>(root, src), id, name: `${id} (копия ${opts.from})` };
  } else {
    data = {
      $schema: '../schema/skill.schema.json',
      id,
      name: id,
      description: '',
      range: 'ranged',
      target: { side: 'enemy', pick: 'nearest' },
      effects: [{ type: 'damage', k: 1 }],
    };
  }
  writeNew(root, `data/skills/${id}.json`, data, out);
  out.notes.push('Навык ещё ни у кого не стоит — добавьте его юниту (skills.*) или профессии (data/jobs, skills[]).');
  return out;
}

// ---------- chapter / stage / story / boss ----------

/** Слоты по числу врагов: фронт первым, потом тыл. */
const SLOT_ORDER: Record<number, number[]> = { 1: [0], 2: [0, 1], 3: [0, 1, 2], 4: [0, 1, 2, 4], 5: [0, 1, 2, 3, 4] };
const scaleReward = (r: Reward, k: number): Reward => ({ jobExp: Math.round(r.jobExp * k), gold: Math.round(r.gold * k) });
/** Экономика новой главы (docs/content/balance.md, раздел 2): сундук +9% за этап, золото 0.7 от опыта, награды — минуты сундука. */
export const CHEST_GROWTH = 1.09;
export const CHEST_GOLD = 0.7;
export const REWARD_MINUTES = 30;
export const BOSS_REWARD_MINUTES = 45;

export function genChapter(root: string, id: string, opts: Record<string, string>): GenResult {
  const out: GenResult = { written: [], notes: [] };
  checkId(id, 'chapter');
  const rel = `data/campaign/${id}.json`;
  if (exists(root, rel)) throw new ContentNewError(`${rel} уже есть — не перезаписываю`);
  const all = chapters(root).sort((a, b) => a.order - b.order);
  if (all.some((c) => c.id === id)) throw new ContentNewError(`глава ${id} уже объявлена в data/campaign`);
  const last = all[all.length - 1];
  const order = opts.order ? Number(opts.order) : (last?.order ?? 0) + 1;
  if (!Number.isInteger(order) || order < 1) throw new ContentNewError(`--order: нужно целое ≥ 1 (получено ${opts.order})`);
  if (all.some((c) => c.order === order)) throw new ContentNewError(`order ${order} уже занят главой ${all.find((c) => c.order === order)!.id}`);
  const prefix = checkId(opts.prefix ?? (/^chapter(\d+)$/.exec(id) ? `ch${/^chapter(\d+)$/.exec(id)![1]}` : undefined), '--prefix (для id вида chapterN выводится сам)');
  const usedIds = new Set(all.flatMap((c) => c.stages.map((s) => s.id)));
  if ([...usedIds].some((s) => s.startsWith(`${prefix}_s`))) throw new ContentNewError(`этапы с префиксом ${prefix}_s уже есть — задайте --prefix`);

  // Монстры: --mobs или рядовые враги последней главы.
  const mobs = opts.mobs
    ? opts.mobs.split(',').map((m) => m.trim()).filter(Boolean)
    : [...new Set((last?.stages ?? []).flatMap((s) => s.enemies).filter((e): e is Slot => !!e).map((e) => e.unit))].filter(
        (u) => exists(root, `data/units/${u}.json`) && unit(root, u).kind === 'monster',
      );
  if (mobs.length === 0) throw new ContentNewError('нет монстров для этапов: задайте --mobs a,b,c');
  for (const m of mobs) if (unit(root, m).kind !== 'monster') throw new ContentNewError(`--mobs: ${m} — не монстр (kind ${unit(root, m).kind})`);
  const bossId = opts.boss ?? 'mob_boss1';
  const boss = unit(root, bossId);
  if (boss.kind !== 'boss') throw new ContentNewError(`--boss: ${bossId} — не босс (kind ${boss.kind})`);

  // Экономика — как у глав 2–3 (docs/content/balance.md, раздел 2): сундук (offlinePerMinute) растёт геометрически,
  // +9% за этап от последнего этапа прошлой главы, золото сундука — 0.7 от опыта; награда за первое прохождение —
  // 30 минут сундука этого этапа (босс — 45 минут).
  const lastStage = last?.stages[last.stages.length - 1];
  const baseChest = lastStage?.offlinePerMinute.jobExp ?? 6;
  const chestAt = (i: number): Reward => {
    const jobExp = Math.round(baseChest * Math.pow(CHEST_GROWTH, i + 1));
    return { jobExp, gold: Math.round(jobExp * CHEST_GOLD) };
  };
  const stages: Stage[] = [];
  for (let i = 0; i < 9; i++) {
    const n = i < 3 ? 3 : i < 6 ? 4 : 5;
    const enemies: (Slot | null)[] = [null, null, null, null, null];
    SLOT_ORDER[n].forEach((slot, j) => (enemies[slot] = { unit: mobs[(i + j) % mobs.length], mult: 1 }));
    stages.push({
      id: `${prefix}_s${i + 1}`,
      name: `${TODO}: этап ${i + 1}`,
      boss: false,
      enemies,
      rewards: scaleReward(chestAt(i), REWARD_MINUTES),
      offlinePerMinute: chestAt(i),
    });
  }
  stages.push({
    id: `${prefix}_s10`,
    name: `${TODO}: логово босса`,
    boss: true,
    enemies: [{ unit: mobs[0], mult: 1 }, { unit: bossId, mult: 0.5 }, { unit: mobs[1 % mobs.length], mult: 1 }, { unit: mobs[2 % mobs.length], mult: 1 }, null],
    rewards: scaleReward(chestAt(9), BOSS_REWARD_MINUTES),
    offlinePerMinute: chestAt(9),
  });
  const chapter: Chapter = {
    $schema: '../schema/chapter.schema.json',
    $comment: `${TODO}: заготовка content:new — mult всех этапов = 1 (босс 0.5), подобрать по docs/CONTENT_RECIPES.md «Новая глава: чеклист» (playthrough, balance-fit, --fit-recommended); сундук и награды уже по формуле баланса`,
    id,
    name: opts.name ?? `${TODO}: Глава ${order}`,
    order,
    stages,
  };
  writeNew(root, rel, chapter, out);
  out.notes.push(
    `Глава ${id}: этапы ${prefix}_s1…${prefix}_s10, монстры ${mobs.join(', ')}, босс ${bossId}.`,
    `Сундук ${stages[0].offlinePerMinute.jobExp}…${stages[9].offlinePerMinute.jobExp} опыта/мин (+9%/этап), награды — 30 мин сундука (босс 45).`,
    'Дальше — чеклист «Новая глава» в docs/CONTENT_RECIPES.md: названия, составы и mult (npm run playthrough -- <индекс главы> 3 --idle),',
    'окна главы в scripts/balance-fit.ts (W и список файлов) → npx tsx scripts/balance-fit.ts, затем npm run balance -- --days 10 --fit-recommended',
    '(data/progression.json → power.recommendedStages); фоны assets/backgrounds/bg_battle_ch<N>.jpg / bg_map_ch<N>.jpg,',
    'рекрут в data/progression.json → heroes.recruits, полоса башни data/tower.json → bands; подгонка силы — npx tsx scripts/balance-fit.ts --chapter N.',
  );
  if (opts['no-story'] !== 'true') {
    const story = genStory(root, id, {});
    out.written.push(...story.written);
    out.notes.push(...story.notes);
  }
  return out;
}

export function genStage(root: string, chapterId: string, opts: Record<string, string>): GenResult {
  const out: GenResult = { written: [], notes: [] };
  checkId(chapterId, 'stage');
  const rel = chapterFile(root, chapterId);
  const chapter = readJson<Chapter>(root, rel);
  const prefix = stagePrefix(chapter);
  const all = new Set(chapters(root).flatMap((c) => c.stages.map((s) => s.id)));
  let n = chapter.stages.length + 1;
  while (all.has(`${prefix}_s${n}`)) n++;
  const lastIsBoss = !!chapter.stages[chapter.stages.length - 1]?.boss;
  const at = opts.append === 'true' || !lastIsBoss ? chapter.stages.length : chapter.stages.length - 1;
  const from = opts.from ? chapter.stages.find((s) => s.id === opts.from) : chapter.stages[at - 1] ?? chapter.stages[0];
  if (!from) throw new ContentNewError(`этап ${opts.from} не найден в главе ${chapterId}`);
  const stage: Stage = {
    id: `${prefix}_s${n}`,
    name: `${TODO}: этап ${at + 1}`,
    boss: false,
    enemies: from.enemies.map((e) => (e && !(from.boss && unit(root, e.unit).kind === 'boss') ? { ...e } : null)),
    rewards: { ...from.rewards },
    offlinePerMinute: { ...from.offlinePerMinute },
  };
  if (stage.enemies.every((e) => e === null)) throw new ContentNewError(`в этапе ${from.id} нет рядовых врагов для копии — задайте --from`);
  chapter.stages.splice(at, 0, stage);
  writeNew(root, rel, chapter, out, true);
  out.notes.push(
    `Этап ${stage.id} — позиция ${at + 1} из ${chapter.stages.length} в ${rel} (копия ${from.id}).`,
    'id этапа не переименовывайте после релиза: он хранится в сохранениях (campaign.cleared).',
  );
  return out;
}

export function genStory(root: string, chapterId: string, _opts: Record<string, string>): GenResult {
  const out: GenResult = { written: [], notes: [] };
  checkId(chapterId, 'story');
  const chapter = readJson<Chapter>(root, chapterFile(root, chapterId));
  const rel = `data/story/${chapterId}.json`;
  if (exists(root, rel)) throw new ContentNewError(`${rel} уже есть — не перезаписываю`);
  const prefix = stagePrefix(chapter);
  const bossStage = [...chapter.stages].reverse().find((s) => s.boss);
  const lastStage = chapter.stages[chapter.stages.length - 1];
  const bossSlot = bossStage?.enemies.find((e) => e && exists(root, `data/units/${e.unit}.json`) && unit(root, e.unit).kind === 'boss');
  const bossUnit = bossSlot ? unit(root, bossSlot.unit) : undefined;
  const speakers: Record<string, { name: string; portrait: string }> = {
    narrator: { name: `${TODO}: рассказчик`, portrait: 'novice' },
    hero1: { name: 'Герой', portrait: 'hero' },
  };
  if (bossUnit) speakers.boss = { name: bossUnit.name, portrait: `unit:${bossUnit.id}` };
  const line = (speaker: string, what: string) => ({ speaker, text: `${TODO}: ${what}` });
  const scenes: Json[] = [
    { id: `${prefix}_intro`, trigger: 'chapterStart', lines: [line('narrator', 'вступление главы'), line('hero1', 'ответ героя')] },
  ];
  if (bossStage && bossUnit) {
    scenes.push({
      id: `${bossStage.id}_before`,
      trigger: 'beforeStage',
      stageId: bossStage.id,
      bossIntro: { title: bossUnit.name, subtitle: `${TODO}: титул босса` },
      lines: [line('boss', 'угроза босса'), line('hero1', 'ответ героя')],
    });
  }
  scenes.push({ id: `${prefix}_outro`, trigger: 'afterStage', stageId: lastStage.id, lines: [line('narrator', 'финал главы, крючок к следующей')] });
  writeNew(root, rel, { $schema: '../schema/story.schema.json', chapter: chapterId, speakers, scenes }, out);
  out.notes.push(
    `Сюжет ${rel}: сцены ${scenes.map((s) => s.id).join(', ')}. Реплики ≤ 120 символов, 1–6 на сцену.`,
    'hero1…heroN — сюжетные карточки игрока по порядку progression.heroes (имя из карточки); portrait: hero | id профессии | id спрайта | unit:<id>.',
  );
  return out;
}

export function genBoss(root: string, id: string, opts: Record<string, string>): GenResult {
  const out: GenResult = { written: [], notes: [] };
  checkId(id, 'boss');
  const fromId = opts.from ?? 'mob_boss1';
  const src = readJson<Unit & Json>(root, `data/units/${fromId}.json`);
  const ultId = `${id}_ult`;
  if (exists(root, `data/units/${id}.json`)) throw new ContentNewError(`data/units/${id}.json уже есть — не перезаписываю`);
  if (exists(root, `data/skills/${ultId}.json`)) throw new ContentNewError(`data/skills/${ultId}.json уже есть — не перезаписываю`);
  const ultSrc = src.skills.ult && exists(root, `data/skills/${src.skills.ult}.json`) ? readJson<Json>(root, `data/skills/${src.skills.ult}.json`) : undefined;
  const ult: Json = ultSrc
    ? { ...ultSrc, id: ultId, name: `${TODO}: ульта (копия ${String(ultSrc.name)})` }
    : {
        $schema: '../schema/skill.schema.json',
        id: ultId,
        name: `${TODO}: ульта босса`,
        description: 'Удар по всем врагам.',
        range: 'ranged',
        target: { side: 'enemy', pick: 'all' },
        effects: [{ type: 'damage', k: 0.8 }],
      };
  const sprite = opts.sprite ?? src.visual.sprite;
  const boss = {
    ...src,
    $schema: '../schema/unit.schema.json',
    id,
    name: opts.name ?? `${TODO}: босс (копия ${src.name})`,
    kind: 'boss',
    skills: { ...src.skills, ult: ultId },
    visual: { ...src.visual, sprite },
  };
  writeNew(root, `data/skills/${ultId}.json`, ult, out);
  writeNew(root, `data/units/${id}.json`, boss, out);
  out.notes.push(
    `Босс ${id} (из ${fromId}), ульта ${ultId}, спрайт ${sprite}. Поставьте его в босс-этап (boss: true, mult ~0.5),`,
    'в сюжете главы — beforeStage этого этапа с bossIntro { title, subtitle }; баннер «ИМЯ · Босс главы» в бою — сам по kind boss.',
  );
  return out;
}

// ---------- hero (карточка героя) ----------

interface JobJson {
  id: string;
  tier: number;
  from: string[];
  role: string;
  skills: { jobLevel: number; skill: string }[];
}
interface HeroJson {
  id: string;
  name: string;
  job: string;
  source: string;
  skills: { level: number; skill: string }[];
}

const RARITIES = ['green', 'blue', 'purple', 'gold', 'red'] as const;
/** Уровни открытия навыков карточки (как у шаблонов data/heroes): 1, 10, 30, 50. */
export const CARD_SKILL_LEVELS = [1, 10, 30, 50];

function jobs(root: string): Record<string, JobJson> {
  return Object.fromEntries(readJsonDirNames(join(root, 'data/jobs')).map((f) => readJson<JobJson>(root, `data/jobs/${f}`)).map((j) => [j.id, j]));
}

function heroTemplates(root: string): HeroJson[] {
  const dir = join(root, 'data/heroes');
  return existsSync(dir) ? readJsonDirNames(dir).map((f) => readJson<HeroJson>(root, `data/heroes/${f}`)) : [];
}

/** Первая профессия ветки (как lineOf ядра). */
function lineOfJob(all: Record<string, JobJson>, jobId: string): string {
  let cur = all[jobId];
  const seen = new Set<string>();
  while (cur && cur.tier > 1 && !seen.has(cur.id)) {
    seen.add(cur.id);
    const tier = cur.tier;
    const parent = cur.from.map((f) => all[f]).find((j) => j && j.tier < tier);
    if (!parent) break;
    cur = parent;
  }
  return cur?.id ?? jobId;
}

/**
 * Навыки новой карточки класса job: кандидаты — навыки профессии (data/jobs) и файлы data/skills/job_<job>_*.json;
 * из них 4 (или сколько есть, минимум 2) так, чтобы с каждой карточкой того же класса было ≤ 2 общих навыков и другой
 * «фирменный» (последний) навык — правила validateHeroes. Первый (ур. 1) — активный, не пассивка (trigger).
 */
export function pickCardSkills(root: string, job: JobJson, sameClass: HeroJson[]): { level: number; skill: string }[] {
  const order = new Map<string, number>(job.skills.map((s) => [s.skill, s.jobLevel]));
  for (const f of readJsonDirNames(join(root, 'data/skills'))) {
    const sid = f.replace(/\.json$/, '');
    if (sid.startsWith(`job_${job.id}_`) && !order.has(sid)) order.set(sid, 1000 + order.size);
  }
  const cands = [...order.entries()]
    .filter(([sid]) => exists(root, `data/skills/${sid}.json`))
    .sort((a, b) => a[1] - b[1])
    .map(([sid]) => sid);
  if (cands.length < 2) {
    throw new ContentNewError(`у класса ${job.id} меньше двух навыков (data/jobs/${job.id}.json → skills, data/skills/job_${job.id}_*) — сначала добавьте навыки`);
  }
  const passive = new Set(cands.filter((sid) => !!readJson<Json>(root, `data/skills/${sid}.json`).trigger));
  const sig = (t: HeroJson) => [...t.skills].sort((a, b) => a.level - b.level).at(-1)?.skill;
  const sigs = new Set(sameClass.map(sig));
  // Штраф: > 2 общих навыков с карточкой класса и тот же фирменный навык — нарушения (⚠ validateHeroes), пассивка первой — хуже;
  // общие навыки сверх этого — лёгкий штраф (разнообразие).
  const score = (pick: string[]) => {
    let hard = pick.every((s) => passive.has(s)) ? 1 : 0;
    let soft = 0;
    for (const t of sameClass) {
      const shared = t.skills.filter((s) => pick.includes(s.skill)).length;
      hard += Math.max(0, shared - 2);
      soft += shared;
    }
    if (sigs.has(pick[pick.length - 1])) hard += 1;
    return { hard, soft };
  };
  const arrange = (acc: string[]) => {
    const pick = [...acc];
    const firstActive = pick.findIndex((s) => !passive.has(s));
    if (firstActive > 0) pick.unshift(...pick.splice(firstActive, 1));
    return pick;
  };
  let best: { pick: string[]; hard: number; soft: number } | undefined;
  // 4 навыка, если так можно без нарушений; иначе меньше (минимум 2), иначе лучшие 4.
  for (let n = Math.min(4, cands.length); n >= 2; n--) {
    let bestN: typeof best;
    const combo = (start: number, acc: string[]) => {
      if (acc.length === n) {
        const pick = arrange(acc);
        const sc = score(pick);
        if (!bestN || sc.hard < bestN.hard || (sc.hard === bestN.hard && sc.soft < bestN.soft)) bestN = { pick, ...sc };
        return;
      }
      for (let i = start; i < cands.length; i++) combo(i + 1, [...acc, cands[i]]);
    };
    combo(0, []);
    if (!best) best = bestN;
    if (bestN && bestN.hard === 0) {
      best = bestN;
      break;
    }
  }
  return best!.pick.map((skill, i) => ({ level: CARD_SKILL_LEVELS[i], skill }));
}

export function genHero(root: string, id: string, opts: Record<string, string>): GenResult {
  const out: GenResult = { written: [], notes: [] };
  checkId(id, 'hero');
  const rel = `data/heroes/${id}.json`;
  if (exists(root, rel)) throw new ContentNewError(`${rel} уже есть — не перезаписываю`);
  const allJobs = jobs(root);
  const job = opts.class ? allJobs[opts.class] : undefined;
  const classes = Object.values(allJobs)
    .filter((j) => j.tier > 0)
    .map((j) => j.id)
    .sort()
    .join(', ');
  if (!job) throw new ContentNewError(`--class: нужен id профессии из data/jobs (${classes}); получено: ${opts.class ?? 'ничего'}`);
  if (job.tier < 1) throw new ContentNewError(`--class: ${job.id} — Новичок, карточка не может быть Новичком`);
  const gender = opts.gender;
  if (gender !== 'm' && gender !== 'f') throw new ContentNewError(`--gender: m или f (получено: ${gender ?? 'ничего'})`);
  const story = opts.story === 'true';
  const line = lineOfJob(allJobs, job.id);
  // Редкости — правила validateHeroes (src/core/heroes/validate.ts).
  const baseRarity = opts.rarity ?? (story || job.tier === 1 ? 'green' : 'purple');
  if (!(RARITIES as readonly string[]).includes(baseRarity)) throw new ContentNewError(`--rarity: одна из ${RARITIES.join(', ')} (получено ${baseRarity})`);
  if (story) {
    if (job.tier !== 1) throw new ContentNewError(`--story: сюжетная карточка — первая профессия (tier 1), а ${job.id} — tier ${job.tier}; вторая профессия — форма (--form)`);
    if (baseRarity !== 'green') throw new ContentNewError('--story: сюжетная карточка начинается с green');
  } else if (job.tier === 1 && !['green', 'blue'].includes(baseRarity)) {
    throw new ContentNewError(`--rarity: первая профессия из призыва — green или blue (получено ${baseRarity})`);
  } else if (job.tier >= 2 && baseRarity !== 'purple') {
    throw new ContentNewError(`--rarity: вторая профессия из призыва — purple (получено ${baseRarity})`);
  }
  const maxRarity = !story && job.tier === 1 ? 'gold' : 'red';
  const templates = heroTemplates(root);
  const sameClass = (j: string) => templates.filter((t) => t.job === j);
  const others = sameClass(job.id).map((t) => t.id);
  const hero: Json = {
    $schema: '../schema/hero.schema.json',
    $comment: `${TODO}: заготовка content:new — имя, bio, hook, statMods (отличие от карточек класса ${job.id}: ${others.join(', ') || 'нет'}), навыки; потом удалить $comment`,
    id,
    name: opts.name ?? `${TODO}: имя ${id}`,
    gender,
    job: job.id,
    line,
    role: job.role,
    source: story ? 'story' : 'summon',
    baseRarity,
    maxRarity,
    statMods: {},
    skills: pickCardSkills(root, job, sameClass(job.id)),
  };
  if (story) {
    const second = Object.values(allJobs)
      .filter((j) => j.tier === 2 && lineOfJob(allJobs, j.id) === line)
      .sort((a, b) => a.id.localeCompare(b.id));
    const formJob = opts.form ? allJobs[opts.form] : second[0];
    if (opts.form && (!formJob || !second.includes(formJob))) {
      throw new ContentNewError(`--form: вторая профессия линии ${line} (${second.map((j) => j.id).join(', ') || 'нет'}); получено ${opts.form}`);
    }
    if (formJob) {
      hero.forms = [
        {
          rarity: 'purple',
          job: formJob.id,
          role: formJob.role,
          statMods: { hp: 1.2, atk: 1.2, def: 1.2 },
          skills: pickCardSkills(root, formJob, sameClass(formJob.id)),
          promotion: `${TODO}: строка истории при вознесении в ${formJob.id} (≤ 200 символов)`,
          visual: {},
        },
      ];
    }
  }
  hero.visual = opts.sprite ? { sprite: opts.sprite } : {};
  hero.bio = `${TODO}: кто это (≤ 160 символов)`;
  hero.hook = `${TODO}: крючок истории (≤ 200 символов)`;
  // Сюжетную карточку игрок получает только через progression.heroes (иначе content:check — ошибка).
  const progRel = 'data/progression.json';
  const all = chapters(root).sort((a, b) => a.order - b.order);
  const after = opts.after ?? all.at(-1)?.stages.at(-1)?.id;
  if (story && (!after || !all.some((c) => c.stages.some((s) => s.id === after)))) throw new ContentNewError(`--after: этап ${after ?? '?'} не найден в data/campaign`);
  writeNew(root, rel, hero, out);

  if (story) {
    const prog = readJson<{ heroes: { recruits: { afterStage: string; template: string }[] } }>(root, progRel);
    prog.heroes.recruits.push({ afterStage: after!, template: id });
    writeNew(root, progRel, prog, out, true);
    out.notes.push(
      `Сюжетная карточка: добавлена в ${progRel} → heroes.recruits (после ${after}; другой этап — --after или правкой файла).`,
      'Представьте рекрута в сюжете главы (сцена afterStage того же этапа) — docs/CONTENT_RECIPES.md, «Карточка героя».',
    );
  } else {
    out.notes.push(`Таверна: регистрировать не нужно — пул собирается сам (source summon, baseRarity ${baseRarity} есть в data/summon.json → rates[].baseRarities).`);
  }
  out.notes.push(
    `Лист: ${opts.sprite ? `visual.sprite = ${opts.sprite}` : `своего нет — лист класса ${job.id} по полу (_${gender}), иначе базовый`}; content:check покажет, какой лист и портрет получатся.`,
    'id карточки после релиза не переименовывать — он в сохранениях игроков.',
  );
  return out;
}

const GENERATORS: Record<string, (root: string, id: string, opts: Record<string, string>) => GenResult> = {
  unit: genUnit,
  skill: genSkill,
  chapter: genChapter,
  stage: genStage,
  story: genStory,
  boss: genBoss,
  hero: genHero,
};

/** Точка входа CLI и тестов: argv без `node script`. Ошибка ввода — ContentNewError. */
export function runContentNew(argv: readonly string[], root: string): GenResult {
  const { pos, opts } = parseArgs(argv);
  const [kind, id] = pos;
  const gen = GENERATORS[kind ?? ''];
  if (!gen || !id) throw new ContentNewError(USAGE);
  return gen(root, id, opts);
}

/**
 * Строки с «TODO» в JSON-данных (заготовки content:new): content:check выводит их предупреждениями.
 * Возвращает «файл: путь.к.полю — текст».
 */
export function findTodos(file: string, data: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'string') {
      if (v.includes(TODO)) out.push(`${file}: ${path || '(корень)'} — ${v}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(data, '');
  return out;
}
