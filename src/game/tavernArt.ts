import Phaser from 'phaser';
import { GAME_H, GAME_W } from './layout';
import { bleedImage } from './viewport';

/**
 * Таверна (H5): нарисованные текстуры — фон зала, мягкое свечение, круг призыва, луч, рубашка карты.
 * Всё строится один раз на 2D-канвасе и живёт в менеджере текстур. Файл владельца
 * assets/backgrounds/bg_tavern.(jpg|png|webp), если он есть, подменяет нарисованный фон (как фоны глав в backdrops.ts).
 */

export const TAVERN_BG = 'tavern_bg_drawn';
export const TAVERN_BG_FILE = 'bg_tavern';
export const GLOW = 'tavern_glow';
export const CIRCLE = 'tavern_circle';
export const BEAM = 'tavern_beam';
export const CARD_BACK = 'tavern_card_back';
export const SPARK = 'tavern_spark';

const BG_W = 720;
const BG_H = 1280;

/** Файл фона Таверны от художника: URL от корня assets (или null). */
const FILE: string | null = (() => {
  const paths = Object.keys(import.meta.glob('../../assets/backgrounds/bg_tavern.{jpg,png,webp}', { query: '?url', import: 'default' }));
  const name = paths[0]?.split('/').pop();
  return name ? `backgrounds/${name}` : null;
})();
let loadingFile = false;

type Ctx = CanvasRenderingContext2D;

function canvasTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: (c: Ctx) => void): string {
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return '__WHITE';
  draw(tex.getContext());
  tex.refresh();
  return key;
}

/** Все текстуры Таверны (идемпотентно). */
export function ensureTavernTextures(scene: Phaser.Scene): void {
  canvasTexture(scene, TAVERN_BG, BG_W, BG_H, drawTavern);
  canvasTexture(scene, GLOW, 128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });
  canvasTexture(scene, SPARK, 32, 32, (c) => {
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
  });
  canvasTexture(scene, BEAM, 128, 512, (c) => {
    const g = c.createLinearGradient(0, 0, 128, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 512);
    // Сверху и снизу луч мягко тает.
    c.globalCompositeOperation = 'destination-in';
    const v = c.createLinearGradient(0, 0, 0, 512);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(0.2, 'rgba(0,0,0,1)');
    v.addColorStop(0.85, 'rgba(0,0,0,1)');
    v.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = v;
    c.fillRect(0, 0, 128, 512);
  });
  canvasTexture(scene, CIRCLE, 512, 512, drawCircle);
  canvasTexture(scene, CARD_BACK, 368, 524, drawCardBack);
}

/**
 * Фон Таверны на полноэкранную картинку каркаса screen() (вызывать в create(), до того как viewport.ts продолжит
 * фон на поля): нарисованный зал; файл владельца подменит его, когда загрузится.
 */
export function setTavernBackground(bg: Phaser.GameObjects.Image): Phaser.GameObjects.Image {
  const scene = bg.scene;
  ensureTavernTextures(scene);
  const key = scene.textures.exists(TAVERN_BG_FILE) ? TAVERN_BG_FILE : TAVERN_BG;
  bg.setTexture(key).setDisplaySize(GAME_W, GAME_H);
  if (FILE && !scene.textures.exists(TAVERN_BG_FILE) && !loadingFile) {
    loadingFile = true;
    const el = new Image();
    el.onload = () => {
      loadingFile = false;
      if (!scene.game.textures.exists(TAVERN_BG_FILE)) scene.game.textures.addImage(TAVERN_BG_FILE, el);
      if (bg.scene) {
        bg.setTexture(TAVERN_BG_FILE).setDisplaySize(GAME_W, GAME_H);
        if (bg.getData('bleed')) bleedImage(bg.scene, bg);
      }
    };
    el.onerror = () => {
      loadingFile = false;
      console.warn(`Фон ${FILE} не загрузился — остаётся нарисованный`);
    };
    el.src = FILE;
  }
  return bg;
}

/** Где на фоне висят фонари и стоят свечи (в координатах поля 1080×1920) — сцена кладёт туда мерцающее свечение. */
export const TAVERN_LIGHTS: { x: number; y: number; r: number; color: number }[] = [
  { x: 210, y: 360, r: 360, color: 0xffa040 },
  { x: 870, y: 360, r: 360, color: 0xffa040 },
  { x: 540, y: 690, r: 520, color: 0xff7a30 },
  { x: 120, y: 1290, r: 260, color: 0xffb060 },
  { x: 960, y: 1290, r: 260, color: 0xffb060 },
];

// ---------- рисование (координаты канваса 720×1280, поле = ×1.5) ----------

function drawTavern(c: Ctx): void {
  const W = BG_W;
  const H = BG_H;
  // Стена: тёплое тёмное дерево.
  const wall = c.createLinearGradient(0, 0, 0, H);
  wall.addColorStop(0, '#1a0f09');
  wall.addColorStop(0.35, '#3a2214');
  wall.addColorStop(0.55, '#2c190e');
  wall.addColorStop(1, '#120a06');
  c.fillStyle = wall;
  c.fillRect(0, 0, W, H);
  // Доски стены.
  for (let x = 0; x < W; x += 48) {
    c.fillStyle = `rgba(0,0,0,${0.18 + ((x / 48) % 3) * 0.06})`;
    c.fillRect(x, 0, 3, 560);
    c.fillStyle = 'rgba(255,190,120,0.04)';
    c.fillRect(x + 4, 0, 18, 560);
  }
  // Балка под потолком и столбы.
  c.fillStyle = '#140b06';
  c.fillRect(0, 70, W, 34);
  c.fillStyle = 'rgba(255,170,90,0.12)';
  c.fillRect(0, 70, W, 4);
  for (const px of [18, W - 58]) {
    c.fillStyle = '#170d07';
    c.fillRect(px, 0, 40, 620);
    c.fillStyle = 'rgba(255,170,90,0.08)';
    c.fillRect(px + 4, 0, 6, 620);
  }

  // Камин посреди задней стены: камень, арка, огонь.
  const fx = W / 2;
  const fy = 470;
  c.fillStyle = '#2a2420';
  c.fillRect(fx - 150, fy - 170, 300, 230);
  c.fillStyle = '#3a322b';
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 6; col++) {
      const off = row % 2 ? 25 : 0;
      c.fillRect(fx - 150 + col * 50 + off - 25 + 2, fy - 170 + row * 33 + 2, 46, 29);
    }
  }
  c.fillStyle = '#1e1813';
  c.fillRect(fx - 170, fy - 190, 340, 26);
  // Топка.
  c.fillStyle = '#0a0503';
  c.beginPath();
  c.moveTo(fx - 95, fy + 60);
  c.lineTo(fx - 95, fy - 60);
  c.quadraticCurveTo(fx, fy - 130, fx + 95, fy - 60);
  c.lineTo(fx + 95, fy + 60);
  c.closePath();
  c.fill();
  const fire = c.createRadialGradient(fx, fy + 40, 5, fx, fy + 20, 110);
  fire.addColorStop(0, 'rgba(255,240,170,1)');
  fire.addColorStop(0.25, 'rgba(255,170,60,0.95)');
  fire.addColorStop(0.6, 'rgba(200,70,20,0.6)');
  fire.addColorStop(1, 'rgba(120,20,0,0)');
  c.fillStyle = fire;
  c.beginPath();
  c.moveTo(fx - 80, fy + 60);
  c.bezierCurveTo(fx - 70, fy - 10, fx - 30, fy - 20, fx - 20, fy - 70);
  c.bezierCurveTo(fx, fy - 20, fx + 10, fy - 40, fx + 25, fy - 85);
  c.bezierCurveTo(fx + 40, fy - 20, fx + 75, fy - 10, fx + 80, fy + 60);
  c.closePath();
  c.fill();
  // Поленья.
  c.fillStyle = '#3a200e';
  c.fillRect(fx - 70, fy + 42, 140, 16);
  c.fillStyle = '#2a160a';
  c.fillRect(fx - 55, fy + 30, 110, 14);

  // Полки с бутылками по бокам от камина.
  const shelf = (x0: number, x1: number, y: number, seed: number) => {
    c.fillStyle = '#1b0f07';
    c.fillRect(x0, y, x1 - x0, 12);
    c.fillStyle = 'rgba(255,180,100,0.15)';
    c.fillRect(x0, y, x1 - x0, 2);
    const colors = ['#5a8a3a', '#8a2a2a', '#3a5a8a', '#b08030', '#6a3a7a', '#2a6a5a'];
    let x = x0 + 10;
    let k = seed;
    while (x < x1 - 30) {
      k = (k * 9301 + 49297) % 233280;
      const h = 36 + (k % 30);
      const w = 16 + (k % 10);
      const col = colors[k % colors.length];
      c.fillStyle = col;
      c.fillRect(x, y - h, w, h);
      c.fillRect(x + w / 2 - 3, y - h - 12, 6, 12);
      c.fillStyle = 'rgba(255,230,180,0.35)';
      c.fillRect(x + 3, y - h + 4, 3, h - 10);
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(x + w - 4, y - h, 4, h);
      x += w + 8 + (k % 12);
    }
  };
  shelf(70, 200, 250, 3);
  shelf(70, 200, 390, 7);
  shelf(W - 200, W - 70, 250, 11);
  shelf(W - 200, W - 70, 390, 5);

  // Фонари на цепях.
  for (const lx of [140, W - 140]) {
    c.strokeStyle = '#0c0704';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(lx, 104);
    c.lineTo(lx, 200);
    c.stroke();
    c.fillStyle = '#1a120a';
    c.fillRect(lx - 20, 200, 40, 8);
    c.fillStyle = 'rgba(255,200,110,0.95)';
    c.fillRect(lx - 16, 208, 32, 42);
    c.strokeStyle = '#1a120a';
    c.lineWidth = 4;
    c.strokeRect(lx - 16, 208, 32, 42);
    c.beginPath();
    c.moveTo(lx, 208);
    c.lineTo(lx, 250);
    c.stroke();
    c.fillStyle = '#1a120a';
    c.fillRect(lx - 20, 250, 40, 8);
  }

  // Стол: широкая столешница в перспективе.
  const ty = 600;
  const top = c.createLinearGradient(0, ty, 0, H);
  top.addColorStop(0, '#6a4222');
  top.addColorStop(0.4, '#4e2f17');
  top.addColorStop(1, '#24140a');
  c.fillStyle = top;
  c.beginPath();
  c.moveTo(60, ty);
  c.lineTo(W - 60, ty);
  c.lineTo(W + 40, H);
  c.lineTo(-40, H);
  c.closePath();
  c.fill();
  // Доски столешницы (сходятся к дальнему краю).
  c.strokeStyle = 'rgba(0,0,0,0.35)';
  c.lineWidth = 2;
  for (let i = 1; i < 8; i++) {
    const t = i / 8;
    c.beginPath();
    c.moveTo(60 + (W - 120) * t, ty);
    c.lineTo(-40 + (W + 80) * t, H);
    c.stroke();
  }
  // Край стола.
  c.fillStyle = '#2a170a';
  c.fillRect(50, ty - 6, W - 100, 12);
  c.fillStyle = 'rgba(255,200,130,0.35)';
  c.fillRect(50, ty - 6, W - 100, 2);

  // Свечи по краям стола.
  for (const [cx, cy] of [
    [80, 860],
    [W - 80, 860],
  ]) {
    c.fillStyle = '#e8dcc0';
    c.fillRect(cx - 7, cy - 40, 14, 40);
    c.fillStyle = '#3a2410';
    c.fillRect(cx - 16, cy, 32, 6);
    const fl = c.createRadialGradient(cx, cy - 50, 1, cx, cy - 50, 14);
    fl.addColorStop(0, 'rgba(255,250,210,1)');
    fl.addColorStop(0.5, 'rgba(255,190,80,0.9)');
    fl.addColorStop(1, 'rgba(255,120,20,0)');
    c.fillStyle = fl;
    c.beginPath();
    c.ellipse(cx, cy - 50, 7, 14, 0, 0, Math.PI * 2);
    c.fill();
  }

  // Тёплый свет: камин, фонари, свечи (сложение).
  c.globalCompositeOperation = 'lighter';
  const glow = (x: number, y: number, r: number, a: number) => {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,150,60,${a})`);
    g.addColorStop(1, 'rgba(255,120,40,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  };
  glow(fx, fy, 330, 0.35);
  glow(140, 230, 170, 0.3);
  glow(W - 140, 230, 170, 0.3);
  glow(80, 810, 120, 0.25);
  glow(W - 80, 810, 120, 0.25);
  c.globalCompositeOperation = 'source-over';

  // Виньетка.
  const v = c.createRadialGradient(W / 2, H * 0.45, H * 0.25, W / 2, H * 0.5, H * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.7)');
  c.fillStyle = v;
  c.fillRect(0, 0, W, H);
}

function drawCircle(c: Ctx): void {
  const R = 256;
  c.translate(R, R);
  c.strokeStyle = 'rgba(255,255,255,0.95)';
  c.fillStyle = 'rgba(255,255,255,0.95)';
  const ring = (r: number, w: number) => {
    c.lineWidth = w;
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.stroke();
  };
  ring(240, 6);
  ring(222, 2);
  ring(150, 4);
  ring(90, 2);
  // Руны — чёрточки и ромбики между кольцами.
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    c.save();
    c.rotate(a);
    if (i % 3 === 0) {
      c.beginPath();
      c.moveTo(0, -232);
      c.lineTo(6, -222);
      c.lineTo(0, -212);
      c.lineTo(-6, -222);
      c.closePath();
      c.fill();
    } else {
      c.fillRect(-1.5, -236, 3, 10);
    }
    c.restore();
  }
  // Восьмиконечная звезда.
  c.lineWidth = 3;
  for (const off of [0, Math.PI / 4]) {
    c.beginPath();
    for (let i = 0; i <= 4; i++) {
      const a = off + (i / 4) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * 150;
      const y = Math.sin(a) * 150;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  }
  // Внутренние знаки.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    c.beginPath();
    c.arc(Math.cos(a) * 185, Math.sin(a) * 185, 10, 0, Math.PI * 2);
    c.stroke();
  }
  ring(30, 4);
}

function drawCardBack(c: Ctx): void {
  const W = 368;
  const H = 524;
  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  };
  // Кожа.
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#4a2a18');
  g.addColorStop(0.5, '#2e170c');
  g.addColorStop(1, '#1c0d06');
  c.fillStyle = g;
  rr(0, 0, W, H, 26);
  c.fill();
  // Тиснёный ромбовидный узор.
  c.save();
  rr(22, 22, W - 44, H - 44, 14);
  c.clip();
  c.strokeStyle = 'rgba(255,200,120,0.07)';
  c.lineWidth = 2;
  for (let k = -H; k < W + H; k += 32) {
    c.beginPath();
    c.moveTo(k, 0);
    c.lineTo(k + H, H);
    c.stroke();
    c.beginPath();
    c.moveTo(k, H);
    c.lineTo(k + H, 0);
    c.stroke();
  }
  c.restore();
  // Золотая рамка в два контура.
  c.strokeStyle = '#d6ae63';
  c.lineWidth = 10;
  rr(8, 8, W - 16, H - 16, 22);
  c.stroke();
  c.strokeStyle = 'rgba(214,174,99,0.6)';
  c.lineWidth = 3;
  rr(28, 28, W - 56, H - 56, 12);
  c.stroke();
  // Уголки.
  c.fillStyle = '#f0cf8a';
  for (const [x, y] of [
    [28, 28],
    [W - 28, 28],
    [28, H - 28],
    [W - 28, H - 28],
  ]) {
    c.beginPath();
    c.moveTo(x, y - 14);
    c.lineTo(x + 14, y);
    c.lineTo(x, y + 14);
    c.lineTo(x - 14, y);
    c.closePath();
    c.fill();
  }
  // Эмблема: круг, звезда, песочные часы (хроно-мир).
  const cx = W / 2;
  const cy = H / 2;
  const halo = c.createRadialGradient(cx, cy, 10, cx, cy, 130);
  halo.addColorStop(0, 'rgba(255,210,130,0.35)');
  halo.addColorStop(1, 'rgba(255,210,130,0)');
  c.fillStyle = halo;
  c.fillRect(0, 0, W, H);
  c.strokeStyle = '#d6ae63';
  c.lineWidth = 6;
  c.beginPath();
  c.arc(cx, cy, 92, 0, Math.PI * 2);
  c.stroke();
  c.lineWidth = 2;
  c.beginPath();
  c.arc(cx, cy, 78, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = '#d6ae63';
  c.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 26 : 70;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.closePath();
  c.fill();
  c.fillStyle = '#2e170c';
  c.beginPath();
  c.moveTo(cx - 18, cy - 26);
  c.lineTo(cx + 18, cy - 26);
  c.lineTo(cx, cy);
  c.lineTo(cx + 18, cy + 26);
  c.lineTo(cx - 18, cy + 26);
  c.lineTo(cx, cy);
  c.closePath();
  c.fill();
}
