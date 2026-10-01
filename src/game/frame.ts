/**
 * Каркас экрана без Phaser (числа и правила для screen.ts) — проверяется в tests/screen-frame.test.ts.
 * Раскладка шапки и навигации — docs/design/ui-polish-research.md §1.1, §5 «Общее».
 */
import { groupDigits } from '../core';
import { GAME_W, HEADER_H } from './layout';
import { S, TOUCH } from './theme';

/** Кнопка «‹» в шапке: видимый диск и цель нажатия (не меньше TOUCH). */
export const BACK = { x: S.l + 36, size: 84, hit: Math.max(TOUCH, 120) } as const;
/** Шестерёнка настроек — того же вида, что «‹». */
export const GEAR = { size: 84, hit: Math.max(TOUCH, 112) } as const;
/** Высота «таблетки» валюты и её иконка. */
export const PILL = { h: 60, icon: 58, gap: S.xs } as const;

/** Левый край названия экрана: после «‹» или от поля экрана (корневые вкладки без «‹»). */
export function titleLeft(hasBack: boolean): number {
  return hasBack ? BACK.x + BACK.size / 2 + S.s : S.l;
}

/** Центр шапки по высоте. */
export const HEADER_CY = HEADER_H / 2;

/** Значки: точка (без числа) и число (высота «таблетки»; шире — по тексту). */
export const BADGE = { dot: 24, num: 44 } as const;

/**
 * Число в «таблетке» валюты: до 100 000 — полностью (разряды неразрывным пробелом), дальше — коротко, как в AFK Arena:
 * 874K, 8.7M, 87M, 1.2B. Округление вниз: на «таблетке» никогда не видно больше, чем есть. Точное — по нажатию.
 */
export function compactNumber(n: number): string {
  const v = Math.max(0, Math.floor(n));
  if (v < 100_000) return groupDigits(v);
  const fmt = (x: number, unit: string) => {
    const s = x < 10 ? (Math.floor(x * 10) / 10).toFixed(1).replace(/\.0$/, '') : String(Math.floor(x));
    return s + unit;
  };
  if (v < 1_000_000) return fmt(v / 1000, 'K');
  if (v < 1_000_000_000) return fmt(v / 1_000_000, 'M');
  return fmt(v / 1_000_000_000, 'B');
}

/** Обратное к groupDigits: «12 345» → 12345 (счётчик juice.ts пишет полное число — «таблетка» сокращает его сама). */
export function parseGrouped(s: string): number | null {
  const digits = s.replace(/[\s  ]/g, '');
  return /^\d+$/.test(digits) ? Number(digits) : null;
}

/**
 * Сравнение мощи с нужной (правило 11, §3): хватает — ничего не пишем (спокойная зелёная галка), не хватает —
 * «Не хватает N» красным. need ≤ 0 — требования нет.
 */
export function powerShortfall(own: number, need: number): { short: number; label: string | null } {
  const short = Math.max(0, Math.ceil(need - own));
  return { short, label: short > 0 ? `Не хватает ${groupDigits(short)}` : null };
}

/** Подпись числового значка: больше 9 — «9+» (ui-polish-research §2.4). */
export function badgeLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > 9 ? '9+' : String(Math.floor(count));
}

/** Ширина вкладки нижней навигации и её центр. */
export function navTabCenter(i: number, tabs: number): number {
  return (GAME_W / tabs) * (i + 0.5);
}
