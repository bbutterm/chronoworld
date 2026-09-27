import Phaser from 'phaser';
import { GAME_H, GAME_W } from './layout';
import { clamp01, ease, Pool } from './perf';
import type { Area, Projectile } from './skillLook';
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
} as const;

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
interface Live {
  t: number;
  delay: number;
  dur: number;
  obj: Phaser.GameObjects.Image | null;
  fn: (p: number, obj: Phaser.GameObjects.Image | null) => void;
  done?: () => void;
  started: boolean;
}

/** Точка для эффекта: x, центр тела и ноги. */
export interface FxPoint {
  x: number;
  y: number;
  feet: number;
}

const MAX_LIVE = 160;

/** Через сколько мс после начала площадного эффекта «бьёт» (цифры урона) — то же, что возвращает area(). */
const AREA_HIT: Record<Area, number> = { lightning: 120, ring: 110, quake: 110, arrows: 260, blizzard: 320, holy: 120, cloud: 150, sanctuary: 200 };

export class SkillFx {
  private readonly images: Pool<Phaser.GameObjects.Image>;
  private readonly live: Live[] = [];
  private readonly sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly motes: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly trail: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Крестики лечения, поднимающиеся вокруг цели. */
  private readonly crosses: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly flashRect: Phaser.GameObjects.Rectangle;

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
    this.flashRect = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0xffffff, 1).setAlpha(0).setDepth(SFX_DEPTH + 5).setBlendMode(Phaser.BlendModes.ADD);
  }

  /** Скорость боя для частиц (живут по своему времени). */
  setSpeed(speed: number): void {
    for (const e of [this.sparks, this.motes, this.trail, this.crosses]) e.timeScale = speed;
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
    for (const e of [this.sparks, this.motes, this.trail, this.crosses]) e.killAll();
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
      r.fn(p, r.obj);
      if (p >= 1) {
        const last = this.live.pop()!;
        if (last !== r) this.live[i] = last;
        if (r.obj) this.images.release(r.obj);
        r.done?.();
      }
    }
  }

  // ---------- примитивы ----------

  private img(tex: string, x: number, y: number, tint: number, depth = SFX_DEPTH): Phaser.GameObjects.Image {
    const o = this.images.acquire();
    o.setTexture(tex).setPosition(x, y).setOrigin(0.5).setScale(1).setAngle(0).setAlpha(1).setTint(tint).setDepth(depth).setFlipX(false);
    return o;
  }

  private run(obj: Phaser.GameObjects.Image | null, dur: number, fn: Live['fn'], delay = 0, done?: () => void): void {
    if (this.live.length >= MAX_LIVE) {
      // Перегруз (скорость x2, много эффектов): старейший эффект сразу заканчиваем.
      const r = this.live.shift()!;
      if (r.obj) this.images.release(r.obj);
      r.done?.();
    }
    if (obj && delay > 0) obj.setVisible(false);
    this.live.push({ t: 0, delay, dur: Math.max(1, dur), obj, fn, done, started: false });
  }

  /** Отложенный вызов по времени боя (без картинки). */
  later(delay: number, fn: () => void): void {
    this.run(null, 1, () => {}, delay, fn);
  }

  /** Вспышка-свечение: растёт от s0 до s1 и гаснет. */
  glow(x: number, y: number, tint: number, s0: number, s1: number, dur: number, delay = 0, alpha = 1, tex: string = TEX.glow, sy = 1): void {
    const o = this.img(tex, x, y, tint);
    o.setScale(s0, s0 * sy).setAlpha(alpha);
    this.run(o, dur, (p, im) => {
      const s = s0 + (s1 - s0) * ease.quadOut(p);
      im!.setScale(s, s * sy).setAlpha(alpha * (1 - p));
    }, delay);
  }

  burst(x: number, y: number, tint: number, count: number): void {
    this.sparks.setParticleTint(tint);
    this.sparks.explode(count, x, y);
  }

  rise(x: number, y: number, tint: number, count: number, spreadX = 50): void {
    this.motes.setParticleTint(tint);
    for (let i = 0; i < count; i++) this.motes.emitParticleAt(x + (Math.random() - 0.5) * spreadX * 2, y + (Math.random() - 0.5) * 30, 1);
  }

  flash(tint: number, alpha = 0.25, dur = 220): void {
    this.flashRect.setFillStyle(tint, 1).setAlpha(alpha);
    this.run(null, dur, (p) => this.flashRect.setAlpha(alpha * (1 - p)));
  }

  shake(intensity = 0.006, ms = 200): void {
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
  private fireBurst(x: number, y: number, feet: number, last: boolean, reduced: boolean): void {
    this.glow(x, y, FIRE_MAIN, 1, 3.8, 380, 0, 1);
    this.glow(x, y, FIRE_CORE, 0.6, 2.2, 200, 0, 1);
    this.glow(x, y, 0xffffff, 0.4, 1.2, 120, 0, 0.9);
    this.burst(x, y, FIRE_CORE, reduced ? 8 : 18);
    if (reduced) return;
    this.glow(x, feet, FIRE_DEEP, 0.4, 2.4, 420, 0, 0.9, TEX.ring, 0.4);
    this.animated('fx_hit', x, y, 250, 0xffb060, 0, 0.9);
    this.rise(x, y + 30, FIRE_MAIN, 6, 50);
    if (last) {
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
    let x0 = from.x;
    let y0 = from.y;
    if (kind === 'meteor') {
      x0 = to.x - 260;
      y0 = to.y - 760;
    }
    const tex = kind === 'ice' ? TEX.shard : kind === 'arrow' ? TEX.arrow : TEX.orb;
    const o = this.img(tex, x0, y0, tint, SFX_DEPTH + 1);
    const core = kind === 'ice' || kind === 'arrow' ? null : this.img(TEX.orb, x0, y0, 0xffffff, SFX_DEPTH + 2);
    const size = kind === 'meteor' ? 1.9 : kind === 'fireball' ? 1.25 : kind === 'arcane' || kind === 'dark' || kind === 'poison' ? 1 : 1.1;
    o.setScale(kind === 'ice' ? 1.1 : kind === 'arrow' ? 1.2 : size);
    core?.setScale(size * 0.45);
    const angle = Phaser.Math.RadToDeg(Math.atan2(to.y - y0, to.x - x0));
    if (kind === 'ice' || kind === 'arrow') o.setAngle(angle);
    // Лёгкая дуга по высоте (кроме метеора и стрел): снаряд «летит», а не ползёт.
    const arc = kind === 'meteor' || kind === 'arrow' ? 0 : Math.min(120, Math.abs(to.x - x0) * 0.18);
    let frame = 0;
    const d = kind === 'meteor' ? dur * 1.6 : dur;
    if (core) this.run(core, d, (p, im) => {
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

  /** Луч света от кастера к цели: вспыхивает, держится, гаснет; столб света на цели. */
  private beam(from: FxPoint, to: FxPoint, tint: number, delay: number, onHit: () => void): void {
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
  private spikes(p: FxPoint, tint: number, delay: number, onHit: () => void): void {
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
        for (const [i, p] of targets.entries()) for (let k = 0; k < 4; k++) this.fallingArrow(p, tint, i * 50 + k * 70);
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

  private lightning(p: FxPoint, tint: number, delay: number): void {
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
    const a = this.img(TEX.arrow, x0, y0, tint, SFX_DEPTH + 1);
    a.setAngle(Phaser.Math.RadToDeg(Math.atan2(ty - y0, tx - x0))).setScale(1.3);
    this.run(a, 240, (q, im) => {
      im!.setPosition(x0 + (tx - x0) * q, y0 + (ty - y0) * q);
    }, delay, () => this.burst(tx, ty, 0xfff0d0, 3));
  }

  // ---------- лечение и баффы ----------

  /**
   * Лечение (RO Heal): бело-зелёный столб света от земли через всю фигуру (~350 px, мягкие края), расходящееся
   * кольцо по земле, поднимающиеся искры и крестики, свечение на теле. «Уменьшить анимацию» — только кольцо,
   * свечение и несколько искр.
   */
  heal(p: FxPoint, big = false): void {
    const k = big ? 1.15 : 1;
    this.glow(p.x, p.feet, HEAL_MAIN, 0.4, 2.6 * k, 620, 0, 0.95, TEX.ring, 0.35);
    this.glow(p.x, p.y, HEAL_MAIN, 1, 2.8 * k, 520, 0, 0.6);
    if (motion.reduced) {
      this.rise(p.x, p.feet, HEAL_LIGHT, 4, 36);
      return;
    }
    const h = 350 * k;
    // Столб: широкий зеленоватый и узкое белое ядро (текстура луча мягкая поперёк), растут от земли вверх.
    for (const [w, tint, a] of [[150 * k, HEAL_MAIN, 0.75], [56 * k, 0xffffff, 0.9]] as const) {
      const col = this.img(TEX.beam, p.x, p.feet, tint, SFX_DEPTH + 1);
      col.setOrigin(0, 0.5).setRotation(-Math.PI / 2).setScale(0, w / 32).setAlpha(a);
      this.run(col, 760, (q, im) => {
        const up = ease.quadOut(clamp01(q / 0.25));
        const fade = q < 0.55 ? 1 : 1 - (q - 0.55) / 0.45;
        im!.setScale((h / 64) * up, (w / 32) * (1 - 0.35 * q)).setAlpha(a * fade);
      });
    }
    this.glow(p.x, p.feet, HEAL_LIGHT, 0.6, 2.2 * k, 500, 0, 0.8, TEX.glow, 0.4);
    this.rise(p.x, p.feet, 0xb4ffb0, big ? 14 : 10, 60);
    this.rise(p.x, p.feet - 40, 0xffffff, big ? 6 : 4, 40);
    this.crosses.setParticleTint(0xe4ffe0);
    for (let i = 0; i < (big ? 7 : 5); i++) this.crosses.emitParticleAt(p.x + (Math.random() - 0.5) * 130, p.feet - 20 - Math.random() * 160, 1);
  }

  /** Кастер лечения: короткое святое свечение и круг под ногами. */
  holyCast(p: FxPoint): void {
    this.glow(p.x, p.y, 0xfff4c8, 1, 3, 420, 0, 0.7);
    if (motion.reduced) return;
    const c = this.img(TEX.circle, p.x, p.feet, HEAL_LIGHT, SFX_DEPTH - 1);
    c.setScale(0.6, 0.22).setAlpha(0);
    this.run(c, 560, (q, im) => {
      const s = 0.6 + 0.55 * ease.quadOut(q);
      im!.setScale(s, s * 0.36).setAlpha(q < 0.2 ? q / 0.2 : 1 - (q - 0.2) / 0.8).setRotation(q * 1.4);
    });
    this.rise(p.x, p.feet, 0xfff4c8, 5, 50);
  }

  /** Бафф: столб искр цвета статуса и кольцо под ногами. */
  buff(p: FxPoint, tint: number): void {
    this.glow(p.x, p.feet, tint, 0.4, 2, 600, 0, 0.9, TEX.ring, 0.35);
    const col = this.img(TEX.beam, p.x, p.feet - 110, tint, SFX_DEPTH);
    col.setRotation(Math.PI / 2).setScale(220 / 64, 3).setAlpha(0);
    this.run(col, 650, (q, im) => im!.setAlpha(0.7 * (q < 0.2 ? q / 0.2 : 1 - (q - 0.2) / 0.8)).setScale(220 / 64, 3 - q * 1.5));
    this.rise(p.x, p.feet, tint, 12, 36);
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
