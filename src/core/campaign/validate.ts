import type { Content } from '../types';

/**
 * Перекрёстные проверки кампании. Добавляй сюда новые правила — их показывает npm run content:check.
 * - id этапов уникальны по всей кампании;
 * - в каждом этапе хотя бы один враг;
 * - враги существуют и имеют kind monster/boss;
 * - boss-этап содержит юнита kind boss.
 */
export function validateCampaign(content: Content, problems: string[]): void {
  const seen = new Map<string, string>();
  for (const s of content.stages) {
    const where = seen.get(s.id);
    if (where) problems.push(`этап ${s.id} (глава ${s.chapter}): id уже занят этапом главы ${where}`);
    else seen.set(s.id, s.chapter);

    const enemies = s.enemies.filter((e) => e !== null);
    if (enemies.length === 0) problems.push(`этап ${s.id}: нет ни одного врага`);
    for (const e of enemies) {
      const u = content.units[e.unit];
      if (!u) problems.push(`этап ${s.id}: враг ${e.unit} не найден в data/units`);
      else if (u.kind !== 'monster' && u.kind !== 'boss') problems.push(`этап ${s.id}: ${e.unit} — не монстр (kind ${u.kind}), врагами могут быть только monster/boss`);
    }
    if (s.boss && !enemies.some((e) => content.units[e.unit]?.kind === 'boss')) {
      problems.push(`этап ${s.id}: помечен boss, но среди врагов нет юнита kind boss`);
    }
  }
}
