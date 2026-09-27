import Phaser from 'phaser';
import { BLEED_X, BLEED_Y, FONT, GAME_H, GAME_W } from './layout';

/**
 * Вид экрана загрузки (BootScene) — «тёмное золото» скина, но без его текстур (скин строится после загрузки):
 * тёплый полумрак, лента-заголовок, орнамент, полоса с фаской. Всё рисуется маленькими canvas-текстурами сразу в preload.
 *
 * HTML-заставка в index.html (#splash) повторяет ровно эту раскладку и цвета в CSS — первый кадр Phaser сменяет её
 * без «скачка». Меняете числа здесь — поменяйте и там (BOOT в комментарии CSS).
 */
export const BOOT = {
  /** Центр свечения фона (мир) и его радиус. */
  glowY: GAME_H / 2 - 100,
  glowR: 1300,
  /** Лента-заголовок. */
  ribbonY: GAME_H / 2 - 210,
  ribbonW: 820,
  ribbonH: 150,
  notch: 46,
  titleSize: 92,
  /** Орнамент под лентой. */
  ornamentY: GAME_H / 2 - 100,
  /** Полоса загрузки: рамка и жёлоб. */
  barY: GAME_H / 2 + 120,
  frameW: 800,
  frameH: 84,
  barW: 760,
  barH: 44,
  labelY: GAME_H / 2 + 200,
  hintY: GAME_H / 2 + 262,
} as const;

/** Цвета — те же, что в CSS заставки. */
export const BOOT_COLORS = {
  bgCenter: '#2b2218',
  bgMid: '#16130e',
  bgEdge: '#0a0907',
  gold: '#f0cf8a',
  goldDark: '#8f6a2c',
  clothTop: '#7a2a1e',
  clothMid: '#5a1a12',
  clothBottom: '#3a0e0a',
  title: '#ffe9a8',
  titleStroke: '#1a0806',
  bronzeLight: '#a8864f',
  bronzeDark: '#4a3b25',
  frame: '#070605',
  troughTop: '#0c0b09',
  troughBottom: '#1b1813',
  fillTop: '#ffe6a6',
  fillMid: '#d9a54c',
  fillBottom: '#b27a26',
  label: '#eadfc6',
  hint: '#8a8e98',
} as const;

type Ctx = CanvasRenderingContext2D;

function canvas(scene: Phaser.Scene, key: string, w: number, h: number, draw: (c: Ctx) => void): string {
  if (scene.textures.exists(key)) return key;
  const t = scene.textures.createCanvas(key, w, h);
  if (!t) return '__WHITE';
  draw(t.getContext());
  t.refresh();
  return key;
}

function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function vgrad(c: Ctx, y0: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = c.createLinearGradient(0, y0, 0, y1);
  for (const [at, col] of stops) g.addColorStop(at, col);
  return g;
}

/** Фон: радиальное тёплое свечение на весь мир с полями (¼ разрешения — градиент гладкий и так). */
function backgroundKey(scene: Phaser.Scene): string {
  const q = 4;
  const W = (GAME_W + 2 * BLEED_X) / q;
  const H = (GAME_H + 2 * BLEED_Y) / q;
  return canvas(scene, 'boot_bg', W, H, (c) => {
    const x = (GAME_W / 2 + BLEED_X) / q;
    const y = (BOOT.glowY + BLEED_Y) / q;
    const g = c.createRadialGradient(x, y, 0, x, y, BOOT.glowR / q);
    g.addColorStop(0, BOOT_COLORS.bgCenter);
    g.addColorStop(0.45, BOOT_COLORS.bgMid);
    g.addColorStop(1, BOOT_COLORS.bgEdge);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  });
}

/** Лента: золотая кромка, тёмно-красное полотно, вырезы на концах (как skin_ribbon). */
function ribbonKey(scene: Phaser.Scene): string {
  const { ribbonW: W, ribbonH: H, notch: N } = BOOT;
  return canvas(scene, 'boot_ribbon', W, H, (c) => {
    const shape = (i: number) => {
      c.beginPath();
      c.moveTo(i, i);
      c.lineTo(W - i, i);
      c.lineTo(W - N - i / 2, H / 2);
      c.lineTo(W - i, H - i);
      c.lineTo(i, H - i);
      c.lineTo(N + i / 2, H / 2);
      c.closePath();
    };
    shape(0);
    c.fillStyle = vgrad(c, 0, H, [[0, BOOT_COLORS.gold], [1, BOOT_COLORS.goldDark]]);
    c.fill();
    shape(5);
    c.fillStyle = vgrad(c, 0, H, [[0, BOOT_COLORS.clothTop], [0.5, BOOT_COLORS.clothMid], [1, BOOT_COLORS.clothBottom]]);
    c.fill();
  });
}

/** Рамка полосы: бронзовое кольцо, тёмная окантовка, утопленный жёлоб. */
function frameKey(scene: Phaser.Scene): string {
  const { frameW: W, frameH: H, barW, barH } = BOOT;
  return canvas(scene, 'boot_bar_frame', W, H, (c) => {
    rr(c, 0, 0, W, H, H / 2);
    c.fillStyle = vgrad(c, 0, H, [[0, BOOT_COLORS.bronzeLight], [1, BOOT_COLORS.bronzeDark]]);
    c.fill();
    rr(c, 4, 4, W - 8, H - 8, H / 2 - 4);
    c.fillStyle = BOOT_COLORS.frame;
    c.fill();
    const x = (W - barW) / 2;
    const y = (H - barH) / 2;
    rr(c, x, y, barW, barH, barH / 2);
    c.fillStyle = vgrad(c, y, y + barH, [[0, BOOT_COLORS.troughTop], [1, BOOT_COLORS.troughBottom]]);
    c.fill();
  });
}

/** Заливка полосы: золото с фаской (светлее сверху) и бликом; показывается обрезкой по прогрессу. */
function fillKey(scene: Phaser.Scene): string {
  const { barW: W, barH: H } = BOOT;
  return canvas(scene, 'boot_bar_fill', W, H, (c) => {
    rr(c, 0, 0, W, H, H / 2);
    c.fillStyle = vgrad(c, 0, H, [[0, BOOT_COLORS.fillTop], [0.5, BOOT_COLORS.fillMid], [1, BOOT_COLORS.fillBottom]]);
    c.fill();
    c.save();
    rr(c, 0, 0, W, H, H / 2);
    c.clip();
    c.fillStyle = 'rgba(255,248,220,0.55)';
    c.fillRect(0, 4, W, 6);
    c.fillStyle = 'rgba(60,30,0,0.35)';
    c.fillRect(0, H - 6, W, 6);
    c.restore();
  });
}

function textStyle(size: number, color: string, stroke = 0, strokeColor = '#000000'): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: FONT, fontSize: `${size}px`, color, fontStyle: stroke ? 'bold' : 'normal', stroke: strokeColor, strokeThickness: stroke, align: 'center' };
}

export interface BootView {
  setProgress: (p: number) => void;
  label: Phaser.GameObjects.Text;
  hint: Phaser.GameObjects.Text;
}

/** Нарисовать экран загрузки. setProgress(0..1) — ширина золотой заливки. */
export function drawBoot(scene: Phaser.Scene): BootView {
  const cx = GAME_W / 2;
  scene.add.image(cx, GAME_H / 2, backgroundKey(scene)).setDisplaySize(GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y);
  scene.add.image(cx, BOOT.ribbonY, ribbonKey(scene));
  const title = scene.add.text(cx, BOOT.ribbonY - 2, 'Chronoworld', textStyle(BOOT.titleSize, BOOT_COLORS.title, 8, BOOT_COLORS.titleStroke)).setOrigin(0.5);
  title.setShadow(0, 4, 'rgba(0,0,0,0.6)', 2, true, false);
  // Орнамент: золотая черта, гаснущая к краям, и ромб по центру.
  const g = scene.add.graphics();
  for (let i = 0; i < 24; i++) {
    const a = 1 - Math.abs(i - 11.5) / 12;
    g.fillStyle(0xe8c67e, a * 0.9).fillRect(cx - 240 + i * 20, BOOT.ornamentY - 2, 20, 4);
  }
  g.fillStyle(0x0a0907, 1).fillPoints(diamond(cx, BOOT.ornamentY, 17), true);
  g.fillStyle(0xf0cf8a, 1).fillPoints(diamond(cx, BOOT.ornamentY, 12), true);
  scene.add.image(cx, BOOT.barY, frameKey(scene));
  const fill = scene.add.image(cx - BOOT.barW / 2, BOOT.barY, fillKey(scene)).setOrigin(0, 0.5);
  fill.setCrop(0, 0, 0, BOOT.barH);
  const label = scene.add.text(cx, BOOT.labelY, 'Загрузка… 0%', textStyle(42, BOOT_COLORS.label)).setOrigin(0.5);
  const hint = scene.add.text(cx, BOOT.hintY, '', textStyle(28, BOOT_COLORS.hint)).setOrigin(0.5);
  return {
    setProgress: (p) => fill.setCrop(0, 0, Math.round(BOOT.barW * Phaser.Math.Clamp(p, 0, 1)), BOOT.barH),
    label,
    hint,
  };
}

function diamond(x: number, y: number, r: number): Phaser.Math.Vector2[] {
  return [new Phaser.Math.Vector2(x, y - r), new Phaser.Math.Vector2(x + r, y), new Phaser.Math.Vector2(x, y + r), new Phaser.Math.Vector2(x - r, y)];
}
