import type { Content } from '../types';

/**
 * Перекрёстные проверки профессий. Добавляй сюда новые правила — их показывает npm run content:check.
 * TODO(T-A): путь от Новичка до каждой профессии; уровни открытия навыков ≤ maxJobLevel (сделано);
 * у tier 0 нет from, у tier ≥ 1 from непустой и tier источника строго меньше.
 */
export function validateJobs(content: Content, problems: string[]): void {
  for (const j of Object.values(content.jobs)) {
    const where = `профессия ${j.id}`;
    if (!content.skills[j.basic]) problems.push(`${where}: basic ссылается на несуществующий навык ${j.basic}`);
    else if (content.skills[j.basic].trigger) problems.push(`${where}: обычная атака ${j.basic} не может иметь trigger`);
    for (const s of j.skills) {
      if (!content.skills[s.skill]) problems.push(`${where}: навык ${s.skill} не найден`);
      if (s.jobLevel > j.maxJobLevel) problems.push(`${where}: навык ${s.skill} открывается на ${s.jobLevel} > maxJobLevel ${j.maxJobLevel}`);
    }
    for (const f of j.from) if (!content.jobs[f]) problems.push(`${where}: from ссылается на несуществующую профессию ${f}`);
  }
}
