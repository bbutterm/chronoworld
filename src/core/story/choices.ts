import { GameRuleError, type GameContext } from '../progression/types';
import type { SaveState } from '../save/schema';
import type { StoryLine } from './schema';
import { markScenesSeen, type StoryContext, type StoryScene } from './story';

/** Решение доступно только в незакрытой сцене после победы и до начала целевого боя. */
export function canChooseCampaignOption(save: SaveState, sceneId: string, ctx: GameContext & StoryContext): boolean {
  const scene = ctx.story.scenes.find((s) => s.id === sceneId);
  if (!scene?.choice || save.seenScenes.includes(sceneId) || !save.storyQueue?.includes(sceneId)) return false;
  const stage = ctx.content.stages.find((s) => s.campaignChoice?.id === scene.choice!.id);
  const binding = stage?.campaignChoice;
  return !!binding && binding.sceneId === sceneId && save.campaign.cleared.includes(binding.afterStageId)
    && !save.campaign.cleared.includes(stage!.id) && save.campaignChoices?.[binding.id] === undefined;
}

export function chooseCampaignOption(save: SaveState, sceneId: string, optionId: string, ctx: GameContext & StoryContext): SaveState {
  const scene = ctx.story.scenes.find((s) => s.id === sceneId);
  if (!scene?.choice?.options.some((o) => o.id === optionId)) throw new GameRuleError('invalid_choice', 'Неизвестный ответ');
  if (save.campaignChoices?.[scene.choice.id] !== undefined) return save;
  if (!canChooseCampaignOption(save, sceneId, ctx)) throw new GameRuleError('choice_closed', 'Этот выбор уже недоступен');
  return { ...save, campaignChoices: { ...save.campaignChoices, [scene.choice.id]: optionId } };
}

/** Пропуск/закрытие сцены — одна транзакция: neutral fallback и отметка просмотра. */
export function finishCampaignScene(save: SaveState, sceneId: string, ctx: GameContext & StoryContext): SaveState {
  const choice = ctx.story.scenes.find((s) => s.id === sceneId)?.choice;
  const next = choice && save.campaignChoices?.[choice.id] === undefined
    ? { ...save, campaignChoices: { ...save.campaignChoices, [choice.id]: 'default' } } : save;
  return markScenesSeen(next, [sceneId]);
}

export function campaignSceneLines(save: Pick<SaveState, 'campaignChoices'>, scene: Pick<StoryScene, 'lines'>): StoryLine[] {
  return scene.lines.filter((l) => !l.when || (save.campaignChoices?.[l.when.choice] ?? 'default') === l.when.is);
}
