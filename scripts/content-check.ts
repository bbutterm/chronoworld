/**
 * Проверка всего контента одной командой.  npm run content:check
 *   1. data/units и data/skills — по схемам и перекрёстным ссылкам;
 *   2. ссылки на ассеты: спрайты (реестр), снаряды, эффекты, иконки (assets/manifest.json);
 *   3. спрайтшиты: файл есть, размер сходится с сеткой, лист не больше 2048 px;
 *   4. JSON-схемы для редактора не устарели;
 *   5. дымовой прогон: каждый юнит проводит бой без исключений.
 * Код выхода 1, если есть ошибки. Предупреждения (например, нет арта — будет плейсхолдер) не мешают.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContentError, parseFeaturesConfig, simulateBattle, type Content } from '../src/core';
import { buildRegistry, type LegacySprites, type SpritesV2 } from '../src/pipeline/sprites';
import phase0 from '../data/phase0.json';
import { loadContent, ROOT } from './lib/content-node';
import { pngSize } from './lib/png';
import { generateSchemas } from './lib/schemas';

const errors: string[] = [];
const warnings: string[] = [];
const readJson = <T>(rel: string): T | undefined => (existsSync(join(ROOT, rel)) ? (JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as T) : undefined);

// 1. Контент
let content: Content | undefined;
try {
  content = loadContent();
} catch (e) {
  if (e instanceof ContentError) errors.push(...e.problems);
  else throw e;
}

if (content) {
  // 2. Ссылки на ассеты
  const manifest = readJson<{ assets: Record<string, unknown> }>('assets/manifest.json')?.assets ?? {};
  let registry: ReturnType<typeof buildRegistry> = {};
  try {
    registry = buildRegistry(readJson<LegacySprites>('assets/sprites.legacy.json'), readJson<SpritesV2>('assets/sprites/sprites.json'));
  } catch (e) {
    errors.push(String(e));
  }
  const asset = (owner: string, field: string, id: string | undefined) => {
    if (id && !(id in manifest)) errors.push(`${owner}: ${field} = "${id}" — нет в assets/manifest.json`);
  };
  const usedSprites = new Set<string>();
  for (const j of Object.values(content.jobs)) {
    usedSprites.add(j.visual.sprite);
    if (!registry[j.visual.sprite]) warnings.push(`профессия ${j.id}: спрайта "${j.visual.sprite}" нет в реестре — будет плейсхолдер`);
    asset(`профессия ${j.id}`, 'visual.projectile', j.visual.projectile);
    asset(`профессия ${j.id}`, 'visual.hitFx', j.visual.hitFx);
  }
  for (const u of Object.values(content.units)) {
    usedSprites.add(u.visual.sprite);
    if (!registry[u.visual.sprite]) warnings.push(`юнит ${u.id}: спрайта "${u.visual.sprite}" нет в реестре — будет плейсхолдер`);
    asset(`юнит ${u.id}`, 'visual.projectile', u.visual.projectile);
    asset(`юнит ${u.id}`, 'visual.hitFx', u.visual.hitFx);
  }
  for (const s of Object.values(content.skills)) asset(`навык ${s.id}`, 'icon', s.icon);
  const referenced = new Set([
    ...Object.values(content.units).flatMap((u) => [u.skills.basic, u.skills.ult, ...u.skills.passives]),
    ...Object.values(content.jobs).flatMap((j) => [j.basic, ...j.skills.map((s) => s.skill)]),
  ]);
  for (const s of Object.values(content.skills)) {
    const isFallback = Object.values(content.skills).some((o) => o.fallback === s.id);
    if (!referenced.has(s.id) && !isFallback) warnings.push(`навык ${s.id} ни у кого не используется`);
  }

  // 3. Спрайтшиты, которые использует контент
  for (const id of usedSprites) {
    const s = registry[id];
    if (!s) continue;
    const path = join(ROOT, 'assets', s.file);
    if (!existsSync(path)) {
      errors.push(`спрайт ${id}: нет файла assets/${s.file}`);
      continue;
    }
    const { w, h } = pngSize(path);
    const rows = Math.max(...Object.values(s.anims).map((a) => a!.row)) + 1;
    if (w % s.cell[0] || h % s.cell[1]) errors.push(`спрайт ${id}: ${w}×${h} не делится на клетку ${s.cell.join('×')}`);
    if (h < rows * s.cell[1]) errors.push(`спрайт ${id}: в листе ${h / s.cell[1]} рядов, а анимациям нужно ${rows}`);
    for (const [name, a] of Object.entries(s.anims)) {
      if (a && a.frames > s.columns) errors.push(`спрайт ${id}: ${name} — ${a.frames} кадров при ${s.columns} колонках`);
    }
    const big = `спрайт ${id}: лист ${w}×${h} больше 2048 px — на части телефонов не загрузится`;
    if (w > 2048 || h > 2048) (s.source === 'v2' ? errors : warnings).push(big);
    if (s.portrait && !existsSync(join(ROOT, 'assets', s.portrait))) errors.push(`спрайт ${id}: нет портрета assets/${s.portrait}`);
  }

  // 5. Дымовой прогон
  for (const u of Object.values(content.units)) {
    try {
      simulateBattle(content, [u.id, null, null, null, null], phase0.defaultSquadB, 1, { log: false });
      simulateBattle(content, phase0.defaultSquadA, [null, null, u.id, u.id, u.id], 2, { log: false });
    } catch (e) {
      errors.push(`юнит ${u.id}: бой упал — ${String(e)}`);
    }
  }
}

// Конфиги функций (быстрые награды, мощь, ежедневные задания)
try {
  parseFeaturesConfig(readJson('data/progression.json'), readJson('data/quests.json'));
} catch (e) {
  errors.push(`data/progression.json / data/quests.json: ${e instanceof Error ? e.message : String(e)}`);
}

// 4. JSON-схемы
for (const [file, body] of Object.entries(generateSchemas())) {
  const cur = existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), 'utf8') : '';
  if (cur !== body) errors.push(`${file} устарел — запустите npm run content:schema`);
}

for (const w of warnings) console.log(`⚠ ${w}`);
for (const e of errors) console.log(`✗ ${e}`);
if (content) {
  const count = (k: string) => Object.values(content!.units).filter((u) => u.kind === k).length;
  console.log(
    `\nЮнитов: ${Object.keys(content.units).length} (героев ${count('hero')}, монстров ${count('monster')}, боссов ${count('boss')}), ` +
      `навыков: ${Object.keys(content.skills).length}, профессий: ${Object.keys(content.jobs).length}, этапов: ${content.stages.length}`,
  );
}
console.log(errors.length ? `\nОшибок: ${errors.length}` : '\nКонтент в порядке ✓');
process.exit(errors.length ? 1 : 0);
