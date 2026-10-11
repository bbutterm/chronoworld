/**
 * Подготовка к бою (экран этапа и «Отряд»): чистые помощники без Phaser — куда встаёт герой по нажатию,
 * перенос и обмен слотов, геометрия поля «как в бою» и попадание пальца в слот. Тестируются в tests/game-prep.test.ts.
 */
import { assignSlot } from './flow';
import { S, TOUCH_COMFORT } from './theme';

/** Полосы под полем учитывают всю цель нажатия, включая невидимые края маленьких кнопок. */
export function formationBodyRows(fieldBottom: number, withThreat = false) {
  const warningY = fieldBottom + S.xs + TOUCH_COMFORT / 2;
  const next = warningY + TOUCH_COMFORT + S.m;
  const rosterHeadY = next + (withThreat ? TOUCH_COMFORT + S.m : 0);
  return {
    warningY,
    threat: { titleY: next - 18, adviceY: next + 26, zoneY: next, zoneH: 88 },
    rosterHeadY,
    rosterTop: rosterHeadY + TOUCH_COMFORT / 2 + 14,
  };
}

export type Squad = (string | null)[];

/**
 * Ранг расстановки (formationRank из ядра): 0 — танк, 1 — ближний бой, 2 — дальний бой, 3 — лекарь.
 * Порядок слотов, куда герой встаёт по нажатию: «передние» — с фронта (0, 1, затем тыл), «задние» — с конца
 * тыла (4, 3, 2, затем фронт) — так же, как расставляет arrangeSquad.
 */
export function slotOrder(rank: number): number[] {
  return rank <= 1 ? [0, 1, 2, 3, 4] : [4, 3, 2, 1, 0];
}

/** Лучший свободный слот для героя этого ранга; -1 — отряд полон. */
export function bestFreeSlot(squad: readonly (string | null)[], rank: number): number {
  return slotOrder(rank).find((i) => i < squad.length && squad[i] === null) ?? -1;
}

/** Сколько героев в отряде. */
export const squadCount = (squad: readonly (string | null)[]): number => squad.filter(Boolean).length;

/**
 * Итог перетаскивания/нажатия. squad — новый отряд (null — ничего не меняется), reason — почему нельзя.
 */
export interface SquadMove {
  squad: Squad | null;
  reason?: 'full' | 'last' | 'same';
}

/** Нажатие на карточку героя в списке: в отряде — убрать (последнего нельзя), нет — в выбранный или лучший свободный слот. */
export function tapHero(squad: readonly (string | null)[], heroId: string, rank: number, selected: number | null = null): SquadMove {
  const at = squad.indexOf(heroId);
  if (at >= 0) return removeAt(squad, at);
  const slot = selected !== null && selected >= 0 && selected < squad.length ? selected : bestFreeSlot(squad, rank);
  if (slot < 0) return { squad: null, reason: 'full' };
  return { squad: assignSlot([...squad], slot, heroId) };
}

/** Убрать героя из слота. В отряде должен остаться хотя бы один герой. */
export function removeAt(squad: readonly (string | null)[], slot: number): SquadMove {
  if (!squad[slot]) return { squad: null };
  if (squadCount(squad) <= 1) return { squad: null, reason: 'last' };
  return { squad: assignSlot([...squad], slot, null) };
}

/** Герой из списка брошен на слот: встаёт туда; стоявший там уходит на прежнее место героя (или из отряда). */
export function dropHero(squad: readonly (string | null)[], heroId: string, slot: number): SquadMove {
  if (squad[slot] === heroId) return { squad: null, reason: 'same' };
  return { squad: assignSlot([...squad], slot, heroId) };
}

/** Герой перетащен из слота from в слот to: обмен местами (в пустой слот — просто перенос). */
export function swapSlots(squad: readonly (string | null)[], from: number, to: number): SquadMove {
  if (from === to) return { squad: null, reason: 'same' };
  const next = [...squad];
  [next[from], next[to]] = [next[to], next[from]];
  return { squad: next };
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Центры 5 слотов на поле подготовки — как стоят герои в бою (combat.json field.slotsA: фронт ближе к врагу,
 * тыл дальше), вписанные по высоте в полосу [top, bottom] с учётом высоты слота slotH.
 * x: фронт — frontX, тыл — backX (на экране подготовки колонки ближе друг к другу, чем в бою).
 */
export function fieldSlots(
  slotsA: readonly (readonly [number, number] | readonly number[])[],
  band: { top: number; bottom: number },
  xs: { front: number; back: number },
  slotH: number,
): Point[] {
  const ys = slotsA.map((p) => p[1]);
  const xsA = slotsA.map((p) => p[0]);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const frontX = Math.max(...xsA);
  const span = maxY - minY || 1;
  const k = Math.max(0, band.bottom - band.top - slotH) / span;
  const mid = (band.top + band.bottom) / 2;
  const midA = (minY + maxY) / 2;
  return slotsA.map(([x, y]) => ({ x: x === frontX ? xs.front : xs.back, y: mid + (y - midA) * k }));
}

/**
 * В какой слот попадает точка (палец при перетаскивании): внутри прямоугольника слота, расширенного на pad
 * («прилипание»); если таких несколько — ближайший по центру. -1 — мимо.
 */
export function hitSlot(slots: readonly Point[], w: number, h: number, p: Point, pad = 0): number {
  let best = -1;
  let bestD = Infinity;
  slots.forEach((s, i) => {
    if (Math.abs(p.x - s.x) > w / 2 + pad || Math.abs(p.y - s.y) > h / 2 + pad) return;
    const d = (p.x - s.x) ** 2 + (p.y - s.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Порядок героев в списке: по мощи ↓, при равной — по id ↑ (стабильно между перерисовками). */
/**
 * Список героев для отряда — по одной плитке на героя (скриншот владельца 11.10: копии стояли рядом, а две копии
 * одного героя в отряд не встают): копия из отряда, иначе сильнейшая. Копии — для вознесения на экране «Герои».
 */
export function rosterOneEach<T extends { id: string; templateId: string }>(heroes: readonly T[], squad: readonly (string | null)[], power: (h: T) => number): T[] {
  const inSquad = new Set(squad.filter((id): id is string => !!id));
  const best = new Map<string, T>();
  for (const h of heroes) {
    const cur = best.get(h.templateId);
    const better = !cur || (inSquad.has(h.id) && !inSquad.has(cur.id)) || (inSquad.has(h.id) === inSquad.has(cur.id) && (power(h) > power(cur) || (power(h) === power(cur) && h.id < cur.id)));
    if (better) best.set(h.templateId, h);
  }
  return heroes.filter((h) => best.get(h.templateId) === h);
}

export function rosterOrder<T extends { id: string }>(heroes: readonly T[], power: (h: T) => number): T[] {
  const p = new Map(heroes.map((h) => [h.id, power(h)]));
  return [...heroes].sort((a, b) => p.get(b.id)! - p.get(a.id)! || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Жест в списке героев: ещё не ясно (pending), тянем героя (drag) или листаем список (scroll).
 * Героя берём, если палец ушёл вбок, вверх из списка, удержан на месте или список не прокручивается.
 */
export function classifyGesture(
  d: { dx: number; dy: number; heldMs: number },
  opts: { scrollable: boolean; threshold?: number; holdMs?: number; leftList?: boolean },
): 'pending' | 'drag' | 'scroll' {
  const th = opts.threshold ?? 16;
  const dist = Math.hypot(d.dx, d.dy);
  if (dist < th) return d.heldMs >= (opts.holdMs ?? 220) ? 'drag' : 'pending';
  if (!opts.scrollable || opts.leftList) return 'drag';
  return Math.abs(d.dx) > Math.abs(d.dy) ? 'drag' : 'scroll';
}

/**
 * Итерация 4: размеры редактора отряда (squadEditor.ts). slotH — высота слота поля; headH — ряд мощи над слотами;
 * cols/gap/margin — сетка героев (5 плиток в ряд на ширину поля 1080 с полями margin), cardH — высота плитки.
 */
export const PREP = { slotH: 184, headH: 100, cols: 5, gap: 16, margin: 48, cardH: 212 } as const;

/** Ширина плитки сетки героев: cols плиток с зазором gap на ширину width − 2·margin. */
export function rosterCardW(width: number, cols: number = PREP.cols, gap: number = PREP.gap, margin: number = PREP.margin): number {
  return Math.floor((width - 2 * margin - (cols - 1) * gap) / cols);
}

/** Полоса слотов на поле [top, bottom]: под рядом мощи, с отступом снизу. */
export function slotBand(field: { top: number; bottom: number }, headH: number = PREP.headH): { top: number; bottom: number } {
  return { top: field.top + headH, bottom: field.bottom - 14 };
}

/** Наименьший зазор по вертикали между слотами одной колонки (отрицательный — слоты налезают друг на друга). */
export function minSlotGap(slots: readonly Point[], slotH: number): number {
  let gap = Infinity;
  slots.forEach((a, i) =>
    slots.forEach((b, j) => {
      if (j <= i || Math.abs(a.x - b.x) > 1) return;
      gap = Math.min(gap, Math.abs(a.y - b.y) - slotH);
    }),
  );
  return gap;
}
