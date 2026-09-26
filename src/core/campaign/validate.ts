import type { Content } from '../types';

/**
 * Перекрёстные проверки кампании. Добавляй сюда новые правила — их показывает npm run content:check.
 * TODO(T-B): уникальность id этапов по всей кампании; в каждом этапе хотя бы один враг;
 * враги — только kind monster/boss; boss-этап содержит юнита kind boss.
 */
export function validateCampaign(content: Content, problems: string[]): void {
  for (const s of content.stages) {
    for (const e of s.enemies) {
      if (e && !content.units[e.unit]) problems.push(`этап ${s.id}: враг ${e.unit} не найден в data/units`);
    }
  }
}
