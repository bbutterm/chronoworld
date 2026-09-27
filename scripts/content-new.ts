/**
 * Заготовка нового юнита или навыка.
 *   npm run content:new -- unit knight --from warrior       копия существующего юнита с новым id
 *   npm run content:new -- unit poring --kind monster       пустой шаблон монстра
 *   npm run content:new -- skill knight_bash --from warrior_cleave
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/content-node';

const [kind, id] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const opt = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

if ((kind !== 'unit' && kind !== 'skill') || !id || !/^[a-z][a-z0-9_]*$/.test(id)) {
  console.log('Использование: npm run content:new -- unit|skill <id> [--from <id>] [--kind hero|monster|boss]');
  process.exit(1);
}

const dir = kind === 'unit' ? 'data/units' : 'data/skills';
const path = join(ROOT, dir, `${id}.json`);
if (existsSync(path)) {
  console.log(`${dir}/${id}.json уже есть — не перезаписываю`);
  process.exit(1);
}

const from = opt('from');
let data: Record<string, unknown>;
if (from) {
  const src = join(ROOT, dir, `${from}.json`);
  if (!existsSync(src)) {
    console.log(`Нет ${dir}/${from}.json`);
    process.exit(1);
  }
  data = { ...JSON.parse(readFileSync(src, 'utf8')), id, name: `${id} (копия ${from})` };
  if (kind === 'unit') data.visual = { ...(data.visual as object), sprite: id };
} else if (kind === 'unit') {
  data = {
    $schema: '../schema/unit.schema.json',
    id,
    name: id,
    kind: opt('kind') ?? 'hero',
    role: 'damage',
    stats: { hp: 1000, atk: 100, def: 20, spd: 100 },
    skills: { basic: 'basic_melee', passives: [] },
    visual: { sprite: id, hitFx: 'fx_hit' },
  };
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

writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
console.log(`Создан ${dir}/${id}.json — заполните и запустите npm run content:check`);
