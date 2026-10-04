import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Итерация 7C полировки (docs/design/ui-polish-research.md §3, §5 «Карточка героя» и «Инвентарь»): вознесение, контракт
 * героя и инвентарь — одна главная кнопка, без строк-инструкций, моменты через juice.ts, сетка предметов и листы снизу.
 * Сцены тянут Phaser — проверяем исходники (как squad-editor.test.ts).
 */

const SRC = (f: string) => readFileSync(join(import.meta.dirname, '..', 'src', 'game', f), 'utf8');
const ascend = SRC('scenes/AscendScene.ts');
const pick = SRC('scenes/HeroPickScene.ts');
const inv = SRC('scenes/InventoryScene.ts');
const icons = SRC('itemIcons.ts');

/** Строки-инструкции (§3 п. 3) и старые текстуры кнопок, которых в этих экранах больше нет. */
const INSTRUCTION = /Нажмите|нажмите|Коснитесь|коснитесь|, чтобы /;

describe('вознесение (AscendScene)', () => {
  it('показ — момент «ascend» из juice.ts, без своего дубля звука и вибрации', () => {
    expect(ascend).toMatch(/moment\(this, 'ascend'/);
    expect(ascend).not.toMatch(/sfx\('rarity_up'\)/);
    expect(ascend).not.toMatch(/haptic\('levelUp'\)/);
  });

  it('одна главная кнопка «Вознести» (cta), «Авто» — вторичная; имена для e2e на месте', () => {
    expect(ascend).not.toMatch(/ui_btn_primary/);
    expect(ascend).toMatch(/cta\(this, GAME_W \/ 2, BTN_Y, 'Вознести'/);
    expect(ascend).toMatch(/'Авто'[^\n]*variant: 'secondary'/);
    expect(ascend).toMatch(/branchTile_\$\{b\.job\}/);
    expect(ascend).toMatch(/'Отлично!'/);
    // e2e.mjs ищет подписи «Где взять копии» и «Предел уровня».
    expect(ascend).toMatch(/'Где взять копии'/);
    expect(ascend).toMatch(/'Предел уровня'/);
  });

  it('без абзацев-предупреждений: причина — одна короткая строка, статы — stat()', () => {
    expect(ascend).not.toMatch(INSTRUCTION);
    expect(ascend).not.toMatch(/Готово! Золото/);
    expect(ascend).not.toMatch(/Выберите ветку второй профессии:/);
    expect(ascend).toMatch(/shortReason\(st\.reason\)/);
    expect(ascend).toMatch(/\bstat\(this/);
    expect(ascend).not.toMatch(/wordWrap: \{ width: 980 \}/);
  });

  it('выбор корма — лист снизу, а не своё окно', () => {
    expect(ascend).toMatch(/bottomSheet\(this/);
    expect(ascend).not.toMatch(/'k:buttonLong_beige'/);
  });
});

describe('контракт героя (HeroPickScene)', () => {
  it('сетка и одна главная кнопка «Забрать»; показ — момент', () => {
    expect(pick).not.toMatch(/ui_btn_primary/);
    expect(pick.match(/\bcta\(/g)?.length).toBe(3);
    expect(pick).toMatch(/'Забрать'/);
    expect(pick).toMatch(/moment\(this, 'ascend'/);
    expect(pick).not.toMatch(/sfx\('rarity_up'\)/);
    expect(pick).not.toMatch(INSTRUCTION);
  });
});

describe('инвентарь (InventoryScene, itemIcons)', () => {
  it('без строк-инструкций фильтров и старых кнопок-вкладок', () => {
    expect(inv).not.toMatch(INSTRUCTION);
    expect(inv).not.toMatch(/ui_btn_primary|k:buttonLong|k:buttonSquare/);
    expect(inv).not.toMatch(/Предметов: \$\{/);
  });

  it('вкладки и фильтры — segmented и иконки слотов; предметы — сетка плиток', () => {
    expect(inv).toMatch(/segmented\(this, GAME_W \/ 2, TOP \+ 52, CW, \['Снаряжение', 'Герои', 'Карты MVP'\]/);
    expect(inv).toMatch(/itemIconKey\(this, s\)/);
    expect(inv).toMatch(/itemTile\(this/);
    expect(icons).toMatch(/export function itemTile\(/);
  });

  it('подробности и заточка — листы снизу; риск — чип с процентом; одна главная кнопка в листе', () => {
    expect(inv.match(/bottomSheet\(/g)?.length).toBeGreaterThanOrEqual(4);
    expect(inv).toMatch(/`Неудача \$\{pct\(chance\)\}`, riskTone\(chance\)/);
    expect(inv).toMatch(/cta\(this, width \/ 2, y \+ 70, 'Заточить'/);
    expect(inv).toMatch(/variant: 'secondary'/);
    expect(inv).toMatch(/\bstat\(this, width \/ 2/);
  });

  it('сетка 5 в ряд влезает в поле 1080 с полями 48, плитка не меньше цели нажатия', () => {
    const W = 1080;
    const M = 48;
    const tile = Number(/const TILE = (\d+);/.exec(inv)?.[1]);
    const cols = Number(/const COLS = (\d+);/.exec(inv)?.[1]);
    expect(cols).toBe(5);
    expect(tile).toBeGreaterThanOrEqual(96 * 1.5);
    expect(cols * tile).toBeLessThanOrEqual(W - 2 * M - (cols - 1) * 16);
  });
});
