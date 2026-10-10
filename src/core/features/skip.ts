import { playStage, stageStatus, type StageOutcome } from '../campaign/campaign';
import type { SaveState } from '../save/schema';
import type { GameContext } from '../progression/types';
import { FeatureError } from './errors';

function requireCleared(save: SaveState, stageId: string, ctx: GameContext): void {
  if (stageStatus(save, stageId, ctx) !== 'cleared') throw new FeatureError('stage_not_cleared', 'Пропустить или повторить можно только пройденный этап');
}

/*
 * K7 выключен в выпущенных данных (progression.campaign.replay: false, решение владельца 10.10.2026): пройденный этап
 * больше не сражается — playStage бросает GameRuleError('stage_cleared'), экран этапа кнопок повтора не показывает.
 * Функции остаются для контекстов с разрешёнными повторами (тесты, инструменты).
 */

/**
 * K7. Пропустить бой пройденного этапа — сразу итог. Внутри обычный playStage (тот же seed → тот же итог,
 * награда за повтор × replayRewardMultiplier(ctx), battleSeq + 1), из результата убирается лог (result.log = [])
 * — для экрана итогов хватает winner / report / units.
 * Бой может быть и проигран (итог честный, не автопобеда).
 * FeatureError('stage_not_cleared') — этап не пройден; ошибки playStage (unknown_stage, empty_squad) — как есть.
 */
export function skipStage(save: SaveState, stageId: string, seed: number, ctx: GameContext, day?: string): StageOutcome {
  requireCleared(save, stageId, ctx);
  const out = playStage(save, stageId, seed, ctx, undefined, day);
  return { ...out, result: { ...out.result, log: [] } };
}

/**
 * K7. Повторить пройденный этап с просмотром боя: то же, что playStage, но только для пройденных этапов
 * (лог сохраняется для воспроизведения). Для «открытого» этапа используйте playStage.
 */
export function repeatStage(save: SaveState, stageId: string, seed: number, ctx: GameContext, day?: string): StageOutcome {
  requireCleared(save, stageId, ctx);
  return playStage(save, stageId, seed, ctx, undefined, day);
}
