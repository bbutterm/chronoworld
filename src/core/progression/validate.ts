import type { Content } from '../types';

/**
 * Перекрёстные проверки профессий. Добавляй сюда новые правила — их показывает npm run content:check.
 * - basic и навыки существуют, basic без trigger;
 * - навыки открываются на уникальных уровнях ≤ maxJobLevel;
 * - у tier 0 from пустой, у tier ≥ 1 непустой, и tier каждого источника строго меньше;
 * - каждая профессия достижима от профессии tier 0 (Новичка) по цепочке from.
 */
export function validateJobs(content: Content, problems: string[]): void {
  const jobs = Object.values(content.jobs);
  for (const j of jobs) {
    const where = `профессия ${j.id}`;
    if (!content.skills[j.basic]) problems.push(`${where}: basic ссылается на несуществующий навык ${j.basic}`);
    else if (content.skills[j.basic].trigger) problems.push(`${where}: обычная атака ${j.basic} не может иметь trigger`);
    if (j.tier === 3 && (j.from.length !== 1 || content.jobs[j.from[0]]?.tier !== 2)) problems.push(`${where}: ветеранский ранг требует одну родительскую профессию tier 2`);
    const levels = new Set<number>();
    for (const s of j.skills) {
      if (!content.skills[s.skill]) problems.push(`${where}: навык ${s.skill} не найден`);
      if (s.jobLevel > j.maxJobLevel) problems.push(`${where}: навык ${s.skill} открывается на ${s.jobLevel} > maxJobLevel ${j.maxJobLevel}`);
      if (levels.has(s.jobLevel)) problems.push(`${where}: на джоб-уровне ${s.jobLevel} открывается больше одного навыка`);
      levels.add(s.jobLevel);
    }
    if (j.tier === 0 && j.from.length > 0) problems.push(`${where}: у профессии tier 0 не должно быть from`);
    if (j.tier > 0 && j.from.length === 0) problems.push(`${where}: у профессии tier ${j.tier} должен быть непустой from`);
    for (const f of j.from) {
      const src = content.jobs[f];
      if (!src) problems.push(`${where}: from ссылается на несуществующую профессию ${f}`);
      else if (src.tier >= j.tier) problems.push(`${where}: from ${f} (tier ${src.tier}) — tier источника должен быть меньше ${j.tier}`);
    }
  }

  // Достижимость: обход от tier 0 по рёбрам from (только корректным — с меньшим tier).
  const reached = new Set(jobs.filter((j) => j.tier === 0).map((j) => j.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const j of jobs) {
      if (reached.has(j.id)) continue;
      if (j.from.some((f) => reached.has(f) && content.jobs[f].tier < j.tier)) {
        reached.add(j.id);
        grew = true;
      }
    }
  }
  for (const j of jobs) {
    if (!reached.has(j.id)) problems.push(`профессия ${j.id}: недостижима от Новичка (нет пути по from от профессии tier 0)`);
  }
}
