import Phaser from 'phaser';
import { activeForm, CARD_RARITIES, rarityIndex, type CardRarity, type HeroState, type HeroTemplate } from '../core';
import { GAME } from './content';
import { heroSprite, levelText } from './flow';
import { juiceOn } from './juice';
import { heroFace } from './portraitFrame';
import { unitFigure } from './screen';
import { skinIcon } from './skin';
import { C, FS } from './theme';
import { ellipsize, pressable, text } from './ui';

/**
 * Плитка карточки героя в духе AFK Arena (H4 «Герои», H5 «Таверна» — общий помощник, API стабильный):
 * рамка цвета редкости с орнаментом по редкости (зелёный — простые заклёпки, синий — ромбы, фиолетовый — двойной обод
 * и камень, золотой — филигрань и корона, красный — пламя и крылья), фон-сияние цвета редкости, лицо (бюст RO /
 * портрет листа) или фигура в стойке, значки класса (линии) и роли, имя, уровень, ромбы редкостей «до максимума»,
 * метки «в отряде», «Новый!», замок, стрелки «можно улучшить / вознести», серый вид неполученной карточки.
 *
 * Всё рисуется кодом в canvas (текстуры кэшируются по редкости и размеру), арт не нужен. Анимации (сияние «Новый!»,
 * пульс стрелки) выключаются настройкой «Уменьшить анимацию».
 *
 *   drawHeroCard(scene, x, y, hero | template | templateId, { w: 300, onTap, inSquad, … }) → Container
 */

/** Высота плитки = ширина × CARD_ASPECT. */
export const CARD_ASPECT = 1.36;

/** Палитра рамки по редкости: основной цвет, светлый (блик), тёмный (тень), цвет сияния. */
export interface RarityPalette {
  main: string;
  light: string;
  dark: string;
  glow: number;
  /** Основной цвет числом (tint, заливки). */
  tint: number;
}

/** Цвета рамок. Основной — из data/cards.json (color редкости), здесь — оттенки к нему для объёма. */
const PALETTE_EXTRA: Record<CardRarity | 'none', { light: string; dark: string }> = {
  green: { light: '#b6f0a0', dark: '#1f5a24' },
  blue: { light: '#a8d4ff', dark: '#173e86' },
  purple: { light: '#e2c2ff', dark: '#4a1f8a' },
  gold: { light: '#ffc65a', dark: '#7a3a00' },
  red: { light: '#ffb8a0', dark: '#7a140e' },
  none: { light: '#9a9a9a', dark: '#2a2a2a' },
};

const FALLBACK_COLOR: Record<CardRarity, string> = { green: '#4CAF50', blue: '#3F8CFF', purple: '#A05CFF', gold: '#FF9A1A', red: '#E0443A' };

const hex = (s: string) => Phaser.Display.Color.HexStringToColor(s).color;

/** Цвет редкости из data/cards.json (строка #rrggbb). */
export function rarityColor(rarity: CardRarity): string {
  return GAME.cards.rarities.find((r) => r.id === rarity)?.color ?? FALLBACK_COLOR[rarity];
}

/** Название редкости («Зелёный» …). */
export function rarityName(rarity: CardRarity): string {
  return GAME.cards.rarities.find((r) => r.id === rarity)?.name ?? rarity;
}

export function rarityPalette(rarity: CardRarity | 'none'): RarityPalette {
  const main = rarity === 'none' ? '#5a5a5a' : rarityColor(rarity);
  const x = PALETTE_EXTRA[rarity];
  return { main, light: x.light, dark: x.dark, glow: hex(rarity === 'none' ? '#888888' : x.light), tint: hex(main) };
}

/** Гильдия (город) по линии — подпись и фильтр, без бонусов (docs/design/heroes.md, раздел 1). */
export const GUILD_NAMES: Record<string, string> = {
  swordman: 'Пронтера',
  acolyte: 'Пронтера',
  mage: 'Гефен',
  archer: 'Пайон',
  thief: 'Моррок',
  merchant: 'Альберта',
};

/** Линии (первые профессии) по порядку фильтра. */
export const LINES = ['swordman', 'archer', 'mage', 'thief', 'acolyte', 'merchant'] as const;
export const ROLES = ['tank', 'damage', 'healer', 'support'] as const;

// ---------- текстуры ----------

type Ctx = CanvasRenderingContext2D;

function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function canvasTex(scene: Phaser.Scene, key: string, w: number, h: number, draw: (c: Ctx) => void): string {
  if (scene.textures.exists(key)) return key;
  const t = scene.textures.createCanvas(key, w, h);
  if (!t) return key;
  draw(t.getContext());
  t.refresh();
  return key;
}

function diamond(c: Ctx, x: number, y: number, r: number, fill: string, edge = '#120d07'): void {
  c.beginPath();
  c.moveTo(x, y - r);
  c.lineTo(x + r, y);
  c.lineTo(x, y + r);
  c.lineTo(x - r, y);
  c.closePath();
  c.fillStyle = edge;
  c.fill();
  const k = r * 0.68;
  c.beginPath();
  c.moveTo(x, y - k);
  c.lineTo(x + k, y);
  c.lineTo(x, y + k);
  c.lineTo(x - k, y);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  c.beginPath();
  c.moveTo(x - k * 0.4, y - k * 0.3);
  c.lineTo(x, y - k * 0.75);
  c.lineTo(x + k * 0.15, y - k * 0.45);
  c.closePath();
  c.fillStyle = 'rgba(255,255,255,0.55)';
  c.fill();
}

/** Рамка карточки W×H редкости rarity ('none' — серая неполученная): обод, орнамент, прозрачная середина. */
function drawFrame(c: Ctx, W: number, H: number, rarity: CardRarity | 'none', s: number): void {
  const p = rarityPalette(rarity);
  const tier = rarity === 'none' ? 0 : rarityIndex(rarity);
  const R = 26 * s;
  const t = (9 + tier * 1.5) * s;
  const pad = 6 * s + t / 2;
  // Тёмный кант.
  rr(c, pad, pad, W - pad * 2, H - pad * 2, R);
  c.lineWidth = t + 8 * s;
  c.strokeStyle = '#0b0805';
  c.stroke();
  // Обод с градиентом цвета редкости.
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, p.light);
  g.addColorStop(0.35, p.main);
  g.addColorStop(0.7, p.dark);
  g.addColorStop(1, p.main);
  c.lineWidth = t;
  c.strokeStyle = g;
  c.stroke();
  // Внутренняя тонкая линия (блик).
  rr(c, pad + t / 2 + 3 * s, pad + t / 2 + 3 * s, W - 2 * (pad + t / 2 + 3 * s), H - 2 * (pad + t / 2 + 3 * s), R * 0.7);
  c.lineWidth = 2 * s;
  c.strokeStyle = 'rgba(255,245,220,0.35)';
  c.stroke();
  // Фиолетовый и выше — второй, внутренний обод.
  if (tier >= 2) {
    const q = pad + t / 2 + 9 * s;
    rr(c, q, q, W - 2 * q, H - 2 * q, R * 0.55);
    c.lineWidth = 3 * s;
    c.strokeStyle = tier >= 3 ? '#f5d27a' : p.light;
    c.globalAlpha = 0.8;
    c.stroke();
    c.globalAlpha = 1;
  }
  const corner = pad + 2 * s;
  const corners: [number, number][] = [
    [corner, corner],
    [W - corner, corner],
    [corner, H - corner],
    [W - corner, H - corner],
  ];
  const gold = '#f5c84a';
  if (tier === 0 && rarity !== 'none') {
    // Зелёный: круглые заклёпки.
    for (const [x, y] of corners) {
      c.beginPath();
      c.arc(x, y, 9 * s, 0, Math.PI * 2);
      c.fillStyle = '#0b0805';
      c.fill();
      c.beginPath();
      c.arc(x, y, 6 * s, 0, Math.PI * 2);
      c.fillStyle = p.light;
      c.fill();
    }
  } else if (rarity === 'none') {
    for (const [x, y] of corners) diamond(c, x, y, 10 * s, '#777');
  } else {
    // Синий и выше: ромбы в углах (с золотого — золотые), филигрань с золотого.
    if (tier >= 3) {
      c.strokeStyle = gold;
      c.lineWidth = 3 * s;
      for (const [x, y] of corners) {
        const dx = x < W / 2 ? 1 : -1;
        const dy = y < H / 2 ? 1 : -1;
        c.beginPath();
        c.moveTo(x + dx * 16 * s, y);
        c.bezierCurveTo(x + dx * 44 * s, y, x + dx * 40 * s, y + dy * 20 * s, x + dx * 28 * s, y + dy * 18 * s);
        c.moveTo(x, y + dy * 16 * s);
        c.bezierCurveTo(x, y + dy * 44 * s, x + dx * 20 * s, y + dy * 40 * s, x + dx * 18 * s, y + dy * 28 * s);
        c.stroke();
      }
    }
    for (const [x, y] of corners) diamond(c, x, y, (tier >= 3 ? 16 : 13) * s, tier >= 3 ? gold : p.light);
  }
  // Верхний центральный камень: синий — маленький ромб, фиолетовый — камень с «крыльями», золотой — корона, красный — пламя.
  const cx = W / 2;
  const top = pad;
  if (tier >= 3) {
    // Корона.
    c.beginPath();
    const cw = 44 * s;
    const ch = 30 * s;
    c.moveTo(cx - cw, top + 6 * s);
    c.lineTo(cx - cw * 0.8, top - ch * 0.55);
    c.lineTo(cx - cw * 0.4, top - 2 * s);
    c.lineTo(cx, top - ch);
    c.lineTo(cx + cw * 0.4, top - 2 * s);
    c.lineTo(cx + cw * 0.8, top - ch * 0.55);
    c.lineTo(cx + cw, top + 6 * s);
    c.closePath();
    c.fillStyle = '#0b0805';
    c.fill();
    c.lineWidth = 3 * s;
    const cg = c.createLinearGradient(0, top - ch, 0, top + 6 * s);
    cg.addColorStop(0, '#fff3c0');
    cg.addColorStop(1, '#b8862a');
    c.strokeStyle = cg;
    c.stroke();
  }
  if (tier === 4) {
    // Языки пламени у верхних углов.
    for (const side of [-1, 1]) {
      const bx = side < 0 ? corner + 30 * s : W - corner - 30 * s;
      for (let i = 0; i < 3; i++) {
        const fx = bx + side * i * 16 * s;
        const fh = (26 - i * 6) * s;
        c.beginPath();
        c.moveTo(fx - 8 * s, top + 2 * s);
        c.quadraticCurveTo(fx - 2 * s, top - fh * 0.5, fx + side * 4 * s, top - fh);
        c.quadraticCurveTo(fx + 4 * s, top - fh * 0.4, fx + 8 * s, top + 2 * s);
        c.closePath();
        const fg = c.createLinearGradient(0, top - fh, 0, top);
        fg.addColorStop(0, '#ffe08a');
        fg.addColorStop(1, '#e0443a');
        c.fillStyle = fg;
        c.fill();
      }
    }
    // Крылья внизу.
    for (const side of [-1, 1]) {
      c.beginPath();
      const by = H - pad;
      c.moveTo(cx + side * 16 * s, by);
      c.quadraticCurveTo(cx + side * 60 * s, by - 26 * s, cx + side * 96 * s, by - 6 * s);
      c.quadraticCurveTo(cx + side * 60 * s, by - 6 * s, cx + side * 16 * s, by + 8 * s);
      c.closePath();
      c.fillStyle = '#f5c84a';
      c.fill();
      c.strokeStyle = '#0b0805';
      c.lineWidth = 2 * s;
      c.stroke();
    }
  }
  if (tier >= 2 && tier < 3) {
    // «Крылья» камня фиолетового.
    c.strokeStyle = p.light;
    c.lineWidth = 3 * s;
    for (const side of [-1, 1]) {
      c.beginPath();
      c.moveTo(cx + side * 14 * s, top);
      c.quadraticCurveTo(cx + side * 40 * s, top - 14 * s, cx + side * 62 * s, top);
      c.stroke();
    }
  }
  if (tier >= 1) diamond(c, cx, top - (tier >= 3 ? 4 : 0) * s, (tier >= 2 ? 15 : 11) * s, tier >= 3 ? (tier === 4 ? '#ff5a48' : '#ff7a4a') : p.light);
  if (tier >= 2) diamond(c, cx, H - pad, 11 * s, tier >= 3 ? '#f5c84a' : p.light);
}

/** Фон внутри рамки: сияние цвета редкости сверху, тёмный низ, лучи. */
function drawBack(c: Ctx, W: number, H: number, rarity: CardRarity | 'none'): void {
  const p = rarityPalette(rarity);
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, p.dark);
  g.addColorStop(0.55, '#15110c');
  g.addColorStop(1, '#070504');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  const rg = c.createRadialGradient(W / 2, H * 0.36, 4, W / 2, H * 0.36, W * 0.75);
  rg.addColorStop(0, p.main);
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  c.globalAlpha = rarity === 'none' ? 0.25 : 0.55;
  c.fillStyle = rg;
  c.fillRect(0, 0, W, H);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = 'rgba(255,240,210,0.05)';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    c.beginPath();
    c.moveTo(W / 2, H * 0.36);
    c.arc(W / 2, H * 0.36, W * 1.2, a, a + 0.2);
    c.closePath();
    c.fill();
  }
  c.globalCompositeOperation = 'source-over';
}

/** Мягкое сияние (белое, красится tint'ом) — за карточкой «Новый!» / «можно вознести», вспышки вознесения. */
export function glowTexture(scene: Phaser.Scene): string {
  return canvasTex(scene, 'hc_glow', 128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 8, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });
}

/** Лучи (белые, красятся tint'ом) — фон показа вознесения / призыва. */
export function raysTexture(scene: Phaser.Scene): string {
  return canvasTex(scene, 'hc_rays', 512, 512, (c) => {
    c.translate(256, 256);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const g = c.createRadialGradient(0, 0, 10, 0, 0, 256);
      g.addColorStop(0, 'rgba(255,255,255,0.7)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(0, 0);
      c.arc(0, 0, 256, a, a + 0.12);
      c.closePath();
      c.fill();
    }
  });
}

/**
 * Текстура рамки редкости размера w×h (кэш по редкости, размеру и масштабу орнамента). scale — толщина обода и размер
 * орнамента (1 — как у плитки шириной 300); по умолчанию w / 300.
 */
export function frameTexture(scene: Phaser.Scene, rarity: CardRarity | 'none', w: number, h: number, scale?: number): string {
  const W = Math.round(w);
  const H = Math.round(h);
  const s = Math.round((scale ?? W / 300) * 100) / 100;
  // Корона, пламя и крылья выступают за обод — поле M со всех сторон (картинка по центру та же).
  const M = Math.round(24 * s);
  return canvasTex(scene, `hc_frame_${rarity}_${W}x${H}_${s}`, W + 2 * M, H + 2 * M, (c) => {
    c.translate(M, M);
    drawFrame(c, W, H, rarity, s);
  });
}

/** Текстура фона внутри рамки (небольшая, растягивается). */
export function backTexture(scene: Phaser.Scene, rarity: CardRarity | 'none'): string {
  return canvasTex(scene, `hc_back_${rarity}`, 150, 204, (c) => drawBack(c, 150, 204, rarity));
}

/**
 * Фон-витрина цвета редкости w×h с рамкой и орнаментом (большая карточка героя, экран вознесения).
 * Возвращает контейнер с центром (x, y): фон, рамка.
 */
export function rarityBackdrop(scene: Phaser.Scene, x: number, y: number, w: number, h: number, rarity: CardRarity): Phaser.GameObjects.Container {
  const box = scene.add.container(x, y);
  const inset = 16;
  box.add(scene.add.image(0, 0, backTexture(scene, rarity)).setDisplaySize(w - inset * 2, h - inset * 2));
  box.add(scene.add.image(0, 0, frameTexture(scene, rarity, w, h, 1.6)));
  return box;
}

// ---------- значки класса и роли ----------

const ICON_DRAW: Record<string, (c: Ctx) => void> = {
  // Линии
  swordman: (c) => {
    c.beginPath();
    c.moveTo(32, 6); c.lineTo(38, 14); c.lineTo(38, 40); c.lineTo(26, 40); c.lineTo(26, 14); c.closePath();
    c.moveTo(16, 42); c.lineTo(48, 42);
    c.moveTo(32, 42); c.lineTo(32, 56);
    c.stroke();
  },
  archer: (c) => {
    c.beginPath();
    c.moveTo(18, 8); c.bezierCurveTo(46, 18, 46, 46, 18, 56);
    c.moveTo(18, 8); c.lineTo(18, 56);
    c.moveTo(8, 32); c.lineTo(52, 32);
    c.moveTo(46, 26); c.lineTo(54, 32); c.lineTo(46, 38);
    c.stroke();
  },
  mage: (c) => {
    c.beginPath();
    c.moveTo(20, 58); c.lineTo(38, 22);
    c.stroke();
    c.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
      const x = 42 + Math.cos(a) * 14;
      const y = 16 + Math.sin(a) * 14;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
    c.stroke();
  },
  thief: (c) => {
    c.beginPath();
    c.moveTo(48, 8); c.lineTo(24, 36); c.lineTo(30, 42); c.closePath();
    c.moveTo(18, 30); c.lineTo(36, 48);
    c.moveTo(24, 42); c.lineTo(12, 54);
    c.stroke();
  },
  acolyte: (c) => {
    c.beginPath();
    c.moveTo(32, 8); c.lineTo(32, 56);
    c.moveTo(16, 24); c.lineTo(48, 24);
    c.stroke();
    c.beginPath();
    c.arc(32, 24, 8, 0, Math.PI * 2);
    c.stroke();
  },
  merchant: (c) => {
    c.beginPath();
    c.arc(26, 38, 14, 0, Math.PI * 2);
    c.moveTo(48, 20); c.arc(40, 20, 8, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.moveTo(26, 30); c.lineTo(26, 46); c.moveTo(21, 34); c.lineTo(31, 34);
    c.stroke();
  },
  // Роли
  tank: (c) => {
    c.beginPath();
    c.moveTo(32, 6); c.lineTo(52, 14); c.lineTo(50, 34); c.bezierCurveTo(46, 48, 38, 54, 32, 58); c.bezierCurveTo(26, 54, 18, 48, 14, 34); c.lineTo(12, 14); c.closePath();
    c.moveTo(32, 16); c.lineTo(32, 48);
    c.stroke();
  },
  damage: (c) => {
    c.beginPath();
    c.moveTo(12, 12); c.lineTo(44, 44); c.moveTo(52, 12); c.lineTo(20, 44);
    c.moveTo(38, 48); c.lineTo(48, 38); c.moveTo(16, 38); c.lineTo(26, 48);
    c.stroke();
  },
  healer: (c) => {
    c.beginPath();
    c.moveTo(32, 54);
    c.bezierCurveTo(8, 38, 8, 14, 22, 14);
    c.bezierCurveTo(28, 14, 32, 20, 32, 22);
    c.bezierCurveTo(32, 20, 36, 14, 42, 14);
    c.bezierCurveTo(56, 14, 56, 38, 32, 54);
    c.moveTo(32, 26); c.lineTo(32, 42); c.moveTo(24, 34); c.lineTo(40, 34);
    c.stroke();
  },
  support: (c) => {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 11 : 24;
      const x = 32 + Math.cos(a) * r;
      const y = 34 + Math.sin(a) * r;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
    c.stroke();
  },
  // Прочее
  up: (c) => {
    c.beginPath();
    c.moveTo(32, 10); c.lineTo(52, 34); c.lineTo(40, 34); c.lineTo(40, 54); c.lineTo(24, 54); c.lineTo(24, 34); c.lineTo(12, 34); c.closePath();
    c.fill();
  },
  ascend: (c) => {
    c.beginPath();
    c.moveTo(32, 4); c.lineTo(52, 24); c.lineTo(12, 24); c.closePath();
    c.moveTo(32, 26); c.lineTo(52, 46); c.lineTo(12, 46); c.closePath();
    c.fill();
    c.fillRect(24, 46, 16, 12);
  },
};

export type CardIcon = keyof typeof ICON_DRAW;

/** Текстура значка 64×64 (белый контур — красится tint'ом): линии, роли, стрелки. Неизвестная линия — меч. */
export function cardIcon(scene: Phaser.Scene, name: string): string {
  const id = ICON_DRAW[name] ? name : 'swordman';
  return canvasTex(scene, `hc_ico_${id}`, 64, 64, (c) => {
    c.strokeStyle = '#ffffff';
    c.fillStyle = '#ffffff';
    c.lineWidth = 5;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    ICON_DRAW[id](c);
  });
}

/** Кружок-значок (тёмный диск, обод цвета rim, белый символ tint): для углов плитки и строк карточки. */
export function iconBadge(scene: Phaser.Scene, x: number, y: number, name: string, r: number, rim: number, tint = 0xf0e6cf): Phaser.GameObjects.Container {
  const disc = scene.add.circle(0, 0, r, 0x120d08, 0.92).setStrokeStyle(Math.max(2, r * 0.12), rim);
  const ico = scene.add.image(0, 0, cardIcon(scene, name)).setDisplaySize(r * 1.35, r * 1.35).setTint(tint);
  return scene.add.container(x, y, [disc, ico]);
}

// ---------- плитка ----------

export type HeroCardSubject = HeroState | HeroTemplate | string;

export interface HeroCardOptions {
  /** Ширина плитки (высота — × CARD_ASPECT). По умолчанию 300. */
  w?: number;
  /** Редкость вместо экземплярной / базовой шаблона (превью «после вознесения», показ призыва). */
  rarity?: CardRarity;
  /** Уровень вместо экземплярного; null — не показывать. У шаблона по умолчанию не показывается. */
  level?: number | null;
  /** Имя внизу (по умолчанию да). */
  showName?: boolean;
  /** Значки класса и роли в верхних углах (по умолчанию да). */
  showIcons?: boolean;
  /** Ромбы редкостей от базовой до максимальной (по умолчанию да). */
  showPips?: boolean;
  /** Метки. */
  inSquad?: boolean;
  isNew?: boolean;
  locked?: boolean;
  /** Можно «Улучшить» (зелёная стрелка) / вознести (золотая двойная стрелка, приоритетнее). */
  canLevel?: boolean;
  canAscend?: boolean;
  /** Ветка второй профессии для показа (шаблон на фиолетовом — форма ветки; превью «после вознесения»). */
  branch?: string;
  /** Сколько экземпляров героя у игрока (коллекция группирует копии) — плашка «×N» в правом верхнем углу (≥ 2). */
  copies?: number;
  /** Фиолетовый без ветки — плашка «Выберите ветку!». */
  needsBranch?: boolean;
  /** Неполученная карточка коллекции: серая, подпись сверху — «Сюжет» / «Таверна» (или своя). */
  greyed?: boolean | string;
  /** Пульсирующее сияние цвета редкости за карточкой (по умолчанию — у «Новый!» и «можно вознести»). */
  glow?: boolean;
  /** 'portrait' — лицо (по умолчанию), 'sprite' — фигура в стойке (показ призыва, вознесение), 'none' — пусто. */
  figure?: 'portrait' | 'sprite' | 'none';
  /** Нажатие по плитке (в ScrollArea — оберните в area.tap(fn)). */
  onTap?: () => void;
  /** Контейнер, куда добавить плитку (ScrollArea.content и т. п.) — до pressable, как требует ui.ts. */
  parent?: Phaser.GameObjects.Container;
}

/** Что показывает плитка — из экземпляра или шаблона. */
interface Resolved {
  template: HeroTemplate;
  hero?: HeroState;
  rarity: CardRarity;
  level: number | null;
  line: string;
  role: string;
  sprite: string;
}

function resolve(subject: HeroCardSubject, opts: HeroCardOptions): Resolved | null {
  const tid = typeof subject === 'string' ? subject : 'templateId' in subject ? subject.templateId : subject.id;
  const template = GAME.content.heroes[tid];
  if (!template) return null;
  const hero = typeof subject !== 'string' && 'templateId' in subject ? subject : undefined;
  const rarity = opts.rarity ?? hero?.rarity ?? template.baseRarity;
  const branch = opts.branch ?? hero?.branch;
  const shown: HeroState = { ...(hero ?? { id: `tpl_${tid}`, templateId: tid, level: 1 }), rarity, ...(branch ? { branch } : {}) } as HeroState;
  const form = activeForm(template, { rarity, branch });
  const level = opts.level !== undefined ? opts.level : hero ? hero.level : null;
  return { template, hero, rarity, level, line: template.line, role: form.role, sprite: heroSprite(shown, GAME) };
}

/** Размер плитки ширины w. */
export function heroCardSize(w = 300): { w: number; h: number } {
  return { w, h: Math.round(w * CARD_ASPECT) };
}

/**
 * Плитка карточки героя с центром (x, y). subject — экземпляр игрока (HeroState), шаблон (HeroTemplate) или id шаблона.
 * Возвращает контейнер (name `heroCard_<id экземпляра или шаблона>`; data `rarity`, `w`, `h`); нажатие — opts.onTap.
 */
export function drawHeroCard(scene: Phaser.Scene, x: number, y: number, subject: HeroCardSubject, opts: HeroCardOptions = {}): Phaser.GameObjects.Container {
  const { w, h } = heroCardSize(opts.w ?? 300);
  const s = w / 300;
  const box = scene.add.container(x, y);
  if (opts.parent) opts.parent.add(box);
  const r = resolve(subject, opts);
  const greyed = !!opts.greyed;
  const key: CardRarity | 'none' = greyed ? 'none' : (r?.rarity ?? 'green');
  const pal = rarityPalette(key);
  box.setName(`heroCard_${r?.hero?.id ?? r?.template.id ?? 'unknown'}`).setData({ rarity: r?.rarity, w, h });

  // Сияние за карточкой.
  const wantGlow = !greyed && (opts.glow ?? (!!opts.isNew || !!opts.canAscend));
  if (wantGlow) {
    const glow = scene.add.image(0, 0, glowTexture(scene)).setDisplaySize(w * 1.45, h * 1.35).setTint(pal.glow).setAlpha(0.55).setBlendMode(Phaser.BlendModes.ADD);
    box.add(glow);
    if (juiceOn()) scene.tweens.add({ targets: glow, alpha: 0.2, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }
  const inset = 12 * s;
  box.add(scene.add.image(0, 0, backTexture(scene, key)).setDisplaySize(w - inset * 2, h - inset * 2));
  // Фигура.
  const tint = greyed ? 0x3a3a3a : undefined;
  const faceSize = w * 0.8;
  const faceY = -h * 0.08;
  if (r && opts.figure !== 'none') {
    if (opts.figure === 'sprite') {
      const holder = scene.add.container(0, 0);
      box.add(holder);
      unitFigure(scene, r.sprite, 0, h / 2 - 118 * s, h * 0.58, {
        maxScale: 3.2,
        onReady: (o) => {
          if (!holder.scene) {
            o.destroy();
            return;
          }
          holder.add(o);
          if (tint !== undefined) (o as Phaser.GameObjects.Sprite).setTint(tint);
        },
      });
    } else {
      const face = heroFace(scene, r.sprite, faceSize, r.template.gender, tint);
      face.setY(faceY);
      box.add(face);
    }
  }
  // Низ — тёмная полоса под имя и уровень.
  const bandH = 104 * s;
  box.add(scene.add.rectangle(0, h / 2 - inset - bandH / 2, w - inset * 2, bandH, 0x000000, 0.62));
  const frame = scene.add.image(0, 0, frameTexture(scene, key, w, h));
  box.add(frame);
  if (!r) return box;

  const small = Math.max(FS.caption, Math.round(30 * s));
  // Значки класса (линии) и роли.
  if (opts.showIcons !== false) {
    const ir = 27 * s;
    box.add(iconBadge(scene, -w / 2 + 36 * s, -h / 2 + 36 * s, r.line, ir, pal.tint, greyed ? 0x8a8a8a : 0xf0e6cf));
    box.add(iconBadge(scene, w / 2 - 36 * s, -h / 2 + 36 * s, r.role, ir, pal.tint, greyed ? 0x8a8a8a : 0xf0e6cf));
  }
  // Имя: целиком, если влезает, иначе первое слово (Сесиль Деймон → Сесиль), иначе многоточие.
  const maxW = w - 30 * s;
  if (opts.showName !== false) {
    const nameY = h / 2 - inset - bandH + 30 * s;
    const t = text(scene, 0, nameY, r.template.name, small, greyed ? C.disabled : C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 });
    if (t.width > maxW) t.setText(r.template.name.split(' ')[0]);
    box.add(ellipsize(t, maxW));
  }
  // Уровень и ромбы редкостей.
  const rowY = h / 2 - inset - 28 * s;
  const pips = opts.showPips !== false ? CARD_RARITIES.slice(rarityIndex(r.template.baseRarity), rarityIndex(r.template.maxRarity) + 1) : [];
  const pipR = 9 * s;
  const pipStep = 22 * s;
  let pipsW = pips.length ? (pips.length - 1) * pipStep + pipR * 2 : 0;
  let lvl: Phaser.GameObjects.Text | null = null;
  if (r.level !== null && !greyed) {
    lvl = text(scene, 0, rowY, levelText(r.level), small, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 });
    box.add(lvl);
  }
  const gap = lvl && pips.length ? 12 * s : 0;
  const total = (lvl?.width ?? 0) + gap + pipsW;
  if (total > maxW && lvl) pipsW = 0;
  const left = -Math.min(total, maxW) / 2;
  if (lvl) lvl.setOrigin(0, 0.5).setX(left);
  if (pipsW) {
    const px0 = left + (lvl ? lvl.width + gap : 0) + pipR;
    const g = scene.add.graphics();
    pips.forEach((pr, i) => {
      const filled = !greyed && rarityIndex(pr) <= rarityIndex(r.rarity);
      const px = px0 + i * pipStep;
      g.fillStyle(0x000000, 1).fillPoints(diamondPts(px, rowY, pipR + 2 * s), true);
      g.fillStyle(filled ? hex(rarityColor(pr)) : 0x3a3530, 1).fillPoints(diamondPts(px, rowY, pipR - 1 * s), true);
    });
    box.add(g);
  }
  // Метки.
  if (typeof opts.greyed === 'string' || greyed) {
    const label = typeof opts.greyed === 'string' ? opts.greyed : r.template.source === 'story' ? 'Сюжет' : 'Таверна';
    box.add(tag(scene, 0, -h / 2 + 90 * s, label, 0x3a3a3a, small, s));
  } else if (opts.inSquad) {
    box.add(tag(scene, 0, -h / 2 + 36 * s, 'в отряде', 0x2f7a36, small, s));
  }
  if (opts.isNew && !greyed) {
    const nt = tag(scene, 0, -h / 2 + (opts.inSquad ? 86 : 36) * s, 'Новый!', 0xb8402e, small, s);
    box.add(nt);
    if (juiceOn()) scene.tweens.add({ targets: nt, scale: 1.08, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }
  if (!greyed && (opts.copies ?? 0) >= 2) {
    // NB-11: «+1» — столько запасных копий (как «Копий: 1» на карточке героя), а не всего карт героя.
    const ct = text(scene, 0, 0, `+${(opts.copies ?? 1) - 1}`, small, C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 });
    const cw = ct.width + 20 * s;
    const cx = w / 2 - 36 * s;
    const cy = -h / 2 + 88 * s;
    const bg = scene.add.rectangle(0, 0, Math.max(cw, 56 * s), 40 * s, 0x1a120a, 0.92).setStrokeStyle(3 * s, pal.tint);
    box.add(scene.add.container(cx - Math.max(0, cw - 56 * s) / 2, cy, [bg, ct]).setName('copies'));
  }
  if (!greyed && opts.needsBranch) {
    const nb = tag(scene, 0, -h / 2 + (opts.inSquad || opts.isNew ? (opts.inSquad && opts.isNew ? 136 : 86) : 36) * s, 'Выберите ветку!', 0x6a2fb0, Math.max(FS.caption - 4, Math.round(26 * s)), s);
    nb.setName('needsBranch');
    box.add(nb);
    if (juiceOn()) scene.tweens.add({ targets: nb, scale: 1.06, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }
  const markY = h / 2 - inset - bandH - 30 * s;
  if (opts.locked && !greyed) {
    box.add(scene.add.circle(-w / 2 + 38 * s, markY, 24 * s, 0x120d08, 0.9).setStrokeStyle(3 * s, 0xd6ae63));
    box.add(scene.add.image(-w / 2 + 38 * s, markY, skinIcon('lock')).setDisplaySize(34 * s, 34 * s).setTint(0xf0cf8a));
  }
  if (!greyed && (opts.canAscend || opts.canLevel)) {
    const asc = !!opts.canAscend;
    const mark = scene.add.container(w / 2 - 38 * s, markY, [
      scene.add.circle(0, 0, 26 * s, asc ? 0x8a5a10 : 0x1f6a28, 1).setStrokeStyle(3 * s, asc ? 0xffe08a : 0xb6f0a0),
      scene.add.image(0, 0, cardIcon(scene, asc ? 'ascend' : 'up')).setDisplaySize(32 * s, 32 * s).setTint(asc ? 0xffe08a : 0xd8ffd0),
    ]).setName(asc ? 'canAscend' : 'canLevel');
    box.add(mark);
    if (juiceOn()) scene.tweens.add({ targets: mark, y: markY - 8 * s, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }
  if (opts.onTap) pressable(scene, frame, w, h, opts.onTap);
  return box;
}

function diamondPts(x: number, y: number, r: number): Phaser.Math.Vector2[] {
  return [new Phaser.Math.Vector2(x, y - r), new Phaser.Math.Vector2(x + r, y), new Phaser.Math.Vector2(x, y + r), new Phaser.Math.Vector2(x - r, y)];
}

/** Плашка-метка («в отряде», «Новый!»). */
function tag(scene: Phaser.Scene, x: number, y: number, label: string, color: number, size: number, s: number): Phaser.GameObjects.Container {
  const t = text(scene, 0, -2 * s, label, size, C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 });
  const bg = scene.add.rectangle(0, 0, t.width + 24 * s, t.height + 4 * s, color, 0.95).setStrokeStyle(2 * s, 0xf0e6cf, 0.8);
  return scene.add.container(x, y, [bg, t]);
}

/** Ромбы-«звёзды» редкостей (от base до max, закрашены до current) — строка для большой карточки. */
export function rarityPips(scene: Phaser.Scene, x: number, y: number, template: HeroTemplate, current: CardRarity, r = 12): Phaser.GameObjects.Graphics {
  const pips = CARD_RARITIES.slice(rarityIndex(template.baseRarity), rarityIndex(template.maxRarity) + 1);
  const step = r * 2.6;
  const x0 = x - ((pips.length - 1) * step) / 2;
  const g = scene.add.graphics();
  pips.forEach((pr, i) => {
    const filled = rarityIndex(pr) <= rarityIndex(current);
    g.fillStyle(0x000000, 1).fillPoints(diamondPts(x0 + i * step, y, r + 3), true);
    g.fillStyle(filled ? hex(rarityColor(pr)) : 0x3a3530, 1).fillPoints(diamondPts(x0 + i * step, y, r - 1), true);
  });
  return g;
}

/**
 * Мини-иконка карты героя для наград (сундук, итоги, почта, события): рамка цвета редкости, внутри — лицо героя
 * (templateId известен) или «?» (карта случайного героя). size — высота; ширина = size / CARD_ASPECT.
 * pick — «Контракт героя» (герой на выбор): вместо «?» — перо-звезда.
 */
export function heroCardIcon(scene: Phaser.Scene, x: number, y: number, size: number, rarity: CardRarity, templateId?: string, opts: { dim?: boolean; pick?: boolean } = {}): Phaser.GameObjects.Container {
  const h = Math.round(size);
  const w = Math.round(size / CARD_ASPECT);
  const box = scene.add.container(x, y).setName('heroCardIcon');
  const inset = Math.max(2, Math.round(w * 0.05));
  box.add(scene.add.image(0, 0, backTexture(scene, rarity)).setDisplaySize(w - inset * 2, h - inset * 2));
  const t = templateId ? GAME.content.heroes[templateId] : undefined;
  if (t) {
    const hero = { id: `icon_${templateId}`, templateId: t.id, rarity, level: 1 } as HeroState;
    const face = heroFace(scene, heroSprite(hero, GAME), w * 0.86, t.gender);
    face.setY(-h * 0.02);
    box.add(face);
  } else {
    const q = text(scene, 0, 0, opts.pick ? '✦' : '?', Math.round(h * 0.5), rarityPalette(rarity).light, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: Math.max(3, Math.round(h / 16)) });
    box.add(q);
  }
  box.add(scene.add.image(0, 0, frameTexture(scene, rarity, w, h, Math.max(0.2, w / 300 * 1.6))));
  if (opts.dim) box.setAlpha(0.55);
  return box;
}
