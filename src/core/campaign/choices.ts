import type { StageDef } from './schema';
import type { SaveState } from '../save/schema';
import { GameRuleError, type GameContext } from '../progression/types';

export type CampaignChoices = Readonly<Record<string, string>> | undefined;

/** Чистое чтение: никогда не меняет сохранение или базовый контент. */
export function resolveStageEnemies(stage: StageDef, choices?: CampaignChoices): StageDef['enemies'] {
  const binding = stage.campaignChoice;
  const selected = binding && choices?.[binding.id];
  return binding?.variants.find((v) => v.optionId === selected)?.enemies ?? stage.enemies;
}

/** Зафиксировать fallback при начале боя, включая будущие поражения. */
export function beginCampaignStage(save: SaveState, stageId: string, ctx: GameContext): SaveState {
  const stage = ctx.content.stages.find((s) => s.id === stageId);
  if (!stage) throw new GameRuleError('unknown_stage', `Неизвестный этап: ${stageId}`);
  if (!save.campaign.cleared.includes(stageId) && stage.globalIndex > 0 && !save.campaign.cleared.includes(ctx.content.stages[stage.globalIndex - 1]?.id)) throw new GameRuleError('stage_locked', 'Этап ещё закрыт');
  const binding = stage.campaignChoice;
  if (!binding || save.campaignChoices?.[binding.id] !== undefined) return save;
  return { ...save, campaignChoices: { ...save.campaignChoices, [binding.id]: 'default' } };
}
