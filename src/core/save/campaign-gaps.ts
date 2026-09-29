import type { GameContext } from '../progression/types';
import type { SaveState } from './schema';

/**
 * Глава 1 растянута до 18 этапов (28.09): новые этапы ch1_s11…s18 вставлены между выпущенными ch1_s1…s10. Игрок, у которого
 * уже пройден этап дальше вставленного (например ch1_s10 или вся кампания), не должен «откатиться» на новые этапы:
 * все известные этапы, стоящие в порядке кампании ДО самого дальнего пройденного, засчитываются пройденными (без наград —
 * их игрок получил бы за этапы, которые уже прошёл дальше). Id неизвестных этапов в cleared не трогаются.
 * Новые id дописываются в конец cleared в порядке кампании. Ничего не добавлено — тот же объект save.
 * Не миграция версии: работает для любого сохранения при каждой загрузке (sanitizeSave) и для будущих вставок.
 */
export function fillClearedGaps<S extends Pick<SaveState, 'campaign'>>(save: S, ctx: Pick<GameContext, 'content'>): { save: S; filled: string[] } {
  const stages = ctx.content.stages;
  const cleared = new Set(save.campaign.cleared);
  let farthest = -1;
  for (const s of stages) if (cleared.has(s.id)) farthest = Math.max(farthest, s.globalIndex);
  const filled = stages.filter((s) => s.globalIndex < farthest && !cleared.has(s.id)).map((s) => s.id);
  if (!filled.length) return { save, filled };
  return { save: { ...save, campaign: { ...save.campaign, cleared: [...save.campaign.cleared, ...filled] } }, filled };
}
