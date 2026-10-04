import type { Content, SkillDef } from '../types';
import { lineOf } from './card';
import { rarityIndex, type CardSkill } from './schema';

/** Предел уровня редкости по умолчанию (data/cards.json может менять числа; проверка навыков — по этой таблице). */
const DEFAULT_MAX_LEVEL = { green: 20, blue: 40, purple: 60, gold: 80, red: 100 } as const;

/** Ветки, которые бывают только у одного пола (Лучник: парень — Бард, девушка — Танцовщица). */
const GENDER_ONLY: Record<string, 'm' | 'f'> = { bard: 'm', dancer: 'f', clown: 'm', gypsy: 'f' };

/**
 * Перекрёстные проверки шаблонов героев (ошибки — problems, content:check ✗; предупреждения — warnings, ⚠).
 * - job существует, первая профессия (tier 1), line = линия job; навыки существуют, уровни открытия уникальны,
 *   возрастают и не выше предела maxRarity; 2–4 навыка на форму; maxRarity ≥ baseRarity;
 * - ветки: две разные вторые профессии (tier 2) своей линии; bard — только у парня, dancer — только у девушки;
 * - навыки 1-го уровня различны у всех героев (первая профессия) и у всех форм веток между собой;
 * - имена уникальны;
 * - ульта формы (ult): существует, не пассивка, не среди навыков формы; ⚠ одна ульта у двух форм;
 * - разные навыки героев с одним именем не скрывают разные эффекты или способ применения;
 * - ⚠ навык не своей линии; ⚠ у двух героев одного класса (или двух форм одной ветки) общих навыков > 2 или одинаковый
 *   «фирменный» (последний) навык.
 */
export function validateHeroes(content: Content, problems: string[], warnings: string[] = []): void {
  const heroes = Object.values(content.heroes);
  checkSkillNames(content, problems);
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
    if (job.tier !== 1) problems.push(`${where}: класс героя — первая профессия (${t.job} — tier ${job.tier})`);
    if (rarityIndex(t.maxRarity) < rarityIndex(t.baseRarity)) problems.push(`${where}: maxRarity ${t.maxRarity} ниже baseRarity ${t.baseRarity}`);
    checkSkills(content, where, t.skills, t.maxRarity, line, problems, warnings);
    checkUlt(content, where, t.ult, t.skills, problems);
    const seenJobs = new Set<string>();
    for (const [i, b] of t.branches.entries()) {
      const bw = `${where}: branches[${i}] (${b.job})`;
      const bj = content.jobs[b.job];
      if (!bj) problems.push(`${bw}: класс ${b.job} не найден`);
      else {
        if (lineOf({ content }, b.job) !== line) problems.push(`${bw}: класс ${b.job} не из линии ${line}`);
        if (bj.tier !== 2) problems.push(`${bw}: ветка — вторая профессия (tier 2), а ${b.job} — tier ${bj.tier}`);
      }
      if (seenJobs.has(b.job)) problems.push(`${bw}: ветка ${b.job} указана дважды`);
      seenJobs.add(b.job);
      const only = GENDER_ONLY[b.job];
      if (only && only !== t.gender) problems.push(`${bw}: ветка ${b.job} — только для ${only === 'm' ? 'парня' : 'девушки'}`);
      checkSkills(content, bw, b.skills, t.maxRarity, line, problems, warnings);
      checkUlt(content, bw, b.ult, b.skills, problems);
      const a = b.advanced;
      if (a) {
        const aw = `${bw}: advanced`;
        const aj = content.jobs[a.job];
        if (!aj || aj.tier !== 3 || aj.from.length !== 1 || aj.from[0] !== b.job || lineOf({ content }, a.job) !== line) problems.push(`${aw}: требуется ветеранский ранг своей ветки ${b.job}`);
        if (GENDER_ONLY[a.job] && GENDER_ONLY[a.job] !== t.gender) problems.push(`${aw}: неверный пол профессии`);
        if (a.visual.sprite !== `${a.job}_${t.gender}`) problems.push(`${aw}: нужен явный лист профессии своего пола`);
        if (a.role !== b.role) problems.push(`${aw}: роль ветки должна сохраняться`);
        if (a.minLevel > DEFAULT_MAX_LEVEL[a.minRarity] || rarityIndex(a.minRarity) > rarityIndex(t.maxRarity)) problems.push(`${aw}: недостижимый порог`);
        checkSkills(content, aw, a.skills, t.maxRarity, line, problems, warnings, 6);
        checkUlt(content, aw, a.ult, a.skills, problems);
        if (!a.ult) problems.push(`${aw}: нужна личная ульта`);
        if (a.skills.some(s => !b.skills.some(old => old.skill === s.skill) && s.level < a.minLevel)) problems.push(`${aw}: новый навык ниже порога формы`);
      }
    }
  }
  // ✗ Навыки 1-го уровня различны: у героев (первая профессия) и у форм веток.
  const firstSkill = (skills: CardSkill[]) => [...skills].sort((x, y) => x.level - y.level)[0]?.skill;
  const uniq = (label: string, list: { who: string; skill: string | undefined }[]) => {
    const by = new Map<string, string>();
    for (const x of list) {
      if (!x.skill) continue;
      const other = by.get(x.skill);
      if (other) problems.push(`${label}: навык 1-го уровня ${x.skill} и у ${other}, и у ${x.who} — у каждого должен быть свой`);
      else by.set(x.skill, x.who);
    }
  };
  uniq('герои', heroes.map((t) => ({ who: t.id, skill: firstSkill(t.skills) })));
  uniq('ветки', heroes.flatMap((t) => t.branches.map((b) => ({ who: `${t.id}/${b.job}`, skill: firstSkill(b.skills) }))));
  // ⚠ Ульта у каждой формы своя (одна ульта на две формы — герои не различаются в бою).
  const ultBy = new Map<string, string>();
  for (const t of heroes)
    for (const f of [{ who: t.id, ult: t.ult }, ...t.branches.map((b) => ({ who: `${t.id}/${b.job}`, ult: b.ult }))]) {
      if (!f.ult) continue;
      const other = ultBy.get(f.ult);
      if (other) warnings.push(`ульта ${f.ult} и у ${other}, и у ${f.who}`);
      else ultBy.set(f.ult, f.who);
    }
  // ⚠ Различие героев одного класса и форм одной ветки.
  type Form = { who: string; skills: CardSkill[] };
  const groups = new Map<string, Form[]>();
  const add = (key: string, f: Form) => groups.set(key, [...(groups.get(key) ?? []), f]);
  for (const t of heroes) {
    add(`класс ${t.job}`, { who: `карточки ${t.id}`, skills: t.skills });
    for (const b of t.branches) add(`ветка ${b.job}`, { who: `${t.id}/${b.job}`, skills: b.skills });
  }
  const sig = (skills: CardSkill[]) => [...skills].sort((x, y) => x.level - y.level).at(-1)?.skill;
  for (const [key, list] of groups) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const shared = a.skills.filter((s) => b.skills.some((x) => x.skill === s.skill)).length;
        if (shared > 2) warnings.push(`${a.who} и ${b.who} (${key}): общих навыков ${shared} > 2 — должны различаться`);
        if (sig(a.skills) === sig(b.skills)) warnings.push(`${a.who} и ${b.who} (${key}): одинаковый фирменный навык ${sig(a.skills)}`);
      }
    }
  }
}

/**
 * Одно имя не должно обозначать, например, рывок по перезарядке и другую атаку на энергии.
 * Общий id и равноценные определения допустимы; сравниваем только используемые героями навыки,
 * без обычных атак, старых юнитов и монстров. Разная косметика не делает навык другим.
 */
function checkSkillNames(content: Content, problems: string[]): void {
  const byName = new Map<string, { id: string; signature: string }[]>();
  const seen = new Set<string>();
  const mechanics = (sk: SkillDef, mode: string): string => {
    const { id: _id, name: _name, description: _description, icon: _icon, $schema: _schema, ...rules } = sk;
    return JSON.stringify({ mode, ...rules });
  };
  for (const hero of Object.values(content.heroes)) {
    for (const form of [hero, ...hero.branches.flatMap(b => b.advanced ? [b, b.advanced] : [b])]) {
      const uses = [
        ...form.skills.map(({ skill }) => ({ id: skill, mode: content.skills[skill]?.trigger ? 'passive' : 'active' })),
        ...(form.ult ? [{ id: form.ult, mode: 'ult' }] : []),
      ];
      for (const use of uses) {
        const sk = content.skills[use.id];
        const key = `${use.id}/${use.mode}`;
        if (!sk || seen.has(key)) continue;
        seen.add(key);
        const name = sk.name.trim().toLowerCase().replace(/\s+/g, ' ');
        const signature = mechanics(sk, use.mode);
        const previous = byName.get(name) ?? [];
        const conflict = previous.find((p) => p.id !== use.id && p.signature !== signature);
        if (conflict) problems.push(`навыки героев ${conflict.id} и ${use.id}: одинаковое имя «${sk.name}», но разные эффекты или способ применения — нужны разные названия`);
        byName.set(name, [...previous, { id: use.id, signature }]);
      }
    }
  }
}

/**
 * Ульта формы (docs/design/battle-decisions.md §1): навык существует, активный (не пассивка), не среди навыков формы
 * (иначе ульта — тот же навык дважды).
 */
function checkUlt(content: Content, where: string, ult: string | undefined, skills: CardSkill[], problems: string[]): void {
  // Нет ульты — в бою ультой станет навык с самой долгой перезарядкой (ultSkillOf); у героев data/heroes ульта есть у
  // каждой формы — тест tests/hero-ults.test.ts (заготовка content:new — без неё).
  if (!ult) return;
  const sk = content.skills[ult];
  if (!sk) problems.push(`${where}: ульта ${ult} не найдена в data/skills`);
  else if (sk.trigger) problems.push(`${where}: ульта ${ult} — пассивка (trigger), нужна активная`);
  if (skills.some((s) => s.skill === ult)) problems.push(`${where}: ульта ${ult} уже среди навыков формы`);
}

function checkSkills(content: Content, where: string, skills: CardSkill[], maxRarity: keyof typeof DEFAULT_MAX_LEVEL, line: string, problems: string[], warnings: string[], maxSkills = 4): void {
  if (skills.length < 2 || skills.length > maxSkills) problems.push(`${where}: навыков ${skills.length}, нужно 2–${maxSkills}`);
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
