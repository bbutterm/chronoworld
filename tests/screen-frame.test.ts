import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BACK, BADGE, badgeLabel, compactNumber, GEAR, navTabCenter, parseGrouped, PILL, powerShortfall, titleLeft } from '../src/game/frame';
import { GAME_W, HEADER_H } from '../src/game/layout';
import { S, TOUCH } from '../src/game/theme';

const SRC = readFileSync(join(import.meta.dirname, '..', 'src', 'game', 'screen.ts'), 'utf8');

describe('каркас экрана: числа (frame.ts)', () => {
  it('валюта коротко: до 100 000 полностью, дальше K/M/B с округлением вниз', () => {
    expect(compactNumber(0)).toBe('0');
    expect(compactNumber(12)).toBe('12');
    expect(compactNumber(34617)).toBe('34 617');
    expect(compactNumber(99_999)).toBe('99 999');
    expect(compactNumber(100_000)).toBe('100K');
    expect(compactNumber(874_999)).toBe('874K');
    expect(compactNumber(1_000_000)).toBe('1M');
    expect(compactNumber(8_707_826)).toBe('8.7M');
    expect(compactNumber(8_799_999)).toBe('8.7M');
    expect(compactNumber(87_070_000)).toBe('87M');
    expect(compactNumber(1_250_000_000)).toBe('1.2B');
    expect(compactNumber(-5)).toBe('0');
    expect(compactNumber(12.9)).toBe('12');
  });

  it('счётчик награды пишет полное число — «таблетка» читает его обратно', () => {
    expect(parseGrouped('8 707 826')).toBe(8_707_826);
    expect(parseGrouped('12 345')).toBe(12345);
    expect(parseGrouped('874K')).toBeNull();
    expect(parseGrouped('')).toBeNull();
    for (const n of [0, 7, 99_999, 100_000, 8_707_826]) expect(parseGrouped(String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '))).toBe(n);
  });

  it('мощь: хватает — подписи нет; не хватает — «Не хватает N»', () => {
    expect(powerShortfall(1224, 1067)).toEqual({ short: 0, label: null });
    expect(powerShortfall(1000, 1000)).toEqual({ short: 0, label: null });
    expect(powerShortfall(10_000, 12_600)).toEqual({ short: 2600, label: 'Не хватает 2 600' });
    expect(powerShortfall(99.4, 100)).toEqual({ short: 1, label: 'Не хватает 1' });
    expect(powerShortfall(500, 0).label).toBeNull();
  });

  it('значки: точка 24, число 44; «9+» (больше 9 числом не показываем)', () => {
    expect(BADGE).toEqual({ dot: 24, num: 44 });
    expect(badgeLabel(0)).toBeNull();
    expect(badgeLabel(-3)).toBeNull();
    expect(badgeLabel(7)).toBe('7');
    expect(badgeLabel(9)).toBe('9');
    expect(badgeLabel(10)).toBe('9+');
    expect(badgeLabel(100)).toBe('9+');
  });

  it('шапка: «‹» и шестерёнка — цель не меньше TOUCH и в высоту шапки; название правее «‹»', () => {
    expect(BACK.hit).toBeGreaterThanOrEqual(TOUCH);
    expect(GEAR.hit).toBeGreaterThanOrEqual(TOUCH);
    expect(BACK.hit).toBeLessThanOrEqual(HEADER_H);
    expect(BACK.x - BACK.hit / 2).toBeGreaterThanOrEqual(0);
    expect(titleLeft(true)).toBeGreaterThanOrEqual(BACK.x + BACK.size / 2 + S.xs);
    expect(titleLeft(false)).toBe(S.l);
    // Две «таблетки» друг над другом (экран 9:16) помещаются в шапку.
    expect(2 * PILL.h + 8).toBeLessThanOrEqual(HEADER_H - 2 * S.xxs);
  });

  it('вкладки навигации — равные доли ширины', () => {
    expect(navTabCenter(0, 4)).toBe(GAME_W / 8);
    expect(navTabCenter(3, 4)).toBe((GAME_W * 7) / 8);
  });
});

describe('каркас экрана: screen.ts', () => {
  it('Telegram BackButton = «‹» экрана и снимается, когда экран уходит', () => {
    expect(SRC).toMatch(/new ModalBack\(goBack,/);
    expect(SRC).toMatch(/scene\.events\.once\(Phaser\.Scenes\.Events\.SHUTDOWN, \(\) => \{\s*modalBack\.destroy\(\)/);
    // «Назад» не срабатывает дважды: экран уже уходит (затемнение transitions.ts) — ничего не делаем.
    expect(SRC).toMatch(/isLeaving\(scene\)/);
  });

  it('без «‹ Назад» текстом, капса во вкладках и орнамента под шапкой', () => {
    expect(SRC).not.toContain("'‹ Назад'");
    expect(SRC).not.toContain('toUpperCase()');
    expect(SRC).not.toContain("'skin_ornament'");
    expect(SRC).not.toContain("'skin_tab'");
  });

  it('модальные окна на токенах движения: затемнение 0.65, появление M.base E.pop, закрытие M.fast', () => {
    expect(SRC).toMatch(/0x000000, 0\.65\)/);
    expect(SRC).toMatch(/inner\.setScale\(0\.92\)/);
    expect(SRC).toMatch(/scale: 1, alpha: 1, duration: M\.base, ease: E\.pop/);
    expect(SRC).toMatch(/duration: M\.fast, ease: E\.in/);
  });

  it('новые компоненты экспортируются: cta, powerCompare, bottomSheet, dot, popOut', () => {
    for (const name of ['cta', 'powerCompare', 'updatePowerCompare', 'bottomSheet', 'dot', 'popOut', 'closeTopModal']) {
      expect(SRC).toMatch(new RegExp(`export function ${name}\\(`));
    }
  });
});
