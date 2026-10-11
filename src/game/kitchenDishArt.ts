import type { DishArt } from '../core';

/**
 * Пиксельные картинки блюд Кухни (docs/design/kitchen.md, «Картинки блюд»): блюдо собирается из родных иконок продуктов RO
 * (assets/ui/icons/item_food_*.png, 24×24) и нарисованной по пикселям основы — тарелки, миски, стакана, пирога или
 * котелка — на холсте DISH_PX × DISH_PX. Новых файлов арта нет. Модуль без Phaser и DOM (проверяется в тестах);
 * текстуру из пикселей делает kitchenEntry.ts (dishIcon).
 */

/** Сторона холста блюда в пикселях RO. */
export const DISH_PX = 32;

/** Пиксели RGBA (как ImageData). */
export interface Pixels {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

type RGBA = readonly [number, number, number, number];

const hex = (h: string, a = 255): RGBA => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];

/** Палитра основ: тёмный контур как у иконок RO, тёплый фарфор, дерево, корочка, чугун. */
const P = {
  outline: hex('#1e1a22'),
  plate: hex('#ece6db'),
  plateLight: hex('#fbf8f2'),
  plateWell: hex('#d6cfc2'),
  plateShade: hex('#b3a999'),
  wood: hex('#a8703f'),
  woodLight: hex('#c8925a'),
  woodShade: hex('#7a4c27'),
  porridge: hex('#f4ecd6'),
  porridgeShade: hex('#ddd0b0'),
  glass: hex('#d6e8f2', 235),
  glassAir: hex('#eef6fb', 70),
  glassRim: hex('#f6fcff'),
  glassBase: hex('#b4cbd8'),
  shine: hex('#ffffff', 200),
  crust: hex('#e2a54c'),
  crustLight: hex('#f6cf7a'),
  crustDark: hex('#b5732c'),
  crustSide: hex('#9b5f25'),
  honey: hex('#f0a526'),
  honeyLight: hex('#ffd76a'),
  honeyDark: hex('#c47812'),
  iron: hex('#4d4954'),
  ironLight: hex('#77727f'),
  ironShade: hex('#34313a'),
  stew: hex('#c4652f'),
  steam: hex('#f2f6fa', 170),
  steamFaint: hex('#dfe8ef', 120),
};

/** Цвет напитка по главному продукту стакана (нет в таблице — яблочный). */
const LIQUID: Record<string, readonly [RGBA, RGBA]> = {
  apple: [hex('#f2c445'), hex('#d99a22')],
  carrot: [hex('#f2862a'), hex('#c95f14')],
  milk: [hex('#f7f4ec'), hex('#d9d3c6')],
  honey: [hex('#e9a52a'), hex('#bb7414')],
  meat: [hex('#b45a2c'), hex('#86401c')],
};

/** Тёплый оттенок прожарки (умножение), белые пиксели — кость, блик — не трогаем. */
const ROAST: readonly [number, number, number] = [0.86, 0.6, 0.4];

class Layer {
  readonly data = new Uint8ClampedArray(DISH_PX * DISH_PX * 4);
  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < DISH_PX && y < DISH_PX;
  }
  alpha(x: number, y: number): number {
    return this.inside(x, y) ? this.data[(y * DISH_PX + x) * 4 + 3] : 0;
  }
  set(x: number, y: number, c: RGBA): void {
    if (!this.inside(x, y)) return;
    this.data.set(c, (y * DISH_PX + x) * 4);
  }
  /** Наложить пиксель поверх (альфа «source over»). */
  over(x: number, y: number, c: RGBA): void {
    if (!this.inside(x, y) || c[3] === 0) return;
    const i = (y * DISH_PX + x) * 4;
    const sa = c[3] / 255;
    const da = this.data[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    for (let k = 0; k < 3; k++) this.data[i + k] = Math.round((c[k] * sa + this.data[i + k] * da * (1 - sa)) / oa);
    this.data[i + 3] = Math.round(oa * 255);
  }
  /** Наложить слой целиком. */
  draw(src: Layer): this {
    for (let y = 0; y < DISH_PX; y++)
      for (let x = 0; x < DISH_PX; x++) {
        const i = (y * DISH_PX + x) * 4;
        if (src.data[i + 3]) this.over(x, y, [src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3]]);
      }
    return this;
  }
  /** Контур в 1 пиксель вокруг непрозрачного (по 4 соседям) — как у иконок RO. */
  outline(c: RGBA = P.outline): this {
    const solid = (x: number, y: number) => this.alpha(x, y) >= 128;
    const edge: [number, number][] = [];
    for (let y = 0; y < DISH_PX; y++)
      for (let x = 0; x < DISH_PX; x++) if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) edge.push([x, y]);
    for (const [x, y] of edge) this.set(x, y, c);
    return this;
  }
}

/** Залить эллипс (центры пикселей внутри); color(nx, ny) — цвет по нормированным координатам (−1…1), null — пропуск. */
function ellipse(l: Layer, cx: number, cy: number, rx: number, ry: number, color: (nx: number, ny: number, x: number, y: number) => RGBA | null): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      if (nx * nx + ny * ny > 1) continue;
      const c = color(nx, ny, x, y);
      if (c) l.set(x, y, c);
    }
}

/** Габариты непрозрачного в иконке: [x0, y0, x1, y1] включительно; пустая — null. */
export function opaqueBox(p: Pixels): [number, number, number, number] | null {
  let x0 = p.w;
  let y0 = p.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++)
      if (p.data[(y * p.w + x) * 4 + 3] > 0) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

/**
 * Иконка продукта на слое: точка привязки (ax, ay) — доля габарита (0…1) непрозрачной части, (px, py) — куда её поставить.
 * roast — тёплый оттенок прожарки.
 */
function icon(p: Pixels | undefined, ax: number, ay: number, px: number, py: number, roast = false): Layer {
  const l = new Layer();
  const box = p && opaqueBox(p);
  if (!p || !box) return l;
  const dx = Math.round(px - (box[0] + ax * (box[2] - box[0] + 1)));
  const dy = Math.round(py - (box[1] + ay * (box[3] - box[1] + 1)));
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4;
      const a = p.data[i + 3];
      if (!a) continue;
      let r = p.data[i];
      let g = p.data[i + 1];
      let b = p.data[i + 2];
      if (roast) {
        const hi = Math.max(r, g, b);
        const lo = Math.min(r, g, b);
        const bone = hi > 200 && hi - lo < 40;
        const dark = hi < 60;
        if (!bone && !dark) [r, g, b] = [r * ROAST[0], g * ROAST[1], b * ROAST[2]].map(Math.round) as [number, number, number];
      }
      l.set(x + dx, y + dy, [r, g, b, a]);
    }
  return l;
}

const wide = (p: Pixels | undefined) => {
  const b = p && opaqueBox(p);
  return b ? b[2] - b[0] + 1 : 0;
};

function plate(cx: number, cy: number, rx: number, ry: number): Layer {
  const l = new Layer();
  ellipse(l, cx, cy, rx, ry, (nx, ny) => {
    const wx = nx / 0.66;
    const wy = (ny + 0.12) / 0.56;
    if (wx * wx + wy * wy <= 1) return ny > 0.2 ? P.plate : P.plateWell;
    if (ny > 0.4) return P.plateShade;
    if (ny < -0.45) return P.plateLight;
    return P.plate;
  });
  return l.outline();
}

function glass(cx: number, top: number, bottom: number, liquid: readonly [RGBA, RGBA]): Layer {
  const l = new Layer();
  const fill = top + Math.round((bottom - top) * 0.28);
  for (let y = top; y <= bottom; y++) {
    const t = (y - top) / (bottom - top);
    const hw = Math.round(5.6 - 1.2 * t);
    for (let x = cx - hw; x <= cx + hw; x++) {
      const wall = x === cx - hw || x === cx + hw;
      let c: RGBA;
      if (y === top) c = P.glassRim;
      else if (y >= bottom - 1) c = P.glassBase;
      else if (wall) c = P.glass;
      else if (y < fill) c = P.glassAir;
      else if (y === fill) c = liquid[0].map((v, k) => (k < 3 ? Math.min(255, v + 24) : v)) as unknown as RGBA;
      else c = x >= cx + hw - 2 ? liquid[1] : liquid[0];
      l.set(x, y, c);
    }
  }
  // Блик стекла слева.
  for (let y = top + 2; y <= bottom - 4; y++) if (y % 6 !== 0) l.over(cx - Math.round(5.6 - 1.2 * ((y - top) / (bottom - top))) + 1, y, P.shine);
  return l.outline();
}

function bowl(cx: number, cy: number): Layer {
  const l = new Layer();
  // Тело миски — нижняя половина эллипса, ножка, край и каша.
  ellipse(l, cx, cy, 12, 9, (nx, ny) => (ny < 0 ? null : ny > 0.62 ? P.woodShade : nx < -0.55 ? P.woodLight : P.wood));
  for (let x = cx - 4; x <= cx + 3; x++) l.set(x, cy + 9, P.woodShade);
  ellipse(l, cx, cy, 12, 3, (_nx, ny) => (ny < -0.2 ? P.woodLight : P.wood));
  ellipse(l, cx, cy, 10, 2.2, (nx, ny) => (ny > 0.25 || nx > 0.6 ? P.porridgeShade : P.porridge));
  return l.outline();
}

function pie(cx: number, cy: number): Layer {
  const l = new Layer();
  ellipse(l, cx, cy, 11, 6.5, (nx, ny, x, y) => {
    if (ny > 0.55) return P.crustSide;
    const lattice = ny < 0.4 && ((x + y) % 4 === 0 || (x - y + 64) % 4 === 0);
    if (lattice) return P.crustDark;
    return ny < -0.45 || nx < -0.6 ? P.crustLight : P.crust;
  });
  // Медовая глазурь сверху и две капли по боку.
  ellipse(l, cx + 1, cy - 2, 5.5, 2.2, (nx, ny) => (ny < -0.3 && nx < 0.2 ? P.honeyLight : P.honey));
  for (const [dx, len] of [[-2, 4], [3, 3]] as const) for (let i = 0; i < len; i++) l.set(cx + 1 + dx, cy + i, i === len - 1 ? P.honeyDark : P.honey);
  return l.outline();
}

function pot(cx: number, cy: number): Layer {
  const l = new Layer();
  ellipse(l, cx, cy + 2, 11, 8, (nx, ny) => (ny < -0.6 ? null : ny > 0.55 ? P.ironShade : nx < -0.5 ? P.ironLight : P.iron));
  for (const s of [-1, 1]) for (let y = cy - 2; y <= cy + 1; y++) l.set(cx + s * 12, y, P.iron);
  ellipse(l, cx, cy - 3, 12, 2.6, (_nx, ny) => (ny < -0.1 ? P.ironLight : P.iron));
  ellipse(l, cx, cy - 3, 10, 1.7, () => P.stew);
  return l.outline();
}

/** Пар над блюдом: две волнистые струйки (x — середина, y — низ). */
function steam(l: Layer, x: number, y: number): void {
  const wave = [0, 0, 1, 1, 0, 0, -1];
  for (const [dx, len] of [[-3, 6], [3, 5]] as const)
    for (let i = 0; i < len; i++) l.over(x + dx + wave[(i + (dx > 0 ? 2 : 0)) % wave.length], y - i, i < 2 ? P.steam : P.steamFaint);
}

/**
 * Собрать блюдо: RGBA DISH_PX × DISH_PX. icons — пиксели иконок продуктов по id продукта (нет иконки — продукт не рисуется,
 * основа остаётся). Детерминировано: те же входы — те же пиксели.
 */
export function composeDish(art: DishArt, icons: Readonly<Record<string, Pixels | undefined>>): Uint8ClampedArray {
  const out = new Layer();
  const [main, second, third] = art.items.map((id) => icons[id]);
  const C = DISH_PX / 2;
  let steamAt: [number, number] | null = null;
  switch (art.base) {
    case 'plate': {
      // Главный — в центре (с соседями — правее), второй — сзади слева, третий — спереди слева: кость окорока справа видна.
      if (second) out.draw(icon(second, 0.5, 1, C - 8, 23));
      out.draw(plate(C, 25, 14.5, 4.8));
      out.draw(icon(main, 0.5, 1, second || third ? C + 4 : C, 27, art.cooked));
      if (third) out.draw(icon(third, 0.5, 1, C - 6, 30));
      steamAt = [C, 9];
      break;
    }
    case 'glass': {
      // Широкий продукт (морковь) — за стаканом, узкий (яблоко) — перед ним справа.
      const behind = wide(main) > 16;
      if (main && behind) out.draw(icon(main, 1, 0, DISH_PX - 1, 4));
      out.draw(glass(C - 4, 7, 29, LIQUID[art.items[0]] ?? LIQUID.apple));
      if (main && !behind) out.draw(icon(main, 1, 1, DISH_PX - 1, DISH_PX - 1));
      if (second) out.draw(icon(second, 0, 1, 0, DISH_PX - 1));
      steamAt = [C - 4, 5];
      break;
    }
    case 'bowl': {
      if (main) out.draw(icon(main, 0, 1, 1, 22));
      out.draw(bowl(C + 3, 20));
      if (second) out.draw(icon(second, 1, 1, DISH_PX - 1, DISH_PX - 1));
      steamAt = [C + 4, 16];
      break;
    }
    case 'pie': {
      if (main) out.draw(icon(main, 1, 1, DISH_PX - 1, 21));
      out.draw(plate(C, 26, 14.5, 4.6));
      out.draw(pie(C - 1, 22));
      if (second) out.draw(icon(second, 0, 1, 0, DISH_PX - 1));
      steamAt = [C - 1, 14];
      break;
    }
    case 'pot': {
      if (main) out.draw(icon(main, 0.5, 0.55, C + 2, 13, art.cooked));
      out.draw(pot(C, 20));
      if (second) out.draw(icon(second, 1, 1, DISH_PX - 1, DISH_PX - 1));
      steamAt = [C, 13];
      break;
    }
  }
  if (art.hot && steamAt) steam(out, steamAt[0], steamAt[1]);
  return out.data;
}
