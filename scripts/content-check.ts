/**
 * Проверка всего контента одной командой.  npm run content:check
 *   1. весь data/ — одна сборка buildGameContext (как в игре): схемы и перекрёстные ссылки, все ошибки сразу;
 *   2. ссылки на ассеты: спрайты (реестр), снаряды, эффекты, иконки (assets/manifest.json);
 *   3. спрайтшиты: файл есть, размер сходится с сеткой, лист не больше 2048 px;
 *   4. JSON-схемы для редактора не устарели;
 *   5. дымовой прогон: каждый юнит проводит бой без исключений; каждый герой — на пределе каждой своей редкости (с фиолетового — каждая ветка);
 *   6. сюжет (data/story): схема и ссылки — в сборке (п. 1), здесь — портреты спикеров (нет картинки — предупреждение, будет иконка);
 *   7. строки «TODO» в data/ (заготовки npm run content:new) — предупреждения: их надо дописать до релиза;
 *   8. карточки героев (data/heroes) и Таверна — scripts/lib/content-check-heroes.ts: правила различия карточек одного
 *      класса и навыки своей линии — ⚠ (ошибки навыков — в сборке, п. 1); итоговый лист карточки находится (свой или класса
 *      по полу; не находится — ✗), свой лист в реестре, лист нужного пола, портрет у листа (нет — ⚠); призывная карточка,
 *      которую Таверна не выдаёт (baseRarity/maxRarity мимо data/summon.json → rates) — ✗.
 *   9. ворота предметов по главам (data/items → minChapter): источник, который в своей главе даёт только закрытые
 *      предметы (правило выпадения/сундука, товар Лавки, порог охоты) — ✗; глава без открытых предметов слота — ⚠
 *      (src/core/equipment/lint.ts).
 *  10. Летопись (data/lore/*.json, файлы необязательны): схема и ссылки на юниты/предметы/героев/профессии/главы/этапы — ✗;
 *      длина текстов сверх LORE_LIMITS, монстр вне кампании, Башни и Охоты — ⚠ (src/core/lore/lore.ts → validateLore).
 *  11. Тексты глав (episode, legend, chronicle, stages[].finding) и реплики боссов и мини-боссов (barks): длины — схема (✗), id находок
 *      уникальны по всем главам — ✗, больше 4 находок в главе и юнит с репликами дважды в этапе — ⚠ (src/core/lore/pages.ts).
 * Код выхода 1, если есть ошибки. Предупреждения (например, нет арта — будет плейсхолдер) не мешают.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRANCH_RARITY, buildUnit, CARD_RARITIES, collectGameContext, lintItemGates, lintLevelBands, maxLevelOf, parseLore, rarityIndex, validateLore, recommendedPower, simulateBattle, validateHeroes, validatePageTexts } from '../src/core';
import { MonsterSoundsSchema, monsterSoundFiles } from '../src/game/monsterSounds';
import { portraitSprite } from '../src/game/storyView';
import { buildRegistry, type LegacySprites, type SpritesV2 } from '../src/pipeline/sprites';
import phase0 from '../data/phase0.json';
import { lintHeroes } from './lib/content-check-heroes';
import { findTodos } from './lib/content-gen';
import { readJsonDir, readRawGameData, ROOT } from './lib/content-node';
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
  // 9. Ворота предметов по главам
  const gates = lintItemGates(built.ctx);
  errors.push(...gates.errors);
  warnings.push(...gates.warnings);
  // Уровни врагов (power.levels): полосы этапов.
  errors.push(...lintLevelBands(built.ctx));
  // Экспедиции: порог мощи локации выше рекомендуемой мощи самых трудных этапов до её открытия — игрок увидит
  // локацию, но отправить отряд, скорее всего, не сможет.
  const stages = built.ctx.content.stages;
  for (const loc of built.ctx.meta.expeditions.locations) {
    const upto = stages.slice(0, stages.findIndex((s) => s.id === loc.stage) + 1);
    const rec = Math.max(0, ...upto.map((s) => recommendedPower(s.id, built.ctx!)));
    if (loc.power > rec) warnings.push(`data/expeditions.json: локация ${loc.id} — порог мощи ${loc.power} выше рекомендуемой мощи этапов до ${loc.stage} (${rec})`);
  }
}

// 10. Летопись: файлы читаются текстом (пустой файл — как будто его нет, как в игре).
const loreDir = join(ROOT, 'data/lore');
const loreFiles = existsSync(loreDir)
  ? readdirSync(loreDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => ({ file: `data/lore/${f}`, data: readFileSync(join(loreDir, f), 'utf8') }))
  : [];
const loreParsed = parseLore(loreFiles);
errors.push(...loreParsed.problems);
if (built.ctx) {
  const lint = validateLore(loreParsed.lore, { content: built.ctx.content, items: built.ctx.equipment.items, tower: built.ctx.tower, hunt: built.ctx.hunt, cards: built.ctx.cards });
  errors.push(...lint.errors);
  warnings.push(...lint.warnings);
  // 11. Тексты «между этапами» (эпизод, легенда, летопись глав, находки этапов, реплики боссов): уникальность id находок — ✗.
  const pages = validatePageTexts(built.ctx.content);
  errors.push(...pages.errors);
  warnings.push(...pages.warnings);
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
    ...Object.values(content.heroes).flatMap((t) => [...t.skills, ...t.branches.flatMap((b) => b.skills)].map((s) => s.skill)),
  ]);

  // 8. Карточки героев и Таверна: правила карточек, листы (свой / класса / пол), портреты, выдача Таверны.
  const sheetGender: Record<string, string | undefined> = {};
  // Пол листа — в доказательствах конвейера арта (sprites.provenance.json, tools/sprites_manifest.py), в бандл не идут.
  const provenance = readJson<{ sprites: Record<string, { source?: { gender?: string } }> }>('assets/sprites/sprites.provenance.json')?.sprites ?? {};
  for (const [id, p] of Object.entries(provenance)) {
    sheetGender[id] = p.source?.gender === 'female' ? 'f' : p.source?.gender === 'male' ? 'm' : undefined;
  }
  if (built.ctx) {
    const lint = lintHeroes(built.ctx, registry, sheetGender);
    errors.push(...lint.errors);
    warnings.push(...lint.warnings);
    for (const id of lint.sprites) usedSprites.add(id);
  } else validateHeroes(content, [], warnings);
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
  // Карточки героев на пределе уровня каждой своей редкости (с навыками всех открытых уровней).
  if (built.ctx) {
    const gctx = built.ctx;
    for (const t of Object.values(content.heroes)) {
      for (const r of CARD_RARITIES.slice(rarityIndex(t.baseRarity), rarityIndex(t.maxRarity) + 1)) {
        // С фиолетового — каждая ветка (и форма без ветки: «Выберите ветку!»).
        const branches = rarityIndex(r) >= rarityIndex(BRANCH_RARITY) ? [undefined, ...t.branches.map((b) => b.job)] : [undefined];
        for (const branch of branches) {
          try {
            const unit = buildUnit({ id: 'smoke', templateId: t.id, rarity: r, level: maxLevelOf(gctx, r), ...(branch ? { branch } : {}) }, gctx);
            simulateBattle(content, [unit, null, unit, null, unit], phase0.defaultSquadB, 3, { log: false });
          } catch (e) {
            errors.push(`карточка ${t.id} (${r}${branch ? `, ${branch}` : ''}): бой упал — ${String(e)}`);
          }
        }
      }
    }
  }
}

// 12. Звуки монстров RO (data/monster_sounds.json → assets/audio/mon_<имя>.ogg|m4a, tools/ro_audio.py): схема и файлы — ✗,
//     лист спрайта, которого нет ни в реестре, ни в сборке листов RO (raw/ro-build/sprites.fragment.json), — ⚠.
{
  const raw = readJson<unknown>('data/monster_sounds.json');
  const parsed = raw === undefined ? null : MonsterSoundsSchema.safeParse(raw);
  if (parsed && !parsed.success) errors.push(`data/monster_sounds.json: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  else if (parsed?.success) {
    for (const f of monsterSoundFiles(parsed.data))
      for (const ext of ['ogg', 'm4a'])
        if (!existsSync(join(ROOT, 'assets/audio', `${f}.${ext}`))) errors.push(`data/monster_sounds.json: нет assets/audio/${f}.${ext} — python3 tools/ro_audio.py`);
    const known = new Set([
      ...(readJson<{ sprites: { id: string }[] }>('assets/sprites/sprites.json')?.sprites ?? []).map((s) => s.id),
      ...(readJson<{ sprites: { id: string }[] }>('raw/ro-build/sprites.fragment.json')?.sprites ?? []).map((s) => s.id),
    ]);
    for (const id of Object.keys(parsed.data.sprites)) if (!known.has(id)) warnings.push(`data/monster_sounds.json: листа «${id}» нет ни в assets/sprites/sprites.json, ни в raw/ro-build — звук не зазвучит`);
  }
}

// 4. JSON-схемы
for (const [file, body] of Object.entries(generateSchemas())) {
  const cur = existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), 'utf8') : '';
  if (cur !== body) errors.push(`${file} устарел — запустите npm run content:schema`);
}

// 7. Незаполненные заготовки content:new
for (const dir of ['data/campaign', 'data/story', 'data/units', 'data/skills', 'data/jobs', 'data/heroes', 'data/lore']) {
  for (const f of readJsonDir(dir)) warnings.push(...findTodos(f.file, f.data));
}

for (const w of warnings) console.log(`⚠ ${w}`);
for (const e of errors) console.log(`✗ ${e}`);
if (content) {
  const count = (k: string) => Object.values(content!.units).filter((u) => u.kind === k).length;
  console.log(
    `\nЮнитов: ${Object.keys(content.units).length} (героев ${count('hero')}, монстров ${count('monster')}, боссов ${count('boss')}), ` +
      `навыков: ${Object.keys(content.skills).length}, профессий: ${Object.keys(content.jobs).length}, карточек героев: ${Object.keys(content.heroes).length}, этапов: ${content.stages.length}, ` +
      `сюжетных сцен: ${built.ctx?.story.scenes.length ?? 0}, ` +
      `летопись: монстров ${Object.keys(loreParsed.lore.monsters).length}, предметов ${Object.keys(loreParsed.lore.items).length}, ` +
      `героев ${Object.keys(loreParsed.lore.heroes).length}, кусочков истории героев ${Object.values(loreParsed.lore.heroStories).flat().length}, профессий ${Object.keys(loreParsed.lore.jobs).length}, глав ${Object.keys(loreParsed.lore.chapters).length}, записей мира ${loreParsed.lore.world.length}, ` +
      `строк-комментариев ${Object.values(loreParsed.lore.lines).flat().length}; ` +
      `тексты глав: эпизодов ${content.chapters.filter((c) => c.episode).length}, легенд ${content.chapters.filter((c) => c.legend).length}, ` +
      `летописей ${content.chapters.filter((c) => c.chronicle).length}, находок ${content.stages.filter((s) => s.finding).length}, ` +
      `говорящих боссов ${Object.values(content.units).filter((u) => u.barks).length}`,
  );
}
console.log(errors.length ? `\nОшибок: ${errors.length}` : '\nКонтент в порядке ✓');
process.exit(errors.length ? 1 : 0);
