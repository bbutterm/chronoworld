import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Экран «Герои» (итерация полировки 7A, docs/design/ui-polish-research.md §5 «Герои (список)»): один значок на
 * карточке (история и вещь — через heroCardMark, без отдельной красной точки), ноль инструкций «Нажмите…»,
 * подсказки обучения — раз за визит (перерисовка фильтром их не повторяет).
 */
const SRC = readFileSync(join(import.meta.dirname, '..', 'src', 'game', 'scenes', 'HeroesScene.ts'), 'utf8');

describe('экран «Герои»', () => {
  it('история и «вещь получше» — значком карточки, не отдельной точкой', () => {
    expect(SRC).not.toMatch(/storyDot/);
    expect(SRC).toMatch(/storyNew:/);
    expect(SRC).toMatch(/gearUpgrade[,:]/);
  });

  it('без инструкций в постоянном интерфейсе', () => {
    expect(SRC).not.toMatch(/Нажмите|нажмите/);
  });

  it('перерисовка фильтром — тем же визитом, подсказки обучения только при входе', () => {
    // Все перерисовки экрана идут через redraw() с keep: true; голый restart() — только в выборе ветки (другая сцена).
    const restarts = SRC.match(/this\.scene\.restart\([^)]*\)/g) ?? [];
    expect(restarts.every((r) => r.includes('keep: true'))).toBe(true);
    const create = SRC.slice(SRC.indexOf('create(data'), SRC.indexOf('private resetFilters'));
    const keepAt = create.indexOf('if (data.keep) return;');
    expect(keepAt).toBeGreaterThan(0);
    expect(create.indexOf("tutorialHint(this, 'equip_gear'")).toBeGreaterThan(keepAt);
    expect(create.indexOf("tutorialHint(this, 'ascend'")).toBeGreaterThan(keepAt);
  });

  it('одна главная кнопка: «Вознести всех» — только когда есть кого', () => {
    expect(SRC.match(/'ui_btn_primary'/g) ?? []).toHaveLength(1);
    expect(SRC).toMatch(/if \(ascendAll\(save, GAME\)\.done\.length\)/);
  });
});
