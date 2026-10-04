import { ChapterSchema, type ChapterDef, type StageInfo } from '../campaign/schema';
import { validateCampaign } from '../campaign/validate';
import { HeroTemplateSchema, type HeroTemplate } from '../heroes/schema';
import { validateHeroes } from '../heroes/validate';
import { JobSchema, type JobDef } from '../progression/schema';
import { validateJobs } from '../progression/validate';
import type { Content } from '../types';
import { SkillSchema, UnitSchema, type SkillDef, type UnitDef } from './schema';
import type { z } from 'zod';

export interface RawFile {
  /** Путь или имя файла — для понятных ошибок. */
  file: string;
  data: unknown;
}

export interface RawContent {
  units: RawFile[];
  skills: RawFile[];
  jobs?: RawFile[];
  chapters?: RawFile[];
  /** data/heroes — шаблоны карточек героев. */
  heroes?: RawFile[];
}

export class ContentError extends Error {
  constructor(public problems: string[]) {
    super(`Ошибки в контенте (${problems.length}):\n- ${problems.join('\n- ')}`);
  }
}

function parseAll<T extends { id: string }>(files: RawFile[], schema: z.ZodType<T>, what: string, problems: string[]): Record<string, T> {
  const out: Record<string, T> = {};
  // Node sorts filenames by code point; browser globs may use locale collation.
  // Keep the same registry order for prefix pairs such as assassin.json / assassin_cross.json.
  const filename = (f: RawFile) => f.file.split('/').at(-1) ?? f.file;
  const ordered = [...files].sort((a, b) => filename(a) < filename(b) ? -1 : filename(a) > filename(b) ? 1 : 0);
  for (const f of ordered) {
    const r = schema.safeParse(f.data);
    if (!r.success) {
      for (const i of r.error.issues) problems.push(`${f.file}: ${i.path.join('.') || '(корень)'} — ${i.message}`);
      continue;
    }
    if (out[r.data.id]) problems.push(`${f.file}: ${what} ${r.data.id} уже объявлен`);
    out[r.data.id] = r.data;
  }
  return out;
}

/** Проверяет файлы контента по схемам и перекрёстным ссылкам, собирает реестр. */
export function buildContent(raw: RawContent): Content {
  const problems: string[] = [];
  const skills = parseAll<SkillDef>(raw.skills, SkillSchema as z.ZodType<SkillDef>, 'навык', problems);
  const units = parseAll<UnitDef>(raw.units, UnitSchema as z.ZodType<UnitDef>, 'юнит', problems);
  const jobs = parseAll<JobDef>(raw.jobs ?? [], JobSchema as z.ZodType<JobDef>, 'профессия', problems);
  const heroes = parseAll<HeroTemplate>(raw.heroes ?? [], HeroTemplateSchema as unknown as z.ZodType<HeroTemplate>, 'карточка', problems);
  const chapterMap = parseAll<ChapterDef>(raw.chapters ?? [], ChapterSchema as z.ZodType<ChapterDef>, 'глава', problems);

  const chapters = Object.values(chapterMap).sort((a, b) => a.order - b.order);
  const stages: StageInfo[] = [];
  for (const c of chapters) c.stages.forEach((s, index) => stages.push({ ...s, chapter: c.id, index, globalIndex: stages.length }));

  for (const s of Object.values(skills)) {
    if (s.fallback && !skills[s.fallback]) problems.push(`навык ${s.id}: fallback ${s.fallback} не найден`);
    // Цепочка fallback должна заканчиваться: цикл в бою — бесконечная рекурсия (нет целей ни у одного навыка цепочки).
    const chain = new Set<string>([s.id]);
    for (let f = s.fallback; f && skills[f]; f = skills[f].fallback) {
      if (chain.has(f)) {
        problems.push(`навык ${s.id}: цепочка fallback зациклена (${[...chain, f].join(' → ')})`);
        break;
      }
      chain.add(f);
    }
    if (s.effects.some((e) => e.type === 'dash') && s.target.side !== 'enemy') {
      problems.push(`навык ${s.id}: dash возможен только к врагу`);
    }
  }
  for (const u of Object.values(units)) {
    const ref = (sid: string | undefined, slot: string) => {
      if (sid && !skills[sid]) problems.push(`юнит ${u.id}: ${slot} ссылается на несуществующий навык ${sid}`);
    };
    ref(u.skills.basic, 'skills.basic');
    ref(u.skills.ult, 'skills.ult');
    u.skills.actives.forEach((a, i) => {
      ref(a, `skills.actives[${i}]`);
      if (skills[a]?.trigger) problems.push(`юнит ${u.id}: активный навык ${a} с trigger (это пассивка)`);
    });
    u.skills.passives.forEach((p, i) => {
      ref(p, `skills.passives[${i}]`);
      if (skills[p] && !skills[p].trigger) problems.push(`юнит ${u.id}: пассивка ${p} без trigger`);
    });
    const basic = skills[u.skills.basic];
    if (basic?.trigger) problems.push(`юнит ${u.id}: обычная атака ${basic.id} не может иметь trigger`);
  }

  const content: Content = { units, skills, jobs, heroes, chapters, stages };
  validateJobs(content, problems);
  validateHeroes(content, problems);
  validateCampaign(content, problems);

  if (problems.length) throw new ContentError(problems);
  return content;
}
