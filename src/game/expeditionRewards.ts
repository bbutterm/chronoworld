import { autoResolveEvents, expeditionStory, rewardsWithStory, type ActiveExpedition, type ExpeditionContext, type ExpeditionRewards, type SaveState } from '../core';

/** Текущая добыча, как при «Забрать»: выбранные исходы + варианты по умолчанию для нерешённых событий.
 * Только предпросмотр: снимок добычи, решения и Летопись не меняются. Новый выбор пересчитает сумму от снимка.
 */
export function expeditionRewardPreview(save: SaveState, e: ActiveExpedition, ctx: ExpeditionContext): ExpeditionRewards {
  const resolved = autoResolveEvents(save, e, ctx);
  const rewards = rewardsWithStory(e.rewards, expeditionStory(save, resolved, ctx));
  // Как при получении, предметы, удалённые из контента, не выдаются.
  return { ...rewards, items: rewards.items.filter((id) => ctx.equipment?.items[id]) };
}
