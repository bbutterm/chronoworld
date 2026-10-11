/**
 * Разведение бойцов на экране (T2-05, «куча в центре»): ядро боя ставит ближних бойцов вплотную друг к другу
 * (дистанция удара меньше ширины спрайта), и фигуры сливаются в кашу. Здесь — только отображение: к позиции
 * из лога ядра добавляется небольшое смещение, которое расталкивает близких соседей. Ядро, лог и баланс не
 * меняются. Враги расходятся по горизонтали (атакующий встаёт у переднего края цели, а не на неё), союзники —
 * по вертикали (ряды), смещение сглажено, чтобы фигуры не дрожали. Без выделений памяти в кадре.
 */

/** Что нужно от вида юнита. pos — позиция из ядра (её двигают твины шагов), off — показанное смещение. */
export interface SpreadUnit {
  pos: { x: number; y: number };
  offX: number;
  offY: number;
  /** Рабочие поля решателя (цель на этот кадр). */
  sx: number;
  sy: number;
  side: 'A' | 'B';
  /** Добавка к радиусу (крупный босс). */
  extra: number;
  /** Половина ширины тела фигуры в координатах ядра (presentation.body / FIELD_SQUEEZE); нет — только базовый эллипс. */
  halfW?: number;
  /** Участвует в расталкивании (жив и смерть ещё не показана). */
  active: boolean;
}

/** Полуоси «личного эллипса» пары врагов и пары союзников (px поля 1080×1920). */
const FOE_RX = 150;
const FOE_RY = 120;
const ALLY_RX = 130;
const ALLY_RY = 135;
/**
 * Пара шире базового эллипса (ui-core 6: поздние монстры и вторые профессии крупнее): полуось по x — не меньше суммы
 * полуширин тел × BODY_FIT. Тело — объединение стойки, ходьбы и «ранен» с прозрачным запасом, поэтому фигуры только
 * касаются контурами; клинок удара (кадры атаки в тело не входят) по-прежнему заходит на соседа.
 */
const BODY_FIT = 1.05;
/** Потолок полуоси от тел: огромного босса раздвигает separateBattleSprites (battlePresentation.ts), не разведение. */
const BODY_RX_MAX = 260;
/** Доля второстепенной оси в толчке: враги почти не уходят по вертикали, союзники — по горизонтали. */
const MINOR = 0.6;
/**
 * Наибольшее смещение от позиции ядра — фигура остаётся «там же», только не на соседе. Потолок 100 не давал
 * развести больше трёх бойцов, сошедшихся в одну точку (6-1: семь фигур в пятне ~150×150 CSS).
 */
const MAX_OFF_X = 200;
const MAX_OFF_Y = 160;
/** Итераций решателя: при 7–8 фигурах в одной точке шести не хватало, чтобы разойтись. */
const ITERATIONS = 10;
/** Постоянная времени сглаживания, мс боя. */
const SMOOTH_MS = 120;

/** Границы поля для показа (как bounds в combat.json, с запасом под фигуры). */
export interface SpreadBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Посчитать смещения всех юнитов и плавно подвести к ним показанные (dt — мс боя). */
export function spreadUnits(units: readonly SpreadUnit[], dt: number, b: SpreadBounds): void {
  const n = units.length;
  for (let i = 0; i < n; i++) {
    const u = units[i];
    u.sx = u.pos.x;
    u.sy = u.pos.y;
  }
  for (let it = 0; it < ITERATIONS; it++) {
    for (let i = 0; i < n; i++) {
      const a = units[i];
      if (!a.active) continue;
      for (let j = i + 1; j < n; j++) {
        const c = units[j];
        if (!c.active) continue;
        const foe = a.side !== c.side;
        const rx = Math.max(foe ? FOE_RX : ALLY_RX, Math.min(BODY_RX_MAX, ((a.halfW ?? 0) + (c.halfW ?? 0)) * BODY_FIT)) + a.extra + c.extra;
        const ry = (foe ? FOE_RY : ALLY_RY) + (a.extra + c.extra) * 0.5;
        const dx = c.sx - a.sx;
        const dy = c.sy - a.sy;
        const nx = dx / rx;
        const ny = dy / ry;
        const d2 = nx * nx + ny * ny;
        if (d2 >= 1) continue;
        const d = Math.sqrt(d2);
        // Направление толчка (от a к c) в долях полуосей; при совпадении точек — по стороне/порядку.
        let ux: number;
        let uy: number;
        if (foe) {
          ux = Math.abs(dx) > 2 ? Math.sign(dx) : a.side === 'A' ? 1 : -1;
          uy = d > 1e-3 ? (ny / d) * MINOR : 0;
        } else {
          uy = Math.abs(dy) > 2 ? Math.sign(dy) : 1;
          ux = d > 1e-3 ? (nx / d) * MINOR : 0;
        }
        const push = (1 - d) * 0.5;
        const px = ux * push * rx;
        const py = uy * push * ry;
        a.sx -= px;
        a.sy -= py;
        c.sx += px;
        c.sy += py;
      }
    }
  }
  const k = dt > 0 ? 1 - Math.exp(-dt / SMOOTH_MS) : 0;
  for (let i = 0; i < n; i++) {
    const u = units[i];
    if (!u.active) continue;
    const tx = clamp(clamp(u.sx, b.minX, b.maxX) - u.pos.x, -MAX_OFF_X, MAX_OFF_X);
    const ty = clamp(clamp(u.sy, b.minY, b.maxY) - u.pos.y, -MAX_OFF_Y, MAX_OFF_Y);
    u.offX += (tx - u.offX) * k;
    u.offY += (ty - u.offY) * k;
  }
}

/** Сразу поставить смещения в цель (после «Пропустить» — без доплывания). */
export function settleSpread(units: readonly SpreadUnit[], b: SpreadBounds): void {
  spreadUnits(units, 0, b);
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (!u.active) continue;
    u.offX = clamp(clamp(u.sx, b.minX, b.maxX) - u.pos.x, -MAX_OFF_X, MAX_OFF_X);
    u.offY = clamp(clamp(u.sy, b.minY, b.maxY) - u.pos.y, -MAX_OFF_Y, MAX_OFF_Y);
  }
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
