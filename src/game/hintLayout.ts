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

/** Стрелка указателя на цель с этой стороны (прямоугольник). */
export function arrowRect(target: { x: number; y: number; h: number }, side: HintSide): Rect {
  const g = HINT_GEOM;
  const arrowY = target.y + (side === 'above' ? -1 : 1) * (target.h / 2 + g.arrowGap);
  return { x: target.x - g.arrowW / 2, y: arrowY - g.arrowH / 2, w: g.arrowW, h: g.arrowH };
}

export function overlapArea(a: Rect, b: Rect): number {
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

export interface BandOptions {
  /** Где полосу хотел поставить экран (верхний край). */
  prefer: number;
  /** Что нельзя закрывать: кнопки, подписи, числа (данные). */
  avoid: Rect[];
  /** Полоса экрана, в которой можно встать (верх и низ), и ширина экрана. */
  top: number;
  bottom: number;
  /** Горизонталь полосы (x и ширина). */
  x: number;
  w: number;
  /** Шаг перебора, ед. */
  step?: number;
}

/**
 * Куда поставить плашку высотой h на всю ширину (реплика персонажа firstTips.ts): верхний край, при котором плашка
 * закрывает меньше всего данных и кнопок, а из равных — ближайший к prefer (место экрана хорошее по умолчанию: двигаем,
 * только если оно правда что-то закрывает). Закрыть данные хуже любого сдвига. Возвращает верхний край и площадь.
 */
export function placeBand(h: number, o: BandOptions): { y: number; overlap: number } {
  const step = o.step ?? 20;
  const lo = o.top;
  const hi = Math.max(lo, o.bottom - h);
  const clamp = (v: number) => Math.min(Math.max(v, lo), hi);
  const cands = new Set<number>([clamp(o.prefer)]);
  for (let y = lo; y <= hi; y += step) cands.add(y);
  cands.add(hi);
  // Вплотную к каждой помехе — сверху и снизу (так находятся щели уже шага).
  for (const r of o.avoid) {
    cands.add(clamp(r.y - h - 8));
    cands.add(clamp(r.y + r.h + 8));
  }
  let best = { y: clamp(o.prefer), overlap: Infinity, dist: Infinity };
  for (const y of cands) {
    const rect: Rect = { x: o.x, y, w: o.w, h };
    const overlap = o.avoid.reduce((s, r) => s + overlapArea(rect, r), 0);
    const dist = Math.abs(y - o.prefer);
    if (overlap < best.overlap || (overlap === best.overlap && dist < best.dist)) best = { y, overlap, dist };
  }
  return { y: best.y, overlap: best.overlap };
}

/** Объект сцены — ровно то, что нужно обходу помех (без Phaser: проверяется в тестах заглушками). */
export interface SceneNode {
  name?: string;
  type?: string;
  visible?: boolean;
  text?: string;
  input?: { enabled?: boolean } | null;
  list?: SceneNode[];
  getBounds?: () => { x: number; y: number; width: number; height: number };
}

/** Помехи плашки: элементы управления и подписи-данные (числа, названия) — отдельно, их закрыть по-разному плохо. */
export interface Obstacles {
  controls: Rect[];
  texts: Rect[];
}

/**
 * Что плашка подсказки не должна закрывать (как obstacleRects() реплик firstTips.ts): интерактивные объекты и видимые
 * подписи сцены. Не помеха: сама цель (контрол под точкой цели, подписи на прямоугольнике цели), слой подсказки
 * ('hint', skipNames), затемнения и подложки во весь экран. Подписи внутри контрола не обходятся отдельно — их
 * закрывает прямоугольник контрола.
 */
export function sceneObstacles(
  list: readonly SceneNode[],
  target: { x: number; y: number; w: number; h: number },
  screen: { w: number; h: number },
  skipNames: readonly string[] = ['hint'],
): Obstacles {
  const controls: Rect[] = [];
  const texts: Rect[] = [];
  const tgt: Rect = { x: target.x - target.w / 2, y: target.y - target.h / 2, w: target.w, h: target.h };
  const inside = (r: Rect) => target.x >= r.x && target.x <= r.x + r.w && target.y >= r.y && target.y <= r.y + r.h;
  const walk = (nodes: readonly SceneNode[], textsToo: boolean) => {
    for (const o of nodes) {
      if (o.visible === false || (o.name && skipNames.includes(o.name))) continue;
      const isControl = !!o.input?.enabled;
      const b = o.getBounds?.();
      const r: Rect | null = b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
      if (isControl && r && r.w > 0 && r.h > 0 && !(r.w >= screen.w * 0.9 && r.h >= screen.h * 0.9) && !inside(r)) controls.push(r);
      else if (textsToo && !isControl && o.type === 'Text' && o.text?.trim() && r && r.w > 0 && r.h > 0) {
        if (r.w * r.h < screen.w * screen.h * 0.5 && overlapArea(r, tgt) === 0) texts.push(r);
      }
      // Внутрь контрола — только за вложенными контролами (его подписи закрыты им самим).
      if (o.list) walk(o.list, textsToo && !isControl);
    }
  };
  walk(list, true);
  return { controls, texts };
}
