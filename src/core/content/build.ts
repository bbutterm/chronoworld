import { SkillSchema, UnitSchema, type SkillDef, type UnitDef } from './schema';
import type { Content } from '../types';

export interface RawFile {
  /** Путь или имя файла — для понятных ошибок. */
  file: string;
  data: unknown;
}

export class ContentError extends Error {
  constructor(public problems: string[]) {
    super(`Ошибки в контенте (${problems.length}):\n- ${problems.join('\n- ')}`);
  }
}

/** Проверяет файлы юнитов и навыков по схемам и перекрёстным ссылкам, собирает реестр. */
export function buildContent(unitFiles: RawFile[], skillFiles: RawFile[]): Content {
  const problems: string[] = [];
  const skills: Record<string, SkillDef> = {};
  const units: Record<string, UnitDef> = {};

  for (const f of skillFiles) {
    const r = SkillSchema.safeParse(f.data);
    if (!r.success) {
      for (const i of r.error.issues) problems.push(`${f.file}: ${i.path.join('.') || '(корень)'} — ${i.message}`);
      continue;
    }
    if (skills[r.data.id]) problems.push(`${f.file}: навык ${r.data.id} уже объявлен`);
    skills[r.data.id] = r.data;
  }
  for (const f of unitFiles) {
    const r = UnitSchema.safeParse(f.data);
    if (!r.success) {
      for (const i of r.error.issues) problems.push(`${f.file}: ${i.path.join('.') || '(корень)'} — ${i.message}`);
      continue;
    }
    if (units[r.data.id]) problems.push(`${f.file}: юнит ${r.data.id} уже объявлен`);
    units[r.data.id] = r.data;
  }

  for (const s of Object.values(skills)) {
    if (s.fallback && !skills[s.fallback]) problems.push(`навык ${s.id}: fallback ${s.fallback} не найден`);
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
    u.skills.passives.forEach((p, i) => {
      ref(p, `skills.passives[${i}]`);
      if (skills[p] && !skills[p].trigger) problems.push(`юнит ${u.id}: пассивка ${p} без trigger`);
    });
    const basic = skills[u.skills.basic];
    if (basic?.trigger) problems.push(`юнит ${u.id}: обычная атака ${basic.id} не может иметь trigger`);
  }

  if (problems.length) throw new ContentError(problems);
  return { units, skills };
}
