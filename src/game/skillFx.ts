import Phaser from 'phaser';
import { GAME_H, GAME_W } from './layout';
import { clamp01, ease, Pool } from './perf';
import type { Area, Projectile } from './skillLook';
import type { SkillHit } from './skillVisuals';
import { animatedEffect, animatedFrameAt, animatedFxDuration, animatedFxKey } from './animatedFx';
import { motion } from './state';

/**
 * Эффекты навыков в бою, нарисованные кодом: круг каста под кастером, свечение, снаряды со шлейфом,
 * вспышки попаданий, площадные эффекты (молнии, кольцо, дождь стрел, метель, святые столбы), искры лечения и баффов.
 * Текстуры (белые, красятся tint'ом) рисуются в canvas один раз на игру; картинки — из пула, частицы — три общих
 * эмиттера. Всё движение считается в step(dt) по времени боя (dt уже умножен на скорость), без твина на эффект.
 */

export const SFX_DEPTH = 4000;

const TEX = {
  glow: 'sfx_glow',
  spark: 'sfx_spark',
  ring: 'sfx_ring',
  circle: 'sfx_circle',
  orb: 'sfx_orb',
  shard: 'sfx_shard',
  beam: 'sfx_beam',
  bolt: 'sfx_bolt',
  arrow: 'sfx_arrow',
  rock: 'sfx_rock',
  flame: 'sfx_flame',
  cross: 'sfx_cross',
  slash: 'sfx_slash',
  claw: 'sfx_claw',
  splat: 'sfx_splat',
  star: 'sfx_star',
  coin: 'sfx_coin',
  bang: 'sfx_bang',
  puff: 'sfx_puff',
  streak: 'sfx_streak',
  vine: 'sfx_vine',
  note: 'sfx_note',
  bird: 'sfx_bird',
  trap: 'sfx_trap',
  flask: 'sfx_flask',
  heart: 'sfx_heart',
  blade: 'sfx_blade',
  shield: 'sfx_shield',
  hcross: 'sfx_hcross',
  feather: 'sfx_feather',
  pan: 'sfx_pan',
} as const;

/** Текстуры эффектов (для рецептов навыков skillSigs.ts). */
export const FX_TEX = TEX;

/** Звёздочка оглушения (белая, красится) — BattleScene крутит её над головой оглушённого. */
export const STAR_TEX = TEX.star;

/**
 * Вид обычного удара по оружию/телу атакующего: разрез меча, укол кинжала, тупой удар, попадание стрелы,
 * магическая искра, святая искра, укус/когти монстра, шлепок слизи.
 */
export type HitStyle = 'slash' | 'stab' | 'blunt' | 'arrow' | 'magic' | 'holy' | 'bite' | 'slime';

export type { SkillHit } from './skillVisuals';

/** Огненная стрела (RO Fire Bolt): стрелы падают сверху наискосок на цель одна за другой, каждая — взрыв огня. */
export const FIRE_BOLT_MS = 300;
export const FIRE_BOLT_STEP = 150;
/** Цвета огня: ядро, пламя, угли. */
const FIRE_CORE = 0xffe070;
const FIRE_MAIN = 0xff8a20;
const FIRE_DEEP = 0xff3c0c;
/** Лечение: столб света и искры (бело-зелёные). */
const HEAL_LIGHT = 0xd6ffd8;
const HEAL_MAIN = 0x7dff8f;

type Ctx = CanvasRenderingContext2D;

function canvasTex(scene: Phaser.Scene, key: string, w: number, h: number, draw: (c: Ctx) => void): void {
  if (scene.textures.exists(key)) return;
  const t = scene.textures.createCanvas(key, w, h);
  if (!t) return;
  draw(t.getContext());
  t.refresh();
}

/** Белые текстуры эффектов (один раз на игру). */
export function buildSkillFxTextures(scene: Phaser.Scene): void {
  canvasTex(scene, TEX.glow, 64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
  });
  canvasTex(scene, TEX.spark, 32, 32, (c) => {
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(16, 0); c.lineTo(18, 14); c.lineTo(32, 16); c.lineTo(18, 18); c.lineTo(16, 32); c.lineTo(14, 18); c.lineTo(0, 16); c.lineTo(14, 14);
    c.closePath();
    c.fill();
  });
  canvasTex(scene, TEX.ring, 128, 128, (c) => {
    c.shadowColor = '#ffffff';
    c.shadowBlur = 10;
    c.strokeStyle = 'rgba(255,255,255,0.95)';
    c.lineWidth = 7;
    c.beginPath(); c.arc(64, 64, 52, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 2;
    c.beginPath(); c.arc(64, 64, 42, 0, Math.PI * 2); c.stroke();
  });
  canvasTex(scene, TEX.circle, 256, 256, drawMagicCircle);
  canvasTex(scene, TEX.orb, 64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
  });
  canvasTex(scene, TEX.shard, 96, 32, (c) => {
    c.shadowColor = '#ffffff';
    c.shadowBlur = 6;
    c.fillStyle = 'rgba(255,255,255,0.95)';
    c.beginPath(); c.moveTo(94, 16); c.lineTo(50, 5); c.lineTo(6, 16); c.lineTo(50, 27); c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.beginPath(); c.moveTo(60, 16); c.lineTo(40, 2); c.lineTo(30, 16); c.lineTo(40, 30); c.closePath(); c.fill();
  });
  canvasTex(scene, TEX.beam, 64, 32, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.6)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(0.65, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 32);
  });
  canvasTex(scene, TEX.bolt, 96, 512, (c) => {
    // Зигзаг молнии сверху вниз с ответвлениями (детерминированно).
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const path = (x0: number, y0: number, y1: number, spread: number): [number, number][] => {
      const pts: [number, number][] = [[x0, y0]];
      let x = x0;
      for (let y = y0; y < y1; ) {
        y += 22 + rnd() * 26;
        x = Phaser.Math.Clamp(x + (rnd() - 0.5) * spread, 10, 86);
        pts.push([x, Math.min(y, y1)]);
      }
      return pts;
    };
    const draw = (pts: [number, number][], w: number) => {
      c.beginPath();
      pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.lineWidth = w;
      c.stroke();
    };
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(255,255,255,1)';
    c.shadowColor = '#ffffff';
    c.shadowBlur = 14;
    const main = path(48, 0, 512, 44);
    draw(main, 7);
    draw(path(main[5][0], main[5][1], main[5][1] + 120, 50), 3);
    draw(path(main[11][0], main[11][1], main[11][1] + 90, 50), 3);
    c.shadowBlur = 0;
    draw(main, 2.5);
  });
  canvasTex(scene, TEX.arrow, 80, 16, (c) => {
    c.fillStyle = '#ffffff';
    c.fillRect(8, 7, 58, 2.5);
    c.beginPath(); c.moveTo(80, 8); c.lineTo(64, 2); c.lineTo(66, 8); c.lineTo(64, 14); c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.8)';
    c.beginPath(); c.moveTo(14, 8); c.lineTo(0, 1); c.lineTo(6, 8); c.lineTo(0, 15); c.closePath(); c.fill();
  });
  // Пламя огненной стрелы — цветное (не красится): голова справа (белое ядро → жёлтый → оранжевый), хвост влево — красный.
  canvasTex(scene, TEX.flame, 192, 64, (c) => {
    const tail = c.createLinearGradient(0, 0, 170, 0);
    tail.addColorStop(0, 'rgba(255,40,0,0)');
    tail.addColorStop(0.45, 'rgba(255,70,10,0.55)');
    tail.addColorStop(0.8, 'rgba(255,150,30,0.9)');
    tail.addColorStop(1, 'rgba(255,210,80,1)');
    c.fillStyle = tail;
    c.shadowColor = '#ff6a10';
    c.shadowBlur = 10;
    // Хвост — вытянутая капля, сужается к концу; два языка пламени по краям.
    c.beginPath();
    c.moveTo(4, 32);
    c.quadraticCurveTo(60, 14, 150, 13);
    c.quadraticCurveTo(186, 32, 150, 51);
    c.quadraticCurveTo(60, 50, 4, 32);
    c.fill();
    c.beginPath();
    c.moveTo(30, 20); c.quadraticCurveTo(90, 8, 140, 20); c.quadraticCurveTo(90, 18, 30, 20);
    c.moveTo(30, 44); c.quadraticCurveTo(90, 56, 140, 44); c.quadraticCurveTo(90, 46, 30, 44);
    c.fill();
    c.shadowBlur = 0;
    c.globalCompositeOperation = 'lighter';
    const head = c.createRadialGradient(152, 32, 0, 152, 32, 30);
    head.addColorStop(0, 'rgba(255,255,255,1)');
    head.addColorStop(0.3, 'rgba(255,245,170,1)');
    head.addColorStop(0.65, 'rgba(255,170,40,0.85)');
    head.addColorStop(1, 'rgba(255,90,10,0)');
    c.fillStyle = head;
    c.fillRect(110, 0, 82, 64);
    c.globalCompositeOperation = 'source-over';
  });
  // Крестик лечения со свечением (белый, красится).
  canvasTex(scene, TEX.cross, 32, 32, (c) => {
    c.shadowColor = '#ffffff';
    c.shadowBlur = 6;
    c.fillStyle = '#ffffff';
    c.fillRect(13, 4, 6, 24);
    c.fillRect(4, 13, 24, 6);
  });
  // Разрез: полумесяц выпуклостью вправо, тонкие концы; яркая кромка по внешнему краю.
  canvasTex(scene, TEX.slash, 160, 160, (c) => {
    c.shadowColor = '#ffffff';
    c.shadowBlur = 12;
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.beginPath();
    c.moveTo(66, 10);
    c.quadraticCurveTo(156, 80, 66, 150);
    c.quadraticCurveTo(122, 80, 66, 10);
    c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = '#ffffff';
    c.lineWidth = 4;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(70, 16);
    c.quadraticCurveTo(150, 80, 70, 144);
    c.stroke();
  });
  // Когти/укус: три изогнутых царапины наискосок.
  canvasTex(scene, TEX.claw, 96, 96, (c) => {
    c.shadowColor = '#ffffff';
    c.shadowBlur = 6;
    c.fillStyle = '#ffffff';
    for (let i = 0; i < 3; i++) {
      const d = (i - 1) * 20;
      c.beginPath();
      c.moveTo(66 + d, 6);
      c.quadraticCurveTo(66 + d, 52, 24 + d, 90);
      c.quadraticCurveTo(54 + d, 50, 66 + d, 6);
      c.fill();
    }
  });
  // Шлепок слизи: капля с лепестками и брызгами.
  canvasTex(scene, TEX.splat, 96, 96, (c) => {
    c.fillStyle = '#ffffff';
    const blob = (x: number, y: number, r: number) => {
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    };
    // Неровная клякса: крупные перекрывающиеся доли (не «цветок»), несколько отлетевших капель.
    blob(48, 50, 25);
    for (const [a, d, r] of [[0.2, 16, 17], [1.5, 18, 14], [2.6, 15, 16], [3.7, 19, 12], [5.0, 16, 15]] as const) blob(48 + Math.cos(a) * d, 50 + Math.sin(a) * d, r);
    for (const [a, d, r] of [[0.9, 38, 5], [2.2, 40, 4], [4.2, 37, 6], [5.6, 41, 3]] as const) blob(48 + Math.cos(a) * d, 50 + Math.sin(a) * d, r);
    // Блик — светлее (после оттенка — светлый тон того же цвета).
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = 'rgba(0,0,0,0.3)';
    blob(40, 40, 8);
  });
  // Звёздочка: пятиконечная, со свечением.
  canvasTex(scene, TEX.star, 32, 32, (c) => {
    c.shadowColor = '#ffffff';
    c.shadowBlur = 4;
    c.fillStyle = '#ffffff';
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 5.5 : 13;
      c.lineTo(16 + Math.cos(a) * r, 16 + Math.sin(a) * r);
    }
    c.closePath();
    c.fill();
  });
  // Монета (цветная, не красится): золото с кромкой и бликом.
  canvasTex(scene, TEX.coin, 32, 32, (c) => {
    const g = c.createRadialGradient(12, 11, 2, 16, 16, 15);
    g.addColorStop(0, '#fff6c0');
    g.addColorStop(0.45, '#ffd040');
    g.addColorStop(1, '#b8780e');
    c.fillStyle = g;
    c.beginPath(); c.arc(16, 16, 14, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#7a4a06';
    c.lineWidth = 2;
    c.stroke();
    c.strokeStyle = 'rgba(122,74,6,0.8)';
    c.beginPath(); c.arc(16, 16, 8, 0, Math.PI * 2); c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.fillRect(9, 9, 4, 3);
  });
  // «!» провокации (цветной): красный с тёмной обводкой.
  canvasTex(scene, TEX.bang, 48, 104, (c) => {
    c.lineJoin = 'round';
    c.strokeStyle = '#3a0400';
    c.lineWidth = 6;
    c.fillStyle = '#ff3a26';
    c.beginPath();
    c.moveTo(12, 8); c.lineTo(36, 8); c.lineTo(30, 66); c.lineTo(18, 66); c.closePath();
    c.stroke(); c.fill();
    c.beginPath(); c.arc(24, 86, 10, 0, Math.PI * 2); c.stroke(); c.fill();
    c.fillStyle = 'rgba(255,220,200,0.85)';
    c.fillRect(16, 12, 5, 30);
  });
  // Клуб пыли/дыма: несколько мягких кругов (красится: пыль, песок, дым).
  canvasTex(scene, TEX.puff, 64, 64, (c) => {
    for (const [x, y, r] of [[32, 36, 20], [20, 30, 14], [44, 28, 15], [30, 20, 13], [46, 42, 12], [18, 44, 11]] as const) {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.85)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.45)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 64, 64);
    }
  });
  // Полоса скорости: к правому краю ярче (голова), мягкая поперёк.
  canvasTex(scene, TEX.streak, 128, 16, (c) => {
    const g = c.createLinearGradient(0, 0, 128, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(0, 8); c.lineTo(120, 3); c.quadraticCurveTo(128, 8, 120, 13); c.closePath();
    c.fill();
  });
  // Корень мандрагоры (цветной): изогнутый, сужается кверху, с шипами.
  canvasTex(scene, TEX.vine, 48, 128, (c) => {
    c.lineCap = 'round';
    const path = () => {
      c.beginPath();
      c.moveTo(24, 126);
      c.bezierCurveTo(6, 96, 42, 64, 20, 36);
      c.quadraticCurveTo(12, 20, 30, 6);
    };
    c.strokeStyle = '#22320c';
    c.lineWidth = 14;
    path(); c.stroke();
    c.strokeStyle = '#6e9a2c';
    c.lineWidth = 9;
    path(); c.stroke();
    c.strokeStyle = 'rgba(190,230,110,0.8)';
    c.lineWidth = 3;
    path(); c.stroke();
    c.fillStyle = '#4e7420';
    for (const [x, y, d] of [[16, 96, -1], [30, 72, 1], [16, 48, -1], [26, 24, 1]] as const) {
      c.beginPath(); c.moveTo(x, y - 5); c.lineTo(x + d * 12, y - 12); c.lineTo(x, y + 4); c.closePath(); c.fill();
    }
  });
  canvasTex(scene, TEX.rock, 48, 64, (c) => {
    const g = c.createLinearGradient(0, 0, 48, 0);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#9a9a9a');
    c.fillStyle = g;
    c.beginPath(); c.moveTo(24, 0); c.lineTo(44, 64); c.lineTo(4, 64); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(24, 4); c.lineTo(28, 60); c.stroke();
  });
  buildSkillSigTextures(scene);
}

/** Текстуры рецептов навыков вторых профессий (белые — красятся; с тёмной обводкой — читаются на траве). */
function buildSkillSigTextures(scene: Phaser.Scene): void {
  // Нота ♪ (белая с тёмной обводкой: красится в цвет песни).
  canvasTex(scene, TEX.note, 40, 56, (c) => {
    const path = () => {
      c.beginPath();
      c.ellipse(13, 44, 10, 7.5, -0.4, 0, Math.PI * 2);
      c.moveTo(20, 42); c.lineTo(22, 6); c.lineTo(36, 14); c.lineTo(35, 21); c.lineTo(25, 16); c.lineTo(23, 43);
      c.closePath();
    };
    c.lineJoin = 'round';
    c.strokeStyle = 'rgba(20,10,30,0.85)';
    c.lineWidth = 5;
    path(); c.stroke();
    c.fillStyle = '#ffffff';
    path(); c.fill();
  });
  // Сокол (силуэт с раскрытыми крыльями, клюв вправо): тёмно-бурый с белой грудью — цветной, не красится.
  canvasTex(scene, TEX.bird, 96, 64, (c) => {
    c.lineJoin = 'round';
    const body = () => {
      c.beginPath();
      c.moveTo(94, 30); c.lineTo(82, 26); c.quadraticCurveTo(72, 18, 60, 24);
      c.quadraticCurveTo(40, 2, 12, 4); c.quadraticCurveTo(34, 16, 40, 28);
      c.lineTo(8, 30); c.lineTo(22, 36); c.lineTo(4, 42); c.lineTo(38, 38);
      c.quadraticCurveTo(34, 56, 18, 62); c.quadraticCurveTo(50, 58, 60, 38);
      c.quadraticCurveTo(76, 40, 84, 33);
      c.closePath();
    };
    c.strokeStyle = '#1a1006';
    c.lineWidth = 4;
    body(); c.stroke();
    const g = c.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, '#8a5a2a');
    g.addColorStop(1, '#4a2e12');
    c.fillStyle = g;
    body(); c.fill();
    c.fillStyle = '#f4ead8';
    c.beginPath(); c.ellipse(70, 31, 10, 5, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffd040';
    c.beginPath(); c.moveTo(94, 30); c.lineTo(84, 27); c.lineTo(85, 33); c.closePath(); c.fill();
    c.fillStyle = '#000';
    c.beginPath(); c.arc(80, 28, 1.8, 0, Math.PI * 2); c.fill();
  });
  // Капкан: железные челюсти с зубьями (серый металл, цветной).
  canvasTex(scene, TEX.trap, 96, 48, (c) => {
    c.lineJoin = 'round';
    c.strokeStyle = '#1a1a20';
    c.lineWidth = 4;
    const g = c.createLinearGradient(0, 0, 0, 48);
    g.addColorStop(0, '#e8ecf4');
    g.addColorStop(1, '#6a7080');
    for (const flip of [1, -1]) {
      c.save();
      c.translate(48, 26);
      c.scale(1, flip);
      c.beginPath();
      c.moveTo(-44, 2); c.lineTo(44, 2);
      for (let i = 0; i < 7; i++) {
        const x = 44 - (i + 0.5) * (88 / 7);
        c.lineTo(x + 6, -4); c.lineTo(x, -18); c.lineTo(x - 6, -4);
      }
      c.closePath();
      c.fillStyle = g;
      c.fill();
      c.stroke();
      c.restore();
    }
    c.fillStyle = '#4a4e5a';
    c.beginPath(); c.arc(48, 28, 6, 0, Math.PI * 2); c.fill(); c.stroke();
  });
  // Колба зелья: белая (красится цветом зелья), тёмная обводка, пробка, блик.
  canvasTex(scene, TEX.flask, 40, 56, (c) => {
    c.lineJoin = 'round';
    const path = () => {
      c.beginPath();
      c.moveTo(15, 8); c.lineTo(25, 8); c.lineTo(25, 20);
      c.quadraticCurveTo(38, 28, 36, 40); c.quadraticCurveTo(34, 53, 20, 53);
      c.quadraticCurveTo(6, 53, 4, 40); c.quadraticCurveTo(2, 28, 15, 20);
      c.closePath();
    };
    c.strokeStyle = '#1a1010';
    c.lineWidth = 4;
    path(); c.stroke();
    c.fillStyle = '#ffffff';
    path(); c.fill();
    c.fillStyle = '#8a5a2a';
    c.fillRect(14, 2, 12, 8);
    c.strokeRect(14, 2, 12, 8);
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.beginPath(); c.ellipse(13, 36, 3, 7, 0.3, 0, Math.PI * 2); c.fill();
  });
  // Сердечко (белое, красится).
  canvasTex(scene, TEX.heart, 40, 36, (c) => {
    const path = () => {
      c.beginPath();
      c.moveTo(20, 34);
      c.bezierCurveTo(2, 22, 0, 8, 10, 4);
      c.bezierCurveTo(16, 1, 20, 6, 20, 10);
      c.bezierCurveTo(20, 6, 24, 1, 30, 4);
      c.bezierCurveTo(40, 8, 38, 22, 20, 34);
      c.closePath();
    };
    c.strokeStyle = 'rgba(60,0,20,0.8)';
    c.lineWidth = 3;
    path(); c.stroke();
    c.fillStyle = '#ffffff';
    path(); c.fill();
  });
  // Клинок (остриё вправо): светлая сталь с тёмной обводкой, золотая гарда — цветной.
  canvasTex(scene, TEX.blade, 112, 28, (c) => {
    c.lineJoin = 'round';
    c.strokeStyle = '#141820';
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(34, 9); c.lineTo(100, 11); c.lineTo(110, 14); c.lineTo(100, 17); c.lineTo(34, 19); c.closePath();
    const g = c.createLinearGradient(0, 9, 0, 19);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#9aa4b8');
    c.fillStyle = g;
    c.fill(); c.stroke();
    c.fillStyle = '#e8b830';
    c.fillRect(28, 3, 7, 22); c.strokeRect(28, 3, 7, 22);
    c.fillStyle = '#6a3a18';
    c.fillRect(6, 10, 22, 8); c.strokeRect(6, 10, 22, 8);
  });
  // Щит (белый с обводкой и крестом — красится цветом навыка).
  canvasTex(scene, TEX.shield, 64, 76, (c) => {
    c.lineJoin = 'round';
    const path = () => {
      c.beginPath();
      c.moveTo(32, 4); c.quadraticCurveTo(46, 12, 60, 10); c.quadraticCurveTo(62, 52, 32, 72);
      c.quadraticCurveTo(2, 52, 4, 10); c.quadraticCurveTo(18, 12, 32, 4);
      c.closePath();
    };
    c.strokeStyle = '#141820';
    c.lineWidth = 5;
    path(); c.stroke();
    const g = c.createLinearGradient(0, 4, 0, 72);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#b8c0d0');
    c.fillStyle = g;
    path(); c.fill();
    c.fillStyle = 'rgba(60,70,100,0.5)';
    c.fillRect(28, 16, 8, 44);
    c.fillRect(14, 28, 36, 8);
  });
  // Святой крест (белый, светится; длинная нижняя перекладина).
  canvasTex(scene, TEX.hcross, 96, 128, (c) => {
    c.shadowColor = '#ffffff';
    c.shadowBlur = 14;
    c.fillStyle = '#ffffff';
    c.fillRect(40, 6, 16, 116);
    c.fillRect(10, 34, 76, 16);
    c.shadowBlur = 0;
    c.fillStyle = 'rgba(255,255,255,0.6)';
    c.beginPath(); c.arc(48, 42, 16, 0, Math.PI * 2); c.fill();
  });
  // Перо (белое, красится).
  canvasTex(scene, TEX.feather, 24, 56, (c) => {
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(12, 2); c.quadraticCurveTo(24, 20, 14, 50); c.lineTo(10, 50); c.quadraticCurveTo(0, 20, 12, 2);
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(12, 6); c.lineTo(12, 55); c.stroke();
  });
  // Сковорода (чугун, цветная): круг с бликом и ручкой вправо.
  canvasTex(scene, TEX.pan, 96, 56, (c) => {
    c.lineJoin = 'round';
    c.strokeStyle = '#0c0c10';
    c.lineWidth = 4;
    c.fillStyle = '#6a3a18';
    c.fillRect(50, 23, 42, 10); c.strokeRect(50, 23, 42, 10);
    const g = c.createRadialGradient(22, 22, 2, 28, 28, 26);
    g.addColorStop(0, '#9aa0ac');
    g.addColorStop(0.6, '#3a3e48');
    g.addColorStop(1, '#1a1c22');
    c.fillStyle = g;
    c.beginPath(); c.arc(28, 28, 25, 0, Math.PI * 2); c.fill(); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.6)';
    c.lineWidth = 3;
    c.beginPath(); c.arc(28, 28, 17, -2.6, -1.4); c.stroke();
  });
}

/** Магический круг: два кольца, гексаграмма, руны по ободу — белый, вращается и красится в цвет стихии. */
function drawMagicCircle(c: Ctx): void {
  const r = 128;
  c.translate(r, r);
  c.strokeStyle = '#ffffff';
  c.fillStyle = '#ffffff';
  c.shadowColor = '#ffffff';
  c.shadowBlur = 8;
  c.lineWidth = 5;
  c.beginPath(); c.arc(0, 0, 118, 0, Math.PI * 2); c.stroke();
  c.lineWidth = 3;
  c.beginPath(); c.arc(0, 0, 96, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.arc(0, 0, 58, 0, Math.PI * 2); c.stroke();
  // Гексаграмма.
  c.lineWidth = 3;
  for (const off of [0, Math.PI / 3]) {
    c.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = off - Math.PI / 2 + (i * Math.PI * 2) / 3;
      const x = Math.cos(a) * 94;
      const y = Math.sin(a) * 94;
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    }
    c.closePath();
    c.stroke();
  }
  // Руны между кольцами: короткие штрихи-знаки.
  c.lineWidth = 3;
  c.lineCap = 'round';
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    c.save();
    c.rotate(a);
    c.translate(0, -107);
    c.beginPath();
    switch (i % 4) {
      case 0: c.moveTo(-5, -5); c.lineTo(5, 5); c.moveTo(5, -5); c.lineTo(-5, 5); break;
      case 1: c.moveTo(0, -6); c.lineTo(0, 6); c.moveTo(-5, -2); c.lineTo(5, -2); break;
      case 2: c.arc(0, 0, 5, 0, Math.PI * 2); break;
      default: c.moveTo(-6, 5); c.lineTo(0, -6); c.lineTo(6, 5); break;
    }
    c.stroke();
    c.restore();
  }
  // Точки на внутреннем кольце.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    c.beginPath(); c.arc(Math.cos(a) * 58, Math.sin(a) * 58, 5, 0, Math.PI * 2); c.fill();
  }
}

/** Одна живая анимация: fn(p) каждый кадр (p 0..1), после — картинка возвращается в пул. */
/** RR-15: прозрачность эффектов навыков врага по отряду. */
const SOFT_ALPHA = 0.55;
/** Фокус на ульте героя (владелец 01.10): эффекты остальных бойцов, запущенные во время ульты, — бледнее. */
export const FOCUS_MUTE_ALPHA = 0.35;
/** Ульта героя: процедурные свечения и атласы её рецепта — крупнее обычного навыка (×1.3–1.6). */
export const ULT_FX_BOOST = 1.4;

interface Live {
  t: number;
  delay: number;
  dur: number;
  obj: Phaser.GameObjects.Image | null;
  fn: (p: number, obj: Phaser.GameObjects.Image | null) => void;
  done?: () => void;
  started: boolean;
  /** RR-15: эффект навыка врага по отряду — прозрачнее (SkillFx.soft на момент запуска). */
  soft: boolean;
  /** Ульта героя: масштаб свечений (SkillFx.boost на момент запуска). */
  boost: number;
  /** Чужой эффект во время ульты героя — бледнее (SkillFx.mute на момент запуска). */
  mute: boolean;
}

/** Точка для эффекта: x, центр тела и ноги. */
export interface FxPoint {
  x: number;
  y: number;
  feet: number;
}

const MAX_LIVE = 260;
/** Тряска экрана не чаще, чем раз в столько мс (время сцены): только крупные удары, без дрожи на каждом. */
const SHAKE_GAP_MS = 450;
const ADD = Phaser.BlendModes.ADD;
const NORMAL = Phaser.BlendModes.NORMAL;

/** Через сколько мс после начала площадного эффекта «бьёт» (цифры урона) — то же, что возвращает area(). */
const AREA_HIT: Record<Area, number> = { lightning: 120, ring: 110, quake: 110, arrows: 260, blizzard: 320, holy: 120, cloud: 150, sanctuary: 200 };

export class SkillFx {
  /**
   * RR-15: эффекты, запущенные при soft = true (навык врага по отряду), рисуются с прозрачностью × SOFT_ALPHA — и их
   * отложенные продолжения тоже (флаг запоминается в записи). Ставит BattleScene вокруг playSignature/flyAtlas.
   */
  soft = false;
  /**
   * Ульта героя (BattleScene.fxMode): свечения и атласы рецепта крупнее (×ULT_FX_BOOST), правило RR-15 не действует —
   * эффект в полную яркость даже на своих героях. Запоминается в записи, как soft.
   */
  boost = 1;
  /** Фокус на ульте героя: эффект другого бойца, запущенный во время ульты, — × FOCUS_MUTE_ALPHA. */
  mute = false;
  private readonly images: Pool<Phaser.GameObjects.Image>;
  private readonly live: Live[] = [];
  private readonly sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly motes: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly trail: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Крестики лечения, поднимающиеся вокруг цели. */
  private readonly crosses: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Пыль, песок, дым (обычное смешивание — не светится). */
  private readonly dustFx: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Монеты (Маммонит, Кража): летят вверх и падают. */
  private readonly coinFx: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Звёздочки удара (Баш, пинок). */
  private readonly starFx: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Капли слизи и яда (обычное смешивание, падают). */
  private readonly blobFx: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly flashRect: Phaser.GameObjects.Rectangle;
  private lastShake = -Infinity;

  constructor(private readonly scene: Phaser.Scene) {
    buildSkillFxTextures(scene);
    this.images = new Pool(() => scene.add.image(0, 0, TEX.glow).setBlendMode(Phaser.BlendModes.ADD));
    const common = { emitting: false, blendMode: Phaser.BlendModes.ADD } as const;
    this.sparks = scene.add
      .particles(0, 0, TEX.spark, { ...common, lifespan: { min: 350, max: 650 }, speed: { min: 80, max: 320 }, scale: { start: 0.9, end: 0 }, alpha: { start: 1, end: 0 }, gravityY: 300, maxParticles: 220 })
      .setDepth(SFX_DEPTH + 2);
    this.motes = scene.add
      .particles(0, 0, TEX.spark, { ...common, lifespan: { min: 700, max: 1100 }, speedY: { min: -170, max: -60 }, speedX: { min: -20, max: 20 }, scale: { start: 0.8, end: 0.1 }, alpha: { start: 1, end: 0 }, maxParticles: 220 })
      .setDepth(SFX_DEPTH + 1);
    this.trail = scene.add
      .particles(0, 0, TEX.glow, { ...common, lifespan: 320, speed: { min: 0, max: 30 }, scale: { start: 0.7, end: 0 }, alpha: { start: 0.9, end: 0 }, maxParticles: 200 })
      .setDepth(SFX_DEPTH);
    this.crosses = scene.add
      .particles(0, 0, TEX.cross, { ...common, lifespan: { min: 800, max: 1200 }, speedY: { min: -150, max: -70 }, speedX: { min: -12, max: 12 }, scale: { start: 0.9, end: 0.3 }, alpha: { start: 1, end: 0 }, maxParticles: 60 })
      .setDepth(SFX_DEPTH + 1);
    this.dustFx = scene.add
      .particles(0, 0, TEX.puff, { emitting: false, lifespan: { min: 450, max: 800 }, speed: { min: 20, max: 110 }, angle: { min: 180, max: 360 }, scale: { start: 0.7, end: 1.6 }, alpha: { start: 0.8, end: 0 }, rotate: { min: 0, max: 360 }, maxParticles: 140 })
      .setDepth(SFX_DEPTH - 1);
    this.coinFx = scene.add
      .particles(0, 0, TEX.coin, { emitting: false, lifespan: { min: 650, max: 900 }, speed: { min: 260, max: 460 }, angle: { min: 235, max: 305 }, gravityY: 1100, scale: { start: 1.1, end: 0.8 }, alpha: { start: 1, end: 0.2 }, rotate: { min: -180, max: 180 }, maxParticles: 60 })
      .setDepth(SFX_DEPTH + 3);
    this.starFx = scene.add
      .particles(0, 0, TEX.star, { emitting: false, lifespan: { min: 380, max: 620 }, speed: { min: 140, max: 320 }, gravityY: 250, scale: { start: 1.2, end: 0.2 }, alpha: { start: 1, end: 0 }, rotate: { min: 0, max: 360 }, maxParticles: 80 })
      .setDepth(SFX_DEPTH + 3);
    this.blobFx = scene.add
      .particles(0, 0, TEX.orb, { emitting: false, lifespan: { min: 380, max: 620 }, speed: { min: 150, max: 340 }, angle: { min: 200, max: 340 }, gravityY: 1000, scale: { start: 0.45, end: 0.15 }, alpha: { start: 0.95, end: 0.3 }, maxParticles: 100 })
      .setDepth(SFX_DEPTH + 2);
    this.flashRect = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0xffffff, 1).setAlpha(0).setDepth(SFX_DEPTH + 5).setBlendMode(Phaser.BlendModes.ADD);
  }

  /** Скорость боя для частиц (живут по своему времени). */
  setSpeed(speed: number): void {
    for (const e of this.emitters) e.timeScale = speed;
  }

  private get emitters(): Phaser.GameObjects.Particles.ParticleEmitter[] {
    return [this.sparks, this.motes, this.trail, this.crosses, this.dustFx, this.coinFx, this.starFx, this.blobFx];
  }

  get activeCount(): number {
    return this.live.length;
  }

  clear(): void {
    this.live.length = 0;
    this.images.clear();
  }

  /**
   * «Пропустить» (T2-12): оборвать всё, что ещё летит или ждёт своей задержки — снаряды, вспышки, отложенные
   * удары и тряску, частицы, вспышку экрана. Отложенные done не вызываются: они только рисуют.
   */
  cancel(): void {
    for (const r of this.live) if (r.obj) this.images.release(r.obj);
    this.live.length = 0;
    for (const e of this.emitters) e.killAll();
    this.flashRect.setAlpha(0);
  }

  step(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const r = this.live[i];
      r.t += dt;
      if (r.t < r.delay) continue;
      if (!r.started) {
        r.started = true;
        r.obj?.setVisible(true);
      }
      const p = clamp01((r.t - r.delay) / r.dur);
      const was = this.soft;
      const wasBoost = this.boost;
      const wasMute = this.mute;
      this.soft = r.soft;
      this.boost = r.boost;
      this.mute = r.mute;
      r.fn(p, r.obj);
      if (r.soft && r.obj) r.obj.alpha *= SOFT_ALPHA;
      if (r.mute && r.obj) r.obj.alpha *= FOCUS_MUTE_ALPHA;
      if (p >= 1) {
        const last = this.live.pop()!;
        if (last !== r) this.live[i] = last;
        if (r.obj) this.images.release(r.obj);
        r.done?.();
      }
      this.soft = was;
      this.boost = wasBoost;
      this.mute = wasMute;
    }
  }

  /** Началась ульта героя: эффекты, уже идущие на экране, и их продолжения — приглушить (FOCUS_MUTE_ALPHA). */
  muteLive(): void {
    for (const r of this.live) r.mute = true;
  }

  // ---------- примитивы ----------

  /** Картинка из пула: всё, что эффекты меняют (текстура, кадр, якорь, масштаб, поворот, оттенок, смешивание), сбрасывается. */
  img(tex: string, x: number, y: number, tint: number, depth = SFX_DEPTH, blend: Phaser.BlendModes = ADD): Phaser.GameObjects.Image {
    const o = this.images.acquire();
    o.setTexture(tex).setPosition(x, y).setOrigin(0.5).setScale(1).setAngle(0).setAlpha(1).setTint(tint).setDepth(depth).setFlipX(false).setFlipY(false).setBlendMode(blend);
    return o;
  }

  run(obj: Phaser.GameObjects.Image | null, dur: number, fn: Live['fn'], delay = 0, done?: () => void): void {
    if (this.live.length >= MAX_LIVE) {
      // Перегруз (скорость x2, много эффектов): старейший эффект сразу заканчиваем.
      const r = this.live.shift()!;
      if (r.obj) this.images.release(r.obj);
      r.done?.();
    }
    if (obj && delay > 0) obj.setVisible(false);
    this.live.push({ t: 0, delay, dur: Math.max(1, dur), obj, fn, done, started: false, soft: this.soft && this.boost === 1, boost: this.boost, mute: this.mute });
  }

  /** Отложенный вызов по времени боя (без картинки). */
  later(delay: number, fn: () => void): void {
    this.run(null, 1, () => {}, delay, fn);
  }

  /** Вспышка-свечение: растёт от s0 до s1 и гаснет. */
  glow(x: number, y: number, tint: number, s0: number, s1: number, dur: number, delay = 0, alpha = 1, tex: string = TEX.glow, sy = 1): void {
    s0 *= this.boost;
    s1 *= this.boost;
    const o = this.img(tex, x, y, tint);
    o.setScale(s0, s0 * sy).setAlpha(alpha);
    this.run(o, dur, (p, im) => {
      const s = s0 + (s1 - s0) * ease.quadOut(p);
      im!.setScale(s, s * sy).setAlpha(alpha * (1 - p));
    }, delay);
  }

  /** «Уменьшить анимацию»: частиц вдвое меньше (эффект остаётся виден). */
  n(count: number): number {
    return motion.reduced ? Math.ceil(count / 2) : count;
  }

  burst(x: number, y: number, tint: number, count: number): void {
    this.sparks.setParticleTint(tint);
    this.sparks.explode(this.n(count), x, y);
  }

  rise(x: number, y: number, tint: number, count: number, spreadX = 50): void {
    this.motes.setParticleTint(tint);
    for (let i = 0, k = this.n(count); i < k; i++) this.motes.emitParticleAt(x + (Math.random() - 0.5) * spreadX * 2, y + (Math.random() - 0.5) * 30, 1);
  }

  /** Клубы пыли/дыма у земли (x ± spread). */
  dust(x: number, y: number, tint: number, count: number, spread = 40): void {
    this.dustFx.setParticleTint(tint);
    for (let i = 0, k = this.n(count); i < k; i++) this.dustFx.emitParticleAt(x + (Math.random() - 0.5) * spread * 2, y - Math.random() * 16, 1);
  }

  /**
   * Облако из клубов (картинки из пула, обычное смешивание): клубы разлетаются от центра, растут и тают.
   * Плотнее частиц пыли — читается на траве и песке (смерть, песок в глаза, приземление).
   */
  puffCloud(x: number, y: number, tint: number, count: number, size: number, dur = 520, alpha = 0.85): void {
    for (let i = 0, k = this.n(count); i < k; i++) {
      const a = (i / k) * Math.PI * 2 + Math.random() * 0.8;
      const r = size * (0.25 + Math.random() * 0.35);
      const dx = Math.cos(a) * r;
      const dy = Math.sin(a) * r * 0.5;
      const o = this.img(TEX.puff, x, y, tint, SFX_DEPTH + 1, NORMAL);
      const s0 = (size / 64) * (0.55 + Math.random() * 0.3);
      o.setScale(s0 * 0.6).setAlpha(alpha).setRotation(Math.random() * Math.PI * 2);
      this.run(o, dur, (q, im) => {
        const e = ease.quadOut(q);
        im!.setPosition(x + dx * (0.4 + e), y + dy * (0.4 + e) - 20 * q).setScale(s0 * (0.6 + 0.7 * e)).setAlpha(alpha * (q < 0.35 ? 1 : 1 - (q - 0.35) / 0.65));
      });
    }
  }

  stars(x: number, y: number, tint: number, count: number): void {
    this.starFx.setParticleTint(tint);
    this.starFx.explode(this.n(count), x, y);
  }

  /** Перья: разлетаются из точки и, покачиваясь, опускаются (сокол, ангельские крылья). */
  feathers(x: number, y: number, tint: number, count: number, spread = 60, dur = 900): void {
    for (let i = 0, k = this.n(count); i < k; i++) {
      const dx = (Math.random() - 0.5) * spread * 2;
      const dy = (Math.random() - 0.5) * spread * 0.8;
      const ph = Math.random() * Math.PI * 2;
      const o = this.img(TEX.feather, x, y, tint, SFX_DEPTH + 2, NORMAL);
      o.setScale(0.9).setRotation(ph);
      this.run(o, dur, (q, im) => {
        const e = ease.quadOut(clamp01(q * 3));
        im!.setPosition(x + dx * e + Math.sin(ph + q * 9) * 14, y + dy * e + 70 * q).setRotation(ph + Math.sin(ph + q * 9) * 0.6).setAlpha(q < 0.6 ? 1 : 1 - (q - 0.6) / 0.4);
      });
    }
  }

  coins(x: number, y: number, count: number): void {
    this.coinFx.explode(this.n(count), x, y);
  }

  blobs(x: number, y: number, tint: number, count: number): void {
    this.blobFx.setParticleTint(tint);
    this.blobFx.explode(this.n(count), x, y);
  }

  /** Вспышка всего экрана; «Уменьшить анимацию» — без неё. */
  flash(tint: number, alpha = 0.25, dur = 220): void {
    if (motion.reduced) return;
    this.flashRect.setFillStyle(tint, 1).setAlpha(alpha);
    this.run(null, dur, (p) => this.flashRect.setAlpha(alpha * (1 - p)));
  }

  /** Тряска экрана — только на крупных ударах и не чаще SHAKE_GAP_MS; «Уменьшить анимацию» — без неё. */
  shake(intensity = 0.006, ms = 200): void {
    if (motion.reduced) return;
    const now = this.scene.time.now;
    if (now - this.lastShake < SHAKE_GAP_MS) return;
    this.lastShake = now;
    this.scene.cameras.main.shake(ms, intensity);
  }

  /**
   * Анимированный эффект RO (assets/effects, animatedFx.ts) из пула картинок: кадры по времени боя, ширина width,
   * якорь листа — в точке (x, y), с оттенком. false — лист ещё не загружен (грузится лениво), рисуем без него.
   */
  animated(id: string, x: number, y: number, width: number, tint: number, delay = 0, alpha = 1, depth = SFX_DEPTH + 1): boolean {
    const eff = animatedEffect(id);
    const key = animatedFxKey(id);
    if (!eff || !this.scene.textures.exists(key)) return false;
    width = Math.min(width * this.boost, GAME_W * 0.95);
    const o = this.img(key, x, y, tint, depth);
    o.setFrame(0).setOrigin(eff.anchor[0] / eff.cell[0], eff.anchor[1] / eff.cell[1]);
    o.setDisplaySize(width, (width * eff.cell[1]) / eff.cell[0]).setAlpha(alpha);
    const dur = animatedFxDuration(eff);
    this.run(o, dur, (p, im) => {
      const f = animatedFrameAt(eff, p * dur);
      im!.setVisible(f >= 0);
      if (f >= 0) im!.setFrame(f);
    }, delay);
    return true;
  }

  // ---------- удар ----------

  /** Попадание навыка: кольцо, свечение и искры в цвет стихии. big — крупнее. */
  impact(p: FxPoint, tint: number, big = false): void {
    const k = big ? 1.4 : 1;
    this.glow(p.x, p.y, tint, 0.8 * k, 3.2 * k, 320);
    this.glow(p.x, p.y, 0xffffff, 0.5 * k, 1.6 * k, 180);
    this.glow(p.x, p.y, tint, 0.3 * k, 1.5 * k, 380, 0, 0.9, TEX.ring);
    this.burst(p.x, p.y, tint, big ? 18 : 12);
  }

  // ---------- обычные удары ----------

  /**
   * Искра обычного удара по виду оружия/тела атакующего (dir — куда летит удар: 1 вправо, −1 влево).
   * big — крупный удар (ульта, мощный навык, удар на ≥ 20% HP): вспышка крупнее, белое ядро, кольцо.
   */
  strike(style: HitStyle, p: FxPoint, dir: number, big: boolean, tint: number): void {
    const k = big ? 1.35 : 1;
    const x = p.x - dir * 10;
    const y = p.y + (Math.random() - 0.5) * 24;
    // Белая звёздочка-вспышка в точке удара — у всех видов, «щелчок» попадания.
    this.glow(x, y, 0xffffff, 0.65 * k, 1.6 * k, 100, 0, 0.55, TEX.spark);
    switch (style) {
      case 'slash':
        this.slash(x, y, dir, tint, 1.5 * k, -0.5 + Math.random() * 0.5);
        this.burst(x + dir * 10, y, tint, big ? 10 : 6);
        break;
      case 'stab':
        this.slash(x, y - 10, dir, tint, 1.2 * k, -0.25, 0, 0.5);
        this.slash(x, y + 14, dir, tint, 1.2 * k, 0.35, 70, 0.5);
        this.burst(x + dir * 8, y, tint, big ? 8 : 5);
        break;
      case 'blunt':
        this.glow(x, y, tint, 0.8 * k, 3.2 * k, 240, 0, 1);
        this.glow(x, y, tint, 0.3 * k, 1.8 * k, 260, 0, 0.95, TEX.ring);
        this.stars(x, y, 0xffe890, big ? 7 : 4);
        this.dust(p.x, p.feet, 0xd8c8a8, 3, 26);
        break;
      case 'arrow':
        this.streakAt(x, y, dir, tint, 1.7 * k, 220);
        this.glow(x + dir * 12, y, tint, 0.5 * k, 2.2 * k, 220, 0, 1);
        this.glow(x + dir * 12, y, tint, 0.2 * k, 1.2 * k, 240, 0, 0.9, TEX.ring);
        this.burst(x + dir * 10, y, 0xfff0d0, big ? 8 : 5);
        break;
      case 'magic':
      case 'holy':
        this.glow(x, y, tint, 0.8 * k, 3 * k, 320, 0, 1);
        this.glow(x, y, tint, 0.3 * k, 1.7 * k, 340, 0, 0.95, TEX.ring);
        this.burst(x, y, style === 'holy' ? 0xfff6c8 : tint, big ? 12 : 8);
        break;
      case 'bite':
        this.claw(x, y, dir, tint, 1.45 * k);
        this.burst(x, y, 0xffb0a0, big ? 6 : 4);
        break;
      case 'slime':
        this.splat(x, y + 6, tint, 1.35 * k);
        this.blobs(x, y, tint, big ? 8 : 5);
        break;
    }
    if (big) {
      this.glow(x, y, 0xffffff, 0.35, 1.6, 140, 0, 0.5);
      this.glow(x, y, tint, 0.4, 2.6, 340, 0, 0.95, TEX.ring);
      this.burst(x, y, 0xffffff, 6);
    }
  }

  /**
   * Разрез-полумесяц: вспыхивает, «проворачивается» в сторону удара и гаснет. angle — наклон (рад), delay — мс,
   * sx — сжатие по ширине (укол — узкий). Под ним — белое ядро.
   */
  slash(x: number, y: number, dir: number, tint: number, scale: number, angle = 0, delay = 0, sx = 1): void {
    const d = dir < 0 ? -1 : 1;
    // Цветной полумесяц — обычным смешиванием (читается и на светлом/красном), белое ядро поверх — светится.
    for (const [t, s, a, depth, blend] of [[tint, 1, 0.9, SFX_DEPTH + 2, NORMAL], [0xffffff, 0.72, 1, SFX_DEPTH + 3, ADD]] as const) {
      const o = this.img(TEX.slash, x, y, t, depth, blend);
      o.setFlipX(d < 0).setRotation(angle * d).setScale(scale * s * sx * 0.7, scale * s * 0.7).setAlpha(a);
      this.run(o, 240, (q, im) => {
        const g = 0.7 + 0.45 * ease.quadOut(clamp01(q / 0.5));
        im!.setScale(scale * s * sx * g, scale * s * g).setRotation((angle + 0.55 * q) * d).setAlpha(a * (q < 0.35 ? 1 : 1 - (q - 0.35) / 0.65));
      }, delay);
    }
  }

  /** Когти/укус монстра: три царапины проступают по диагонали и гаснут. */
  claw(x: number, y: number, dir: number, tint: number, scale: number, delay = 0): void {
    const o = this.img(TEX.claw, x, y, tint, SFX_DEPTH + 2, NORMAL);
    o.setFlipX(dir < 0).setScale(scale * 0.6).setAlpha(0.95);
    this.run(o, 260, (q, im) => {
      im!.setScale(scale * (0.6 + 0.5 * ease.quadOut(clamp01(q / 0.4)))).setAlpha(q < 0.4 ? 0.95 : 0.95 * (1 - (q - 0.4) / 0.6));
    }, delay);
  }

  /** Шлепок слизи/яда (обычное смешивание): растекается и тает. */
  splat(x: number, y: number, tint: number, scale: number, delay = 0, dur = 380): void {
    const o = this.img(TEX.splat, x, y, tint, SFX_DEPTH + 1, NORMAL);
    o.setScale(scale * 0.35).setAlpha(0.9).setRotation(Math.random() * Math.PI * 2);
    this.run(o, dur, (q, im) => {
      im!.setScale(scale * (0.35 + 0.85 * ease.quadOut(clamp01(q / 0.35)))).setAlpha(q < 0.5 ? 0.9 : 0.9 * (1 - (q - 0.5) / 0.5));
    }, delay);
  }

  /** Полоса скорости (голова в точке x, y; dir — направление полёта). */
  streakAt(x: number, y: number, dir: number, tint: number, scale: number, dur: number, delay = 0, angle = 0): void {
    const o = this.img(TEX.streak, x, y, tint, SFX_DEPTH + 1);
    o.setFlipX(dir < 0).setOrigin(dir < 0 ? 0 : 1, 0.5).setRotation(angle).setScale(scale * 1.4, scale);
    this.run(o, dur, (q, im) => im!.setScale(scale * (1.4 - 0.6 * q), scale * (1 - 0.5 * q)).setAlpha(1 - q), delay);
  }

  // ---------- особые попадания навыков ----------

  /** Попадание навыка с особым видом (на каждую цель). from — атакующий (монеты кражи летят к нему). */
  skillHit(kind: SkillHit, p: FxPoint, dir: number, from?: FxPoint): void {
    const x = p.x - dir * 8;
    const y = p.y;
    switch (kind) {
      case 'bash': {
        // Баш: красный крест-разрез, белая вспышка, звёзды.
        this.slash(x, y, dir, 0xff3a2a, 1.45, -0.7);
        this.slash(x, y, dir, 0xff6040, 1.3, 0.6, 50);
        this.glow(x, y, 0xffffff, 0.5, 2.6, 180, 0, 1);
        this.glow(x, y, 0xff4a2a, 0.8, 3.4, 320, 0, 0.9);
        this.stars(x, y - 20, 0xffe060, 7);
        this.burst(x, y, 0xffb070, 10);
        break;
      }
      case 'envenom': {
        // Отравление: разрез и зелёный всплеск с каплями, пузырьки яда.
        this.slash(x, y, dir, 0xc8ff9a, 0.9, -0.3);
        this.splat(x, y, 0x7ee03a, 1.7, 40);
        this.blobs(x, y, 0x8fe04a, 9);
        this.later(120, () => this.rise(p.x, p.y, 0xa6f060, 5, 26));
        break;
      }
      case 'steal': {
        // Кража: быстрый укол и монетка с блеском летит к вору.
        this.slash(x, y, dir, 0xfff0c0, 0.75, -0.2, 0, 0.6);
        this.coinFly(p, from ?? { x: p.x - dir * 200, y: p.y, feet: p.feet });
        break;
      }
      case 'sand': {
        // Песок в глаза: облако песка у лица.
        this.puffCloud(p.x, p.y - 30, 0xe8c888, 7, 130, 620, 0.9);
        this.dust(p.x, p.y - 20, 0xe6c88a, 6, 36);
        this.burst(x, y - 20, 0xf0d8a0, 8);
        break;
      }
      case 'coins': {
        // Маммонит: удар и россыпь монет, золотое кольцо.
        this.glow(x, y, 0xffd84a, 0.6, 3, 280, 0, 0.95);
        this.glow(x, y, 0xffe890, 0.3, 1.8, 360, 0, 0.9, TEX.ring);
        this.coins(x, y - 10, 12);
        this.burst(x, y, 0xffe070, 8);
        break;
      }
      case 'knock': {
        // Отталкивающая стрела: удар, полосы отброса за целью, кольцо.
        for (let i = 0; i < 3; i++) this.streakAt(p.x + dir * 70, p.y + (i - 1) * 26, dir, 0x9fe6ff, 1.4 - Math.abs(i - 1) * 0.3, 320, i * 30);
        this.glow(x, y, 0xbff0ff, 0.6, 3, 280, 0, 1);
        this.glow(x, y, 0x8fe6ff, 0.4, 2.4, 380, 0, 0.9, TEX.ring);
        this.burst(x, y, 0xcff4ff, 12);
        this.dust(p.x + dir * 30, p.feet, 0xd8c8a8, 4, 30);
        break;
      }
      case 'ice': this.iceBurst(p); break;
      case 'kick': {
        // Пинок: звёздный удар, полосы, пыль.
        this.strike('blunt', p, dir, true, 0xffc860);
        this.stars(x, y - 10, 0xffe060, 8);
        for (let i = 0; i < 2; i++) this.streakAt(x + dir * 40, y + (i ? 18 : -18), dir, 0xfff0c0, 1.5, 260, i * 40);
        this.puffCloud(p.x, p.feet - 10, 0xd8c8a8, 4, 70, 420);
        break;
      }
      case 'smash': {
        this.glow(x, y, 0xffffff, 0.6, 2.6, 180, 0, 1);
        this.glow(x, y, 0xffa040, 0.8, 3.6, 340, 0, 0.9);
        this.glow(p.x, p.feet, 0xd8b080, 0.4, 3, 420, 0, 0.9, TEX.ring, 0.4);
        this.stars(x, y, 0xffe060, 8);
        this.puffCloud(p.x, p.feet - 10, 0xc8b090, 6, 110, 520);
        break;
      }
      case 'roots': this.roots(p); break;
      case 'goo':
      case 'mud': {
        const tint = kind === 'goo' ? 0x9be36b : 0x9a7a4a;
        this.splat(x, y, tint, 1.8);
        this.blobs(x, y, tint, 12);
        if (kind === 'goo') this.later(100, () => this.rise(p.x, p.y, 0xb8f080, 4, 24));
        break;
      }
      case 'bite': this.claw(x, y, dir, 0xff8a7a, 1.25); this.burst(x, y, 0xff9080, 6); break;
      case 'leap': {
        this.claw(x, y, dir, 0xff6a58, 1.6);
        this.glow(x, y, 0xffffff, 1, 2.6, 160, 0, 1, TEX.spark);
        this.puffCloud(p.x, p.feet - 10, 0xd8c8a8, 5, 90, 460);
        break;
      }
      case 'cart': {
        this.glow(x, y, 0xffc860, 0.5, 2.6, 260, 0, 0.9);
        this.stars(x, y, 0xffe890, 4);
        this.dust(p.x, p.feet, 0xc8b090, 6, 44);
        break;
      }
      case 'fire': {
        this.glow(x, y, FIRE_MAIN, 0.8, 3.2, 320, 0, 1);
        this.glow(x, y, FIRE_CORE, 0.4, 1.6, 200, 0, 1);
        this.burst(x, y, FIRE_CORE, 10);
        this.rise(p.x, p.y + 20, FIRE_MAIN, 5, 30);
        break;
      }
      case 'bounce': {
        this.splat(x, y + 10, 0xff9ad0, 1.1);
        this.blobs(x, y, 0xff9ad0, 6);
        this.stars(x, y - 30, 0xffe060, 4);
        break;
      }
      case 'counter': {
        // Контратака: встречный крест-разрез сталью, белая искра, короткое кольцо.
        this.slash(x, y, -dir, 0xbfe0ff, 1.3, -0.8);
        this.slash(x, y, -dir, 0xffffff, 1.2, 0.7, 40);
        this.glow(x, y, 0xdff0ff, 0.4, 2, 200, 0, 1, TEX.spark);
        this.glow(x, y, 0x9fd0ff, 0.3, 1.8, 300, 0, 0.9, TEX.ring);
        break;
      }
      case 'double': {
        // Двойная атака: два быстрых укола крест-накрест, белые полосы.
        this.slash(x, y - 12, dir, 0xe8f0ff, 1.05, -0.35, 0, 0.45);
        this.slash(x, y + 12, dir, 0xe8f0ff, 1.05, 0.35, 90, 0.45);
        this.streakAt(x + dir * 30, y - 12, dir, 0xffffff, 1, 180);
        this.streakAt(x + dir * 30, y + 12, dir, 0xffffff, 1, 180, 90);
        break;
      }
      case 'peck': {
        // Стальной сокол: когти и перья.
        this.claw(x, y - 10, dir, 0xe8eef8, 1.2);
        this.feathers(p.x, p.y - 20, 0xf0e4d0, 5);
        this.burst(x, y, 0xffffff, 5);
        break;
      }
      case 'gank': {
        // Грабёж: удар и монетки к разбойнику.
        this.slash(x, y, dir, 0xffe890, 0.9, -0.3, 0, 0.7);
        this.coinFly(p, from ?? { x: p.x - dir * 200, y: p.y, feet: p.feet });
        this.coins(x, y - 10, 4);
        break;
      }
    }
  }

  /** Монетка с блеском: подпрыгивает над целью и дугой летит к вору. */
  coinFly(from: FxPoint, to: FxPoint): void {
    const o = this.img(TEX.coin, from.x, from.y - 30, 0xffffff, SFX_DEPTH + 3, NORMAL);
    o.setScale(1.6);
    const x0 = from.x;
    const y0 = from.y - 30;
    this.run(o, 560, (q, im) => {
      const up = q < 0.35;
      const t = up ? q / 0.35 : (q - 0.35) / 0.65;
      const x = up ? x0 : x0 + (to.x - x0) * ease.quadOut(t);
      const y = up ? y0 - 70 * ease.quadOut(t) : y0 - 70 + (to.y - 40 - (y0 - 70)) * t - Math.sin(t * Math.PI) * 60;
      im!.setPosition(x, y).setScale(1.6 * Math.abs(Math.cos(q * 12)) + 0.2).setAlpha(q > 0.85 ? (1 - q) / 0.15 : 1);
    });
    this.later(190, () => {
      this.glow(x0, y0 - 70, 0xfff4c0, 0.3, 1.6, 260, 0, 1, TEX.spark);
      this.burst(x0, y0 - 70, 0xffe070, 5);
    });
  }

  /** Ледяной удар: веер осколков из точки попадания, голубая вспышка, кольцо инея под ногами. */
  iceBurst(p: FxPoint): void {
    this.glow(p.x, p.y, 0xbfeaff, 0.8, 3.2, 360, 0, 1);
    this.glow(p.x, p.y, 0xffffff, 0.4, 1.6, 180, 0, 1);
    this.glow(p.x, p.feet, 0x8fdcff, 0.4, 2.6, 520, 0, 0.9, TEX.ring, 0.4);
    const n = motion.reduced ? 4 : 7;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.42;
      const o = this.img(TEX.shard, p.x, p.y, 0xbfeeff, SFX_DEPTH + 2);
      o.setRotation(a).setScale(0.3, 0.8);
      this.run(o, 420, (q, im) => {
        const r = 20 + 70 * ease.quadOut(q);
        im!.setPosition(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r).setScale(0.3 + 0.6 * (1 - q), 0.8).setAlpha(1 - q * q);
      });
    }
    this.burst(p.x, p.y, 0xdff6ff, 10);
  }

  /** Корни мандрагоры: три корня вырастают из земли вокруг ног цели, пыль. */
  roots(p: FxPoint): void {
    for (let i = 0; i < 5; i++) {
      const d = i - 2;
      const o = this.img(TEX.vine, p.x + d * 32, p.feet + 10 - Math.abs(d) * 4, 0xffffff, SFX_DEPTH + 1, NORMAL);
      o.setOrigin(0.5, 1).setFlipX(d > 0).setScale(1.3, 0).setRotation(d * 0.22);
      const h = 1.7 - Math.abs(d) * 0.25;
      this.run(o, 950, (q, im) => {
        const up = q < 0.25 ? ease.backOut(q / 0.25) : 1;
        im!.setScale(1.3, h * up).setAlpha(q < 0.75 ? 1 : 1 - (q - 0.75) / 0.25);
      }, Math.abs(d) * 50);
    }
    this.puffCloud(p.x, p.feet - 6, 0x9a8a5a, 5, 110, 480);
    this.burst(p.x, p.feet - 10, 0xa6d060, 8);
  }

  // ---------- навыки целиком ----------

  /** Магнум брейк: огненное кольцо вокруг мечника — вспышка, два кольца по земле, языки пламени наружу. */
  magnumBreak(c: FxPoint, targets: FxPoint[]): void {
    this.glow(c.x, c.y, FIRE_CORE, 1, 3.4, 260, 0, 1);
    this.glow(c.x, c.y, FIRE_MAIN, 1.2, 6.5, 420, 0, 0.95);
    this.glow(c.x, c.feet, FIRE_DEEP, 0.5, 7.5, 520, 0, 1, TEX.ring, 0.4);
    this.glow(c.x, c.feet, FIRE_MAIN, 0.4, 5.5, 440, 80, 0.9, TEX.ring, 0.4);
    const n = motion.reduced ? 6 : 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const o = this.img(TEX.flame, c.x, c.feet - 30, 0xffffff, SFX_DEPTH + 2);
      o.setRotation(a).setOrigin(0.8, 0.5).setScale(0.5, 0.45);
      this.run(o, 420, (q, im) => {
        const r = 30 + 250 * ease.quadOut(q);
        im!.setPosition(c.x + Math.cos(a) * r, c.feet - 30 + Math.sin(a) * r * 0.45).setAlpha(1 - q).setScale(0.5 + 0.3 * q, 0.45 * (1 - q * 0.5));
      });
    }
    this.burst(c.x, c.y, FIRE_CORE, 20);
    this.dust(c.x, c.feet, 0x6a4a3a, 6, 90);
    for (const p of targets) this.later(110, () => this.skillHit('fire', p, p.x >= c.x ? 1 : -1));
    this.later(110, () => this.shake(0.005, 160));
  }

  /** Удар тележкой: широкий размах дугой по переднему ряду, пыль под целями. */
  cartSwing(c: FxPoint, targets: FxPoint[], dir: number): void {
    const cx = c.x + dir * 90;
    this.slash(cx, c.y, dir, 0xffd890, 2.6, -1.1);
    this.slash(cx, c.y + 20, dir, 0xffffff, 2.1, -0.9, 40, 0.8);
    this.dust(c.x + dir * 60, c.feet, 0xc8b090, 8, 90);
    for (const p of targets) this.later(90, () => this.skillHit('cart', p, dir));
  }

  /** Крик провокации: красное кольцо и свечение вокруг мечника (tint — у «Громкого голоса» оранжевый). */
  shout(c: FxPoint, tint = 0xff4030): void {
    this.glow(c.x, c.y, tint, 0.6, 3, 360, 0, 0.8);
    const red = tint === 0xff4030;
    this.glow(c.x, c.y, red ? 0xff5040 : tint, 0.4, 3.6, 420, 0, 0.95, TEX.ring);
    this.glow(c.x, c.y, red ? 0xff8070 : 0xffffff, 0.3, 2.6, 420, 90, 0.8, TEX.ring);
  }

  /** След из светящихся частиц (снаряды рецептов); «Уменьшить анимацию» — без следа. */
  trailAt(x: number, y: number, tint: number, count = 1): void {
    if (motion.reduced) return;
    this.trail.setParticleTint(tint);
    this.trail.emitParticleAt(x, y, count);
  }

  /** Провокация на цели: красный «!» над головой, красная аура, кольцо под ногами. */
  provoke(p: FxPoint, headY: number): void {
    const o = this.img(TEX.bang, p.x, headY - 40, 0xffffff, SFX_DEPTH + 4, NORMAL);
    o.setScale(0);
    this.run(o, 1100, (q, im) => {
      const s = q < 0.18 ? ease.backOut(q / 0.18) : 1;
      im!.setScale(0.9 * s).setY(headY - 40 - 10 * Math.sin(q * Math.PI)).setAlpha(q < 0.75 ? 1 : 1 - (q - 0.75) / 0.25);
    });
    const aura = this.img(TEX.glow, p.x, p.y, 0xff2a1a, SFX_DEPTH - 1);
    aura.setScale(3, 4).setAlpha(0);
    this.run(aura, 900, (q, im) => im!.setAlpha(0.7 * Math.abs(Math.sin(q * Math.PI * 2)) * (1 - q * 0.5)));
    this.glow(p.x, p.feet, 0xff4030, 0.4, 2.4, 600, 0, 0.9, TEX.ring, 0.4);
  }

  /** Королевский прыжок (Мастеринг): ударная волна — кольца по земле от кастера, пыль, брызги слизи. */
  royalBounce(c: FxPoint, targets: FxPoint[]): void {
    for (let i = 0; i < 3; i++) this.glow(c.x, c.feet, i === 1 ? 0xffffff : 0xff9ad0, 0.5, 11 - i * 2, 620, i * 90, 0.95, TEX.ring, 0.38);
    this.glow(c.x, c.feet - 40, 0xff9ad0, 1, 6, 420, 0, 0.8);
    this.splat(c.x, c.feet - 20, 0xff9ad0, 2.2);
    this.blobs(c.x, c.feet - 40, 0xff9ad0, 14);
    this.puffCloud(c.x, c.feet - 10, 0xd8c8a8, 10, 260, 620);
    for (const p of targets) this.later(140 + Math.abs(p.x - c.x) * 0.25, () => this.skillHit('bounce', p, p.x >= c.x ? 1 : -1));
    this.later(60, () => {
      this.shake(0.008, 260);
      this.flash(0xffc0e0, 0.08, 180);
    });
  }

  /** Облако смерти: клубы дыма у ног и светлая вспышка. */
  deathPuff(p: FxPoint, big: boolean): void {
    this.puffCloud(p.x, p.feet - 40, 0xeeeaf4, big ? 12 : 8, big ? 220 : 150, 700, 0.9);
    this.glow(p.x, p.y, 0xffffff, 0.8, big ? 4 : 2.8, 380, 0, 0.6);
    this.rise(p.x, p.feet, 0xe8e0ff, 5, 36);
  }

  /** Пыль из-под ног (рывок, приземление). */
  dashDust(x: number, feet: number, dir: number): void {
    this.puffCloud(x - dir * 24, feet - 8, 0xd8c8a8, 4, 80, 420, 0.8);
  }

  /** След рывка/прыжка: светящиеся частицы по пути тела. «Уменьшить анимацию» — без следа. */
  dashTrail(x: number, y: number, tint: number): void {
    if (motion.reduced) return;
    this.glow(x, y, tint, 2.2, 0.6, 280, 0, 0.75);
    this.trail.setParticleTint(tint);
    this.trail.emitParticleAt(x, y, 2);
  }

  // ---------- огненная стрела ----------

  /**
   * Одна огненная стрела (RO Fire Bolt): большое пламя (~150 px) с ярким ядром и шлейфом падает сверху наискосок
   * на цель (со стороны кастера) за FIRE_BOLT_MS, взрыв огня ~240 px со вспышкой, искрами и углями.
   * last — последняя стрела залпа: короткая тряска экрана. «Уменьшить анимацию» — без шлейфа, тряски, вспышки и углей.
   */
  fireBolt(from: FxPoint, to: FxPoint, index: number, last: boolean, delay: number, onHit: () => void): void {
    const reduced = motion.reduced;
    const side = from.x <= to.x ? -1 : 1;
    const tx = to.x + ((index % 3) - 1) * 22;
    const ty = to.y + 10 - (index % 2) * 18;
    const x0 = tx + side * (190 + (index % 2) * 40);
    const y0 = ty - 620;
    const angle = Math.atan2(ty - y0, tx - x0);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const flame = this.img(TEX.flame, x0, y0, 0xffffff, SFX_DEPTH + 2);
    flame.setOrigin(0.8, 0.5).setRotation(angle).setScale(0.82, 0.95);
    const halo = this.img(TEX.glow, x0, y0, FIRE_MAIN, SFX_DEPTH + 1);
    halo.setScale(2.4).setAlpha(0.55);
    let frame = 0;
    this.run(halo, FIRE_BOLT_MS, (p, im) => im!.setPosition(x0 + (tx - x0) * p, y0 + (ty - y0) * p), delay);
    this.run(flame, FIRE_BOLT_MS, (p, im) => {
      const x = x0 + (tx - x0) * p;
      const y = y0 + (ty - y0) * p;
      im!.setPosition(x, y).setScale(0.82 * (0.95 + 0.1 * Math.sin(p * 50)), 0.95);
      frame++;
      if (reduced) return;
      this.trail.setParticleTint(frame % 2 ? FIRE_MAIN : FIRE_DEEP);
      this.trail.emitParticleAt(x - cos * 60, y - sin * 60, 2);
      if (frame % 3 === 0) this.burst(x, y, FIRE_CORE, 1);
    }, delay, () => {
      this.fireBurst(tx, ty, to.feet, last, reduced);
      onHit();
    });
  }

  /** Взрыв огня в точке попадания: белая вспышка, огненный шар ~240 px, кольцо по земле, искры, угли, лист fx_hit. */
  fireBurst(x: number, y: number, feet: number, last: boolean, reduced: boolean): void {
    this.glow(x, y, FIRE_MAIN, 1, 3.8, 380, 0, 1);
    this.glow(x, y, FIRE_CORE, 0.6, 2.2, 200, 0, 1);
    this.glow(x, y, 0xffffff, 0.4, 1.2, 120, 0, 0.9);
    this.burst(x, y, FIRE_CORE, 18);
    this.glow(x, feet, FIRE_DEEP, 0.4, 2.4, 420, 0, 0.9, TEX.ring, 0.4);
    this.animated('fx_hit', x, y, 250, 0xffb060, 0, 0.9);
    this.rise(x, y + 30, FIRE_MAIN, 6, 50);
    if (last && !reduced) {
      this.flash(0xff7a20, 0.1, 180);
      this.shake(0.006, 160);
    }
  }

  // ---------- снаряды ----------

  /**
   * Снаряд от кастера к цели за dur мс, затем onHit. fireball — шар со шлейфом, ice — ледяной осколок,
   * lightning — искрящий шар, beam — луч света (мгновенно), arrow — светящаяся стрела, meteor — падает сверху.
   */
  projectile(kind: Projectile, from: FxPoint, to: FxPoint, tint: number, dur: number, delay: number, onHit: () => void): void {
    if (kind === 'beam') return this.beam(from, to, tint, delay, onHit);
    if (kind === 'rock') return this.spikes(to, tint, delay, onHit);
    if (kind === 'arrow') return this.glowArrow(from, to, tint, 1.3, dur, delay, onHit);
    let x0 = from.x;
    let y0 = from.y;
    if (kind === 'meteor') {
      x0 = to.x - 260;
      y0 = to.y - 760;
    }
    const ice = kind === 'ice';
    const o = this.img(ice ? TEX.shard : TEX.orb, x0, y0, tint, SFX_DEPTH + 1);
    // Ядро: у огня/магии — белый шар, у ледяного осколка — ореол вокруг (осколок читается на траве).
    const core = ice ? this.img(TEX.glow, x0, y0, 0xbfeeff, SFX_DEPTH) : this.img(TEX.orb, x0, y0, 0xffffff, SFX_DEPTH + 2);
    const size = kind === 'meteor' ? 1.9 : kind === 'fireball' ? 1.25 : kind === 'arcane' || kind === 'dark' || kind === 'poison' ? 1 : 1.1;
    o.setScale(ice ? 1.5 : size);
    if (ice) core.setScale(2.6, 1.2).setAlpha(0.7);
    else core.setScale(size * 0.45);
    const angle = Phaser.Math.RadToDeg(Math.atan2(to.y - y0, to.x - x0));
    if (ice) {
      o.setAngle(angle);
      core.setAngle(angle);
    }
    // Лёгкая дуга по высоте (кроме метеора): снаряд «летит», а не ползёт.
    const arc = kind === 'meteor' ? 0 : Math.min(120, Math.abs(to.x - x0) * 0.18);
    let frame = 0;
    const d = kind === 'meteor' ? dur * 1.6 : dur;
    this.run(core, d, (p, im) => {
      const x = x0 + (to.x - x0) * p;
      const y = y0 + (to.y - y0) * p - Math.sin(p * Math.PI) * arc;
      im!.setPosition(x, y);
    }, delay);
    this.run(o, d, (p, im) => {
      const x = x0 + (to.x - x0) * p;
      const y = y0 + (to.y - y0) * p - Math.sin(p * Math.PI) * arc;
      im!.setPosition(x, y);
      if (kind === 'fireball' || kind === 'meteor') im!.setScale(size * (0.9 + 0.15 * Math.sin(p * 40)));
      // Шлейф: частица каждый кадр полёта (огонь — чередуя жёлтый и красный).
      frame++;
      this.trail.setParticleTint(kind === 'fireball' || kind === 'meteor' ? (frame % 2 ? 0xffb040 : 0xff4a10) : tint);
      this.trail.emitParticleAt(x, y, kind === 'meteor' ? 3 : 1);
      if (kind === 'lightning' && frame % 3 === 0) this.burst(x, y, tint, 1);
    }, delay, onHit);
  }

  /**
   * Светящаяся стрела (Двойной выстрел, Отталкивающая стрела): древко в цвет навыка, яркий ореол вокруг,
   * шлейф частиц; scale — крупнее для заряженной стрелы.
   */
  glowArrow(from: FxPoint, to: FxPoint, tint: number, scale: number, dur: number, delay: number, onHit: () => void): void {
    const x0 = from.x;
    const y0 = from.y - 10;
    const ang = Math.atan2(to.y - y0, to.x - x0);
    const halo = this.img(TEX.glow, x0, y0, tint, SFX_DEPTH + 1);
    halo.setRotation(ang).setScale(2.2 * scale, 0.9 * scale).setAlpha(0.8);
    const a = this.img(TEX.arrow, x0, y0, 0xffffff, SFX_DEPTH + 2);
    a.setRotation(ang).setScale(1.25 * scale);
    const tip = Math.cos(ang) * 30 * scale;
    const tipY = Math.sin(ang) * 30 * scale;
    let frame = 0;
    const move = (p: number, im: Phaser.GameObjects.Image | null) => im!.setPosition(x0 + (to.x - x0) * p, y0 + (to.y - y0) * p);
    this.run(halo, dur, move, delay);
    this.run(a, dur, (p, im) => {
      move(p, im);
      frame++;
      if (motion.reduced) return;
      this.trail.setParticleTint(tint);
      this.trail.emitParticleAt(im!.x - tip, im!.y - tipY, 1);
      if (frame % 2 === 0) this.burst(im!.x, im!.y, tint, 1);
    }, delay, onHit);
  }

  /** Луч света от кастера к цели: вспыхивает, держится, гаснет; столб света на цели. */
  beam(from: FxPoint, to: FxPoint, tint: number, delay: number, onHit: () => void): void {
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    const b = this.img(TEX.beam, (from.x + to.x) / 2, (from.y + to.y) / 2, tint, SFX_DEPTH + 1);
    b.setRotation(ang).setScale(len / 64, 1.2).setAlpha(0);
    this.run(b, 420, (p, im) => {
      im!.setAlpha(p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8).setScale(len / 64, 1.6 - p);
    }, delay);
    // Вертикальный столб на цели.
    this.pillar(to, tint, delay + 60);
    this.later(delay + 90, onHit);
  }

  /** Столб света над целью (святое). */
  pillar(p: FxPoint, tint: number, delay = 0): void {
    const col = this.img(TEX.beam, p.x, p.feet - 170, tint, SFX_DEPTH + 1);
    col.setRotation(Math.PI / 2).setScale(340 / 64, 2.4).setAlpha(0);
    this.run(col, 520, (q, im) => im!.setAlpha(q < 0.15 ? q / 0.15 : 1 - (q - 0.15) / 0.85).setScale(340 / 64, 2.6 * (1 - q * 0.6)), delay);
    this.glow(p.x, p.feet, tint, 0.5, 2.2, 520, delay, 0.9, TEX.ring, 0.35);
    this.later(delay, () => this.rise(p.x, p.feet, tint, 6, 30));
  }

  /** Каменные шипы из-под земли под целью. */
  spikes(p: FxPoint, tint: number, delay: number, onHit: () => void): void {
    for (let i = 0; i < 3; i++) {
      const s = this.img(TEX.rock, p.x + (i - 1) * 34, p.feet + 4, tint, SFX_DEPTH);
      s.setOrigin(0.5, 1).setScale(1, 0);
      const h = i === 1 ? 2.2 : 1.5;
      this.run(s, 520, (q, im) => {
        const up = q < 0.3 ? ease.backOut(q / 0.3) : 1;
        im!.setScale(1, h * up).setAlpha(q < 0.7 ? 1 : 1 - (q - 0.7) / 0.3);
      }, delay + i * 50);
    }
    this.later(delay + 120, () => {
      this.burst(p.x, p.feet, tint, 10);
      onHit();
    });
  }

  // ---------- площадь ----------

  /**
   * Площадной эффект по целям. center — где «эпицентр» (кастер для кольца ближнего боя, иначе центр целей).
   * Возвращает задержку (мс) до момента удара — к нему BattleScene приурочивает цифры урона.
   */
  areaAt(delay: number, kind: Area, targets: FxPoint[], center: FxPoint, tint: number): number {
    this.later(delay, () => this.area(kind, targets, center, tint));
    return delay + AREA_HIT[kind];
  }

  area(kind: Area, targets: FxPoint[], center: FxPoint, tint: number): number {
    switch (kind) {
      case 'lightning': {
        targets.forEach((p, i) => this.lightning(p, tint, 60 + i * 90));
        this.later(60, () => this.flash(0xd8d8ff, 0.14, 180));
        this.later(60 + 90 * Math.max(0, targets.length - 1), () => this.flash(0xffffff, 0.08, 160));
        return AREA_HIT.lightning;
      }
      case 'ring':
      case 'quake': {
        const big = kind === 'quake' ? 1.6 : 1.2;
        this.glow(center.x, center.feet, tint, 0.4, 6 * big, 520, 0, 1, TEX.ring, 0.4);
        this.glow(center.x, center.feet, tint, 0.3, 4 * big, 420, 90, 0.8, TEX.ring, 0.4);
        this.glow(center.x, center.y, tint, 1, 5 * big, 360);
        this.burst(center.x, center.y, tint, 24);
        for (const p of targets) this.later(120, () => this.burst(p.x, p.feet, kind === 'quake' ? 0xb08050 : tint, 8));
        return AREA_HIT[kind];
      }
      case 'arrows': {
        for (const [i, p] of targets.entries()) for (let k = 0, n = motion.reduced ? 3 : 5; k < n; k++) this.fallingArrow(p, tint, i * 50 + k * 55);
        return AREA_HIT.arrows;
      }
      case 'blizzard': {
        for (const [i, p] of targets.entries()) {
          for (let k = 0; k < 3; k++) {
            const from = { x: p.x + 120 + k * 30, y: p.y - 520, feet: p.feet };
            this.projectile('ice', from, { ...p, x: p.x + (k - 1) * 26 }, tint, 280, i * 40 + k * 70, () => this.burst(p.x, p.y, tint, 5));
          }
        }
        this.glow(center.x, center.feet, tint, 1, 7, 700, 0, 0.6, TEX.glow, 0.45);
        this.later(80, () => this.flash(0xa8e0ff, 0.1, 260));
        return AREA_HIT.blizzard;
      }
      case 'holy': {
        targets.forEach((p, i) => this.pillar(p, tint, i * 70));
        this.later(40, () => this.flash(0xfff4c0, 0.1, 240));
        return AREA_HIT.holy;
      }
      case 'cloud': {
        for (const p of targets) {
          this.glow(p.x, p.feet - 20, tint, 1, 4, 650, 0, 0.8, TEX.glow, 0.6);
          this.later(60, () => this.rise(p.x, p.feet, tint, 6, 40));
        }
        return AREA_HIT.cloud;
      }
      case 'sanctuary': {
        for (const p of targets) this.glow(p.x, p.feet, tint, 1.2, 1.9, 800, 0, 0.9, TEX.circle, 0.35);
        return AREA_HIT.sanctuary;
      }
    }
  }

  lightning(p: FxPoint, tint: number, delay: number): void {
    const b = this.img(TEX.bolt, p.x + (Math.random() - 0.5) * 20, p.feet, tint, SFX_DEPTH + 3);
    b.setOrigin(0.5, 1).setScale(1.3, 1.5).setFlipX(Math.random() < 0.5);
    this.run(b, 300, (q, im) => {
      // Два мигания и угасание.
      const a = q < 0.15 ? 1 : q < 0.3 ? 0.25 : q < 0.45 ? 1 : 1 - (q - 0.45) / 0.55;
      im!.setAlpha(a);
    }, delay);
    const core = this.img(TEX.bolt, b.x, p.feet, 0xffffff, SFX_DEPTH + 4);
    core.setOrigin(0.5, 1).setScale(0.6, 1.5).setFlipX(b.flipX);
    this.run(core, 200, (q, im) => im!.setAlpha(1 - q), delay);
    this.glow(p.x, p.feet, tint, 0.5, 2.6, 380, delay, 1, TEX.ring, 0.4);
    this.glow(p.x, p.y, tint, 1, 3, 260, delay);
    this.later(delay, () => this.burst(p.x, p.feet - 10, tint, 10));
  }

  private fallingArrow(p: FxPoint, tint: number, delay: number): void {
    const tx = p.x + (Math.random() - 0.5) * 70;
    const ty = p.feet - Math.random() * 60;
    const x0 = tx - 140;
    const y0 = ty - 560;
    const ang = Math.atan2(ty - y0, tx - x0);
    const halo = this.img(TEX.glow, x0, y0, tint, SFX_DEPTH);
    halo.setRotation(ang).setScale(2.4, 0.7).setAlpha(0.75);
    const a = this.img(TEX.arrow, x0, y0, 0xffffff, SFX_DEPTH + 1);
    a.setRotation(ang).setScale(1.35);
    const move = (q: number, im: Phaser.GameObjects.Image | null) => im!.setPosition(x0 + (tx - x0) * q, y0 + (ty - y0) * q);
    this.run(halo, 240, move, delay);
    this.run(a, 240, move, delay, () => {
      this.burst(tx, ty, 0xfff0d0, 3);
      this.glow(tx, ty, tint, 0.3, 1.4, 200, 0, 0.9);
      this.dust(tx, ty, 0xd8c8a8, 1, 10);
    });
  }

  // ---------- лечение и баффы ----------

  /**
   * Лечение (RO Heal): бело-зелёный столб света от земли через всю фигуру (~350 px, мягкие края), расходящееся
   * кольцо по земле, поднимающиеся искры и крестики, свечение на теле. small — Первая помощь: столб ниже,
   * крестик над головой. «Уменьшить анимацию» — столб не растёт, а проявляется на месте; частиц меньше.
   */
  heal(p: FxPoint, big = false, small = false): void {
    const k = big ? 1.15 : small ? 0.6 : 1;
    const reduced = motion.reduced;
    this.glow(p.x, p.feet, HEAL_MAIN, 0.4, 2.6 * Math.max(k, 0.8), 620, 0, 0.95, TEX.ring, 0.35);
    this.glow(p.x, p.y, HEAL_MAIN, 1, 2.8 * k, 520, 0, 0.25);
    const h = 350 * k;
    // Мягкий зелёный столб и тонкое приглушённое ядро: вместе с атласом Heal не выбеливают тело.
    for (const [w, tint, a] of [[100 * k, HEAL_MAIN, 0.35], [24 * k, 0xffffff, 0.22]] as const) {
      const col = this.img(TEX.beam, p.x, p.feet, tint, SFX_DEPTH + 1);
      col.setOrigin(0, 0.5).setRotation(-Math.PI / 2).setScale(reduced ? h / 64 : 0, w / 32).setAlpha(a);
      this.run(col, 760, (q, im) => {
        const up = reduced ? 1 : ease.quadOut(clamp01(q / 0.25));
        const fade = q < 0.55 ? (reduced ? Math.min(1, q / 0.15) : 1) : 1 - (q - 0.55) / 0.45;
        im!.setScale((h / 64) * up, (w / 32) * (1 - 0.35 * q)).setAlpha(a * fade);
      });
    }
    this.glow(p.x, p.feet, HEAL_LIGHT, 0.6, 2.2 * k, 500, 0, 0.8, TEX.glow, 0.4);
    this.rise(p.x, p.feet, 0xb4ffb0, big ? 14 : small ? 5 : 10, 60 * k);
    this.rise(p.x, p.feet - 40, 0xffffff, big ? 6 : 4, 40 * k);
    this.crosses.setParticleTint(0xe4ffe0);
    const crosses = this.n(big ? 7 : small ? 3 : 5);
    for (let i = 0; i < crosses; i++) this.crosses.emitParticleAt(p.x + (Math.random() - 0.5) * 130 * k, p.feet - 20 - Math.random() * 160 * k, 1);
    if (small) {
      // Первая помощь: крупный крестик всплывает над фигурой.
      const c = this.img(TEX.cross, p.x, p.y - 30, 0x9dff9a, SFX_DEPTH + 3);
      c.setScale(0);
      this.run(c, 700, (q, im) => im!.setScale(2.2 * (q < 0.2 ? ease.backOut(q / 0.2) : 1)).setY(p.y - 30 - 60 * q).setAlpha(q < 0.6 ? 1 : 1 - (q - 0.6) / 0.4));
    }
  }

  /** Кастер лечения: короткое святое свечение и круг под ногами. */
  holyCast(p: FxPoint): void {
    this.glow(p.x, p.y, 0xfff4c8, 1, 3, 420, 0, 0.7);
    const c = this.img(TEX.circle, p.x, p.feet, HEAL_LIGHT, SFX_DEPTH - 1);
    c.setScale(0.6, 0.22).setAlpha(0);
    const spin = motion.reduced ? 0 : 1.4;
    this.run(c, 560, (q, im) => {
      const s = 0.6 + 0.55 * ease.quadOut(q);
      im!.setScale(s, s * 0.36).setAlpha(q < 0.2 ? q / 0.2 : 1 - (q - 0.2) / 0.8).setRotation(q * spin);
    });
    this.rise(p.x, p.feet, 0xfff4c8, 5, 50);
  }

  /**
   * Бафф (Благословение — золото, Ускорение — голубой, прочее — цвет статуса): кольцо под ногами, столб света,
   * по спирали вверх поднимаются искры-звёздочки, блик над головой.
   */
  buff(p: FxPoint, tint: number): void {
    this.glow(p.x, p.feet, tint, 0.4, 2.2, 640, 0, 0.95, TEX.ring, 0.35);
    this.glow(p.x, p.feet, 0xffffff, 0.3, 1.4, 420, 60, 0.8, TEX.ring, 0.35);
    for (const [w, t, a] of [[3.2, tint, 0.75], [1.2, 0xffffff, 0.8]] as const) {
      const col = this.img(TEX.beam, p.x, p.feet, t, SFX_DEPTH);
      col.setOrigin(0, 0.5).setRotation(-Math.PI / 2).setScale(260 / 64, w).setAlpha(0);
      this.run(col, 700, (q, im) => im!.setAlpha(a * (q < 0.2 ? q / 0.2 : 1 - (q - 0.2) / 0.8)).setScale((260 / 64) * (0.8 + 0.2 * q), w * (1 - 0.4 * q)));
    }
    // Спираль искр: стартуют по кругу у ног с задержкой — поднимаются столбом.
    const n = this.n(10);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 4;
      this.later(i * 35, () => {
        this.motes.setParticleTint(i % 3 ? tint : 0xffffff);
        this.motes.emitParticleAt(p.x + Math.cos(a) * 46, p.feet - 10 + Math.sin(a) * 12, 1);
      });
    }
    this.later(260, () => {
      this.glow(p.x, p.feet - 250, 0xffffff, 0.3, 1.5, 300, 0, 1, TEX.spark);
      this.stars(p.x, p.feet - 230, tint, 3);
    });
  }

  // ---------- каст ----------

  /** Круг каста и свечение на юните — живут в контейнере юнита (двигаются с ним, сортируются по глубине). */
  castRig(node: Phaser.GameObjects.Container, bodyH: number): CastRig {
    return new CastRig(this.scene, node, bodyH, this);
  }

  /** Искры, поднимающиеся с круга каста. */
  castMotes(x: number, feet: number, tint: number): void {
    this.rise(x, feet, tint, motion.reduced ? 1 : 2, 110);
  }
}

/** Размер круга каста под кастером (256 px текстуры × CIRCLE_K ≈ 320 px в поперечнике). */
const CIRCLE_K = 1.25;

/** Круг под ногами (сжат по вертикали — «лежит» на земле), вращается; свечение-аура за фигурой. */
export class CastRig {
  private readonly ground: Phaser.GameObjects.Container;
  private readonly outer: Phaser.GameObjects.Image;
  private readonly inner: Phaser.GameObjects.Image;
  /** Мягкое свечение под кругом: круг читается и на светлой траве. */
  private readonly glowDisc: Phaser.GameObjects.Image;
  private readonly aura: Phaser.GameObjects.Image;
  private t = 0;
  private moteAcc = 0;
  private tint = 0xffffff;
  active = false;

  constructor(
    scene: Phaser.Scene,
    private readonly node: Phaser.GameObjects.Container,
    bodyH: number,
    private readonly fx: SkillFx,
  ) {
    this.outer = scene.add.image(0, 0, TEX.circle).setBlendMode(Phaser.BlendModes.ADD);
    this.inner = scene.add.image(0, 0, TEX.circle).setBlendMode(Phaser.BlendModes.ADD).setScale(0.55);
    this.glowDisc = scene.add.image(0, 0, TEX.glow).setBlendMode(Phaser.BlendModes.ADD).setScale(4.2);
    this.ground = scene.add.container(0, 0, [this.glowDisc, this.outer, this.inner]).setScale(CIRCLE_K, CIRCLE_K * 0.38).setVisible(false);
    this.aura = scene.add.image(0, -bodyH * 0.5, TEX.glow).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(bodyH * 1.3, bodyH * 1.5).setVisible(false);
    // Круг — под спрайтом (индекс 0), аура — тоже за фигурой.
    node.addAt(this.aura, 0);
    node.addAt(this.ground, 0);
  }

  show(tint: number): void {
    this.tint = tint;
    this.active = true;
    this.t = 0;
    this.outer.setTint(tint);
    this.inner.setTint(0xffffff);
    this.glowDisc.setTint(tint);
    this.aura.setTint(tint);
    this.ground.setVisible(true).setAlpha(0);
    this.aura.setVisible(true).setAlpha(0);
  }

  hide(): void {
    this.active = false;
    this.ground.setVisible(false);
    this.aura.setVisible(false);
  }

  /** dt — мс боя. progress — доля каста (0..1): круг разгорается к концу. */
  step(dt: number, progress: number): void {
    if (!this.active) return;
    this.t += dt;
    const fade = Math.min(1, this.t / 200);
    this.outer.rotation += dt * 0.0012;
    this.inner.rotation -= dt * 0.002;
    const pulse = 0.5 + 0.5 * Math.sin(this.t / 110);
    this.ground.setAlpha(fade * (0.75 + 0.25 * pulse));
    const grow = 0.85 + 0.25 * progress;
    this.ground.setScale(CIRCLE_K * grow, CIRCLE_K * 0.38 * grow);
    this.inner.setAlpha(0.55 + 0.45 * progress);
    this.glowDisc.setAlpha(0.35 + 0.3 * progress);
    this.aura.setAlpha(fade * (0.35 + 0.25 * pulse + 0.25 * progress));
    this.moteAcc += dt;
    // Искры поднимаются с круга всё чаще к концу каста (у огня — языки пламени вверх).
    const every = motion.reduced ? 140 : 60 - 25 * progress;
    if (this.moteAcc > every) {
      this.moteAcc = 0;
      this.fx.castMotes(this.node.x, this.node.y, this.tint);
    }
  }
}
