import Phaser from 'phaser';
import type { SkillDef, StatusDef } from '../core';
import { ELEMENT_COLORS, lookOf, statusIconOf, type Glyph, type SkillLook, type StatusIcon } from './skillLook';

/**
 * Значки навыков в стиле скина «тёмная бронза»: рамка (золотая у активных, приглушённая восьмиугольная у пассивок),
 * фон в цвете стихии и крупный символ, нарисованный путями canvas. Текстура `skill_<id>` создаётся по требованию
 * (в памяти только показанные навыки). Если художник положит `assets/ui/icons/skill_<id>.png`, BootScene загрузит её
 * под тем же ключом — тогда рисовать не нужно.
 */

type Ctx = CanvasRenderingContext2D;

export const SKILL_ICON_SIZE = 96;
export const skillIconKey = (id: string) => `skill_${id}`;

/** Готовые PNG значков (assets/ui/icons/skill_<id>.png) — известны при сборке. */
const FILES = Object.keys(import.meta.glob('../../assets/ui/icons/skill_*.png', { query: '?url', import: 'default' }));

/** BootScene: поставить в очередь PNG значков (если есть). Путь — от корня assets, как в манифесте. */
export function queueSkillIconFiles(scene: Phaser.Scene): void {
  for (const f of FILES) {
    const name = f.split('/').pop()!.replace(/\.png$/, '');
    scene.load.image(name, `ui/icons/${name}.png`);
  }
}

/** Ключ текстуры значка навыка; рисует его, если ещё нет. Неизвестный навык — нейтральный значок. */
export function skillIcon(scene: Phaser.Scene, skill: SkillDef | undefined): string {
  if (!skill) return ensureFallback(scene);
  const key = skillIconKey(skill.id);
  if (scene.textures.exists(key)) return key;
  const t = scene.textures.createCanvas(key, SKILL_ICON_SIZE, SKILL_ICON_SIZE);
  if (!t) return ensureFallback(scene);
  drawSkillIcon(t.getContext(), SKILL_ICON_SIZE, lookOf(skill));
  t.refresh();
  return key;
}

function ensureFallback(scene: Phaser.Scene): string {
  const key = 'skill__unknown';
  if (!scene.textures.exists(key)) {
    const t = scene.textures.createCanvas(key, SKILL_ICON_SIZE, SKILL_ICON_SIZE);
    if (t) {
      drawSkillIcon(t.getContext(), SKILL_ICON_SIZE, { element: 'neutral', glyph: 'orb', aoe: false, passive: false });
      t.refresh();
    }
  }
  return key;
}

// ---------- рамка и фон ----------

function roundRect(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** Восьмиугольник со срезанными углами — форма пассивок (отличается от скруглённого квадрата активных). */
function octagon(c: Ctx, x: number, y: number, w: number, h: number, cut: number): void {
  c.beginPath();
  c.moveTo(x + cut, y);
  c.lineTo(x + w - cut, y);
  c.lineTo(x + w, y + cut);
  c.lineTo(x + w, y + h - cut);
  c.lineTo(x + w - cut, y + h);
  c.lineTo(x + cut, y + h);
  c.lineTo(x, y + h - cut);
  c.lineTo(x, y + cut);
  c.closePath();
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return hex((ch(16) << 16) | (ch(8) << 8) | ch(0));
}

/** Нарисовать значок в canvas size×size (экспорт — для листа-превью в тестах/скриптах). */
export function drawSkillIcon(c: Ctx, size: number, look: SkillLook): void {
  const col = ELEMENT_COLORS[look.element];
  const passive = look.passive;
  const pad = size * 0.04;
  const w = size - pad * 2;
  const shape = () => (passive ? octagon(c, pad, pad, w, w, size * 0.2) : roundRect(c, pad, pad, w, w, size * 0.16));

  // Фон: радиальный градиент стихии (у пассивок — приглушённый, ближе к бронзе).
  const main = hex(col.main);
  const bright = passive ? mix(main, '#3a342b', 0.55) : main;
  const deep = passive ? mix(col.dark, '#1a1815', 0.5) : col.dark;
  const g = c.createRadialGradient(size * 0.38, size * 0.32, size * 0.05, size * 0.5, size * 0.5, size * 0.72);
  g.addColorStop(0, bright);
  g.addColorStop(0.55, mix(bright, deep, 0.6));
  g.addColorStop(1, deep);
  shape();
  c.fillStyle = g;
  c.fill();

  // Внутренняя тень к краям — объём.
  c.save();
  shape();
  c.clip();
  const v = c.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  c.fillStyle = v;
  c.fillRect(0, 0, size, size);
  if (look.aoe) rays(c, size, passive ? 'rgba(255,240,200,0.12)' : 'rgba(255,245,210,0.28)');
  c.restore();

  // Символ.
  c.save();
  c.translate(size / 2, size / 2);
  c.scale(size / 64, size / 64);
  c.translate(-32, -32);
  drawGlyph(c, look.glyph, glyphFill(look), passive);
  c.restore();

  // Рамка: активные — золотой скос с бликом, пассивки — тёмная бронза и пунктир внутри.
  shape();
  if (passive) {
    c.lineWidth = size * 0.05;
    c.strokeStyle = '#5c4b31';
    c.stroke();
    octagon(c, pad + size * 0.07, pad + size * 0.07, w - size * 0.14, w - size * 0.14, size * 0.16);
    c.setLineDash([size * 0.05, size * 0.04]);
    c.lineWidth = size * 0.018;
    c.strokeStyle = 'rgba(214,174,99,0.45)';
    c.stroke();
    c.setLineDash([]);
  } else {
    const fg = c.createLinearGradient(0, 0, 0, size);
    fg.addColorStop(0, '#f6dc9c');
    fg.addColorStop(0.5, '#d6ae63');
    fg.addColorStop(1, '#7a5522');
    c.lineWidth = size * 0.06;
    c.strokeStyle = fg;
    c.stroke();
    roundRect(c, pad + size * 0.05, pad + size * 0.05, w - size * 0.1, w - size * 0.1, size * 0.12);
    c.lineWidth = size * 0.014;
    c.strokeStyle = 'rgba(255,240,200,0.35)';
    c.stroke();
  }
}

function rays(c: Ctx, size: number, color: string): void {
  c.save();
  c.translate(size / 2, size / 2);
  c.fillStyle = color;
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(Math.cos(a - 0.12) * size, Math.sin(a - 0.12) * size);
    c.lineTo(Math.cos(a + 0.12) * size, Math.sin(a + 0.12) * size);
    c.closePath();
    c.fill();
  }
  c.restore();
}

/** Цвет символа: особые (лечение — зелёный крест, провокация — красный «!»), иначе светлый цвет стихии. */
function glyphFill(look: SkillLook): [string, string] {
  if (look.glyph === 'cross') return ['#e8ffe0', '#3fcf5a'];
  if (look.glyph === 'bang') return ['#ffd0c0', '#e0302a'];
  if (look.glyph === 'down') return ['#ffd8c8', '#e0603a'];
  if (look.glyph === 'up') return ['#fff6c8', '#e8a82a'];
  if (look.glyph === 'haste') return ['#e0f6ff', '#4ab0f0'];
  if (look.glyph === 'coin') return ['#fff3b0', '#d6a02a'];
  const col = ELEMENT_COLORS[look.element];
  return ['#ffffff', col.light];
}

// ---------- символы (координаты 64×64) ----------

function finish(c: Ctx, fill: [string, string], passive: boolean): void {
  const g = c.createLinearGradient(0, 8, 0, 56);
  g.addColorStop(0, fill[0]);
  g.addColorStop(1, fill[1]);
  c.globalAlpha = passive ? 0.85 : 1;
  c.shadowColor = 'rgba(0,0,0,0.6)';
  c.shadowBlur = 4;
  c.shadowOffsetY = 1.5;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.lineWidth = 3;
  c.strokeStyle = '#1a0f06';
  c.stroke();
  c.shadowColor = 'transparent';
  c.fillStyle = g;
  c.fill();
  c.globalAlpha = 1;
}

/** Контурный символ (линии): обводка тёмным, поверх — светлая линия. */
function strokeGlyph(c: Ctx, fill: [string, string], width: number, passive: boolean): void {
  c.globalAlpha = passive ? 0.85 : 1;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.lineWidth = width + 4;
  c.strokeStyle = '#1a0f06';
  c.stroke();
  const g = c.createLinearGradient(0, 8, 0, 56);
  g.addColorStop(0, fill[0]);
  g.addColorStop(1, fill[1]);
  c.lineWidth = width;
  c.strokeStyle = g;
  c.stroke();
  c.globalAlpha = 1;
}

function star(c: Ctx, x: number, y: number, r: number, points = 5, inner = 0.45): void {
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rr = i % 2 ? r * inner : r;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i) c.lineTo(px, py);
    else c.moveTo(px, py);
  }
  c.closePath();
}

function shieldPath(c: Ctx, cx: number, top: number, w: number, h: number): void {
  c.moveTo(cx, top);
  c.quadraticCurveTo(cx + w * 0.3, top + h * 0.1, cx + w / 2, top + h * 0.08);
  c.quadraticCurveTo(cx + w / 2, top + h * 0.7, cx, top + h);
  c.quadraticCurveTo(cx - w / 2, top + h * 0.7, cx - w / 2, top + h * 0.08);
  c.quadraticCurveTo(cx - w * 0.3, top + h * 0.1, cx, top);
  c.closePath();
}

function upArrow(c: Ctx, cx: number, top: number, w: number, h: number): void {
  c.moveTo(cx, top);
  c.lineTo(cx + w / 2, top + h * 0.45);
  c.lineTo(cx + w * 0.18, top + h * 0.45);
  c.lineTo(cx + w * 0.18, top + h);
  c.lineTo(cx - w * 0.18, top + h);
  c.lineTo(cx - w * 0.18, top + h * 0.45);
  c.lineTo(cx - w / 2, top + h * 0.45);
  c.closePath();
}

/** Диагональная стрела из (x0,y0) остриём в (x1,y1). */
function arrowLine(c: Ctx, x0: number, y0: number, x1: number, y1: number, head: number): void {
  const a = Math.atan2(y1 - y0, x1 - x0);
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.moveTo(x1 - Math.cos(a - 0.5) * head, y1 - Math.sin(a - 0.5) * head);
  c.lineTo(x1, y1);
  c.lineTo(x1 - Math.cos(a + 0.5) * head, y1 - Math.sin(a + 0.5) * head);
  // Оперение.
  c.moveTo(x0, y0);
  c.lineTo(x0 - Math.cos(a - 0.7) * head * 0.7, y0 - Math.sin(a - 0.7) * head * 0.7);
  c.moveTo(x0, y0);
  c.lineTo(x0 - Math.cos(a + 0.7) * head * 0.7, y0 - Math.sin(a + 0.7) * head * 0.7);
}

const GLYPHS: Record<Glyph, (c: Ctx, f: [string, string], p: boolean) => void> = {
  cross: (c, f, p) => {
    // Один контур «плюса» — чтобы обводка не рисовала линию по центру.
    c.beginPath();
    c.moveTo(25, 10); c.lineTo(39, 10); c.lineTo(39, 25); c.lineTo(54, 25); c.lineTo(54, 39); c.lineTo(39, 39);
    c.lineTo(39, 54); c.lineTo(25, 54); c.lineTo(25, 39); c.lineTo(10, 39); c.lineTo(10, 25); c.lineTo(25, 25); c.closePath();
    finish(c, f, p);
  },
  shield: (c, f, p) => {
    c.beginPath();
    shieldPath(c, 32, 9, 40, 46);
    finish(c, f, p);
    c.beginPath();
    c.moveTo(32, 16); c.lineTo(32, 48); c.moveTo(20, 24); c.lineTo(44, 24);
    c.lineWidth = 2.5; c.strokeStyle = 'rgba(40,24,8,0.55)'; c.stroke();
  },
  up: (c, f, p) => {
    c.beginPath();
    upArrow(c, 32, 8, 38, 48);
    finish(c, f, p);
  },
  haste: (c, f, p) => {
    c.beginPath();
    c.moveTo(14, 30); c.lineTo(32, 12); c.lineTo(50, 30);
    c.moveTo(14, 50); c.lineTo(32, 32); c.lineTo(50, 50);
    strokeGlyph(c, f, 7, p);
  },
  guard: (c, f, p) => {
    c.beginPath();
    shieldPath(c, 32, 8, 42, 48);
    finish(c, f, p);
    c.beginPath();
    upArrow(c, 32, 17, 18, 26);
    c.fillStyle = 'rgba(40,24,8,0.7)'; c.fill();
  },
  down: (c, f, p) => {
    c.save();
    c.translate(32, 32); c.rotate(Math.PI); c.translate(-32, -32);
    c.beginPath();
    upArrow(c, 32, 8, 38, 48);
    c.restore();
    finish(c, f, p);
  },
  bang: (c, f, p) => {
    c.beginPath();
    c.moveTo(25, 8); c.lineTo(39, 8); c.lineTo(36, 40); c.lineTo(28, 40); c.closePath();
    c.moveTo(39, 50); c.arc(32, 50, 7, 0, Math.PI * 2);
    finish(c, f, p);
  },
  stars: (c, f, p) => {
    c.beginPath();
    star(c, 32, 16, 10);
    star(c, 15, 40, 9);
    star(c, 49, 40, 9);
    finish(c, f, p);
  },
  flame: (c, f, p) => {
    c.beginPath();
    c.moveTo(32, 6);
    c.bezierCurveTo(40, 18, 52, 26, 50, 40);
    c.bezierCurveTo(49, 52, 40, 58, 32, 58);
    c.bezierCurveTo(22, 58, 14, 51, 14, 40);
    c.bezierCurveTo(14, 30, 22, 26, 24, 16);
    c.bezierCurveTo(28, 22, 28, 28, 30, 30);
    c.bezierCurveTo(32, 22, 30, 14, 32, 6);
    c.closePath();
    finish(c, f, p);
    c.beginPath();
    c.moveTo(32, 30);
    c.bezierCurveTo(38, 38, 42, 44, 38, 52);
    c.bezierCurveTo(34, 56, 26, 55, 25, 48);
    c.bezierCurveTo(24, 42, 30, 38, 32, 30);
    c.fillStyle = 'rgba(255,255,230,0.85)'; c.fill();
  },
  snow: (c, f, p) => {
    c.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 - Math.PI / 2;
      const ex = 32 + Math.cos(a) * 24;
      const ey = 32 + Math.sin(a) * 24;
      c.moveTo(32, 32); c.lineTo(ex, ey);
      const bx = 32 + Math.cos(a) * 15;
      const by = 32 + Math.sin(a) * 15;
      c.moveTo(bx, by); c.lineTo(bx + Math.cos(a - 0.9) * 8, by + Math.sin(a - 0.9) * 8);
      c.moveTo(bx, by); c.lineTo(bx + Math.cos(a + 0.9) * 8, by + Math.sin(a + 0.9) * 8);
    }
    strokeGlyph(c, f, 4, p);
  },
  bolt: (c, f, p) => {
    c.beginPath();
    c.moveTo(38, 5); c.lineTo(16, 36); c.lineTo(29, 36); c.lineTo(24, 59); c.lineTo(48, 26); c.lineTo(35, 26); c.lineTo(42, 5);
    c.closePath();
    finish(c, f, p);
  },
  spike: (c, f, p) => {
    c.beginPath();
    c.moveTo(8, 54); c.lineTo(18, 26); c.lineTo(24, 40); c.lineTo(32, 8); c.lineTo(40, 40); c.lineTo(46, 22); c.lineTo(56, 54);
    c.closePath();
    finish(c, f, p);
  },
  holy: (c, f, p) => {
    c.beginPath();
    star(c, 32, 32, 26, 4, 0.28);
    finish(c, f, p);
    c.beginPath();
    star(c, 32, 32, 12, 4, 0.35);
    c.fillStyle = 'rgba(255,255,255,0.9)'; c.fill();
  },
  drop: (c, f, p) => {
    c.beginPath();
    c.moveTo(32, 6);
    c.bezierCurveTo(40, 20, 50, 30, 50, 40);
    c.arc(32, 40, 18, 0, Math.PI, false);
    c.bezierCurveTo(14, 30, 24, 20, 32, 6);
    c.closePath();
    finish(c, f, p);
    c.beginPath(); c.ellipse(25, 40, 3.5, 6, -0.4, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,255,255,0.7)'; c.fill();
  },
  skull: (c, f, p) => {
    c.beginPath();
    c.arc(32, 28, 19, Math.PI * 0.8, Math.PI * 0.2);
    c.lineTo(44, 44); c.lineTo(42, 54); c.lineTo(22, 54); c.lineTo(20, 44);
    c.closePath();
    finish(c, f, p);
    c.beginPath();
    c.ellipse(24.5, 30, 5, 6, 0, 0, Math.PI * 2);
    c.ellipse(39.5, 30, 5, 6, 0, 0, Math.PI * 2);
    c.moveTo(32, 37); c.lineTo(29, 43); c.lineTo(35, 43); c.closePath();
    c.fillStyle = '#1a0f06'; c.fill();
  },
  orb: (c, f, p) => {
    c.beginPath(); c.arc(32, 32, 18, 0, Math.PI * 2);
    finish(c, f, p);
    c.beginPath(); c.ellipse(32, 32, 26, 9, -0.5, 0, Math.PI * 2);
    strokeGlyph(c, f, 2.5, p);
    c.beginPath(); c.arc(26, 26, 5, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,255,255,0.85)'; c.fill();
  },
  arrow: (c, f, p) => {
    c.beginPath();
    arrowLine(c, 12, 52, 52, 12, 12);
    strokeGlyph(c, f, 4.5, p);
  },
  arrows: (c, f, p) => {
    c.beginPath();
    arrowLine(c, 10, 8, 26, 44, 9);
    arrowLine(c, 26, 6, 42, 42, 9);
    arrowLine(c, 42, 10, 56, 44, 9);
    strokeGlyph(c, f, 3.5, p);
  },
  sword: (c, f, p) => {
    c.beginPath();
    c.moveTo(50, 8); c.lineTo(56, 8); c.lineTo(56, 14); c.lineTo(26, 44); c.lineTo(20, 38); c.closePath();
    finish(c, f, p);
    c.beginPath();
    c.moveTo(14, 36); c.lineTo(28, 50);
    c.moveTo(22, 42); c.lineTo(10, 54);
    strokeGlyph(c, ['#f6dc9c', '#9a6a2a'], 5, p);
  },
  slashes: (c, f, p) => {
    c.beginPath();
    for (const d of [-12, 0, 12]) {
      c.moveTo(18 + d, 54); c.quadraticCurveTo(22 + d, 30, 46 + d, 10);
    }
    strokeGlyph(c, f, 5, p);
  },
  sweep: (c, f, p) => {
    // Широкий полумесяц удара с «хвостом».
    c.beginPath();
    c.arc(30, 36, 26, Math.PI * 0.95, Math.PI * 1.9);
    c.quadraticCurveTo(40, 24, 18, 36);
    c.quadraticCurveTo(10, 44, 8, 50);
    c.closePath();
    finish(c, f, p);
    c.beginPath();
    c.moveTo(40, 44); c.lineTo(56, 40); c.moveTo(36, 52); c.lineTo(52, 52);
    strokeGlyph(c, f, 3, p);
  },
  dash: (c, f, p) => {
    c.beginPath();
    c.moveTo(56, 32); c.lineTo(38, 16); c.lineTo(38, 25); c.lineTo(22, 25); c.lineTo(22, 39); c.lineTo(38, 39); c.lineTo(38, 48);
    c.closePath();
    finish(c, f, p);
    c.beginPath();
    c.moveTo(8, 22); c.lineTo(16, 22); c.moveTo(4, 32); c.lineTo(16, 32); c.moveTo(8, 42); c.lineTo(16, 42);
    strokeGlyph(c, f, 3, p);
  },
  fist: (c, f, p) => {
    c.beginPath();
    roundRect(c, 14, 18, 36, 30, 9);
    finish(c, f, p);
    c.beginPath();
    c.moveTo(23, 18); c.lineTo(23, 30); c.moveTo(32, 18); c.lineTo(32, 30); c.moveTo(41, 18); c.lineTo(41, 30);
    c.moveTo(14, 34); c.quadraticCurveTo(24, 38, 30, 34);
    c.lineWidth = 2.5; c.strokeStyle = 'rgba(40,24,8,0.7)'; c.stroke();
    c.beginPath();
    c.moveTo(20, 8); c.lineTo(22, 13); c.moveTo(32, 5); c.lineTo(32, 11); c.moveTo(44, 8); c.lineTo(42, 13);
    strokeGlyph(c, f, 2.5, p);
  },
  coin: (c, f, p) => {
    c.beginPath(); c.arc(32, 32, 22, 0, Math.PI * 2);
    finish(c, f, p);
    c.beginPath(); c.arc(32, 32, 15, 0, Math.PI * 2);
    c.lineWidth = 2.5; c.strokeStyle = 'rgba(90,56,10,0.8)'; c.stroke();
    c.beginPath(); star(c, 32, 32, 9);
    c.fillStyle = 'rgba(120,76,14,0.85)'; c.fill();
  },
  note: (c, f, p) => {
    c.beginPath();
    c.ellipse(22, 46, 9, 7, -0.4, 0, Math.PI * 2);
    c.moveTo(29, 44); c.lineTo(29, 10); c.lineTo(48, 18); c.lineTo(48, 26); c.lineTo(33, 20); c.lineTo(33, 44);
    c.closePath();
    finish(c, f, p);
  },
  trap: (c, f, p) => {
    c.beginPath();
    c.arc(32, 40, 22, Math.PI, 0);
    strokeGlyph(c, f, 4, p);
    c.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + ((i + 0.5) / 7) * Math.PI;
      const x = 32 + Math.cos(a) * 22;
      const y = 40 + Math.sin(a) * 22;
      c.moveTo(x, y); c.lineTo(32 + Math.cos(a) * 12, 40 + Math.sin(a) * 12);
    }
    c.moveTo(6, 40); c.lineTo(58, 40);
    strokeGlyph(c, f, 3, p);
  },
  bird: (c, f, p) => {
    c.beginPath();
    c.moveTo(4, 22); c.quadraticCurveTo(20, 18, 32, 36); c.quadraticCurveTo(44, 18, 60, 22);
    c.quadraticCurveTo(46, 30, 36, 46); c.lineTo(32, 54); c.lineTo(28, 46); c.quadraticCurveTo(18, 30, 4, 22);
    c.closePath();
    finish(c, f, p);
  },
};

function drawGlyph(c: Ctx, glyph: Glyph, fill: [string, string], passive: boolean): void {
  GLYPHS[glyph](c, fill, passive);
}

// ---------- значки статусов над полоской HP ----------

export const statusIconKey = (icon: StatusIcon) => `sti_${icon}`;
const STATUS_SIZE = 40;

const STATUS_STYLE: Record<StatusIcon, { bg: string; glyph: Glyph; fill: [string, string] }> = {
  atkUp: { bg: '#8a4a0a', glyph: 'up', fill: ['#fff6c8', '#f0b02a'] },
  atkDown: { bg: '#5a1010', glyph: 'down', fill: ['#ffd0c0', '#e0503a'] },
  defUp: { bg: '#23385a', glyph: 'guard', fill: ['#ffffff', '#a8c8ff'] },
  defDown: { bg: '#4a1a2a', glyph: 'down', fill: ['#ffd0e0', '#d05a8a'] },
  spdUp: { bg: '#10406a', glyph: 'haste', fill: ['#e0f6ff', '#5ac0ff'] },
  spdDown: { bg: '#2a2a3a', glyph: 'down', fill: ['#e0e0f0', '#8a8ab0'] },
  stun: { bg: '#4a3a0a', glyph: 'stars', fill: ['#fff8c0', '#ffd84a'] },
  poison: { bg: '#1b3a0c', glyph: 'drop', fill: ['#e8ffd0', '#7fd04a'] },
  burn: { bg: '#5a1606', glyph: 'flame', fill: ['#fff0c0', '#ff7a2a'] },
};

/** Ключ текстуры значка статуса (кружок с символом), рисует при первом запросе. */
export function statusIcon(scene: Phaser.Scene, st: StatusDef): string {
  const icon = statusIconOf(st);
  const key = statusIconKey(icon);
  if (scene.textures.exists(key)) return key;
  const t = scene.textures.createCanvas(key, STATUS_SIZE, STATUS_SIZE);
  if (!t) return '__DEFAULT';
  const c = t.getContext();
  const s = STATUS_STYLE[icon];
  const r = STATUS_SIZE / 2;
  c.beginPath(); c.arc(r, r, r - 1.5, 0, Math.PI * 2);
  const g = c.createRadialGradient(r * 0.8, r * 0.7, 2, r, r, r);
  g.addColorStop(0, mix(s.bg, '#ffffff', 0.25));
  g.addColorStop(1, s.bg);
  c.fillStyle = g; c.fill();
  c.lineWidth = 2.5; c.strokeStyle = '#d6ae63'; c.stroke();
  c.save();
  c.translate(r, r); c.scale((STATUS_SIZE * 0.7) / 64, (STATUS_SIZE * 0.7) / 64); c.translate(-32, -32);
  drawGlyph(c, s.glyph, s.fill, false);
  c.restore();
  t.refresh();
  return key;
}
