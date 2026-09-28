/**
 * Походка бойца по показанной позиции («лунная походка», T3). Ядро шлёт шаги (walk/dash), сцена тянет к ним позицию,
 * а разведение (battleSpread) добавляет сглаженное смещение. Поэтому ходьбу и разворот решаем по реальной скорости
 * фигуры на экране, а не по флагу твина: шаг, который разведение гасит, — не ходьба; сдвиг разведением без своего
 * шага — не шаг (стойка, лицом к врагу); свой шаг назад — лицом по ходу, а не спиной вперёд. Без Phaser и выделений.
 */

/** Ходьба включается выше START и гаснет ниже STOP (px на мс боя; шаг ядра — 0,32): гистерезис без дрожания. */
export const GAIT_START = 0.09;
export const GAIT_STOP = 0.045;
/** Разворот по ходу — только если горизонтальная скорость выше этой (почти вертикальный шаг — лицом к врагу). */
export const GAIT_TURN = 0.06;
/** Постоянная времени сглаживания скорости, мс боя. */
export const GAIT_SMOOTH_MS = 70;

export interface GaitState {
  lastX: number;
  lastY: number;
  /** Сглаженная скорость показанной фигуры, px/мс боя. */
  vx: number;
  vy: number;
  /** Идёт ходьбой (для анимации walk). */
  walking: boolean;
}

/**
 * Шаг походки: x, y — показанная позиция в этом кадре, dt — мс боя, move — вид своего шага ядра (null — стоит).
 * Возвращает, куда смотреть по ходу: 1/-1, 0 — движется без явного направления по x, null — стоит (лицом к врагу).
 */
export function gaitStep(g: GaitState, x: number, y: number, dt: number, move: 'walk' | 'dash' | null): 1 | -1 | 0 | null {
  if (dt > 0) {
    const k = 1 - Math.exp(-dt / GAIT_SMOOTH_MS);
    g.vx += ((x - g.lastX) / dt - g.vx) * k;
    g.vy += ((y - g.lastY) / dt - g.vy) * k;
  }
  g.lastX = x;
  g.lastY = y;
  const moving = move !== null && Math.hypot(g.vx, g.vy) > (g.walking ? GAIT_STOP : GAIT_START);
  g.walking = moving && move === 'walk';
  if (!moving) return null;
  return Math.abs(g.vx) > GAIT_TURN ? (g.vx > 0 ? 1 : -1) : 0;
}

/** Сбросить скорость (после «Пропустить» — фигуры встали в конечные точки скачком). */
export function gaitReset(g: GaitState, x: number, y: number): void {
  g.lastX = x;
  g.lastY = y;
  g.vx = 0;
  g.vy = 0;
  g.walking = false;
}
