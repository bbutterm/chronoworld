import type Phaser from 'phaser';
import digitsAtlas from '../../assets/fx/damage/numbers.json';
import type { CachedTextStyle } from './perf';

/**
 * Растровые шрифты для цифр боя (урон, крит, магия, лечение, щит): для каждого стиля один раз рисуем глифы
 * тем же `Text` Phaser (тот же шрифт, обводка, разрешение и выравнивание), складываем в лист-холст и регистрируем
 * как BitmapFont. Цифра в бою — `BitmapText.setText`: только пересчёт вершин, без перерисовки canvas, замера
 * шрифта и загрузки текстуры в GPU на каждое попадание (раньше ~27 % JS боя).
 *
 * Вид тот же, что у `Text`: каждый глиф — это картинка `Text` из одного символа, стоящая с тем же шагом
 * (ширины символов и кернинг — `measureText`), рамка и центр — как у `Text` целой строки (см. `NumberFont.origin`).
 */

/** Все символы, которые бывают в цифрах боя (`BattleScene.popNumber`): «-12!», «(30)», «+45», «щит +20». */
export const NUMBER_GLYPHS = '0123456789+-!() щит';

/** Поле вокруг каждого глифа (единицы игры): хвосты букв за шагом символа не обрезаются. */
const PAD = 2;
/** Ширина листа глифов, пикселей текстуры. */
const SHEET_W = 1024;

export interface NumberFont {
  /** Ключ шрифта в cache.bitmapFont (он же ключ текстуры). */
  key: string;
  /** Размер шрифта для BitmapText (единицы игры). */
  size: number;
  /** Толщина обводки: рамка `Text` шире строки на неё. */
  stroke: number;
}

const fonts = new Map<string, NumberFont>();

/** Можно ли нарисовать строку растровым шрифтом цифр (иначе — обычный Text). */
export function coversNumber(value: string): boolean {
  for (let i = 0; i < value.length; i++) if (!NUMBER_GLYPHS.includes(value[i])) return false;
  return value.length > 0;
}

/**
 * Растровый шрифт для стиля надписи (строится один раз на игру для сочетания стиля и разрешения текста).
 * probe — служебный Text сцены (им рисуются глифы; после — пустой, без поля).
 */
export function numberFont(scene: Phaser.Scene, style: CachedTextStyle, probe: Phaser.GameObjects.Text): NumberFont {
  const res = probe.style.resolution || 1;
  const id = `${style.fontStyle}|${style.fontSize}|${style.fontFamily}|${style.color}|${style.stroke}|${style.strokeThickness}|${res}`;
  const known = fonts.get(id);
  if (known && scene.textures.exists(known.key) && scene.cache.bitmapFont.exists(known.key)) return known;

  const key = `numfont_${fonts.size}_${hash(id)}`;
  probe.setPadding(PAD, PAD, PAD, PAD);
  probe.style.setStyle(style, false);
  // Замер шрифта (MeasureText) именно этого размера: setStyle без метрик оставил бы метрики прошлого стиля.
  if (!style.metrics) probe.style.update(true);
  const s = style.strokeThickness;
  const penX = Math.round(s / 2);

  // Глифы: картинка Text из одного символа (с полем PAD) — по порядку в строки листа.
  type Glyph = { ch: string; canvas: HTMLCanvasElement; w: number; h: number; adv: number; x: number; y: number };
  const glyphs: Glyph[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const ch of NUMBER_GLYPHS) {
    probe.setText(ch);
    const w = probe.canvas.width;
    const h = probe.canvas.height;
    const copy = document.createElement('canvas');
    copy.width = w;
    copy.height = h;
    copy.getContext('2d')!.drawImage(probe.canvas, 0, 0);
    if (x + w > SHEET_W) {
      x = 0;
      y += rowH + 1;
      rowH = 0;
    }
    glyphs.push({ ch, canvas: copy, w, h, adv: probe.context.measureText(ch).width, x, y });
    x += w + 1;
    rowH = Math.max(rowH, h);
  }
  // Кернинг пар (у цифр Arial его нет, но шаг строки должен совпадать с measureText целой строки).
  const kern = new Map<string, number>();
  for (const a of glyphs) {
    for (const b of glyphs) {
      const k = probe.context.measureText(a.ch + b.ch).width - a.adv - b.adv;
      if (Math.abs(k) > 0.01) kern.set(a.ch + b.ch, k);
    }
  }
  const metrics = probe.style.getTextMetrics();
  probe.setPadding(0, 0, 0, 0);
  probe.setText('');

  const texW = SHEET_W;
  const texH = y + rowH;
  const tex = scene.textures.createCanvas(key, texW, texH)!;
  const ctx = tex.getContext();
  for (const g of glyphs) ctx.drawImage(g.canvas, g.x, g.y);
  tex.refresh();

  const chars: Record<number, unknown> = {};
  for (const g of glyphs) {
    const code = g.ch.charCodeAt(0);
    const kerning: Record<number, number> = {};
    for (const a of glyphs) {
      const k = kern.get(a.ch + g.ch);
      if (k !== undefined) kerning[a.ch.charCodeAt(0)] = k * res;
    }
    chars[code] = {
      x: g.x,
      y: g.y,
      width: g.w,
      height: g.h,
      centerX: Math.floor(g.w / 2),
      centerY: Math.floor(g.h / 2),
      // Перо Text стоит в (PAD + round(s/2)) от левого края своей картинки, верх строки — в PAD от верха.
      xOffset: -(PAD + penX) * res,
      yOffset: -PAD * res,
      xAdvance: g.adv * res,
      data: {},
      kerning,
      u0: g.x / texW,
      v0: g.y / texH,
      u1: (g.x + g.w) / texW,
      v1: (g.y + g.h) / texH,
    };
    tex.add(g.ch, 0, g.x, g.y, g.w, g.h);
  }
  const size = metrics.fontSize;
  const lineHeight = (metrics.fontSize + s) * res;
  scene.cache.bitmapFont.add(key, { data: { font: key, size: size * res, lineHeight, chars }, texture: key, frame: null });
  const font: NumberFont = { key, size, stroke: s };
  fonts.set(id, font);
  return font;
}

/**
 * Центр как у `Text` той же строки: у Text рамка шире строки на обводку и округлена вверх (ceil),
 * перо — в round(s/2) от левого края; высота — fontSize + s. Для BitmapText (рамка = шаг строки)
 * это нормированный origin по x; по y рамки совпадают (0.5).
 */
export function numberOrigin(font: NumberFont, lineWidth: number): number {
  if (lineWidth <= 0) return 0.5;
  const w = Math.ceil(lineWidth + font.stroke);
  return (w / 2 - Math.round(font.stroke / 2)) / lineWidth;
}

/** Ширина рамки `Text` той же строки (для удержания у края экрана, как раньше). */
export function numberFrameWidth(font: NumberFont, lineWidth: number): number {
  return Math.ceil(lineWidth + font.stroke);
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

// ---------- цифры урона Ragnarok Online ----------

/**
 * Цифры урона RO (docs/RO_EXTRACT_LIST.md §5): кадры 0–9 из клиентского `숫자.spr` — белые с серым градиентом и тёмной
 * обводкой, цвет задаётся умножением (tint), как в клиенте: белые — урон по монстрам, красные — по героям,
 * зелёные — лечение, жёлтые — удар ульты. Знаков (+, −, скобок, букв) в шрифте нет — пишем только число.
 * Атлас `assets/fx/damage/numbers.png` грузит экран загрузки (queueDamageDigits); рамки кадров — из numbers.json в бандле.
 */
export const DAMAGE_DIGITS_KEY = 'fx_damage_numbers';
const RO_FONT_KEY = 'ro_damage_digits';
/** Цифры RO стоят с лёгким нахлёстом обводок (как в клиенте), шаг — ширина кадра минус это. */
const RO_OVERLAP = 3;

type AtlasFrame = { frame: { x: number; y: number; w: number; h: number } };
const ATLAS = digitsAtlas as unknown as { frames: Record<string, AtlasFrame>; meta: { size: { w: number; h: number } } };

/** Высота цифры RO в пикселях атласа. */
export const RO_DIGIT_H = Math.max(...Object.values(ATLAS.frames).map((f) => f.frame.h));

/** Экран загрузки: поставить в очередь атлас цифр урона RO (≈ 2 КБ). */
export function queueDamageDigits(scene: Phaser.Scene): void {
  scene.load.image(DAMAGE_DIGITS_KEY, 'fx/damage/numbers.png');
}

/** Можно ли нарисовать строку цифрами RO (только 0–9). */
export function coversRoDigits(value: string): boolean {
  if (!value.length) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

/** Ключ растрового шрифта цифр RO (строится один раз из атласа) или null — атлас не загрузился (тогда старые цифры). */
export function roDamageFont(scene: Phaser.Scene): string | null {
  if (scene.cache.bitmapFont.exists(RO_FONT_KEY)) return RO_FONT_KEY;
  if (!scene.textures.exists(DAMAGE_DIGITS_KEY)) return null;
  const { w: texW, h: texH } = ATLAS.meta.size;
  const chars: Record<number, unknown> = {};
  for (let d = 0; d <= 9; d++) {
    const f = ATLAS.frames[`numbers_${d}`]?.frame;
    if (!f) return null;
    chars[48 + d] = {
      x: f.x,
      y: f.y,
      width: f.w,
      height: f.h,
      centerX: Math.floor(f.w / 2),
      centerY: Math.floor(f.h / 2),
      xOffset: 0,
      yOffset: RO_DIGIT_H - f.h,
      xAdvance: f.w - RO_OVERLAP,
      data: {},
      kerning: {},
      u0: f.x / texW,
      v0: f.y / texH,
      u1: (f.x + f.w) / texW,
      v1: (f.y + f.h) / texH,
    };
  }
  scene.cache.bitmapFont.add(RO_FONT_KEY, { data: { font: RO_FONT_KEY, size: RO_DIGIT_H, lineHeight: RO_DIGIT_H, chars }, texture: DAMAGE_DIGITS_KEY, frame: null });
  return RO_FONT_KEY;
}
