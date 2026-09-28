import { describe, expect, it } from 'vitest';
import { stageLabel } from '../src/core';
import { stageNo } from '../src/game/flow';
import { sceneLabel } from '../src/game/storyView';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const stage = (id: string) => ctx.content.stages.find((s) => s.id === id)!;

describe('ночной QA: интерфейс', () => {
  it('MT-05 / NB-10: номер этапа «глава-этап» по месту в главе, а не по id и не сквозной', () => {
    // Глава 1 растянута: ch1_s11 стоит третьим, босс ch1_s10 — последним (18-м).
    expect(stageNo(stage('ch1_s1'), ctx)).toBe('1-1');
    expect(stageNo(stage('ch1_s11'), ctx)).toBe('1-3');
    expect(stageNo(stage('ch1_s10'), ctx)).toBe('1-18');
    const ch2 = ctx.content.stages.filter((s) => s.chapter === ctx.content.chapters[1].id);
    expect(stageNo(ch2[0], ctx)).toBe('2-1');
    expect(stageNo(ch2[4], ctx)).toBe('2-5');
    // Тот же формат, что в баннерах и замках (core stageLabel).
    for (const s of ctx.content.stages) expect(stageNo(s, ctx)).toBe(stageLabel(s.id, ctx.content));
  });

  it('MT-05: «История» подписывает сцены тем же номером этапа', () => {
    const sc = ctx.story.scenes.find((s) => s.trigger === 'beforeStage' && s.stageId && stage(s.stageId).chapter !== ctx.content.chapters[0].id);
    expect(sc).toBeDefined();
    expect(sceneLabel(sc!, ctx)).toContain(stageNo(stage(sc!.stageId!), ctx));
  });
});
