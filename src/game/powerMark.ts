/**
 * Знак после числа мощи в ряду powerCompare (screen.ts). Мощь — ориентир развития характеристик, не прогноз победы
 * (flow.ts recommendedPower): зелёная галка — только с настоящим запасом, без запаса — жёлтая точка, на поражении
 * галки нет вовсе (сигналы «проиграли» и «всё в порядке» не спорят). Правило 11 (§3 docs/content/ui.md): слов
 * «сил хватает» нет, при нехватке — «Не хватает N».
 */

/**
 * Запас над ориентиром, с которого бой показывается зелёной галкой: как вердикт ядра 'easy'
 * (src/core/features/power.ts stagePowerCheck, ratio ≥ 1.1).
 */
export const POWER_MARGIN = 1.1;

/**
 * - ahead — мощь с запасом (или выполненное требование): зелёная галка;
 * - even — от ориентира до запаса (×1–1.1): жёлтая точка без текста, «на равных»;
 * - short — ниже ориентира: «Не хватает N» красным;
 * - plain — только число (экран поражения при мощи не ниже ориентира: дело не в мощи).
 */
export type PowerMark = 'ahead' | 'even' | 'short' | 'plain';

export interface PowerMarkOptions {
  /** Итог проигранного боя: галки нет, при нехватке — по-прежнему «Не хватает N». */
  defeat?: boolean;
  /**
   * need — жёсткий порог, а не ориентир боя (экспедиция уходит при мощи ≥ нужной): галка без запаса.
   */
  requirement?: boolean;
}

export function powerMark(own: number, need: number, opts: PowerMarkOptions = {}): PowerMark {
  // Как powerShortfall (frame.ts): нехватка — от единицы мощи.
  if (Math.ceil(need - own) > 0) return 'short';
  if (opts.defeat) return 'plain';
  if (opts.requirement || own >= need * POWER_MARGIN) return 'ahead';
  return 'even';
}
