import { describe, expect, it } from 'vitest';
import {
  actPlayStage, actSkipStage, beginCampaignStage, campaignSceneLines, canChooseCampaignOption,
  chooseCampaignOption, deserialize, enemySquad, finishCampaignScene, getStage, newGame,
  playStage, recommendedPower, resolveStageEnemies, sanitizeSave, serialize, stageLevels,
  stagePower, stagePowerCheck, unitLevel, type SaveState,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { ownRecommendedLevel, powerCheck, stageLevelsFor, stageNeeds } from '../src/game/flow';
import { withReplay } from './helpers';

const ctx = loadFullContext();
const sceneId = 'ch3o_s15_after';
const stageId = 'ch3_s6';
const choiceId = 'ch3_rescue';
const stage = getStage(ctx, stageId);
const ready = (): SaveState => ({
  ...newGame(ctx, 0), campaign: { cleared: ctx.content.stages.slice(0, stage.globalIndex).map((s) => s.id) }, storyQueue: [sceneId],
});
const choose = (option = 'block') => chooseCampaignOption(ready(), sceneId, option, ctx);

 describe('кампанийное решение: одна транзакция и совместимость', () => {
  it('разрешено после победы, не раньше и не после закрытия/прохождения', () => {
    expect(canChooseCampaignOption(newGame(ctx, 0), sceneId, ctx)).toBe(false);
    expect(() => chooseCampaignOption(newGame(ctx, 0), sceneId, 'block', ctx)).toThrow();
    expect(canChooseCampaignOption(ready(), sceneId, ctx)).toBe(true);
    const unqueued = ready(); delete unqueued.storyQueue;
    expect(canChooseCampaignOption(unqueued, sceneId, ctx)).toBe(false);
    expect(() => chooseCampaignOption(unqueued, sceneId, 'block', ctx)).toThrow();
    expect(beginCampaignStage(unqueued, stageId, ctx).campaignChoices?.[choiceId]).toBe('default');
    expect(canChooseCampaignOption({ ...ready(), seenScenes: [sceneId] }, sceneId, ctx)).toBe(false);
    const old = ready(); old.campaign.cleared.push(stageId);
    expect(canChooseCampaignOption(old, sceneId, ctx)).toBe(false);
    expect(() => chooseCampaignOption(old, sceneId, 'block', ctx)).toThrow();
    const closed = finishCampaignScene(old, sceneId, ctx);
    expect(closed.campaignChoices?.[choiceId]).toBe('default');
    expect(closed.storyQueue).toBeUndefined();
  });
  it('записывает только выбор; двойное нажатие не меняет ресурсы или ответ', () => {
    const save = ready(); const before = serialize(save);
    const next = chooseCampaignOption(save, sceneId, 'block', ctx);
    expect(next).toEqual({ ...save, campaignChoices: { [choiceId]: 'block' } });
    expect(serialize(save)).toBe(before);
    expect(chooseCampaignOption(next, sceneId, 'evacuate', ctx)).toBe(next);
    expect(chooseCampaignOption(next, sceneId, 'block', ctx)).toBe(next);
    expect(() => chooseCampaignOption(save, sceneId, 'bad', ctx)).toThrow();
  });
  it('пропуск атомарно фиксирует default и просмотр; после ответа сохраняет ответ', () => {
    const skipped = finishCampaignScene(ready(), sceneId, ctx);
    expect(skipped.campaignChoices?.[choiceId]).toBe('default');
    expect(skipped.seenScenes).toContain(sceneId);
    expect(skipped.storyQueue).toBeUndefined();
    expect(chooseCampaignOption(skipped, sceneId, 'block', ctx)).toBe(skipped);
    expect(finishCampaignScene(choose(), sceneId, ctx).campaignChoices?.[choiceId]).toBe('block');
  });
  it.each(['evacuate', 'block', 'default'])('reload %s не меняет выбор', (value) => {
    const save = value === 'default' ? beginCampaignStage(ready(), stageId, ctx) : choose(value);
    expect(serialize(deserialize(serialize(save)))).toBe(serialize(save));
    expect(sanitizeSave(deserialize(serialize(save)), ctx).save.campaignChoices).toEqual(save.campaignChoices);
  });
  it.each([null, [], 123, { ch3_rescue: 42 }])('повреждённое необязательное поле %j не сбрасывает аккаунт', (value) => {
    const save = ready(); save.resources.gold = 12345;
    const loaded = deserialize(JSON.stringify({ ...save, campaignChoices: value }));
    const clean = sanitizeSave(loaded, ctx);
    expect(clean.save.resources.gold).toBe(12345);
    expect(clean.save.heroes).toEqual(save.heroes);
    expect(clean.warnings.length).toBeGreaterThan(0);
    expect(clean.save.campaignChoices).toEqual({});
  });
  it('удаляет только неизвестные пары с предупреждением', () => {
    const save = { ...ready(), campaignChoices: { ch3_rescue: 'bad', unknown: 'block' } };
    const clean = sanitizeSave(deserialize(serialize(save)), ctx);
    expect(clean.save.campaignChoices).toEqual({});
    expect(clean.warnings).toHaveLength(2);
  });
  it('старые сохранения читаются без решения и без лишней записи', () => {
    const save = ready(); const before = serialize(save);
    const clean = sanitizeSave(save, ctx).save;
    expect(clean.campaignChoices).toBeUndefined();
    resolveStageEnemies(stage, save.campaignChoices);
    stagePower(stageId, ctx, save.campaignChoices);
    expect(serialize(save)).toBe(before);
  });
  it('первый headless бой фиксирует fallback даже при поражении', () => {
    const save = ready(); const before = serialize(save);
    const out = playStage(save, stageId, 17, ctx);
    expect(out.result.winner).not.toBe('A');
    expect(out.save.campaignChoices?.[choiceId]).toBe('default');
    expect(canChooseCampaignOption(out.save, sceneId, ctx)).toBe(false);
    expect(out.save.resources).toEqual(save.resources);
    expect(serialize(save)).toBe(before);
    expect(playStage(out.save, stageId, 17, ctx).save.campaignChoices).toEqual(out.save.campaignChoices);
  });
  it('поражение/повтор детерминированы и сохраняют выбранную ветку', () => {
    const save = choose();
    const a = playStage(save, stageId, 91, ctx), b = playStage(save, stageId, 91, ctx);
    expect(a).toEqual(b);
    expect(a.save.campaignChoices).toEqual(save.campaignChoices);
    expect(a.events).toEqual([]);
  });
  it('победа выдаёт обычные награды; skip повтора (replay: true) — обычные награды повтора, без следов решения', () => {
    const save = choose();
    save.heroes = save.heroes.map((h) => ({ ...h, rarity: 'red' as const, level: 100, branch: ctx.content.heroes[h.templateId].branches?.[0]?.job }));
    const a = actPlayStage(save, save.daily.day, stageId, 7, ctx);
    expect(a.result.winner).toBe('A');
    expect(a.events.filter((e) => e.type === 'rewards')).toEqual([{ type: 'rewards', gold: stage.rewards.gold, heroExp: stage.rewards.jobExp }]);
    expect(a.save.campaignChoices).toEqual(save.campaignChoices);
    // Выпущенные данные повторы запрещают; путь повтора проверяем на явно разрешённых повторах.
    expect(() => actSkipStage(a.save, save.daily.day, stageId, 7, ctx)).toThrow(expect.objectContaining({ code: 'stage_cleared' }));
    const rctx = withReplay(ctx);
    const m = rctx.progression.campaign.replayRewardMultiplier!;
    const repeated = actSkipStage(a.save, save.daily.day, stageId, 7, rctx);
    expect(repeated.events.filter((e) => e.type === 'rewards')).toEqual([{ type: 'rewards', gold: Math.floor(stage.rewards.gold * m), heroExp: Math.floor(stage.rewards.jobExp * m) }]);
    expect(repeated.save.campaignChoices).toEqual(save.campaignChoices);
  });
});

describe('кампанийное решение: единый состав и результат', () => {
  it('default и evacuate точно воспроизводят базовый бой', () => {
    const base = enemySquad(stageId, ctx);
    for (const option of ['default', 'evacuate']) expect(enemySquad(stageId, ctx, { [choiceId]: option })).toEqual(base);
    const choices = { [choiceId]: 'block' };
    expect(resolveStageEnemies(stage, choices).map((e) => e?.unit)).toEqual(['orc_skeleton', 'orc_high', 'orc_archer', 'orc_zombie', 'orc_archer']);
    for (const s of ctx.content.stages.filter((s) => s.id !== stageId)) expect(enemySquad(s.id, ctx, choices)).toEqual(enemySquad(s.id, ctx));
  });
  it('просмотр, уровни, рекомендации используют ветку, не меняют save', () => {
    const save = choose(); const before = serialize(save); const choices = save.campaignChoices;
    const levels = stageLevels(stageId, ctx, choices);
    const enemies = enemySquad(stageId, ctx, choices);
    expect(stagePowerCheck(save, stageId, ctx).recommended).toBe(recommendedPower(stageId, ctx, choices));
    expect(powerCheck(save, stageId, ctx).recommended).toBe(recommendedPower(stageId, ctx, choices));
    expect(stageNeeds(save, stageId, ctx)).toBeDefined();
    expect(ownRecommendedLevel(save, stageId, ctx)).toBeDefined();
    expect(stageLevelsFor(save, stageId, ctx)).toBeDefined();
    expect(levels.enemies).toHaveLength(enemies.length);
    expect(enemies.map((u) => u && unitLevel(u, levels.rarity, ctx, 1, choices))).toEqual(levels.enemies);
    expect(serialize(save)).toBe(before);
  });
  it('результат показывает до трёх строк и нейтральный fallback', () => {
    const result = ctx.story.scenes.find((s) => s.id === 'ch3o_s6_after')!;
    for (const option of ['default', 'block', 'evacuate']) {
      const lines = campaignSceneLines({ campaignChoices: { [choiceId]: option } }, result);
      expect(lines.length).toBeLessThanOrEqual(3);
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines.every((l) => l.text.length <= 120)).toBe(true);
    }
    expect(campaignSceneLines({}, result)).toEqual(campaignSceneLines({ campaignChoices: { [choiceId]: 'default' } }, result));
  });
});
