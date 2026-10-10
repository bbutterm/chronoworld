import { tr } from './locale';
import type Phaser from 'phaser';
import { addAtlasAliases, blitExtruded, shelfPack } from './packedTexture';
import { R } from './theme';

/**
 * Скин интерфейса «тёмная бронза». Всё рисуется кодом в canvas при загрузке — арт не нужен. Когда придёт нарисованный
 * UI-кит (docs/UI_ART_PROMPT.txt), id из манифеста с файлами победят: SKIN_FOR подменяет только те id, у которых нет
 * своего файла.
 *
 * Материалы (docs/design/ui-polish-research.md, §3 правило 5 и §4.3–4.5) — три поверхности и одна рамка:
 * - `skin_surface` — поверхность e1: заливка ~82 %, без рамки и тени (секции, подложки внутри экрана);
 * - `skin_raised` / `skin_panel` (ui_panel) — поднятая карточка e2: тонкая бронзовая рамка 2.5 ед. и мягкая тень;
 * - `skin_sunken` — утопленное поле/слот: темнее фона, тень сверху, светлая кромка снизу;
 * - `skin_modal` — модалка e3: радиус R.xl, рамка 3 ед. со светлым верхом.
 * `skin_panel_light` (ui_panel_light) — «текущая/готовая» строка, вторичный блок: тёплая поверхность и тонкая кромка.
 * Кнопки: `skin_btn_gold` (главная), `skin_btn` = `skin_btn_secondary` (тёмная с рамкой), `skin_btn_ghost` (без фона,
 * только отклик при нажатии), `skin_btn_active` (выбранный переключатель), `skin_btn_disabled`, `skin_btn_danger`.
 * У каждой кнопки есть `<ключ>_pressed`. Радиусы по ролям — токены R (кнопка/слот R.m, карточка R.l, модалка R.xl).
 */

/** Палитра скина. */
export const SKIN = {
  bg: 0x0d0e0b,
  bar: 0x121310,
  panelTop: '#2b2721',
  panelBottom: '#1a1815',
  bronze: '#5c4b31',
  bronzeLight: '#7a6442',
  gold: '#d6ae63',
  goldLight: '#f0cf8a',
  goldDark: '#8f6a2c',
  cream: '#eadfc6',
  creamDim: '#a89d86',
  forestTop: '#0f1d12',
  forestBottom: '#1f3d26',
} as const;

/** Числовые цвета для tint/заливок. */
export const SKIN_TINT = {
  cream: 0xeadfc6,
  creamDim: 0xa89d86,
  gold: 0xd6ae63,
  bronze: 0x5c4b31,
} as const;

/** Какие id манифеста/атласа рисуем скином (ключ текстуры скина). */
export const SKIN_FOR: Record<string, string> = {
  ui_slot_empty: 'skin_slot_empty',
  ui_panel: 'skin_panel',
  ui_panel_light: 'skin_panel_light',
  ui_slot_filled: 'skin_slot',
  ui_slot_selected: 'skin_slot_selected',
  ui_btn_primary: 'skin_btn_gold',
  ui_btn_secondary: 'skin_btn_secondary',
  ui_btn_speed: 'skin_btn',
  ui_btn_skip: 'skin_btn',
  'k:buttonLong_beige': 'skin_btn',
  'k:buttonLong_grey': 'skin_btn',
  'k:buttonLong_blue': 'skin_btn',
  'k:buttonLong_brown': 'skin_btn_active',
  'k:buttonSquare_beige': 'skin_btn',
  'k:buttonSquare_grey': 'skin_btn',
  'k:buttonSquare_blue': 'skin_btn',
  'k:buttonSquare_brown': 'skin_btn_active',
};

/** Эти id рисуем скином, даже если у них есть файл (старый бежевый арт не подходит к скину). */
export const SKIN_FORCE = new Set(['ui_slot_empty']);

/**
 * Отступ 9-slice у текстур скина (они рисуются в игровых единицах, без масштаба). Угол каждой плитки
 * (поле + радиус + «толщина» кнопки) в него помещается — tests/skin.test.ts; ui.ts panel() уменьшает срез у мелких
 * плиток до половины стороны, поэтому у кнопок и слотов угол маленький (R.m), а большой (R.xl) — только у модалки.
 */
export const SKIN_SLICE = 48;
/** На золотой кнопке подпись тёмная, на остальных — кремовая. */
export const SKIN_DARK_LABEL = new Set(['skin_btn_gold']);

/** Сторона квадратной текстуры плитки. */
const TILE = 128;
/** «Толщина» кнопки снизу (тёмная кромка); нажатая проседает на LIP − 2. */
const LIP = 5;

type Ctx = CanvasRenderingContext2D;

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Общий атлас скина (§7.2 п. 3): плитки SKIN_TILES, контурные иконки, кружки этапов и мелкие украшения рисуются
 * каждая в свой canvas, как раньше, а затем копируются 1:1 в один холст. Ключи (`skin_btn`, `skin_ico_*`…) остаются —
 * это текстуры-псевдонимы над атласом (packedTexture.ts addAtlasAliases), а в GPU одна текстура: кнопки, панели и
 * иконки экрана рисуются одним батчем WebGL. Большие текстуры (фоны, лучи, баннеры) — отдельно, как были.
 */
export const SKIN_ATLAS = 'skin_atlas';
/** В атлас — текстуры не выше PACK_MAX_H и не шире PACK_MAX_W. */
const PACK_MAX_H = 256;
const PACK_MAX_W = 512;
/** Ширина атласа: 1024 — плотнее полки (≈ 3,8 МБ против 3,1 МБ отдельных текстур; при 2048 — 4,5 МБ). */
const PACK_W = 1024;
/** Поле вокруг кадра (кромка кадра растянута на него — линейная фильтрация у края как у отдельной текстуры). */
const PACK_GUTTER = 2;

interface PendingTexture {
  key: string;
  w: number;
  h: number;
  draw: (ctx: Ctx) => void;
}
/** Пока идёт buildSkin — очередь текстур в атлас; вне его canvas() создаёт текстуру сразу. */
let packing: PendingTexture[] | null = null;

function canvas(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: Ctx) => void): void {
  if (scene.textures.exists(key)) return;
  if (packing && w <= PACK_MAX_W && h <= PACK_MAX_H) {
    if (!packing.some((p) => p.key === key)) packing.push({ key, w, h, draw });
    return;
  }
  const t = scene.textures.createCanvas(key, w, h);
  if (!t) return;
  draw(t.getContext());
  t.refresh();
}

/** Описание плитки скина (панель, кнопка, слот). Цвета — CSS-строки (можно rgba). */
export interface TileSpec {
  /** Радиус угла (токен R). */
  r: number;
  /** Прозрачное поле вокруг (место под тень). */
  pad: number;
  /** Вертикальный градиент тела: верх → (середина) → низ. */
  top: string;
  mid?: string;
  bottom: string;
  /** Непрозрачность тела (поверхность — 0.8, карточка — 0.95+). */
  alpha?: number;
  /** Рамка: цвет снизу и (если есть) светлее сверху; толщина bw. Нет — без рамки. */
  border?: string;
  borderTop?: string;
  bw?: number;
  /** Кнопка: «толщина» снизу этого цвета; pressed — нажатая (проседает, без толщины). */
  lip?: string;
  pressed?: boolean;
  /** Мягкая тень под плиткой (непрозрачность) и тёмный контур в 1 ед. — отделяет от любого фона. */
  shadow?: number;
  /** Фаска: светлая кромка по верху внутри рамки (непрозрачность). */
  hairline?: number;
  /** Глянец верхней половины (золотая кнопка). */
  gloss?: number;
  /** Утопленное поле: внутренняя тень сверху (непрозрачность). */
  inset?: number;
  /** Активная вкладка: полоса-подчёркивание снизу и тёплое свечение от неё. */
  underline?: string;
  glow?: string;
}

/** Угол плитки в текстуре (поле + радиус + толщина) — должен помещаться в SKIN_SLICE. */
export const tileCorner = (o: TileSpec): number => o.pad + o.r + (o.lip ? LIP : 0);

/** Тело и рамка: поверхности и карточки (без «толщины»). */
const SURFACE: TileSpec = { r: R.l, pad: 2, top: '#221e1a', bottom: '#1b1814', alpha: 0.82, hairline: 0.04 };
const RAISED: TileSpec = {
  r: R.l,
  pad: 4,
  top: '#2a2620',
  bottom: '#1c1915',
  alpha: 0.96,
  border: '#3c3226',
  borderTop: '#5f4d34',
  bw: 2.5,
  shadow: 0.5,
  hairline: 0.06,
};
const SUNKEN: TileSpec = {
  r: R.m,
  pad: 2,
  top: '#100e0b',
  bottom: '#17140f',
  alpha: 0.92,
  border: 'rgba(255,236,200,0.07)',
  borderTop: 'rgba(0,0,0,0.7)',
  bw: 1.5,
  inset: 0.5,
};
const BTN: TileSpec = {
  r: R.m,
  pad: 3,
  top: '#342e26',
  bottom: '#221e19',
  border: '#56462e',
  borderTop: '#8a7048',
  bw: 2,
  lip: '#0b0907',
  shadow: 0.45,
  hairline: 0.1,
};
const GOLD: TileSpec = {
  r: R.m,
  pad: 3,
  top: '#f8dc9a',
  mid: '#e2ae55',
  bottom: '#bb812c',
  border: '#6b4513',
  borderTop: '#8a5e1e',
  bw: 2,
  lip: '#5a370c',
  shadow: 0.5,
  hairline: 0.55,
  gloss: 0.12,
};
const TAB: TileSpec = { r: R.m, pad: 3, top: '#1e1b17', bottom: '#16130f', alpha: 0.72, hairline: 0.04 };

/** Все плитки скина: ключ текстуры → описание. `_pressed` — нажатое состояние кнопки того же ключа. */
export const SKIN_TILES: Record<string, TileSpec> = {
  // Поверхности.
  skin_surface: SURFACE,
  skin_raised: RAISED,
  skin_sunken: SUNKEN,
  skin_modal: { ...RAISED, r: R.xl, pad: 6, top: '#2c2721', bottom: '#191613', alpha: 1, border: '#544430', borderTop: '#a08050', bw: 3, shadow: 0.65, hairline: 0.08 },
  // ui_panel: поднятая карточка, но спокойнее прежней (без заклёпок, двойной кромки и блика).
  skin_panel: RAISED,
  // ui_panel_light: «текущая/готовая» строка и вторичные блоки экрана — тёплая поверхность светлее карточки,
  // тонкая золотистая кромка вместо бронзовой рамки (выделяет, но не спорит с главной карточкой).
  skin_panel_light: { r: R.l, pad: 3, top: '#352c20', bottom: '#231d16', alpha: 0.92, border: 'rgba(240,207,138,0.24)', borderTop: 'rgba(240,207,138,0.34)', bw: 1.5, shadow: 0.3, hairline: 0.08 },
  // Слоты: заполненный — маленькая поднятая плитка, пустой — утопленный, выбранный — золотая рамка.
  // Заполненный слот почти всегда лежит внутри карточки — без бронзовой рамки (не «карточка в карточке»): чуть светлее
  // подложки, волосяная кромка и тень.
  skin_slot: { r: R.m, pad: 3, top: '#2b261f', bottom: '#1d1a15', alpha: 0.95, border: 'rgba(255,236,200,0.08)', bw: 1.5, shadow: 0.35, hairline: 0.08 },
  skin_slot_empty: SUNKEN,
  skin_slot_selected: { r: R.m, pad: 3, top: '#3a3020', bottom: '#211b13', border: '#c99a4a', borderTop: '#f0cf8a', bw: 3, shadow: 0.45, hairline: 0.12, glow: 'rgba(240,207,138,0.16)' },
  // Кнопки.
  skin_btn: BTN,
  skin_btn_pressed: { ...BTN, pressed: true },
  skin_btn_secondary: BTN,
  skin_btn_secondary_pressed: { ...BTN, pressed: true },
  skin_btn_ghost: { r: R.m, pad: 3, top: 'rgba(0,0,0,0)', bottom: 'rgba(0,0,0,0)' },
  skin_btn_ghost_pressed: { r: R.m, pad: 3, top: 'rgba(255,240,210,0.10)', bottom: 'rgba(255,240,210,0.06)' },
  skin_btn_active: { ...BTN, top: '#4a3a22', bottom: '#2a2014', border: '#a8803e', borderTop: '#f0cf8a', bw: 2.5, lip: '#140f08', hairline: 0.14 },
  skin_btn_active_pressed: { ...BTN, top: '#4a3a22', bottom: '#2a2014', border: '#a8803e', borderTop: '#f0cf8a', bw: 2.5, lip: '#140f08', pressed: true },
  skin_btn_gold: GOLD,
  skin_btn_gold_pressed: { ...GOLD, top: '#e8c070', mid: '#cf9842', bottom: '#a96f22', pressed: true, gloss: 0 },
  // Недоступная: ровный серый «камень» — без тёплой бронзы и глянца, та же «толщина».
  skin_btn_disabled: { ...BTN, top: '#2d2c2a', bottom: '#242321', border: '#3a3836', borderTop: '#4c4a46', lip: '#121110', shadow: 0.35, hairline: 0.04 },
  // Опасное действие (сброс прогресса): тёмно-красная, кремовая подпись.
  skin_btn_danger: { ...BTN, top: '#8e3324', bottom: '#5a1a12', border: '#2a0804', borderTop: '#c0604c', lip: '#2a0804', hairline: 0.18 },
  skin_btn_danger_pressed: { ...BTN, top: '#8e3324', bottom: '#5a1a12', border: '#2a0804', borderTop: '#c0604c', lip: '#2a0804', pressed: true },
  // Вкладки: без рамки (как в AFK — подсвечена активная, а не каждая плитка); активная — тёплое тело и золотая черта снизу.
  skin_tab: TAB,
  skin_tab_pressed: { ...TAB, top: '#16130f', bottom: '#16130f', alpha: 0.85 },
  skin_tab_active: { ...TAB, top: '#3a2e1d', bottom: '#241c12', alpha: 0.95, hairline: 0.08, underline: '#e0b45e', glow: 'rgba(240,190,100,0.22)' },
  skin_tab_active_pressed: { ...TAB, top: '#2a2116', bottom: '#241c12', alpha: 0.95, underline: '#c99a4a' },
  // «Таблетка» валюты: утопленное поле, тонкая тёплая кромка.
  skin_pill: { ...SUNKEN, r: R.l, pad: 2, top: '#0d0c0a', bottom: '#15130f', alpha: 0.85, border: 'rgba(232,184,90,0.2)', borderTop: 'rgba(0,0,0,0.6)' },
};

/** Вертикальный градиент: верх → (середина) → низ. */
function vgrad(ctx: Ctx, y: number, h: number, top: string, bottom: string, mid?: string): CanvasGradient {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, top);
  if (mid) g.addColorStop(0.5, mid);
  g.addColorStop(1, bottom);
  return g;
}

/**
 * Плитка скина по описанию: тень и тёмный контур, тело с градиентом, (глянец, внутренняя тень), фаска-кромка,
 * рамка (светлее сверху), у кнопок — «толщина» снизу, у активной вкладки — черта и свечение снизу.
 * Всё в пределах угла 9-slice: середина текстуры растягивается, поэтому ничего «точечного» (заклёпок, бликов по центру).
 */
function tile(ctx: Ctx, s: number, o: TileSpec): void {
  const lipH = o.lip ? LIP : 0;
  const sink = o.lip && o.pressed ? LIP - 2 : 0;
  const x = o.pad;
  const w = s - o.pad * 2;
  const y = o.pad + sink;
  const h = s - o.pad * 2 - lipH;
  const r = o.r;
  // Тень и тёмный контур (только у плиток с рамкой: поверхность лежит прямо на фоне).
  if (o.shadow) {
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${o.shadow})`;
    ctx.shadowBlur = Math.min(o.pad + 2, 8);
    ctx.shadowOffsetY = o.pressed ? 1 : 2;
    rr(ctx, x - 1, y - 1, w + 2, h + lipH - sink + 2, r + 1);
    ctx.fillStyle = 'rgba(6,5,4,0.9)';
    ctx.fill();
    ctx.restore();
  }
  // «Толщина» кнопки снизу.
  if (lipH && !o.pressed) {
    rr(ctx, x, y + lipH, w, h, r);
    ctx.fillStyle = o.lip as string;
    ctx.fill();
  }
  // Тело.
  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = vgrad(ctx, y, h, o.top, o.bottom, o.mid);
  ctx.fill();
  ctx.restore();
  ctx.save();
  rr(ctx, x, y, w, h, r);
  ctx.clip();
  if (o.gloss) {
    const gl = ctx.createLinearGradient(0, y, 0, y + h * 0.5);
    gl.addColorStop(0, `rgba(255,255,255,${o.gloss})`);
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(x, y, w, h * 0.5);
  }
  if (o.inset) {
    const sh = ctx.createLinearGradient(0, y, 0, y + 16);
    sh.addColorStop(0, `rgba(0,0,0,${o.inset})`);
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(x, y, w, 16);
  }
  if (o.glow) {
    const gw = ctx.createLinearGradient(0, y + h, 0, y + h * 0.35);
    gw.addColorStop(0, o.glow);
    gw.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gw;
    ctx.fillRect(x, y, w, h);
  }
  // Кнопка: лёгкая тень к низу тела — объём без «пластика».
  if (o.lip) {
    const sd = ctx.createLinearGradient(0, y + h * 0.6, 0, y + h);
    sd.addColorStop(0, 'rgba(0,0,0,0)');
    sd.addColorStop(1, o.pressed ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.2)');
    ctx.fillStyle = sd;
    ctx.fillRect(x, y, w, h);
  }
  if (o.underline) {
    ctx.fillStyle = o.underline;
    ctx.fillRect(x + r * 0.6, y + h - 6, w - r * 1.2, 4);
  }
  ctx.restore();
  // Фаска: светлая кромка по верху (следует скруглению), гаснет к середине высоты.
  const bw = o.border ? (o.bw ?? 2) : 0;
  if (o.hairline && !o.pressed) {
    const i = bw + 0.75;
    rr(ctx, x + i, y + i, w - i * 2, h - i * 2, Math.max(2, r - i));
    const hl = ctx.createLinearGradient(0, y, 0, y + Math.min(h * 0.5, 40));
    hl.addColorStop(0, `rgba(255,244,214,${o.hairline})`);
    hl.addColorStop(1, 'rgba(255,244,214,0)');
    ctx.strokeStyle = hl;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  // Рамка.
  if (bw) {
    rr(ctx, x + bw / 2, y + bw / 2, w - bw, h - bw, Math.max(2, r - bw / 2));
    ctx.strokeStyle = o.borderTop ? vgrad(ctx, y, h, o.borderTop, o.border as string, o.border) : (o.border as string);
    ctx.lineWidth = bw;
    ctx.stroke();
  }
}

/** Контурные иконки 64×64 (белые — красятся tint'ом). */
const ICONS: Record<string, (ctx: Ctx) => void> = {
  map: (c) => {
    c.beginPath();
    c.moveTo(8, 16); c.lineTo(24, 10); c.lineTo(40, 16); c.lineTo(56, 10); c.lineTo(56, 48); c.lineTo(40, 54); c.lineTo(24, 48); c.lineTo(8, 54); c.closePath();
    c.moveTo(24, 10); c.lineTo(24, 48); c.moveTo(40, 16); c.lineTo(40, 54);
    c.stroke();
  },
  helmet: (c) => {
    c.beginPath();
    c.moveTo(14, 40); c.bezierCurveTo(14, 18, 22, 8, 32, 8); c.bezierCurveTo(42, 8, 50, 18, 50, 40); c.closePath();
    c.moveTo(12, 40); c.lineTo(10, 54); c.lineTo(54, 54); c.lineTo(52, 40);
    c.moveTo(26, 26); c.lineTo(38, 26); c.moveTo(32, 26); c.lineTo(32, 40);
    c.stroke();
  },
  home: (c) => {
    c.beginPath();
    c.moveTo(8, 30); c.lineTo(32, 10); c.lineTo(56, 30);
    c.moveTo(14, 26); c.lineTo(14, 54); c.lineTo(50, 54); c.lineTo(50, 26);
    c.moveTo(27, 54); c.lineTo(27, 40); c.lineTo(37, 40); c.lineTo(37, 54);
    c.stroke();
  },
  // Вкладка «Город»: крепостная стена с двумя башнями и воротами.
  castle: (c) => {
    c.beginPath();
    c.moveTo(8, 56); c.lineTo(8, 14); c.lineTo(14, 14); c.lineTo(14, 20); c.lineTo(20, 20); c.lineTo(20, 14); c.lineTo(26, 14); c.lineTo(26, 30);
    c.lineTo(38, 30); c.lineTo(38, 14); c.lineTo(44, 14); c.lineTo(44, 20); c.lineTo(50, 20); c.lineTo(50, 14); c.lineTo(56, 14); c.lineTo(56, 56); c.closePath();
    c.moveTo(26, 56); c.lineTo(26, 44); c.bezierCurveTo(26, 36, 38, 36, 38, 44); c.lineTo(38, 56);
    c.stroke();
  },
  // Вкладка «Приключения»: компас (кольцо и стрелка).
  compass: (c) => {
    c.beginPath();
    c.arc(32, 32, 22, 0, Math.PI * 2);
    c.moveTo(32, 14); c.lineTo(39, 32); c.lineTo(32, 50); c.lineTo(25, 32); c.closePath();
    c.moveTo(25, 32); c.lineTo(39, 32);
    c.stroke();
  },
  gear: (c) => {
    c.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      c.moveTo(32 + Math.cos(a) * 16, 32 + Math.sin(a) * 16);
      c.lineTo(32 + Math.cos(a) * 24, 32 + Math.sin(a) * 24);
    }
    c.stroke();
    c.beginPath(); c.arc(32, 32, 16, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(32, 32, 7, 0, Math.PI * 2); c.stroke();
  },
  gift: (c) => {
    c.beginPath();
    c.rect(10, 24, 44, 10); c.rect(14, 34, 36, 20);
    c.moveTo(32, 24); c.lineTo(32, 54);
    c.moveTo(32, 24); c.bezierCurveTo(24, 10, 12, 16, 22, 24);
    c.moveTo(32, 24); c.bezierCurveTo(40, 10, 52, 16, 42, 24);
    c.stroke();
  },
  bag: (c) => {
    c.beginPath();
    c.moveTo(14, 22); c.lineTo(50, 22); c.lineTo(54, 54); c.lineTo(10, 54); c.closePath();
    c.moveTo(24, 22); c.bezierCurveTo(24, 8, 40, 8, 40, 22);
    c.stroke();
  },
  lock: (c) => {
    c.beginPath(); rr(c, 14, 28, 36, 26, 6); c.stroke();
    c.beginPath(); c.moveTo(21, 28); c.lineTo(21, 20); c.bezierCurveTo(21, 8, 43, 8, 43, 20); c.lineTo(43, 28); c.stroke();
    c.beginPath(); c.arc(32, 40, 3, 0, Math.PI * 2); c.stroke();
  },
  chest: (c) => {
    c.beginPath(); rr(c, 8, 26, 48, 28, 5); c.stroke();
    c.beginPath(); c.moveTo(8, 32); c.bezierCurveTo(8, 12, 56, 12, 56, 32); c.stroke();
    c.beginPath(); c.moveTo(8, 34); c.lineTo(56, 34); c.stroke();
    c.beginPath(); rr(c, 27, 30, 10, 10, 2); c.stroke();
  },
  scroll: (c) => {
    c.beginPath();
    c.moveTo(18, 10); c.lineTo(48, 10); c.lineTo(48, 50); c.bezierCurveTo(48, 56, 42, 56, 40, 52);
    c.moveTo(18, 10); c.bezierCurveTo(12, 10, 12, 18, 18, 18); c.lineTo(18, 50); c.bezierCurveTo(18, 58, 40, 58, 40, 52); c.lineTo(28, 52);
    c.moveTo(24, 22); c.lineTo(42, 22); c.moveTo(24, 30); c.lineTo(42, 30); c.moveTo(24, 38); c.lineTo(36, 38);
    c.stroke();
  },
  tower: (c) => {
    c.beginPath();
    c.moveTo(18, 54); c.lineTo(20, 22); c.lineTo(44, 22); c.lineTo(46, 54); c.closePath();
    c.moveTo(16, 22); c.lineTo(16, 12); c.lineTo(22, 12); c.lineTo(22, 16); c.lineTo(29, 16); c.lineTo(29, 12); c.lineTo(35, 12); c.lineTo(35, 16); c.lineTo(42, 16); c.lineTo(42, 12); c.lineTo(48, 12); c.lineTo(48, 22);
    c.moveTo(28, 54); c.lineTo(28, 42); c.bezierCurveTo(28, 36, 36, 36, 36, 42); c.lineTo(36, 54);
    c.stroke();
  },
  trophy: (c) => {
    c.beginPath();
    c.moveTo(20, 10); c.lineTo(44, 10); c.lineTo(44, 24); c.bezierCurveTo(44, 36, 20, 36, 20, 24); c.closePath();
    c.moveTo(20, 14); c.bezierCurveTo(8, 14, 10, 28, 22, 28);
    c.moveTo(44, 14); c.bezierCurveTo(56, 14, 54, 28, 42, 28);
    c.moveTo(32, 34); c.lineTo(32, 44); c.moveTo(22, 54); c.lineTo(42, 54); c.lineTo(40, 44); c.lineTo(24, 44); c.closePath();
    c.stroke();
  },
  swords: (c) => {
    c.beginPath();
    c.moveTo(12, 12); c.lineTo(44, 44); c.moveTo(52, 12); c.lineTo(20, 44);
    c.moveTo(38, 48); c.lineTo(48, 38); c.moveTo(16, 38); c.lineTo(26, 48);
    c.moveTo(44, 44); c.lineTo(52, 52); c.moveTo(20, 44); c.lineTo(12, 52);
    c.stroke();
  },
  check: (c) => {
    c.beginPath(); c.moveTo(14, 34); c.lineTo(26, 46); c.lineTo(50, 18); c.stroke();
  },
  back: (c) => {
    c.beginPath(); c.moveTo(38, 14); c.lineTo(20, 32); c.lineTo(38, 50); c.stroke();
  },
  next: (c) => {
    c.beginPath(); c.moveTo(26, 14); c.lineTo(44, 32); c.lineTo(26, 50); c.stroke();
  },
  hourglass: (c) => {
    c.beginPath();
    c.moveTo(16, 8); c.lineTo(48, 8); c.moveTo(16, 56); c.lineTo(48, 56);
    c.moveTo(20, 8); c.bezierCurveTo(20, 26, 32, 26, 32, 32); c.bezierCurveTo(32, 38, 20, 38, 20, 56);
    c.moveTo(44, 8); c.bezierCurveTo(44, 26, 32, 26, 32, 32); c.bezierCurveTo(32, 38, 44, 38, 44, 56);
    c.moveTo(25, 50); c.lineTo(39, 50);
    c.stroke();
  },
  flag: (c) => {
    c.beginPath();
    c.moveTo(16, 58); c.lineTo(16, 8);
    c.moveTo(16, 10); c.bezierCurveTo(28, 4, 36, 16, 50, 10); c.lineTo(50, 34); c.bezierCurveTo(36, 40, 28, 28, 16, 34);
    c.stroke();
  },
  star: (c) => {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 11 : 24;
      if (i) c.lineTo(32 + Math.cos(a) * r, 34 + Math.sin(a) * r);
      else c.moveTo(32 + Math.cos(a) * r, 34 + Math.sin(a) * r);
    }
    c.closePath();
    c.stroke();
  },
  // Кухня (data/kitchen.json → icon): котелок, мясо на кости, яблоко, морковь, горшочек мёда, кувшин молока.
  pot: (c) => {
    c.beginPath();
    c.moveTo(10, 28); c.lineTo(54, 28);
    c.moveTo(14, 28); c.bezierCurveTo(14, 50, 22, 54, 32, 54); c.bezierCurveTo(42, 54, 50, 50, 50, 28);
    c.moveTo(14, 32); c.lineTo(8, 32); c.moveTo(50, 32); c.lineTo(56, 32);
    c.moveTo(24, 20); c.bezierCurveTo(20, 16, 28, 12, 24, 8);
    c.moveTo(36, 20); c.bezierCurveTo(32, 16, 40, 12, 36, 8);
    c.stroke();
  },
  meat: (c) => {
    c.beginPath();
    c.ellipse(26, 30, 17, 14, -0.6, 0, Math.PI * 2);
    c.moveTo(37, 40); c.lineTo(48, 51);
    c.stroke();
    c.beginPath(); c.arc(51, 49, 4, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(46, 54, 4, 0, Math.PI * 2); c.stroke();
  },
  apple: (c) => {
    c.beginPath();
    c.moveTo(32, 20); c.bezierCurveTo(20, 12, 8, 22, 12, 38); c.bezierCurveTo(15, 50, 24, 58, 32, 52);
    c.bezierCurveTo(40, 58, 49, 50, 52, 38); c.bezierCurveTo(56, 22, 44, 12, 32, 20);
    c.moveTo(32, 20); c.lineTo(34, 8);
    c.moveTo(34, 12); c.bezierCurveTo(40, 6, 48, 8, 48, 12); c.bezierCurveTo(42, 16, 38, 14, 34, 12);
    c.stroke();
  },
  carrot: (c) => {
    c.beginPath();
    c.moveTo(40, 18); c.lineTo(14, 54); c.lineTo(48, 26); c.closePath();
    c.moveTo(28, 38); c.lineTo(34, 40); c.moveTo(22, 46); c.lineTo(27, 47);
    c.moveTo(44, 22); c.lineTo(50, 8); c.moveTo(44, 22); c.lineTo(58, 16); c.moveTo(44, 22); c.lineTo(56, 26);
    c.stroke();
  },
  honey: (c) => {
    c.beginPath();
    c.moveTo(20, 20); c.lineTo(44, 20);
    c.moveTo(18, 14); c.lineTo(46, 14); c.lineTo(46, 20); c.lineTo(18, 20); c.closePath();
    c.moveTo(20, 20); c.bezierCurveTo(8, 30, 10, 54, 32, 54); c.bezierCurveTo(54, 54, 56, 30, 44, 20);
    c.moveTo(18, 34); c.bezierCurveTo(24, 40, 28, 30, 32, 38); c.bezierCurveTo(36, 44, 40, 32, 46, 36);
    c.stroke();
  },
  milk: (c) => {
    c.beginPath();
    c.moveTo(22, 8); c.lineTo(38, 8); c.lineTo(36, 18);
    c.bezierCurveTo(46, 24, 46, 34, 46, 54); c.lineTo(14, 54); c.bezierCurveTo(14, 34, 14, 24, 24, 18); c.closePath();
    c.moveTo(46, 28); c.bezierCurveTo(56, 28, 56, 44, 46, 44);
    c.moveTo(15, 36); c.lineTo(45, 36);
    c.stroke();
  },
};

export type SkinIcon = keyof typeof ICONS;

/** Id текстуры иконки скина. */
export const skinIcon = (name: SkinIcon) => `skin_ico_${name}`;

/** Сгенерировать все текстуры скина (один раз, в BootScene). */
export function buildSkin(scene: Phaser.Scene): void {
  packing = [];
  try {
    buildSkinTextures(scene);
  } finally {
    const list = packing;
    packing = null;
    packSkin(scene, list);
  }
}

/** Нарисовать отложенные текстуры в один атлас и завести ключи-псевдонимы. Без document/2d — по отдельности, как раньше. */
function packSkin(scene: Phaser.Scene, items: PendingTexture[]): void {
  if (!items.length) return;
  const separately = () => {
    for (const it of items) canvas(scene, it.key, it.w, it.h, it.draw);
  };
  if (typeof document === 'undefined' || scene.textures.exists(SKIN_ATLAS)) return separately();
  const { width, height, slots } = shelfPack(items, PACK_W, PACK_GUTTER);
  const atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = width;
  atlasCanvas.height = height;
  const ctx = atlasCanvas.getContext('2d');
  const tmp = document.createElement('canvas');
  if (!ctx) return separately();
  const byKey = new Map(items.map((it) => [it.key, it]));
  for (const s of slots) {
    // Новый размер — чистый холст и сброшенное состояние контекста, как у отдельного canvas.
    tmp.width = s.w;
    tmp.height = s.h;
    const c = tmp.getContext('2d');
    if (!c) return separately();
    byKey.get(s.key)!.draw(c);
    blitExtruded(ctx, tmp, s, PACK_GUTTER);
  }
  tmp.width = 0;
  tmp.height = 0;
  // create, а не createCanvas: CanvasTexture держала бы ещё и копию пикселей (getImageData).
  const atlas = scene.textures.create(SKIN_ATLAS, atlasCanvas, width, height);
  if (!atlas) return separately();
  atlas.add('__BASE', 0, 0, 0, width, height);
  for (const s of slots) atlas.add(s.key, 0, s.x, s.y, s.w, s.h);
  addAtlasAliases(scene.textures, atlas, slots);
}

function buildSkinTextures(scene: Phaser.Scene): void {
  for (const [key, spec] of Object.entries(SKIN_TILES)) canvas(scene, key, TILE, TILE, (c) => tile(c, TILE, spec));
  buildDecor(scene);

  // Иконки: белый контур, скруглённые концы.
  for (const [name, draw] of Object.entries(ICONS)) {
    canvas(scene, `skin_ico_${name}`, 64, 64, (c) => {
      c.strokeStyle = '#ffffff';
      c.lineWidth = 4.5;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      draw(c);
    });
  }

  // Кружки этапов: металлический диск с тёмным ободом и сектором-бликом (как «монета» в референсе).
  const disc = (key: string, face: [string, string], rim: string) =>
    canvas(scene, key, 200, 200, (c) => {
      const cx = 100;
      c.beginPath(); c.arc(cx, cx, 96, 0, Math.PI * 2); c.fillStyle = '#0b0b0a'; c.fill();
      c.beginPath(); c.arc(cx, cx, 90, 0, Math.PI * 2);
      const rg = c.createLinearGradient(0, 10, 0, 190);
      rg.addColorStop(0, '#3a342b'); rg.addColorStop(1, '#16140f');
      c.fillStyle = rg; c.fill();
      c.lineWidth = 3; c.strokeStyle = rim; c.stroke();
      c.beginPath(); c.arc(cx, cx, 68, 0, Math.PI * 2);
      const fg = c.createRadialGradient(cx - 20, cx - 25, 8, cx, cx, 70);
      fg.addColorStop(0, face[0]); fg.addColorStop(1, face[1]);
      c.fillStyle = fg; c.fill();
      // Сектора-блики.
      c.save();
      c.beginPath(); c.arc(cx, cx, 68, 0, Math.PI * 2); c.clip();
      c.fillStyle = 'rgba(255,255,255,0.07)';
      for (const a of [-2.4, -0.3, 1.8]) {
        c.beginPath(); c.moveTo(cx, cx); c.arc(cx, cx, 70, a, a + 0.55); c.closePath(); c.fill();
      }
      c.restore();
      c.beginPath(); c.arc(cx, cx, 68, 0, Math.PI * 2); c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.6)'; c.stroke();
    });
  disc('skin_node_locked', ['#4a4a4e', '#1e1e22'], '#2b2721');
  disc('skin_node_cleared', ['#5a4a30', '#2a2116'], SKIN.bronze);
  disc('skin_node_open', ['#8a2a2a', '#3a1010'], '#6a2a22');
  disc('skin_node_boss', ['#5a1a4a', '#220a1c'], '#7a2a44');

  // Искра (торжественные моменты: смена профессии) — мягкое свечение и четырёхлучевая звезда, белая (красится tint'ом).
  canvas(scene, 'skin_spark', 64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(32, 2); c.quadraticCurveTo(35, 29, 62, 32); c.quadraticCurveTo(35, 35, 32, 62); c.quadraticCurveTo(29, 35, 2, 32); c.quadraticCurveTo(29, 29, 32, 2);
    c.fill();
  });
  // Лучи за фигурой героя: веер золотых клиньев, гаснущих к краю, и тёплое ядро.
  canvas(scene, 'skin_rays', 512, 512, (c) => {
    const cx = 256;
    const g = c.createRadialGradient(cx, cx, 20, cx, cx, 256);
    g.addColorStop(0, 'rgba(255,220,140,0.75)');
    g.addColorStop(0.5, 'rgba(214,174,99,0.3)');
    g.addColorStop(1, 'rgba(214,174,99,0)');
    c.fillStyle = g;
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      c.beginPath();
      c.moveTo(cx, cx);
      c.arc(cx, cx, 256, a, a + (Math.PI / n) * 0.8);
      c.closePath();
      c.fill();
    }
    const core = c.createRadialGradient(cx, cx, 0, cx, cx, 150);
    core.addColorStop(0, 'rgba(255,236,190,0.55)');
    core.addColorStop(1, 'rgba(255,236,190,0)');
    c.fillStyle = core;
    c.fillRect(0, 0, 512, 512);
  });
  // Плашки «Победа» / «Поражение» в стиле скина: тёмная плита с металлической рамкой, лавровые ветви по бокам,
  // ромб-герб сверху, надпись с градиентом и тёмной обводкой (как итоговые баннеры AFK Arena).
  const banner = (key: string, label: string, face: [string, string], border: string, leaf: [string, string]) =>
    canvas(scene, key, 900, 300, (c) => {
      const W = 900;
      const H = 300;
      const bx = 100;
      const bw = W - 200;
      // Лавровые ветви: листья по дуге от низа плиты вверх и наружу.
      for (const d of [-1, 1]) {
        const ox = W / 2 + d * (bw / 2 - 30);
        for (let i = 0; i < 9; i++) {
          const t = i / 8;
          const ang = Math.PI * (0.62 - t * 0.6);
          const lx = ox + d * Math.cos(ang) * 120 * (0.4 + t * 0.6) + d * 30;
          const ly = 230 - t * 170;
          for (const side of [-1, 1]) {
            c.save();
            c.translate(lx, ly);
            c.rotate(d * (side * 0.7 - 0.2 - t * 0.5));
            c.beginPath();
            c.ellipse(side * 14, 0, 22 - t * 6, 8, 0, 0, Math.PI * 2);
            const lg = c.createLinearGradient(0, -8, 0, 8);
            lg.addColorStop(0, leaf[0]);
            lg.addColorStop(1, leaf[1]);
            c.fillStyle = lg;
            c.fill();
            c.lineWidth = 2;
            c.strokeStyle = '#140d06';
            c.stroke();
            c.restore();
          }
        }
      }
      // Плита.
      c.save();
      c.shadowColor = 'rgba(0,0,0,0.7)';
      c.shadowBlur = 16;
      c.shadowOffsetY = 6;
      rr(c, bx, 60, bw, 180, 30);
      c.fillStyle = '#0a0806';
      c.fill();
      c.restore();
      const g = c.createLinearGradient(0, 60, 0, 240);
      g.addColorStop(0, '#3a3228');
      g.addColorStop(1, '#141210');
      rr(c, bx + 4, 64, bw - 8, 172, 26);
      c.fillStyle = g;
      c.fill();
      c.save();
      c.shadowColor = border;
      c.shadowBlur = 20;
      c.lineWidth = 6;
      const bg = c.createLinearGradient(0, 64, 0, 236);
      bg.addColorStop(0, face[0]);
      bg.addColorStop(0.5, border);
      bg.addColorStop(1, border);
      c.strokeStyle = bg;
      c.stroke();
      c.restore();
      rr(c, bx + 18, 78, bw - 36, 144, 18);
      c.lineWidth = 2;
      c.strokeStyle = 'rgba(255,240,210,0.16)';
      c.stroke();
      // Ромбы-заклёпки по бокам и герб сверху.
      c.fillStyle = border;
      for (const x of [bx + 44, W - bx - 44]) {
        c.beginPath(); c.moveTo(x, H / 2 - 16); c.lineTo(x + 12, H / 2); c.lineTo(x, H / 2 + 16); c.lineTo(x - 12, H / 2); c.closePath(); c.fill();
      }
      const crest = (r: number, fill: string | CanvasGradient) => {
        c.beginPath(); c.moveTo(W / 2, 62 - r); c.lineTo(W / 2 + r * 0.85, 62); c.lineTo(W / 2, 62 + r); c.lineTo(W / 2 - r * 0.85, 62); c.closePath();
        c.fillStyle = fill; c.fill();
      };
      crest(34, '#0a0806');
      const cg = c.createLinearGradient(0, 34, 0, 90);
      cg.addColorStop(0, face[0]);
      cg.addColorStop(1, border);
      crest(28, cg);
      crest(11, '#1a0e08');
      // Надпись: крупно, но в ширину плиты.
      let size = 100;
      c.font = `bold ${size}px Arial, "Helvetica Neue", sans-serif`;
      const maxW = bw - 150;
      const mw = c.measureText(label).width;
      if (mw > maxW) {
        size = Math.floor((size * maxW) / mw);
        c.font = `bold ${size}px Arial, "Helvetica Neue", sans-serif`;
      }
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineWidth = 12;
      c.lineJoin = 'round';
      c.strokeStyle = '#120d07';
      c.strokeText(label, W / 2, H / 2 + 10);
      const tg = c.createLinearGradient(0, H / 2 - size / 2, 0, H / 2 + size / 2);
      tg.addColorStop(0, face[0]);
      tg.addColorStop(0.55, face[1]);
      tg.addColorStop(1, face[1]);
      c.fillStyle = tg;
      c.fillText(label, W / 2, H / 2 + 10);
      // Блик по верхней половине букв.
      c.save();
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = 'rgba(255,255,255,0.18)';
      c.fillRect(0, H / 2 - size / 2, W, size * 0.35);
      c.restore();
    });
  banner('skin_banner_victory', tr('ПОБЕДА'), ['#fff0c0', '#d6a040'], SKIN.gold, ['#f0cf8a', '#8f6a2c']);
  banner('skin_banner_defeat', tr('ПОРАЖЕНИЕ'), ['#ffc0b0', '#b8402e'], '#8a3a2e', ['#9a8a7a', '#4a3a30']);

  // Лесной фон (как в референсе): градиент, силуэты крон двумя планами, лучи и светлячки.
  canvas(scene, 'skin_bg_forest', BG_W, BG_H, (c) => drawForest(c, BG_W, BG_H));
  // Поле боя главы 1: поляна на опушке (трава и земля — тайлы художника, если загружены).
  const img = (key: string) => (scene.textures.exists(key) ? (scene.textures.get(key).getSourceImage() as CanvasImageSource) : null);
  canvas(scene, 'skin_bg_battle', BG_W, BG_H, (c) => drawMeadow(c, BG_W, BG_H, img('tile_grass_01'), img('tile_dirt')));
}

/**
 * Украшения экранов (шапка, навигация, ленты заголовков, медальоны иконок, блики) — src/game/decor.ts.
 * Все текстуры маленькие и рисуются один раз при загрузке.
 */
function buildDecor(scene: Phaser.Scene): void {
  // Шапка и навигация: вертикальный градиент тёмная бронза (растягивается по ширине).
  canvas(scene, 'skin_header_grad', 4, 256, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#070605');
    g.addColorStop(0.55, '#15120d');
    g.addColorStop(1, '#2a2115');
    c.fillStyle = g;
    c.fillRect(0, 0, 4, 256);
  });
  // Кромка шапки/навигации: тонкая тень и приглушённая бронзово-золотая линия, гаснущая к краям (без яркого блика).
  canvas(scene, 'skin_trim', 512, 12, (c) => {
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(0, 6, 512, 4);
    const g = c.createLinearGradient(0, 0, 512, 0);
    g.addColorStop(0, 'rgba(143,106,44,0)');
    g.addColorStop(0.5, 'rgba(200,160,96,0.85)');
    g.addColorStop(1, 'rgba(143,106,44,0)');
    c.fillStyle = g;
    c.fillRect(0, 4, 512, 2);
  });
  // Орнамент по центру кромки (только шапки ключевых экранов и модалки): маленький ромб и две тонкие сужающиеся
  // линии — без завитков; спокойная бронза, не яркое золото.
  canvas(scene, 'skin_ornament', 240, 48, (c) => {
    const cx = 120;
    const cy = 24;
    for (const d of [-1, 1]) {
      const g = c.createLinearGradient(cx, 0, cx + d * 104, 0);
      g.addColorStop(0, 'rgba(200,160,96,0.9)');
      g.addColorStop(1, 'rgba(200,160,96,0)');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(cx + d * 14, cy - 2);
      c.lineTo(cx + d * 104, cy);
      c.lineTo(cx + d * 14, cy + 2);
      c.closePath();
      c.fill();
    }
    const dia = (r: number, fill: string | CanvasGradient) => {
      c.beginPath();
      c.moveTo(cx, cy - r); c.lineTo(cx + r * 0.8, cy); c.lineTo(cx, cy + r); c.lineTo(cx - r * 0.8, cy);
      c.closePath();
      c.fillStyle = fill;
      c.fill();
    };
    dia(13, '#0a0806');
    const g = c.createLinearGradient(0, cy - 10, 0, cy + 10);
    g.addColorStop(0, '#e8c67e');
    g.addColorStop(1, '#8f6a2c');
    dia(9.5, g);
    dia(3.5, '#2a1c0c');
  });
  // Лента заголовка: тёмно-красное полотно с золотой кромкой и вырезами на концах (3-slice по горизонтали).
  canvas(scene, 'skin_ribbon', 256, 96, (c) => {
    const W = 256;
    const H = 96;
    const notch = 22;
    const shape = (inset: number) => {
      c.beginPath();
      c.moveTo(inset, 10 + inset);
      c.lineTo(W - inset, 10 + inset);
      c.lineTo(W - notch - inset * 0.5, H / 2);
      c.lineTo(W - inset, H - 10 - inset);
      c.lineTo(inset, H - 10 - inset);
      c.lineTo(notch + inset * 0.5, H / 2);
      c.closePath();
    };
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.6)';
    c.shadowBlur = 8;
    c.shadowOffsetY = 3;
    shape(0);
    c.fillStyle = '#0a0706';
    c.fill();
    c.restore();
    shape(3);
    const g = c.createLinearGradient(0, 12, 0, H - 12);
    g.addColorStop(0, '#7a2a1e');
    g.addColorStop(0.5, '#5a1a12');
    g.addColorStop(1, '#3a0e0a');
    c.fillStyle = g;
    c.fill();
    c.lineWidth = 3;
    const bg = c.createLinearGradient(0, 12, 0, H - 12);
    bg.addColorStop(0, '#f0cf8a');
    bg.addColorStop(1, '#8f6a2c');
    c.strokeStyle = bg;
    c.stroke();
    shape(9);
    c.lineWidth = 1.5;
    c.strokeStyle = 'rgba(255,220,160,0.25)';
    c.stroke();
  });
  // Медальон под иконку: тонкий приглушённый бронзовый обод, тёмное поле, слабый блик сверху.
  canvas(scene, 'skin_medallion', 160, 160, (c) => {
    const cx = 80;
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.6)';
    c.shadowBlur = 8;
    c.shadowOffsetY = 3;
    c.beginPath(); c.arc(cx, cx, 72, 0, Math.PI * 2); c.fillStyle = '#0a0806'; c.fill();
    c.restore();
    const rim = c.createLinearGradient(0, 10, 0, 150);
    rim.addColorStop(0, '#c9a66a');
    rim.addColorStop(0.5, '#7a5c30');
    rim.addColorStop(1, '#3a2a14');
    c.beginPath(); c.arc(cx, cx, 68, 0, Math.PI * 2); c.fillStyle = rim; c.fill();
    const face = c.createRadialGradient(cx, cx - 20, 6, cx, cx, 64);
    face.addColorStop(0, '#3a2e20');
    face.addColorStop(1, '#14100b');
    c.beginPath(); c.arc(cx, cx, 63, 0, Math.PI * 2); c.fillStyle = face; c.fill();
    c.lineWidth = 1.5; c.strokeStyle = 'rgba(0,0,0,0.7)'; c.stroke();
    c.save();
    c.beginPath(); c.arc(cx, cx, 63, 0, Math.PI * 2); c.clip();
    const gl = c.createLinearGradient(0, 22, 0, 80);
    gl.addColorStop(0, 'rgba(255,240,200,0.10)');
    gl.addColorStop(1, 'rgba(255,240,200,0)');
    c.fillStyle = gl;
    c.fillRect(0, 0, 160, 80);
    c.restore();
  });
  // Мягкое круглое свечение (белое — красится tint'ом).
  canvas(scene, 'skin_glow', 128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });
  // Блик, пробегающий по главной кнопке: косая мягкая полоса.
  canvas(scene, 'skin_shine', 96, 160, (c) => {
    const g = c.createLinearGradient(0, 0, 96, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(40, 0); c.lineTo(96, 0); c.lineTo(56, 160); c.lineTo(0, 160);
    c.closePath();
    c.fill();
  });
}

const BG_W = 720;
const BG_H = 1280;

/**
 * Ночной лес в несколько планов (как фон в референсе): небо с лунным светом, дальние ели в дымке, полоса тумана,
 * средний план лиственных крон, лучи света, крупные стволы с листвой по краям, кусты внизу, светлячки, виньетка.
 * Всё детерминированно (свой seed) — фон одинаков при каждом запуске.
 */
function drawForest(c: Ctx, W: number, H: number): void {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const between = (a: number, b: number) => a + rnd() * (b - a);

  // Небо.
  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0d1f1a');
  sky.addColorStop(0.38, '#2a5445');
  sky.addColorStop(0.55, '#1b3a2c');
  sky.addColorStop(1, '#0a160f');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, H);
  // Лунное свечение сверху справа.
  const moon = c.createRadialGradient(W * 0.72, H * 0.1, 0, W * 0.72, H * 0.1, W * 0.75);
  moon.addColorStop(0, 'rgba(190,230,200,0.22)');
  moon.addColorStop(1, 'rgba(190,230,200,0)');
  c.fillStyle = moon;
  c.fillRect(0, 0, W, H);

  // Ель: ярусы треугольников на тонком стволе.
  const pine = (x: number, base: number, h: number, color: string) => {
    c.fillStyle = color;
    c.fillRect(x - h * 0.02, base - h * 0.2, h * 0.04, h * 0.2);
    const tiers = 5;
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers;
      const w = h * (0.34 - t * 0.22);
      const y = base - h * 0.12 - t * h * 0.78;
      c.beginPath();
      c.moveTo(x - w, y);
      c.lineTo(x + w, y);
      c.lineTo(x, y - h * 0.3);
      c.closePath();
      c.fill();
    }
  };
  // Лиственное дерево: ствол и крона из пересекающихся кругов.
  const tree = (x: number, base: number, h: number, color: string) => {
    c.fillStyle = color;
    c.fillRect(x - h * 0.035, base - h * 0.45, h * 0.07, h * 0.45);
    const cy = base - h * 0.62;
    const r = h * 0.26;
    for (let i = 0; i < 7; i++) {
      c.beginPath();
      c.arc(x + between(-r, r) * 0.9, cy + between(-r, r) * 0.6, r * between(0.55, 0.85), 0, Math.PI * 2);
      c.fill();
    }
  };

  // Самый дальний ряд — светлые ели в дымке, за ним ближний дальний ряд.
  for (let x = -20; x < W + 40; x += between(22, 36)) pine(x, H * 0.44 + between(-15, 15), between(110, 170), 'rgba(58,104,84,0.75)');
  for (let x = -20; x < W + 40; x += between(28, 48)) pine(x, H * 0.52 + between(-20, 20), between(160, 240), 'rgba(34,72,54,0.95)');
  // Туман.
  const mist = c.createLinearGradient(0, H * 0.4, 0, H * 0.6);
  mist.addColorStop(0, 'rgba(120,170,140,0)');
  mist.addColorStop(0.5, 'rgba(120,170,140,0.16)');
  mist.addColorStop(1, 'rgba(120,170,140,0)');
  c.fillStyle = mist;
  c.fillRect(0, H * 0.4, W, H * 0.2);
  // Средний план — кроны темнее и крупнее, с просветами и подсветкой по верхнему краю.
  for (let x = -40; x < W + 60; x += between(110, 170)) {
    const base = H * 0.74 + between(-30, 30);
    const h = between(260, 360);
    tree(x, base, h, 'rgba(22,50,36,1)');
    // Лунная кромка: светлые пятна по верху кроны.
    c.fillStyle = 'rgba(120,180,140,0.12)';
    c.beginPath();
    c.arc(x + h * 0.05, base - h * 0.78, h * 0.16, Math.PI, Math.PI * 2);
    c.fill();
  }
  for (let x = 40; x < W; x += between(130, 200)) pine(x, H * 0.8 + between(-20, 20), between(240, 320), 'rgba(15,34,24,1)');
  // Земля среднего плана.
  const ground = c.createLinearGradient(0, H * 0.72, 0, H);
  ground.addColorStop(0, 'rgba(10,22,15,0)');
  ground.addColorStop(0.3, 'rgba(10,22,15,0.85)');
  ground.addColorStop(1, 'rgba(6,13,9,1)');
  c.fillStyle = ground;
  c.fillRect(0, H * 0.72, W, H * 0.28);

  // Лучи света сквозь кроны.
  c.save();
  c.globalCompositeOperation = 'lighter';
  for (const x of [W * 0.2, W * 0.46, W * 0.7]) {
    const g = c.createLinearGradient(x, 0, x + W * 0.25, H);
    g.addColorStop(0, 'rgba(170,230,170,0.08)');
    g.addColorStop(1, 'rgba(170,230,170,0)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x + W * 0.06, 0);
    c.lineTo(x + W * 0.32, H);
    c.lineTo(x + W * 0.16, H);
    c.closePath();
    c.fill();
  }
  c.restore();

  // Ближний план — толстые стволы по краям, ветки и листва.
  const trunk = (x: number, w: number, lean: number) => {
    c.fillStyle = '#060d09';
    c.beginPath();
    c.moveTo(x - w / 2, H);
    c.lineTo(x + w / 2, H);
    c.lineTo(x + w * 0.35 + lean, 0);
    c.lineTo(x - w * 0.35 + lean, 0);
    c.closePath();
    c.fill();
  };
  trunk(-10, 90, 20);
  trunk(W + 12, 96, -24);
  const leaves = (cx: number, cy: number, n: number, r: number) => {
    c.fillStyle = '#081510';
    for (let i = 0; i < n; i++) {
      c.beginPath();
      c.ellipse(cx + between(-r, r), cy + between(-r * 0.5, r * 0.5), between(r * 0.25, r * 0.5), between(r * 0.15, r * 0.3), between(0, Math.PI), 0, Math.PI * 2);
      c.fill();
    }
  };
  leaves(40, 60, 26, 150);
  leaves(W - 40, 110, 26, 160);
  leaves(W * 0.5, -20, 18, 220);
  // Кусты и трава внизу.
  c.fillStyle = '#07110b';
  for (let x = -20; x < W + 20; x += between(40, 70)) {
    c.beginPath();
    c.arc(x, H - between(10, 50), between(40, 80), 0, Math.PI * 2);
    c.fill();
  }

  // Светлячки.
  for (let i = 0; i < 22; i++) {
    const x = between(20, W - 20);
    const y = between(H * 0.25, H * 0.95);
    const r = between(4, 9);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(210,255,170,0.95)');
    g.addColorStop(1, 'rgba(210,255,170,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }

  // Виньетка — чтобы интерфейс читался, края темнее.
  const v = c.createRadialGradient(W / 2, H * 0.5, W * 0.35, W / 2, H * 0.5, H * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.5)');
  c.fillStyle = v;
  c.fillRect(0, 0, W, H);
}

/**
 * Поле боя «поляна на опушке»: сверху кромка леса в дымке, ниже трава (тайл tile_grass_01 или заливка),
 * в центре вытоптанная земляная площадка (tile_dirt) с мягким краем — там стоят отряды (y ≈ 55–90% экрана),
 * по краям кусты, камни, цветы; тени крон сверху и виньетка.
 */
function drawMeadow(c: Ctx, W: number, H: number, grass: CanvasImageSource | null, dirt: CanvasImageSource | null): void {
  let seed = 23;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const between = (a: number, b: number) => a + rnd() * (b - a);
  const horizon = H * 0.36;

  // Небо и дальний лес.
  const sky = c.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#7fb0a8');
  sky.addColorStop(1, '#d3e6c6');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, horizon + 10);
  const crowns = (base: number, color: string, rMin: number, rMax: number, step: number) => {
    c.fillStyle = color;
    for (let x = -30; x < W + 40; x += between(step * 0.7, step * 1.3)) {
      const r = between(rMin, rMax);
      c.beginPath();
      c.arc(x, base - r * 0.6, r, 0, Math.PI * 2);
      c.arc(x + r * 0.6, base - r * 0.3, r * 0.8, 0, Math.PI * 2);
      c.fill();
    }
    c.fillRect(0, base - 4, W, 30);
  };
  crowns(horizon - 70, '#6f9878', 40, 70, 60);
  // Высокие деревья кромки леса: ствол и крона в два тона (свет сверху слева).
  const tall = (x: number, base: number, h: number) => {
    c.fillStyle = '#3a2c1e';
    c.fillRect(x - h * 0.03, base - h * 0.5, h * 0.06, h * 0.5);
    const cy = base - h * 0.68;
    const r = h * 0.2;
    c.fillStyle = '#2e5a3a';
    for (let i = 0; i < 6; i++) {
      c.beginPath();
      c.arc(x + between(-r, r) * 0.9, cy + between(-r, r) * 0.7, r * between(0.6, 0.9), 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = 'rgba(120,175,110,0.55)';
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      c.arc(x - r * 0.35 + between(-r, r) * 0.4, cy - r * 0.45 + between(-r, r) * 0.3, r * between(0.25, 0.45), 0, Math.PI * 2);
      c.fill();
    }
  };
  for (let x = -20; x < W + 40; x += between(70, 120)) tall(x, horizon - 10 + between(-10, 10), between(170, 260));
  crowns(horizon - 20, '#3f6e4e', 50, 90, 80);
  crowns(horizon + 10, '#2c5639', 60, 100, 95);

  // Трава: тайл или заливка, к горизонту светлее (дымка).
  if (grass) {
    const pat = c.createPattern(grass, 'repeat');
    if (pat) {
      pat.setTransform(new DOMMatrix().scale(0.7));
      c.fillStyle = pat;
      c.fillRect(0, horizon, W, H - horizon);
    }
  } else {
    c.fillStyle = '#4c7a4a';
    c.fillRect(0, horizon, W, H - horizon);
  }
  const haze = c.createLinearGradient(0, horizon, 0, horizon + H * 0.18);
  haze.addColorStop(0, 'rgba(190,215,180,0.55)');
  haze.addColorStop(1, 'rgba(190,215,180,0)');
  c.fillStyle = haze;
  c.fillRect(0, horizon, W, H * 0.18);

  // Тени крон на траве под кромкой леса.
  c.fillStyle = 'rgba(10,30,15,0.25)';
  for (let x = -20; x < W + 20; x += between(60, 110)) {
    c.beginPath();
    c.ellipse(x, horizon + between(15, 40), between(50, 90), between(14, 24), 0, 0, Math.PI * 2);
    c.fill();
  }

  // Вытоптанная площадка: земля с мягким краем (рисуем в отдельный слой и гасим края радиальной маской).
  const cx = W / 2;
  const cy = H * 0.7;
  const rx = W * 0.47;
  const ry = H * 0.21;
  const layer = document.createElement('canvas');
  layer.width = W;
  layer.height = H;
  const l = layer.getContext('2d');
  if (l) {
    if (dirt) {
      const pat = l.createPattern(dirt, 'repeat');
      if (pat) {
        pat.setTransform(new DOMMatrix().scale(0.8));
        l.fillStyle = pat;
      }
    } else l.fillStyle = '#8a6a44';
    l.fillRect(0, 0, W, H);
    l.globalCompositeOperation = 'destination-in';
    l.save();
    l.translate(cx, cy);
    l.scale(1, ry / rx);
    const m = l.createRadialGradient(0, 0, rx * 0.55, 0, 0, rx);
    m.addColorStop(0, 'rgba(0,0,0,0.85)');
    m.addColorStop(1, 'rgba(0,0,0,0)');
    l.fillStyle = m;
    l.fillRect(-rx, -rx, rx * 2, rx * 2);
    l.restore();
    c.drawImage(layer, 0, 0);
  }

  // Пучки травы, цветы, камни.
  for (let i = 0; i < 70; i++) {
    const x = between(0, W);
    const y = between(horizon + 30, H);
    const inside = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 0.8;
    if (inside) continue;
    const k = (y - horizon) / (H - horizon);
    c.strokeStyle = 'rgba(30,70,30,0.8)';
    c.lineWidth = 1.5 + k * 1.5;
    for (let j = 0; j < 5; j++) {
      c.beginPath();
      c.moveTo(x + j * 3, y);
      c.lineTo(x + j * 3 + between(-6, 6), y - (8 + k * 14));
      c.stroke();
    }
  }
  const flowers = ['#f3e27a', '#f0f0e8', '#e8a0c8', '#9fc7ff'];
  for (let i = 0; i < 60; i++) {
    const x = between(0, W);
    const y = between(horizon + 40, H);
    if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 0.9) continue;
    const k = (y - horizon) / (H - horizon);
    c.fillStyle = flowers[i % flowers.length];
    c.beginPath();
    c.arc(x, y, 1.5 + k * 2.5, 0, Math.PI * 2);
    c.fill();
  }
  for (let i = 0; i < 9; i++) {
    const x = rnd() < 0.5 ? between(10, W * 0.18) : between(W * 0.82, W - 10);
    const y = between(H * 0.5, H * 0.95);
    const r = between(10, 22);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath();
    c.ellipse(x + 3, y + r * 0.5, r, r * 0.35, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#8e948a';
    c.beginPath();
    c.ellipse(x, y, r, r * 0.65, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.beginPath();
    c.ellipse(x - r * 0.3, y - r * 0.25, r * 0.45, r * 0.25, 0, 0, Math.PI * 2);
    c.fill();
  }
  // Кусты по бокам.
  const bush = (x: number, y: number, r: number) => {
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath();
    c.ellipse(x, y + r * 0.6, r * 1.3, r * 0.35, 0, 0, Math.PI * 2);
    c.fill();
    for (const [dx, dy, f, col] of [[-0.6, 0.1, 0.8, '#2d5a32'], [0.6, 0.15, 0.75, '#2d5a32'], [0, -0.2, 1, '#3a6e3c'], [-0.2, -0.45, 0.55, '#4f8a4c']] as const) {
      c.fillStyle = col;
      c.beginPath();
      c.arc(x + dx * r, y + dy * r, r * f, 0, Math.PI * 2);
      c.fill();
    }
  };
  bush(30, H * 0.52, 55);
  bush(W - 25, H * 0.58, 60);
  bush(10, H * 0.93, 80);
  bush(W - 5, H * 0.97, 85);

  // Виньетка: края и низ темнее, центр поляны светлый.
  const v = c.createRadialGradient(W / 2, H * 0.62, W * 0.4, W / 2, H * 0.62, H * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,15,5,0.55)');
  c.fillStyle = v;
  c.fillRect(0, 0, W, H);
}
