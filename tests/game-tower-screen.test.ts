import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Итерация 9A полировки (docs/design/ui-polish-research.md §3, §5 «Башня»): фон этажа, лестница этажей, чипы состояния,
 * правила — за «i» в листе снизу, отряд — ряд портретов без инструкции, одна главная кнопка. Сцена тянет Phaser —
 * проверяем исходник (как game-ascend-inventory.test.ts).
 */
const src = readFileSync(join(import.meta.dirname, '..', 'src', 'game', 'scenes', 'TowerScene.ts'), 'utf8');

describe('экран Башни (TowerScene)', () => {
  it('без строк-инструкций и постоянного блока правил', () => {
    expect(src).not.toMatch(/Нажмите|нажмите|Коснитесь|коснитесь|, чтобы /);
    expect(src).not.toMatch(/'Как устроен забег', FS/);
    // Правила — «i» в полосе состояния и лист снизу.
    expect(src).toMatch(/infoButton\(this,[^\n]*this\.rulesSheet\(\)\)\.setName\('towerInfo'\)/);
    expect(src).toMatch(/bottomSheet\(this, 'Как устроен забег'/);
  });

  it('главная кнопка — cta (золото без ui_btn_primary), остальное вторичное', () => {
    expect(src).not.toMatch(/ui_btn_primary/);
    expect(src).toMatch(/cta\(this, [^\n]*'Начать забег'/);
    expect(src).toMatch(/'Улучшения'[^\n]*variant: 'secondary'/);
    expect(src).toMatch(/'Сдаться'[^\n]*variant: 'secondary'/);
  });

  it('карты и улучшения — листы снизу, состояние забега — чипы', () => {
    expect(src).toMatch(/bottomSheet\(\s*this,\s*'Улучшения Башни'/);
    expect(src).toMatch(/bottomSheet\(this, 'Карты забега'/);
    expect(src).toMatch(/icon: 'red_potion'[^\n]*name: 'towerHp'/);
    expect(src).toMatch(/name: 'towerCards', onTap/);
  });

  it('фон — поле боя этажа; мощь против врагов — powerCompare', () => {
    expect(src).toMatch(/setThemeBackground\(bg, 'battle', themeOfTowerFloor/);
    expect(src).toMatch(/powerCompare\(this/);
  });

  it('имена и подписи для e2e на месте', () => {
    for (const n of ['towerStart', 'towerGo', 'towerGiveUp', 'towerPath${i}', 'towerCard${i}', 'towerEventOpt${i}', 'towerNoHealer', 'towerSummaryOk', 'towerSummaryWhy'])
      expect(src).toContain(n);
    // e2e.mjs: «Бой · этаж 2» (подпись главной кнопки), «Неизвестная встреча», «Войти».
    expect(src).toMatch(/`\$\{NODE_NAMES\[kind\]\} · этаж \$\{next\}`/);
    expect(src).toContain("'Неизвестная встреча'");
    expect(src).toContain("'Войти'");
  });
});
