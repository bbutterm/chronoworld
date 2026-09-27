import type { Content } from '../types';
import { lineOf } from './card';
import { rarityIndex, type CardSkill, type HeroTemplate } from './schema';

/** Предел уровня редкости по умолчанию (data/cards.json может менять числа; проверка навыков — по этой таблице). */
const DEFAULT_MAX_LEVEL = { green: 20, blue: 40, purple: 60, gold: 80, red: 100 } as const;

/**
 * Перекрёстные проверки шаблонов карточек (ошибки — problems, content:check ✗; предупреждения — warnings, ⚠).
 * - job существует, line = первая профессия ветки job; навыки существуют, уровни открытия уникальны, возрастают
 *   и не выше предела maxRarity; 2–4 навыка на форму; обычная атака класса — не пассивка;
 * - редкости: summon + tier 1 → base green/blue, max ≤ gold; summon + tier 2 → base purple; story → base green, tier 1;
 *   maxRarity ≥ baseRarity; формы только у сюжетных, форма — вторая профессия своей линии, rarity форм возрастает;
 * - имена уникальны;
 * - ⚠ навык не своей линии (не профессии ветки); ⚠ у двух карточек одного класса общих навыков > 2 или одинаковый
 *   «фирменный» (последний) навык.
 */
export function validateHeroes(content: Content, problems: string[], warnings: string[] = []): void {
  const heroes = Object.values(content.heroes);
  const names = new Map<string, string>();
  for (const t of heroes) {
    const where = `карточка ${t.id}`;
    const job = content.jobs[t.job];
    if (names.has(t.name)) problems.push(`${where}: имя «${t.name}» уже у карточки ${names.get(t.name)}`);
    names.set(t.name, t.id);
    if (!job) {
      problems.push(`${where}: класс ${t.job} не найден в data/jobs`);
      continue;
    }
    const line = lineOf({ content }, t.job);
    if (t.line !== line) problems.push(`${where}: line ${t.line}, а у класса ${t.job} линия ${line}`);
    if (job.tier === 0) problems.push(`${where}: класс карточки не может быть Новичком`);
    if (rarityIndex(t.maxRarity) < rarityIndex(t.baseRarity)) problems.push(`${where}: maxRarity ${t.maxRarity} ниже baseRarity ${t.baseRarity}`);
    if (t.source === 'summon') {
      if (job.tier === 1 && !['green', 'blue'].includes(t.baseRarity)) problems.push(`${where}: первая профессия из призыва — baseRarity green или blue`);
      if (job.tier === 1 && rarityIndex(t.maxRarity) > rarityIndex('gold')) problems.push(`${where}: первая профессия из призыва растёт максимум до gold`);
      if (job.tier === 2 && t.baseRarity !== 'purple') problems.push(`${where}: вторая профессия из призыва — baseRarity purple`);
      if (t.forms.length) problems.push(`${where}: формы (вторая профессия) бывают только у сюжетных карточек`);
    } else {
      if (t.baseRarity !== 'green') problems.push(`${where}: сюжетная карточка начинается с green`);
      if (job.tier !== 1) problems.push(`${where}: сюжетная карточка — первая профессия (${t.job} — tier ${job.tier})`);
    }
    checkSkills(content, where, t.skills, t.maxRarity, line, problems, warnings);
    let prev = t.baseRarity;
    for (const [i, f] of t.forms.entries()) {
      const fw = `${where}: forms[${i}]`;
      const fj = content.jobs[f.job];
      if (!fj) problems.push(`${fw}: класс ${f.job} не найден`);
      else {
        if (lineOf({ content }, f.job) !== line) problems.push(`${fw}: класс ${f.job} не из линии ${line}`);
        if (fj.tier !== 2) problems.push(`${fw}: форма — вторая профессия (tier 2), а ${f.job} — tier ${fj.tier}`);
      }
      if (rarityIndex(f.rarity) <= rarityIndex(prev)) problems.push(`${fw}: rarity ${f.rarity} должна быть выше ${prev}`);
      if (rarityIndex(f.rarity) > rarityIndex(t.maxRarity)) problems.push(`${fw}: rarity ${f.rarity} выше maxRarity ${t.maxRarity}`);
      prev = f.rarity;
      checkSkills(content, fw, f.skills, t.maxRarity, line, problems, warnings);
    }
  }
  // ⚠ Различие карточек одного класса.
  const byJob = new Map<string, HeroTemplate[]>();
  for (const t of heroes) byJob.set(t.job, [...(byJob.get(t.job) ?? []), t]);
  for (const [job, list] of byJob) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const shared = a.skills.filter((s) => b.skills.some((x) => x.skill === s.skill)).length;
        if (shared > 2) warnings.push(`карточки ${a.id} и ${b.id} (${job}): общих навыков ${shared} > 2 — карточки одного класса должны различаться`);
        const sig = (t: HeroTemplate) => [...t.skills].sort((x, y) => x.level - y.level).at(-1)?.skill;
        if (sig(a) === sig(b)) warnings.push(`карточки ${a.id} и ${b.id} (${job}): одинаковый фирменный навык ${sig(a)}`);
      }
    }
  }
}

function checkSkills(content: Content, where: string, skills: CardSkill[], maxRarity: keyof typeof DEFAULT_MAX_LEVEL, line: string, problems: string[], warnings: string[]): void {
  if (skills.length < 2 || skills.length > 4) problems.push(`${where}: навыков ${skills.length}, нужно 2–4`);
  let last = 0;
  const seen = new Set<string>();
  for (const s of skills) {
    const sk = content.skills[s.skill];
    if (!sk) problems.push(`${where}: навык ${s.skill} не найден`);
    if (seen.has(s.skill)) problems.push(`${where}: навык ${s.skill} указан дважды`);
    seen.add(s.skill);
    if (s.level <= last) problems.push(`${where}: уровни открытия навыков должны строго возрастать (${s.skill} на ${s.level})`);
    last = s.level;
    if (s.level > DEFAULT_MAX_LEVEL[maxRarity]) problems.push(`${where}: навык ${s.skill} открывается на ур. ${s.level}, а предел ${maxRarity} — ${DEFAULT_MAX_LEVEL[maxRarity]}`);
    // Навык своей ветки: принадлежит профессии линии или её второй профессии (по data/jobs) либо назван job_<профессия ветки>_*.
    const owners = Object.values(content.jobs).filter((j) => j.skills.some((x) => x.skill === s.skill));
    const ownLine = owners.some((j) => lineOf({ content }, j.id) === line) || branchJobs(content, line).some((j) => s.skill.startsWith(`job_${j}_`));
    if (sk && !ownLine) warnings.push(`${where}: навык ${s.skill} не из линии ${line}`);
  }
  if (skills[0] && skills[0].level !== 1) problems.push(`${where}: первый навык должен открываться на ур. 1`);
}

function branchJobs(content: Content, line: string): string[] {
  return Object.values(content.jobs)
    .filter((j) => j.tier >= 1 && lineOf({ content }, j.id) === line)
    .map((j) => j.id);
}
