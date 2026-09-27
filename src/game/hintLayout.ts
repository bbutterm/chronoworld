/**
 * S. Где поставить плашку подсказки: над целью или под ней и насколько сдвинуть вбок, чтобы не закрыть
 * другие элементы управления. Чистая функция без Phaser (проверяет tests/game-hints.test.ts),
 * рисует по её ответу hintPointer() в ui.ts.
 */

/** Прямоугольник: левый верхний угол и размер. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type HintSide = 'above' | 'below';

/** Геометрия указателя (игровые единицы). */
export const HINT_GEOM = {
  /** От края цели до центра стрелки. */
  arrowGap: 36,
  /** Размер стрелки. */
  arrowW: 64,
  arrowH: 46,
  /** От центра стрелки до края плашки. */
  boxGap: 28,
  /** Поле от края экрана и зазор до соседнего элемента при сдвиге вбок. */
  margin: 30,
  gap: 12,
} as const;

export interface CalloutPlan {
  side: HintSide;
  /** Центр стрелки. */
  arrowY: number;
  /** Плашка (левый верхний угол и размер). */
  box: Rect;
  /** Сколько площади элементов управления закрыто (0 — ничего). */
  overlap: number;
}

export interface PlaceOptions {
  /** Предпочтительная сторона — при равном результате. */
  prefer?: HintSide;
  /** Что нельзя закрывать (кнопки, плитки, вкладки). Саму цель сюда не класть. */
  avoid: Rect[];
  /** Полоса экрана, в которой должна остаться плашка, и ширина экрана. */
  top: number;
  bottom: number;
  width: number;
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Выбрать сторону и сдвиг плашки. target — центр и размер цели, box — размер плашки.
 * Перебираем «над»/«под» и несколько сдвигов вбок (по центру цели и вплотную к каждой мешающей кнопке);
 * плашка всегда накрывает стрелку по горизонтали. Побеждает вариант, который закрывает меньше всего
 * (выход за полосу экрана — хуже любого перекрытия); при равенстве — предпочтительная сторона и меньший сдвиг.
 */
export function placeCallout(target: { x: number; y: number; w: number; h: number }, box: { w: number; h: number }, o: PlaceOptions): CalloutPlan {
  const g = HINT_GEOM;
  const bw = Math.min(box.w, o.width - 2 * g.margin);
  const clampX = (cx: number) => Math.min(Math.max(cx, bw / 2 + g.margin), o.width - bw / 2 - g.margin);
  // Плашка должна касаться стрелки: центр плашки не дальше (bw - стрелка) / 2 от x цели.
  const reach = Math.max(0, (bw - g.arrowW) / 2);
  const sides: HintSide[] = o.prefer === 'below' ? ['below', 'above'] : ['above', 'below'];
  let best: (CalloutPlan & { rank: number }) | null = null as (CalloutPlan & { rank: number }) | null;
  sides.forEach((side, sideRank) => {
    const dir = side === 'above' ? -1 : 1;
    const arrowY = target.y + dir * (target.h / 2 + g.arrowGap);
    const cy = arrowY + dir * (g.boxGap + box.h / 2);
    const top = cy - box.h / 2;
    const arrow: Rect = { x: target.x - g.arrowW / 2, y: arrowY - g.arrowH / 2, w: g.arrowW, h: g.arrowH };
    const xs = [target.x];
    for (const r of o.avoid) {
      if (r.y + r.h <= top || r.y >= top + box.h) continue;
      xs.push(r.x - g.gap - bw / 2, r.x + r.w + g.gap + bw / 2);
    }
    for (const raw of xs) {
      const cx = clampX(Math.min(Math.max(raw, target.x - reach), target.x + reach));
      const rect: Rect = { x: cx - bw / 2, y: top, w: bw, h: box.h };
      const out = rect.y < o.top || rect.y + rect.h > o.bottom ? 1e12 : 0;
      const overlap = o.avoid.reduce((s, r) => s + overlapArea(rect, r) + overlapArea(arrow, r), 0);
      const score = out + overlap;
      const rank = score * 10 + sideRank * 5 + Math.abs(cx - target.x) / 1e4;
      if (!best || rank < best.rank) best = { side, arrowY, box: rect, overlap: out ? Infinity : overlap, rank };
    }
  });
  const b = best!;
  return { side: b.side, arrowY: b.arrowY, box: b.box, overlap: b.overlap };
}
