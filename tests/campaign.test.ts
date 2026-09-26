import { describe, it } from 'vitest';

// T-B: реализовать src/core/campaign/campaign.ts и заменить todo на тесты.
describe('кампания', () => {
  it.todo('первый этап открыт, остальные закрыты; пройденный — cleared');
  it.todo('enemySquad: статы растут на enemyStatGrowthPerStage за этап, spd не растёт, id слотов разные');
  it.todo('playStage: закрытый этап → GameRuleError stage_locked, пустой отряд → empty_squad');
  it.todo('playStage: победа — золото, опыт каждому герою отряда, stageCleared, stageUnlocked следующего');
  it.todo('playStage: повтор пройденного — награда × replayRewardMultiplier, без stageUnlocked');
  it.todo('playStage: поражение — только battleSeq + 1');
  it.todo('playStage детерминирован по seed и не меняет исходный save');
});
