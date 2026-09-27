/**
 * Проверка всего контента одной командой.  npm run content:check
 *   1. весь data/ — одна сборка buildGameContext (как в игре): схемы и перекрёстные ссылки, все ошибки сразу;
 *   2. ссылки на ассеты: спрайты (реестр), снаряды, эффекты, иконки (assets/manifest.json);
 *   3. спрайтшиты: файл есть, размер сходится с сеткой, лист не больше 2048 px;
 *   4. JSON-схемы для редактора не устарели;
 *   5. дымовой прогон: каждый юнит проводит бой без исключений;
 *   6. сюжет (data/story): схема и ссылки — в сборке (п. 1), здесь — портреты спикеров (нет картинки — предупреждение, будет иконка);
 *   7. строки «TODO» в data/ (заготовки npm run content:new) — предупреждения: их надо дописать до релиза.
 * Код выхода 1, если есть ошибки. Предупреждения (например, нет арта — будет плейсхолдер) не мешают.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildUnit, collectGameContext, simulateBattle } from '../src/core';
import { portraitSprite } from '../src/game/storyView';
import { buildRegistry, type LegacySprites, type SpritesV2 } from '../src/pipeline/sprites';
import phase0 from '../data/phase0.json';
import { findTodos } from './lib/content-gen';
import { loadGameContext, readJsonDir, readRawGameData, ROOT } from './lib/content-node';
import { pngSize } from './lib/png';
import { generateSchemas } from './lib/schemas';

const errors: string[] = [];
const warnings: string[] = [];
const readJson = <T>(rel: string): T | undefined => (existsSync(join(ROOT, rel)) ? (JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as T) : undefined);

// 1. Весь контент и конфиги — одна сборка, как в игре (src/game/content.ts) и в балансе (loadFullContext)
const built = collectGameContext(readRawGameData());
errors.push(...built.problems);
const content = built.content;
if (built.ctx) {
  const roles = new Set(Object.values(built.ctx.content.jobs).map((j) => j.role));
  for (const b of built.ctx.meta.bounties.templates) {
    if (b.role && !roles.has(b.role)) errors.push(`data/bounties.json: поручение ${b.id} требует роль ${b.role}, которой нет ни у одной профессии`);
  }
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
    ...Object.values(content.units).flatMap((u) => [u.skills.basic, u.skills.ult, ...u.skills.actives, ...u.skills.passives]),
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

  // 6. Портреты спикеров сюжета: нет юнита/спрайта — в игре будет иконка скина.
  const sctx = built.ctx;
  for (const story of Object.values(sctx?.story.chapters ?? {})) {
    for (const [key, sp] of Object.entries(story.speakers)) {
      if (sp.portrait === 'hero' || !sctx) continue;
      const sprite = portraitSprite(sp.portrait, sctx);
      if (!sprite || !registry[sprite]) {
        warnings.push(`сюжет ${story.chapter}: портрет спикера ${key} (${sp.portrait}) не найден — в игре будет иконка`);
      }
    }
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
  // Герои из профессий на максимальном уровне (с навыками всех уровней).
  const gctx = loadGameContext();
  for (const j of Object.values(content.jobs)) {
    try {
      const hero = { id: 'smoke', name: j.name, job: j.id, jobLevel: j.maxJobLevel, jobExp: 0, jobHistory: [] };
      const unit = buildUnit(hero, gctx);
      simulateBattle(content, [unit, null, unit, null, unit], phase0.defaultSquadB, 3, { log: false });
    } catch (e) {
      errors.push(`профессия ${j.id}: бой упал — ${String(e)}`);
    }
  }
}

// 4. JSON-схемы
for (const [file, body] of Object.entries(generateSchemas())) {
  const cur = existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), 'utf8') : '';
  if (cur !== body) errors.push(`${file} устарел — запустите npm run content:schema`);
}

// 7. Незаполненные заготовки content:new
for (const dir of ['data/campaign', 'data/story', 'data/units', 'data/skills', 'data/jobs']) {
  for (const f of readJsonDir(dir)) warnings.push(...findTodos(f.file, f.data));
}

for (const w of warnings) console.log(`⚠ ${w}`);
for (const e of errors) console.log(`✗ ${e}`);
if (content) {
  const count = (k: string) => Object.values(content!.units).filter((u) => u.kind === k).length;
  console.log(
    `\nЮнитов: ${Object.keys(content.units).length} (героев ${count('hero')}, монстров ${count('monster')}, боссов ${count('boss')}), ` +
      `навыков: ${Object.keys(content.skills).length}, профессий: ${Object.keys(content.jobs).length}, этапов: ${content.stages.length}, ` +
      `сюжетных сцен: ${built.ctx?.story.scenes.length ?? 0}`,
  );
}
console.log(errors.length ? `\nОшибок: ${errors.length}` : '\nКонтент в порядке ✓');
process.exit(errors.length ? 1 : 0);
