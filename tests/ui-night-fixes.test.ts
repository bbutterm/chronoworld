import { describe, expect, it } from 'vitest';
import { newGame, stageLabel, type SaveState } from '../src/core';
import { heroesBadgeCount, stageNo } from '../src/game/flow';
import { copyCounter } from '../src/game/heroesView';
import { sceneLabel } from '../src/game/storyView';
import { computeView } from '../src/game/viewLayout';
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

  it('MT-06: значок «Герои» считает героев, а не карты-копии', () => {
    let save: SaveState = newGame(ctx, 1_700_000_000_000);
    save = { ...save, resources: { ...save.resources, gold: 1_000_000, heroExp: 1_000_000 } };
    const base = heroesBadgeCount(save, ctx);
    // §2.4: повод — только у героев отряда, по одному на героя (здесь — «Улучшить»).
    expect(base).toBe(save.squad.filter((id) => id !== null).length);
    const lead = save.heroes.find((h) => save.squad.includes(h.id))!;
    const copies = Array.from({ length: 6 }, (_, i) => ({ ...lead, id: `h${900 + i}`, rarity: 'blue' as const, level: 1, isNew: false, locked: false }));
    const more = { ...save, heroes: [...save.heroes, ...copies] };
    // Шесть копий героя из отряда — счёт тот же: копии вне отряда не в счёте, у героя отряда — один повод.
    expect(heroesBadgeCount(more, ctx)).toBe(base);
    // На карточке — «копии» одним словом: запасные карты героя.
    expect(copyCounter(more, lead.id, ctx).text).toMatch(/^Копий: 6/);
  });

  it('NB-21: низ безопасной области — на 9:16 это край поля, на вытянутом экране ниже (туда опускается навигация)', () => {
    expect(computeView(540, 960, 1).safeBottom).toBe(1920);
    const tall = computeView(390, 844, 3);
    expect(tall.safeBottom).toBeGreaterThan(2000);
    expect(tall.safeBottom).toBeLessThanOrEqual(tall.worldY + tall.worldH);
    // «Домашняя полоска» iPhone (34 css px снизу) — навигация над ней.
    const home = computeView(390, 844, 3, { top: 47, right: 0, bottom: 34, left: 0 });
    expect(home.safeBottom).toBeLessThan(home.worldY + home.worldH);
  });
});
