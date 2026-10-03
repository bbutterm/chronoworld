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
  const choices = new Set<string>();
  for (const s of content.stages) {
    const where = seen.get(s.id);
    if (where) problems.push(`этап ${s.id} (глава ${s.chapter}): id уже занят этапом главы ${where}`);
    else seen.set(s.id, s.chapter);

    const binding = s.campaignChoice;
    if (binding) {
      if (choices.has(binding.id)) problems.push(`этап ${s.id}: выбор ${binding.id} уже занят`);
      choices.add(binding.id);
      const before = content.stages.find((x) => x.id === binding.afterStageId);
      if (!before || before.chapter !== s.chapter || before.globalIndex >= s.globalIndex) problems.push(`этап ${s.id}: выбор должен следовать после этапа своей главы`);
      const options = new Set<string>();
      for (const variant of binding.variants) {
        if (variant.optionId === 'default' || options.has(variant.optionId)) problems.push(`этап ${s.id}: неверный или повторный вариант ${variant.optionId}`);
        options.add(variant.optionId);
        if (!variant.enemies.some(Boolean)) problems.push(`этап ${s.id}: пустой вариант ${variant.optionId}`);
        for (const e of variant.enemies) if (e && !['monster', 'boss'].includes(content.units[e.unit]?.kind)) problems.push(`этап ${s.id}: неверный враг варианта ${e.unit}`);
      }
    }
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
