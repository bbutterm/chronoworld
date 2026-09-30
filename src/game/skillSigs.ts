import Phaser from 'phaser';
import { animatedEffect, animatedFxKey, loopFrameAt, type SkillFx as AtlasRoles } from './animatedFx';
import { clamp01, ease } from './perf';
import { FIRE_BOLT_MS, FX_TEX as T, SFX_DEPTH, type FxPoint, type SkillFx } from './skillFx';
import type { Aura, Proc, Signature } from './skillVisuals';
import { motion } from './state';

/**
 * Рецепты своего вида навыков (таблица — skillVisuals.ts): всё собрано из примитивов SkillFx (пул картинок, общие
 * эмиттеры, время боя) — без новых листов. Узнаваемость по RO: Боулинг Баш — размах и кегли, Великий крест — крест
 * света, Удар сокола — сокол, Капкан/Клеймор — ловушки, Метеоритный дождь — метеоры, Удар Асуры — сферы и взрыв…
 * «Уменьшить анимацию» режет только тряску, вспышку экрана и следы (всё это уже внутри SkillFx).
 */

const ADD = Phaser.BlendModes.ADD;
const NORMAL = Phaser.BlendModes.NORMAL;

/** Что знает рецепт: кастер, удары по порядку лога (цель может повторяться), уникальные цели, сторона, цвет. */
export interface SigCtx {
  c: FxPoint;
  hits: FxPoint[];
  uniq: FxPoint[];
  /** 1 — бьёт вправо (отряд A), −1 — влево. */
  dir: number;
  tint: number;
  /** Атласы RO этого навыка (effects.json → skills), уже загруженные: рецепт берёт projectile вместо своего снаряда. */
  atlas?: AtlasRoles;
}

interface SigDef {
  /** Через сколько мс от начала рецепта попадает удар hits[i] (цифры урона/лечения встают под него). */
  hit: (k: SigCtx, i: number) => number;
  draw: (fx: SkillFx, k: SigCtx) => void;
}

const head = (p: FxPoint) => p.feet - (p.feet - p.y) * 2;
const at = (ms: number) => () => ms;
const indexOf = (k: SigCtx, i: number) => Math.max(0, k.uniq.indexOf(k.hits[i]));

// ---------- помощники ----------

/** Значок всплывает (выпрыгивает с отскоком), чуть поднимается и гаснет. */
function pop(fx: SkillFx, tex: string, x: number, y: number, tint: number, scale: number, dur: number, delay = 0, rise = 40, blend = NORMAL, angle = 0): void {
  const o = fx.img(tex, x, y, tint, SFX_DEPTH + 3, blend);
  o.setScale(0).setRotation(angle);
  fx.run(o, dur, (q, im) => {
    const s = q < 0.2 ? ease.backOut(q / 0.2) : 1;
    im!.setScale(scale * s).setY(y - rise * q).setAlpha(q < 0.65 ? 1 : 1 - (q - 0.65) / 0.35);
  }, delay);
}

/** Бросок по дуге (колба, сковорода): картинка крутится, по прилёте — onLand. */
function lob(fx: SkillFx, tex: string, from: FxPoint, to: FxPoint, tint: number, scale: number, dur: number, delay: number, arc: number, spin: number, onLand?: () => void): void {
  const x0 = from.x;
  const y0 = from.y - 30;
  const o = fx.img(tex, x0, y0, tint, SFX_DEPTH + 3, NORMAL);
  o.setScale(scale);
  fx.run(o, dur, (q, im) => {
    im!.setPosition(x0 + (to.x - x0) * q, y0 + (to.y - y0) * q - Math.sin(q * Math.PI) * arc).setRotation(spin * q);
  }, delay, onLand);
}

/** Полёт по прямой (сокол, клинок, щит): поворот по направлению, след. flip — отражать ли картинку при полёте влево. */
function fly(fx: SkillFx, tex: string, x0: number, y0: number, x1: number, y1: number, tint: number, scale: number, dur: number, delay: number, trail: number, onLand?: () => void, spin = 0, blend = NORMAL): void {
  const left = x1 < x0;
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const o = fx.img(tex, x0, y0, tint, SFX_DEPTH + 3, blend);
  o.setScale(scale).setFlipX(left).setRotation(left ? ang + Math.PI : ang);
  let frame = 0;
  fx.run(o, dur, (q, im) => {
    const x = x0 + (x1 - x0) * q;
    const y = y0 + (y1 - y0) * q;
    im!.setPosition(x, y);
    if (spin) im!.setRotation(spin * q);
    if (trail >= 0 && (frame++ & 1) === 0) fx.trailAt(x, y, trail);
  }, delay, onLand);
}

/**
 * Как летит атлас-снаряд (роль projectile): поворот и, при нужде, ширина на экране (единицы игры 1080×1920; без неё —
 * клетка × effects.json → scale, иначе × 1.6). rot: 'dir' — картинка смотрит вправо, поворачивается по направлению
 * полёта; 'up' — смотрит вверх (ледяной осколок: остриё к цели); без rot — не поворачивается (нож и колба кувыркаются
 * в кадрах, пучок стрел падает сверху).
 */
export const FLY_LOOK: Record<string, { w?: number; rot?: 'dir' | 'up'; ground?: boolean; tint?: number }> = {
  fx_job_mage_fire_ball_projectile: { rot: 'dir' },
  // Лёд в захвате бело-сиреневый — с ADD и холодным оттенком читается льдом, а не белой палкой.
  fx_job_mage_frost_diver_spikes: { ground: true, tint: 0xcdefff },
};

/** Шаг ледяных шипов по земле (единицы игры) и сколько живёт один шип, мс. */
const SPIKE_STEP = 90;
const SPIKE_MS = 420;

/**
 * «Снаряд» по земле (ground в FLY_LOOK), как Frost Diver в RO: шипы вырастают из земли один за другим от ног кастера
 * к ногам цели (кадр стоит, origin — точка ног атласа), каждый дальше — крупнее; последний — к моменту попадания.
 */
function groundRun(fx: SkillFx, id: string, eff: NonNullable<ReturnType<typeof animatedEffect>>, from: { x: number; y: number; feet?: number }, to: { x: number; y: number; feet?: number }, dur: number, delay: number, onLand: (() => void) | undefined, tint: number): void {
  const f0 = from.feet ?? from.y + 60;
  const f1 = to.feet ?? to.y + 60;
  const n = Math.max(2, Math.min(7, Math.round(Math.hypot(to.x - from.x, f1 - f0) / SPIKE_STEP)));
  const blend = eff.blend === 'add' ? ADD : NORMAL;
  const s = eff.scale ?? 1.6;
  for (let i = 1; i <= n; i++) {
    const q = i / n;
    const x = from.x + (to.x - from.x) * q;
    const y = f0 + (f1 - f0) * q;
    const o = fx.img(animatedFxKey(id), x, y, tint, SFX_DEPTH + 3, blend);
    const k = s * (0.55 + 0.45 * q);
    o.setFrame(0).setOrigin(eff.anchor[0] / eff.cell[0], eff.anchor[1] / eff.cell[1]).setScale(k, 0);
    // Лёгкий наклон шипов вразнобой (детерминированно по номеру), как россыпь льда.
    o.setRotation(((i * 37) % 7 - 3) * 0.06);
    const at = delay + dur * (q - 1 / n);
    fx.run(o, SPIKE_MS, (t, im) => {
      const up = Math.min(1, t / 0.25);
      im!.setScale(k, k * ease.backOut(up)).setFrame(loopFrameAt(eff, t * SPIKE_MS)).setAlpha(t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
    }, at);
  }
  if (onLand) fx.later(delay + dur, onLand);
}

/**
 * Атлас-снаряд RO (effects.json, роль projectile) летит из from в to за dur (кадры — по кругу), с дугой arc,
 * шлейфом trail (цвет, −1 — без) и оттенком tint; по прилёте — onLand. Картинка — из пула SkillFx, как у процедурных.
 * false — атласа нет в каталоге (вызывающий рисует свой снаряд).
 */
export function flyAtlas(fx: SkillFx, id: string, from: { x: number; y: number; feet?: number }, to: { x: number; y: number; feet?: number }, dur: number, delay: number, arc = 0, trail = -1, onLand?: () => void, tint = 0xffffff): boolean {
  const eff = animatedEffect(id);
  if (!eff) return false;
  const look = FLY_LOOK[id] ?? {};
  if (look.tint !== undefined) tint = look.tint;
  if (look.ground) {
    groundRun(fx, id, eff, from, to, dur, delay, onLand, tint);
    return true;
  }
  const w = look.w ?? eff.cell[0] * (eff.scale ?? 1.6);
  const o = fx.img(animatedFxKey(id), from.x, from.y, tint, SFX_DEPTH + 3, eff.blend === 'add' ? ADD : NORMAL);
  o.setFrame(0).setOrigin(0.5).setDisplaySize(w, (w * eff.cell[1]) / eff.cell[0]);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let frame = 0;
  fx.run(o, dur, (q, im) => {
    const x = from.x + dx * q;
    const y = from.y + dy * q - Math.sin(q * Math.PI) * arc;
    im!.setPosition(x, y).setFrame(loopFrameAt(eff, q * dur));
    if (look.rot) {
      const a = Math.atan2(dy - arc * Math.PI * Math.cos(q * Math.PI), dx);
      im!.setRotation(look.rot === 'up' ? a + Math.PI / 2 : a);
    }
    if (trail >= 0 && (frame++ & 1) === 0) fx.trailAt(x, y, trail);
  }, delay, onLand);
  return true;
}

/**
 * Снаряд навыка: атлас RO (k.atlas.projectile) по той же траектории, иначе процедурный (own). Атлас кладёт свой
 * шлейф trail и дугу arc; попадание — onLand в обоих случаях.
 */
function shot(fx: SkillFx, k: SigCtx, from: { x: number; y: number }, to: { x: number; y: number }, dur: number, delay: number, arc: number, trail: number, onLand: () => void, own: () => void): void {
  const id = k.atlas?.projectile;
  if (!id || !flyAtlas(fx, id, from, to, dur, delay, arc, trail, onLand)) own();
}

/** Кольцо по земле под точкой. */
const groundRing = (fx: SkillFx, p: FxPoint, tint: number, s0: number, s1: number, dur: number, delay = 0, alpha = 0.95) =>
  fx.glow(p.x, p.feet, tint, s0, s1, dur, delay, alpha, T.ring, 0.38);

/** Волны от точки (крик, звук): n колец одно за другим. */
function waves(fx: SkillFx, x: number, y: number, tint: number, n: number, s1: number, dur: number, step: number, sy = 0.7): void {
  for (let i = 0; i < n; i++) fx.glow(x, y, i % 2 ? 0xffffff : tint, 0.5, s1, dur, i * step, 0.9, T.ring, sy);
}

/** Ряд шипов из-под земли (земля, тьма, лёд): n штук вокруг x, центральный выше. */
function spikeRow(fx: SkillFx, p: FxPoint, tint: number, n: number, h: number, gap: number, delay: number, tex: string = T.rock): void {
  for (let i = 0; i < n; i++) {
    const d = i - (n - 1) / 2;
    const s = fx.img(tex, p.x + d * gap, p.feet + 6, tint, SFX_DEPTH + 1, NORMAL);
    s.setOrigin(0.5, 1).setScale(0.9, 0);
    if (tex === T.shard) s.setOrigin(1, 0.5).setRotation(-Math.PI / 2);
    const hh = h * (1 - Math.abs(d) * 0.18);
    fx.run(s, 620, (q, im) => {
      const up = q < 0.25 ? ease.backOut(q / 0.25) : 1;
      if (tex === T.shard) im!.setScale(hh * up * 0.9, 0.9);
      else im!.setScale(0.9, hh * up);
      im!.setAlpha(q < 0.7 ? 1 : 1 - (q - 0.7) / 0.3);
    }, delay + Math.abs(d) * 40);
  }
}

/** Сферы кружат вокруг точки (духовные сферы монаха). */
function orbit(fx: SkillFx, x: number, y: number, tint: number, n: number, r: number, dur: number, delay = 0): void {
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const o = fx.img(T.orb, x, y, tint, SFX_DEPTH + 3, ADD);
    o.setScale(0.45);
    fx.run(o, dur, (q, im) => {
      const a = a0 + q * Math.PI * 3;
      im!.setPosition(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.45).setAlpha(q < 0.75 ? 1 : 1 - (q - 0.75) / 0.25).setScale(0.35 + 0.15 * Math.sin(a));
    }, delay);
  }
}

/** Искры стягиваются к точке с круга радиуса r (сбор силы, поглощение). */
function converge(fx: SkillFx, x: number, y: number, tint: number, n: number, r: number, dur: number, delay = 0): void {
  for (let i = 0, k = fx.n(n); i < k; i++) {
    const a = (i / k) * Math.PI * 2 + Math.random() * 0.4;
    const x0 = x + Math.cos(a) * r;
    const y0 = y + Math.sin(a) * r * 0.7;
    const o = fx.img(T.spark, x0, y0, tint, SFX_DEPTH + 3, ADD);
    o.setScale(1.1);
    fx.run(o, dur, (q, im) => {
      const e = ease.quadIn(q);
      im!.setPosition(x0 + (x - x0) * e, y0 + (y - y0) * e).setAlpha(0.4 + 0.6 * q).setScale(1.1 - 0.5 * q);
    }, delay + i * 12);
  }
}

/** Значки (ноты, сердечки, крестики) поднимаются вокруг фигуры. */
function riseTex(fx: SkillFx, tex: string, p: FxPoint, tint: number, n: number, spread: number, dur: number, scale = 0.9, delay = 0): void {
  for (let i = 0, k = fx.n(n); i < k; i++) {
    const x = p.x + (Math.random() - 0.5) * spread * 2;
    const y = p.y + 20 + Math.random() * 40;
    const sway = Math.random() * Math.PI * 2;
    const o = fx.img(tex, x, y, tint, SFX_DEPTH + 3, NORMAL);
    o.setScale(0);
    fx.run(o, dur, (q, im) => {
      const s = q < 0.15 ? ease.backOut(q / 0.15) : 1;
      im!.setScale(scale * s).setPosition(x + Math.sin(sway + q * 7) * 12, y - 150 * q).setAlpha(q < 0.6 ? 1 : 1 - (q - 0.6) / 0.4);
    }, delay + i * 70);
  }
}

/** Пузырь-щит вокруг фигуры: кольцо стоймя, пульсирует. */
function bubble(fx: SkillFx, p: FxPoint, tint: number, scale: number, dur: number, delay = 0): void {
  const h = (p.feet - p.y) / 60;
  const o = fx.img(T.ring, p.x, p.y, tint, SFX_DEPTH + 2, ADD);
  o.setScale(0.4 * scale, 0.4 * scale * h);
  fx.run(o, dur, (q, im) => {
    const s = scale * (0.4 + 0.6 * ease.backOut(clamp01(q / 0.3))) * (1 + 0.04 * Math.sin(q * 20));
    im!.setScale(s, s * h * 1.2).setAlpha(q < 0.6 ? 0.9 : 0.9 * (1 - (q - 0.6) / 0.4));
  }, delay);
  fx.glow(p.x, p.y, tint, 1.5 * scale, 2.6 * scale, dur, delay, 0.45, T.glow, h * 1.1);
}

/** Магический круг на земле (вращается), tint — цвет; s — размер (1 ≈ 256 px). */
function groundCircle(fx: SkillFx, p: FxPoint, tint: number, s: number, dur: number, delay = 0, spin = 1.5): void {
  const o = fx.img(T.circle, p.x, p.feet, tint, SFX_DEPTH - 1, ADD);
  o.setScale(s * 0.6, s * 0.22).setAlpha(0);
  const r = motion.reduced ? 0 : spin;
  fx.run(o, dur, (q, im) => {
    const g = s * (0.6 + 0.4 * ease.quadOut(clamp01(q / 0.3)));
    im!.setScale(g, g * 0.36).setRotation(q * r).setAlpha(q < 0.2 ? q / 0.2 : q < 0.7 ? 1 : 1 - (q - 0.7) / 0.3);
  }, delay);
}

/** Взрыв (огонь/кислота/тьма) в точке: лист fx_hit, свечение, искры. */
function blast(fx: SkillFx, p: FxPoint, tint: number, core: number, size = 1): void {
  fx.glow(p.x, p.y, tint, 1, 4 * size, 380, 0, 1);
  fx.glow(p.x, p.y, core, 0.5, 2 * size, 200, 0, 1);
  if (!fx.animated('fx_hit', p.x, p.y, 260 * size, tint, 0, 0.9)) fx.glow(p.x, p.y, 0xffffff, 0.4, 1.4 * size, 160);
  groundRing(fx, p, tint, 0.4, 2.6 * size, 460);
  fx.burst(p.x, p.y, core, 14);
}

/** Облако кислоты: клякса, капли, шипение вверх. */
function acidSplash(fx: SkillFx, p: FxPoint, tint: number): void {
  fx.splat(p.x, p.y, tint, 1.9);
  fx.blobs(p.x, p.y, tint, 10);
  fx.glow(p.x, p.y, tint, 0.8, 3.2, 360, 0, 0.9);
  fx.later(120, () => fx.rise(p.x, p.y, 0xeaff9a, 6, 34));
}

// ---------- навыки целиком ----------

const SIGS: Record<Signature, SigDef> = {
  // Старые (skillFx.ts)
  magnum: { hit: at(110), draw: (fx, k) => fx.magnumBreak(k.c, k.uniq) },
  cart: { hit: at(90), draw: (fx, k) => fx.cartSwing(k.c, k.uniq, k.dir) },
  bounce: { hit: at(140), draw: (fx, k) => fx.royalBounce(k.c, k.uniq) },
  provoke: { hit: at(120), draw: (fx, k) => fx.shout(k.c) },
  roots: { hit: at(150), draw: (fx, k) => k.uniq.forEach((p) => fx.roots(p)) },

  // ---------- мечник, рыцарь, крестоносец ----------
  bowlingBash: {
    // Боулинг Баш: широкий размах двуручником по фронту, цели «кеглями» отлетают одна за другой.
    hit: (k, i) => 90 + indexOf(k, i) * 70,
    draw: (fx, k) => {
      const { c, dir } = k;
      fx.slash(c.x + dir * 110, c.y, dir, 0xffe0a0, 3, -1.25);
      fx.slash(c.x + dir * 110, c.y + 16, dir, 0xffffff, 2.5, -1.05, 40, 0.8);
      for (let i = 0; i < 3; i++) fx.streakAt(c.x + dir * (160 + i * 30), c.y - 30 + i * 30, dir, 0xfff0c0, 2, 300, i * 30);
      fx.dust(c.x + dir * 80, c.feet, 0xc8b090, 8, 90);
      k.uniq.forEach((p, i) => fx.later(90 + i * 70, () => {
        fx.strike('blunt', p, dir, true, 0xffe0a0);
        fx.stars(p.x, head(p) + 20, 0xffe060, 6);
        for (let j = 0; j < 2; j++) fx.streakAt(p.x + dir * 60, p.y + (j ? 20 : -20), dir, 0xfff0c0, 1.3, 260, j * 40);
        fx.puffCloud(p.x, p.feet - 10, 0xd8c8a8, 4, 80, 420);
      }));
      fx.later(90, () => fx.shake(0.005, 160));
    },
  },
  chargeAttack: {
    // Атака с разбега: полосы скорости за рыцарем, копейный удар навылет, пыль.
    hit: at(60),
    draw: (fx, k) => {
      const { c, dir } = k;
      for (let i = 0; i < 4; i++) fx.streakAt(c.x - dir * 30, c.y - 45 + i * 30, dir, 0x9fd8ff, 1.8, 280, i * 25);
      const p = k.uniq[0];
      if (!p) return;
      fx.later(60, () => {
        fx.glow(p.x, p.y, 0xffffff, 0.6, 2.8, 200, 0, 1);
        fx.glow(p.x, p.y, 0x9fd8ff, 0.4, 3.2, 380, 0, 0.9, T.ring, 1.6);
        fx.streakAt(p.x + dir * 120, p.y, dir, 0xdff4ff, 2.6, 320);
        fx.burst(p.x, p.y, 0xcfeaff, 16);
        fx.puffCloud(p.x, p.feet - 10, 0xd8c8a8, 5, 100, 460);
        fx.shake(0.005, 150);
      });
    },
  },
  spiralPierce: {
    // Спиральный пронзатель: вращающиеся кольца-«бур» от рыцаря к цели и удар навылет.
    hit: at(200),
    draw: (fx, k) => {
      const { c, dir } = k;
      const p = k.uniq[0];
      if (!p) return;
      for (let i = 0; i < 4; i++) {
        const f = (i + 1) / 4;
        const x = c.x + (p.x - c.x) * f;
        const y = c.y + (p.y - c.y) * f;
        fx.glow(x, y, i % 2 ? 0xffffff : 0xffc060, 0.3, 1.6 - i * 0.1, 260, i * 45, 0.95, T.ring, 2.4);
      }
      fx.streakAt(p.x, p.y, dir, 0xffc060, 3, 260, 60);
      fx.later(200, () => {
        fx.glow(p.x, p.y, 0xffc060, 0.8, 4, 380, 0, 1);
        fx.glow(p.x, p.y, 0xffffff, 0.5, 2, 180, 0, 1);
        fx.slash(p.x, p.y, dir, 0xffc060, 1.6, -0.5);
        fx.slash(p.x, p.y, dir, 0xffffff, 1.4, 0.5, 50);
        fx.streakAt(p.x + dir * 150, p.y, dir, 0xfff0c0, 2.4, 300);
        fx.burst(p.x, p.y, 0xffe0a0, 18);
        fx.shake(0.006, 170);
      });
    },
  },
  holyCross: {
    // Святой крест: золотой крест вспыхивает на цели, крестовый разрез, святые искры.
    hit: at(80),
    draw: (fx, k) => {
      for (const p of k.uniq) {
        fx.glow(p.x, p.y, 0xfff0a0, 0.8, 3.4, 420, 0, 0.9);
        const o = fx.img(T.hcross, p.x, p.y - 10, 0xffe070, SFX_DEPTH + 3, ADD);
        o.setScale(0.2);
        fx.run(o, 560, (q, im) => im!.setScale(0.2 + 1.2 * ease.backOut(clamp01(q / 0.3))).setAlpha(q < 0.5 ? 1 : 1 - (q - 0.5) / 0.5));
        fx.slash(p.x, p.y, k.dir, 0xfff6c8, 1.5, -1.57, 40, 0.7);
        fx.slash(p.x, p.y, k.dir, 0xfff6c8, 1.3, 0, 90, 0.7);
        fx.later(80, () => fx.rise(p.x, p.feet, 0xfff0a0, 6, 30));
      }
    },
  },
  shieldCharge: {
    // Удар щитом: щит летит к цели и оглушает — кольцо, звёзды, пыль.
    hit: at(240),
    draw: (fx, k) => {
      const p = k.uniq[0];
      if (!p) return;
      fly(fx, T.shield, k.c.x + k.dir * 40, k.c.y, p.x - k.dir * 30, p.y, 0xd8e4ff, 1.4, 240, 0, 0xd8e4ff, () => {
        fx.glow(p.x, p.y, 0xffffff, 0.6, 3, 220, 0, 1);
        fx.glow(p.x, p.y, 0xd8e4ff, 0.4, 2.8, 380, 0, 0.9, T.ring);
        fx.stars(p.x, p.y - 20, 0xffe060, 7);
        fx.puffCloud(p.x, p.feet - 10, 0xd8c8a8, 4, 80, 420);
        pop(fx, T.shield, p.x - k.dir * 20, p.y, 0xd8e4ff, 1.4, 300, 0, 0);
      }, 0.4);
    },
  },
  grandCross: {
    // Великий крест: огромный крест света с центром в крестоносце, багрово-золотые столбы на целях.
    hit: at(260),
    draw: (fx, k) => {
      const { c } = k;
      for (const [rot, len, w] of [[0, 1100, 2.6], [Math.PI / 2, 760, 2.6]] as const) {
        for (const [tint, ww, a] of [[0xffe070, w, 0.8], [0xffffff, w * 0.4, 1]] as const) {
          const b = fx.img(T.beam, c.x, c.y - (rot ? 80 : 0), tint, SFX_DEPTH + 1, ADD);
          b.setRotation(rot).setScale(0, ww).setAlpha(a);
          fx.run(b, 760, (q, im) => {
            const g = ease.quadOut(clamp01(q / 0.3));
            im!.setScale((len / 64) * g, ww * (1 - 0.5 * q)).setAlpha(a * (q < 0.5 ? 1 : 1 - (q - 0.5) / 0.5));
          });
        }
      }
      const cross = fx.img(T.hcross, c.x, c.y - 30, 0xff6040, SFX_DEPTH + 2, ADD);
      cross.setScale(0.5);
      fx.run(cross, 760, (q, im) => im!.setScale(0.5 + 2.4 * ease.quadOut(q)).setAlpha(1 - q));
      groundCircle(fx, c, 0xffd060, 2.4, 900);
      fx.later(40, () => fx.flash(0xfff0a0, 0.14, 260));
      k.uniq.forEach((p, i) => fx.later(200 + i * 40, () => {
        fx.pillar(p, 0xff7050);
        fx.glow(p.x, p.y, 0xffe070, 0.8, 3.2, 380, 0, 0.9);
        fx.burst(p.x, p.y, 0xfff0a0, 10);
      }));
      fx.later(260, () => fx.shake(0.006, 200));
    },
  },
  devotion: {
    // Самопожертвование: золотая цепь света от крестоносца к союзнику.
    hit: at(220),
    draw: (fx, k) => {
      for (const p of k.uniq) {
        const len = Math.hypot(p.x - k.c.x, p.y - k.c.y);
        const b = fx.img(T.beam, (p.x + k.c.x) / 2, (p.y + k.c.y) / 2, 0xffd860, SFX_DEPTH + 1, ADD);
        b.setRotation(Math.atan2(p.y - k.c.y, p.x - k.c.x)).setScale(len / 64, 0.5).setAlpha(0);
        fx.run(b, 620, (q, im) => im!.setAlpha(q < 0.2 ? q / 0.2 : 1 - (q - 0.2) / 0.8));
        for (let i = 0; i < 6; i++) {
          const o = fx.img(T.orb, k.c.x, k.c.y, 0xfff0a0, SFX_DEPTH + 2, ADD);
          o.setScale(0.35);
          fx.run(o, 260, (q, im) => im!.setPosition(k.c.x + (p.x - k.c.x) * q, k.c.y + (p.y - k.c.y) * q).setAlpha(1 - q * 0.5), i * 40);
        }
      }
      fx.glow(k.c.x, k.c.y, 0xffd860, 1, 3, 400, 0, 0.8);
    },
  },
  defender: {
    // Защита: большой щит перед крестоносцем, серебряное кольцо.
    hit: at(150),
    draw: (fx, k) => {
      pop(fx, T.shield, k.c.x + k.dir * 70, k.c.y, 0xd8e4ff, 2, 800, 0, 10);
      groundRing(fx, k.c, 0xd8e4ff, 0.5, 3.4, 600);
      fx.glow(k.c.x, k.c.y, 0xd8e4ff, 1, 3.4, 500, 0, 0.7);
    },
  },

  // ---------- лучник, охотник, бард, танцовщица ----------
  blitzBeat: {
    // Удар сокола: сокол пикирует на каждую цель по очереди — когти и перья.
    hit: (_k, i) => 260 + i * 170,
    draw: (fx, k) => {
      k.hits.forEach((p, i) => {
        const x0 = k.c.x - k.dir * 40;
        const y0 = k.c.y - 280;
        fly(fx, T.bird, x0, y0, p.x - k.dir * 10, p.y - 20, 0xffffff, 1.1, 260, i * 170, 0xffe0b0, () => {
          fx.claw(p.x, p.y - 10, k.dir, 0xfff0d0, 1.3);
          fx.feathers(p.x, p.y - 30, 0xe8d4b0, 4);
          fx.burst(p.x, p.y, 0xfff0d0, 6);
        });
      });
    },
  },
  falconAssault: {
    // Атака сокола: сокол крупно пикирует с высоты с золотым шлейфом — сильный удар, вихрь перьев.
    hit: at(420),
    draw: (fx, k) => {
      const p = k.uniq[0];
      if (!p) return;
      fly(fx, T.bird, p.x - k.dir * 320, p.y - 720, p.x, p.y - 10, 0xffffff, 1.9, 420, 0, 0xffd060, () => {
        fx.glow(p.x, p.y, 0xffd060, 1, 4.4, 420, 0, 1);
        fx.glow(p.x, p.y, 0xffffff, 0.5, 2.2, 200, 0, 1);
        groundRing(fx, p, 0xffd060, 0.4, 3.2, 520);
        fx.feathers(p.x, p.y - 20, 0xf0dcb8, 10, 90);
        fx.burst(p.x, p.y, 0xffe890, 18);
        fx.flash(0xffe0a0, 0.08, 180);
        fx.shake(0.006, 180);
      });
    },
  },
  ankleSnare: {
    // Капкан: железные челюсти у ног цели с лязгом захлопываются.
    hit: at(200),
    draw: (fx, k) => {
      for (const p of k.uniq) {
        const o = fx.img(T.trap, p.x, p.feet - 6, 0xffffff, SFX_DEPTH + 2, NORMAL);
        o.setScale(0);
        fx.run(o, 1000, (q, im) => {
          const open = q < 0.15 ? ease.backOut(q / 0.15) : 1;
          const snap = q < 0.2 ? 1.6 : q < 0.26 ? 1.6 - ((q - 0.2) / 0.06) * 1.1 : 0.5;
          im!.setScale(1.3 * open, 1.3 * open * snap).setAlpha(q < 0.8 ? 1 : 1 - (q - 0.8) / 0.2);
        });
        fx.later(200, () => {
          fx.glow(p.x, p.feet - 10, 0xffffff, 0.4, 1.8, 180, 0, 1, T.spark);
          fx.burst(p.x, p.feet - 10, 0xe8ecf4, 8);
          fx.dust(p.x, p.feet, 0xc8b090, 3, 30);
        });
      }
    },
  },
  claymore: {
    // Клеймор: ловушки под передним рядом, взрывы один за другим.
    hit: (k, i) => 260 + indexOf(k, i) * 70,
    draw: (fx, k) => {
      k.uniq.forEach((p, i) => {
        pop(fx, T.trap, p.x, p.feet - 6, 0xffc080, 0.8, 320, 0, 0);
        fx.later(260 + i * 70, () => {
          blast(fx, p, 0xff8a2a, 0xffe070, 1.1);
          fx.puffCloud(p.x, p.feet - 20, 0x8a7a6a, 6, 120, 560);
        });
      });
      fx.later(260, () => fx.shake(0.007, 220));
    },
  },
  sandman: {
    // Сонная ловушка: сиреневые облака сна у голов, медленные искры.
    hit: at(300),
    draw: (fx, k) => {
      for (const p of k.uniq) {
        pop(fx, T.trap, p.x, p.feet - 6, 0xc8b0ff, 0.7, 300, 0, 0);
        fx.later(120, () => {
          fx.puffCloud(p.x, head(p) + 30, 0xd8c8ff, 7, 130, 900, 0.8);
          fx.rise(p.x, p.y, 0xe0d0ff, 6, 40);
          fx.glow(p.x, p.y, 0xc8b0ff, 1, 3.4, 700, 0, 0.6);
        });
      }
    },
  },
  musicalStrike: {
    // Музыкальный удар: ноты летят волной к цели и рассыпаются кольцом.
    hit: at(330),
    draw: (fx, k) => {
      const p = k.uniq[0];
      if (!p) return;
      for (let i = 0; i < 3; i++) {
        const x0 = k.c.x + k.dir * 30;
        const y0 = k.c.y - 20;
        const ph = i * 2.1;
        const o = fx.img(T.note, x0, y0, 0x8fb8ff, SFX_DEPTH + 3, NORMAL);
        o.setScale(1);
        fx.run(o, 300, (q, im) => im!.setPosition(x0 + (p.x - x0) * q, y0 + (p.y - y0) * q + Math.sin(ph + q * 12) * 30), i * 30);
      }
      fx.later(330, () => {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          pop(fx, T.note, p.x + Math.cos(a) * 60, p.y + Math.sin(a) * 50, i % 2 ? 0xffffff : 0x8fb8ff, 0.8, 520, 0, 30);
        }
        fx.glow(p.x, p.y, 0x8fb8ff, 0.8, 3.2, 360, 0, 1);
        fx.glow(p.x, p.y, 0xffffff, 0.3, 2.4, 380, 0, 0.9, T.ring);
      });
    },
  },
  slingingArrow: {
    // Бросок стрелы: розовая стрела танцовщицы, сердечки и лепестки.
    hit: at(260),
    draw: (fx, k) => {
      const p = k.uniq[0];
      if (!p) return;
      fx.glowArrow(k.c, p, 0xff8ac8, 1.5, 260, 0, () => {
        for (let i = 0; i < 3; i++) pop(fx, T.heart, p.x + (i - 1) * 40, p.y - 20, 0xff8ac8, 0.9, 560, i * 60, 50);
        fx.glow(p.x, p.y, 0xff8ac8, 0.6, 3, 320, 0, 1);
        fx.burst(p.x, p.y, 0xffc0e0, 12);
      });
    },
  },
  scream: {
    // Крик: звуковые волны от барда через всё поле.
    hit: at(250),
    draw: (fx, k) => {
      waves(fx, k.c.x, k.c.y, 0xffa0d0, 5, 12, 650, 80);
      fx.glow(k.c.x, k.c.y, 0xffa0d0, 1, 3.6, 360, 0, 0.9);
      fx.later(60, () => fx.shake(0.004, 200));
      for (const p of k.uniq) fx.later(250, () => fx.burst(p.x, head(p) + 20, 0xffc0e0, 6));
    },
  },
  dontForgetMe: {
    // Не забывай меня: фиолетовые круги танца под врагами, ноты падают сверху.
    hit: at(250),
    draw: (fx, k) => {
      for (const p of k.uniq) {
        groundCircle(fx, p, 0xb070ff, 1, 1000);
        for (let i = 0; i < 2; i++) {
          const x = p.x + (i ? 30 : -30);
          const o = fx.img(T.note, x, head(p) - 60, 0xd0a0ff, SFX_DEPTH + 3, NORMAL);
          o.setScale(0.9);
          fx.run(o, 600, (q, im) => im!.setY(head(p) - 60 + 120 * ease.quadIn(q)).setAlpha(q < 0.7 ? 1 : 1 - (q - 0.7) / 0.3), i * 120);
        }
        fx.later(250, () => fx.glow(p.x, p.y, 0xb070ff, 1, 3, 500, 0, 0.6));
      }
    },
  },
  fortuneKiss: {
    // Поцелуй удачи: сердечки из рук танцовщицы (союзники — аура kiss).
    hit: at(150),
    draw: (fx, k) => {
      riseTex(fx, T.heart, k.c, 0xff7ab0, 6, 50, 900, 1);
      fx.glow(k.c.x, k.c.y, 0xff7ab0, 1, 3.4, 460, 0, 0.8);
    },
  },
  assassinCross: {
    // Закат ассасина: кольцо красных нот вокруг барда (союзники — аура song).
    hit: at(150),
    draw: (fx, k) => {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        pop(fx, T.note, k.c.x + Math.cos(a) * 90, k.c.y + Math.sin(a) * 60, i % 2 ? 0xffd0e0 : 0xff5a8a, 0.9, 700, i * 30, 30);
      }
      groundRing(fx, k.c, 0xff5a8a, 0.5, 4, 700);
    },
  },

  // ---------- вор, ассасин, разбойник ----------
  venomKnife: {
    // Ядовитый нож: кинжал с зелёным следом, всплеск яда.
    hit: at(240),
    draw: (fx, k) => {
      const p = k.uniq[0];
      if (!p) return;
      const land = () => fx.skillHit('envenom', p, k.dir);
      const knife = k.atlas?.projectile;
      if (!knife || !flyAtlas(fx, knife, { x: k.c.x, y: k.c.y - 10 }, p, 240, 0, 20, 0x8fe04a, land)) {
        fly(fx, T.blade, k.c.x, k.c.y - 10, p.x, p.y, 0xc8ffa0, 0.8, 240, 0, 0x8fe04a, land, 0, NORMAL);
      }
    },
  },
  sonicBlow: {
    // Звуковой удар: шквал тонких разрезов (по три на удар), фиолетовое кольцо в конце.
    hit: (_k, i) => 40 + i * 90,
    draw: (fx, k) => {
      k.hits.forEach((p, i) => {
        for (let j = 0; j < 3; j++) fx.slash(p.x - k.dir * 6, p.y + (j - 1) * 18, k.dir, j === 1 ? 0xffffff : 0xc9a0ff, 1.1, -1.2 + Math.random() * 2.4, 40 + i * 90 + j * 25, 0.45);
        fx.later(40 + i * 90, () => fx.burst(p.x, p.y, 0xe0c8ff, 5));
      });
      const last = k.hits[k.hits.length - 1];
      if (last) fx.later(40 + (k.hits.length - 1) * 90, () => {
        fx.glow(last.x, last.y, 0xc9a0ff, 0.4, 3, 380, 0, 0.95, T.ring);
        fx.glow(last.x, last.y, 0xffffff, 0.6, 2.4, 200, 0, 1);
      });
    },
  },
  meteorAssault: {
    // Метеоритный удар: тёмная вспышка вокруг ассасина, багрово-фиолетовые взрывы у врагов.
    hit: at(160),
    draw: (fx, k) => {
      fx.glow(k.c.x, k.c.y, 0xb050ff, 1, 5, 420, 0, 0.9);
      groundRing(fx, k.c, 0xb050ff, 0.5, 6, 520);
      groundRing(fx, k.c, 0xff4060, 0.4, 4.5, 440, 80, 0.9);
      fx.burst(k.c.x, k.c.y, 0xd8a0ff, 16);
      k.uniq.forEach((p) => fx.later(160, () => blast(fx, p, 0xb050ff, 0xff90c0, 1)));
      fx.later(160, () => fx.shake(0.006, 200));
    },
  },
  grimtooth: {
    // Мрачный клык: тёмные шипы из-под земли под целью в заднем ряду, когти.
    hit: at(180),
    draw: (fx, k) => {
      for (const p of k.uniq) {
        spikeRow(fx, p, 0x9a5aff, 3, 1.9, 34, 0);
        fx.later(160, () => {
          fx.claw(p.x, p.y, k.dir, 0xc090ff, 1.4);
          fx.glow(p.x, p.y, 0x9a5aff, 0.8, 3, 360, 0, 0.9);
        });
      }
    },
  },
  venomSplasher: {
    // Ядовитый взрыв: большой зелёный взрыв яда на цели.
    hit: at(120),
    draw: (fx, k) => {
      for (const p of k.uniq) {
        for (let i = 0; i < 3; i++) fx.splat(p.x + (i - 1) * 40, p.y + (i === 1 ? 0 : 20), 0x7ee03a, 1.6 + (i === 1 ? 0.6 : 0), i * 50);
        fx.glow(p.x, p.y, 0x7ee03a, 1, 4.6, 460, 0, 1);
        groundRing(fx, p, 0x7ee03a, 0.4, 3.4, 520);
        fx.blobs(p.x, p.y, 0x8fe04a, 16);
        fx.puffCloud(p.x, p.y, 0x9ad060, 6, 140, 700, 0.7);
        fx.later(120, () => fx.rise(p.x, p.y, 0xb8f080, 8, 40));
      }
      fx.shake(0.005, 160);
    },
  },
  raid: {
    // Налёт: разбойник выходит из тёмного дыма и бьёт весь фронт.
    hit: at(150),
    draw: (fx, k) => {
      fx.puffCloud(k.c.x, k.c.y, 0x3a3444, 9, 170, 700, 0.85);
      k.uniq.forEach((p, i) => fx.later(120 + i * 30, () => {
        fx.slash(p.x, p.y, k.dir, 0xa088c0, 1.4, -0.6);
        fx.slash(p.x, p.y, k.dir, 0xffffff, 1.2, 0.6, 50);
        fx.stars(p.x, head(p) + 20, 0xffe060, 4);
        fx.burst(p.x, p.y, 0xd0c0e0, 8);
      }));
    },
  },
  stripWeapon: {
    // Разоружение: разрез, и клинок цели, кувыркаясь, отлетает прочь.
    hit: at(100),
    draw: (fx, k) => {
      for (const p of k.uniq) {
        fx.slash(p.x, p.y, k.dir, 0xff8a6a, 1.4, -0.4);
        const o = fx.img(T.blade, p.x, p.y, 0xffffff, SFX_DEPTH + 3, NORMAL);
        o.setScale(0.9);
        fx.run(o, 700, (q, im) => {
          im!.setPosition(p.x + k.dir * 150 * q, p.y - Math.sin(q * Math.PI) * 170 + 80 * q).setRotation(q * 14).setAlpha(q < 0.75 ? 1 : 1 - (q - 0.75) / 0.25);
        }, 80);
        fx.later(100, () => fx.glow(p.x, p.y, 0xff8a6a, 0.6, 2.8, 320, 0, 0.9));
      }
    },
  },
  backStab: {
    // Удар в спину: разбойник выходит из дыма за спиной — глубокий красный укол.
    hit: at(80),
    draw: (fx, k) => {
      for (const p of k.uniq) {
        fx.puffCloud(p.x + k.dir * 60, p.y, 0x3a3444, 6, 110, 560, 0.8);
        fx.later(60, () => {
          fx.slash(p.x, p.y, -k.dir, 0xff4a3a, 1.8, 1.4, 0, 0.5);
          fx.slash(p.x, p.y, -k.dir, 0xffffff, 1.5, 1.4, 20, 0.35);
          fx.glow(p.x, p.y, 0xff4a3a, 0.8, 3.2, 340, 0, 1);
          fx.burst(p.x, p.y, 0xff9080, 12);
        });
      }
    },
  },
  stripArmor: {
    // Снять доспех: над каждой целью всплывает щит и разлетается осколками.
    hit: (k, i) => 120 + indexOf(k, i) * 60,
    draw: (fx, k) => {
      k.uniq.forEach((p, i) => {
        const d = i * 60;
        fx.slash(p.x, p.y, k.dir, 0xb8c0d0, 1.2, -0.5, d + 60);
        pop(fx, T.shield, p.x, p.y - 20, 0xb8c0d0, 1.1, 260, d, 0);
        fx.later(d + 180, () => {
          for (let j = 0; j < 6; j++) {
            const a = (j / 6) * Math.PI * 2;
            const o = fx.img(T.shard, p.x, p.y - 20, 0xc8d0e0, SFX_DEPTH + 3, NORMAL);
            o.setRotation(a).setScale(0.5, 0.7);
            fx.run(o, 420, (q, im) => im!.setPosition(p.x + Math.cos(a) * 90 * q, p.y - 20 + Math.sin(a) * 90 * q + 60 * q * q).setAlpha(1 - q));
          }
          fx.burst(p.x, p.y - 20, 0xffffff, 6);
        });
      });
    },
  },

  // ---------- торговец, кузнец, алхимик ----------
  fryingPan: {
    // Удар сковородой: чугунная сковорода сверху — «бонг», звёзды.
    hit: at(200),
    draw: (fx, k) => {
      for (const p of k.uniq) {
        const x0 = p.x - k.dir * 40;
        const y0 = head(p) - 20;
        const o = fx.img(T.pan, x0, y0, 0xffffff, SFX_DEPTH + 3, NORMAL);
        o.setOrigin(0.9, 0.5).setFlipX(k.dir < 0).setScale(1.5);
        fx.run(o, 460, (q, im) => {
          const sw = q < 0.45 ? ease.quadIn(q / 0.45) : 1;
          im!.setRotation((k.dir > 0 ? 1 : -1) * (-1.4 + 2 * sw)).setAlpha(q < 0.7 ? 1 : 1 - (q - 0.7) / 0.3);
        });
        fx.later(200, () => {
          fx.glow(p.x, head(p) + 30, 0xffffff, 0.6, 3, 220, 0, 1, T.spark);
          fx.glow(p.x, head(p) + 30, 0xfff0d0, 0.4, 3, 380, 0, 0.9, T.ring);
          fx.stars(p.x, head(p) + 20, 0xffe060, 9);
        });
      }
    },
  },
  hammerFall: {
    // Удар молота: молот в землю — ударная волна по земле, звёзды над головой, пыль.
    hit: at(140),
    draw: (fx, k) => {
      for (const p of k.uniq) {
        fx.glow(p.x, p.feet - 20, 0xffffff, 0.6, 2.6, 180, 0, 1);
        groundRing(fx, p, 0xffc860, 0.5, 6.5, 560);
        groundRing(fx, p, 0xa87840, 0.4, 4.5, 480, 80);
        fx.puffCloud(p.x, p.feet - 10, 0xc8b090, 8, 160, 600);
        fx.later(100, () => fx.stars(p.x, head(p) + 20, 0xffe060, 8));
      }
      fx.shake(0.007, 220);
    },
  },
  cartTermination: {
    // Удар тележкой мастера: тележка на полном ходу — полосы, россыпь монет, тяжёлый удар.
    hit: at(260),
    draw: (fx, k) => {
      const p = k.uniq[0];
      if (!p) return;
      for (let i = 0; i < 5; i++) fx.streakAt(k.c.x + (p.x - k.c.x) * (0.3 + i * 0.12), p.y - 40 + i * 20, k.dir, 0xffd890, 2, 260, i * 30);
      fx.coins(k.c.x + k.dir * 60, k.c.y, 6);
      fx.later(240, () => {
        fx.skillHit('smash', p, k.dir);
        fx.coins(p.x, p.y - 20, 10);
        fx.glow(p.x, p.y, 0xffc860, 0.4, 3, 400, 0, 0.9, T.ring, 1.4);
        fx.shake(0.008, 220);
      });
    },
  },
  weaponPerfection: {
    // Совершенство оружия: искры горна снопом вверх (союзники — аура forge).
    hit: at(150),
    draw: (fx, k) => {
      fx.glow(k.c.x, k.c.y, 0xffb040, 1, 3.6, 420, 0, 0.9);
      groundRing(fx, k.c, 0xffd060, 0.5, 4, 600);
      fx.stars(k.c.x, k.c.y - 20, 0xffc040, 10);
      fx.burst(k.c.x, k.c.y - 20, 0xffe070, 16);
    },
  },
  acidTerror: {
    // Кислотный террор: колба кислоты по дуге — шипящий всплеск.
    hit: at(380),
    draw: (fx, k) => {
      const p = k.uniq[0];
      if (!p) return;
      const land = () => acidSplash(fx, p, 0xc8f040);
      shot(fx, k, { x: k.c.x, y: k.c.y - 30 }, p, 380, 0, 160, -1, land, () => lob(fx, T.flask, k.c, p, 0xc8f040, 1.2, 380, 0, 160, 9, land));
    },
  },
  demonstration: {
    // Огненная бутыль: колба с огнём — взрыв и языки пламени.
    hit: at(380),
    draw: (fx, k) => {
      const p = k.uniq[0];
      if (!p) return;
      const land = () => {
        fx.fireBurst(p.x, p.y, p.feet, true, motion.reduced);
        fx.splat(p.x, p.feet - 10, 0x3a2010, 1.3);
        fx.later(160, () => fx.rise(p.x, p.feet - 10, 0xff8a20, 8, 40));
      };
      shot(fx, k, { x: k.c.x, y: k.c.y - 30 }, p, 380, 0, 160, 0xff8a20, land, () => lob(fx, T.flask, k.c, p, 0xff7a2a, 1.2, 380, 0, 160, 9, land));
    },
  },
  acidBomb: {
    // Кислотный всплеск: колбы градом на всех врагов.
    hit: (k, i) => 380 + indexOf(k, i) * 80,
    draw: (fx, k) => {
      k.uniq.forEach((p, i) => {
        const land = () => acidSplash(fx, p, 0xb8f040);
        shot(fx, k, { x: k.c.x, y: k.c.y - 30 }, p, 380, i * 80, 200, -1, land, () => lob(fx, T.flask, k.c, p, 0xb8f040, 1.1, 380, i * 80, 200, 11, land));
      });
    },
  },
  slimPotion: {
    // Белые зелья: белые колбы летят каждому союзнику и разбиваются брызгами.
    hit: (k, i) => 360 + indexOf(k, i) * 60,
    draw: (fx, k) => {
      k.uniq.forEach((p, i) => lob(fx, T.flask, k.c, p, 0xf4f8ff, 1.1, 360, i * 60, 180, 10, () => {
        fx.splat(p.x, p.y, 0xf4f8ff, 1.2);
        fx.burst(p.x, p.y, 0xffffff, 8);
      }));
    },
  },

  // ---------- маг, волшебник, мудрец ----------
  fireBall: {
    // Огненный шар: шар летит от мага — крупный взрыв огня.
    hit: at(300),
    draw: (fx, k) => {
      const p = k.uniq[0];
      if (!p) return;
      const land = () => {
        fx.fireBurst(p.x, p.y, p.feet, true, motion.reduced);
        groundRing(fx, p, 0xff5a10, 0.5, 4, 520);
      };
      shot(fx, k, k.c, p, 300, 0, Math.min(120, Math.abs(p.x - k.c.x) * 0.18), 0xff8a20, land, () => fx.projectile('fireball', k.c, p, 0xff8a20, 300, 0, land));
    },
  },
  coldBolt: {
    // Ледяная стрела: ледяные копья падают сверху одно за другим (как огненная стрела), иней.
    hit: (_k, i) => FIRE_BOLT_MS + i * 150,
    draw: (fx, k) => {
      k.hits.forEach((p, i) => {
        const side = k.c.x <= p.x ? -1 : 1;
        const tx = p.x + ((i % 3) - 1) * 22;
        const from = { x: tx + side * 200, y: p.y - 600, feet: p.feet };
        const land = () => {
          fx.glow(tx, p.y, 0xbfeaff, 0.8, 3, 320, 0, 1);
          fx.burst(tx, p.y, 0xdff6ff, 10);
          groundRing(fx, p, 0x8fdcff, 0.4, 2.4, 420);
        };
        shot(fx, k, from, { x: tx, y: p.y }, FIRE_BOLT_MS, i * 150, 0, 0xbfeaff, land, () => fx.projectile('ice', from, { ...p, x: tx }, 0x9fe6ff, FIRE_BOLT_MS, i * 150, land));
      });
    },
  },
  jupitel: {
    // Гром Юпитера: шар молний летит в цель, разряды вокруг и отброс.
    hit: at(300),
    draw: (fx, k) => {
      const p = k.uniq[0];
      if (!p) return;
      const land = () => {
        for (let i = 0; i < 3; i++) fx.lightning({ x: p.x + (i - 1) * 50, y: p.y, feet: p.feet }, 0xffe45a, i * 50);
        for (let i = 0; i < 3; i++) fx.streakAt(p.x + k.dir * 80, p.y - 20 + i * 20, k.dir, 0xfff3a8, 1.6, 280, i * 30);
        fx.glow(p.x, p.y, 0xffe45a, 1, 4, 380, 0, 1);
        fx.flash(0xfff3a8, 0.08, 160);
      };
      shot(fx, k, k.c, p, 300, 0, 40, 0x9fb8ff, land, () => fx.projectile('lightning', k.c, p, 0xffe45a, 300, 0, land));
    },
  },
  meteorStorm: {
    // Метеоритный дождь: горящие камни падают с неба, кратеры с пылью.
    hit: (_k, i) => 530 + i * 170,
    draw: (fx, k) => {
      k.hits.forEach((p, i) => {
        const tx = { ...p, x: p.x + ((i % 3) - 1) * 30 };
        fx.projectile('meteor', k.c, tx, 0xff7a2a, 330, i * 170, () => {
          fx.fireBurst(tx.x, p.y, p.feet, i === k.hits.length - 1, motion.reduced);
          groundRing(fx, tx, 0x8a3a10, 0.5, 3.6, 560);
          fx.puffCloud(tx.x, p.feet - 10, 0x6a5a4a, 5, 120, 600);
        });
      });
    },
  },
  frostNova: {
    // Кольцо мороза: ледяное кольцо от волшебника, ледяные иглы из-под врагов.
    hit: at(220),
    draw: (fx, k) => {
      groundRing(fx, k.c, 0xbfeaff, 0.5, 10, 620);
      groundRing(fx, k.c, 0xffffff, 0.4, 7, 520, 80, 0.8);
      fx.glow(k.c.x, k.c.y, 0x9fe6ff, 1, 4, 420, 0, 0.8);
      for (const p of k.uniq) fx.later(180, () => {
        spikeRow(fx, p, 0xcff4ff, 5, 1.1, 26, 0, T.shard);
        fx.glow(p.x, p.feet - 20, 0xbfeaff, 0.8, 3.2, 480, 0, 0.8);
        fx.burst(p.x, p.y, 0xdff6ff, 8);
      });
      fx.later(180, () => fx.flash(0xc8f0ff, 0.08, 200));
    },
  },
  quagmire: {
    // Трясина: бурые лужи грязи под врагами, пузыри.
    hit: at(200),
    draw: (fx, k) => {
      for (const p of k.uniq) {
        const o = fx.img(T.splat, p.x, p.feet, 0x5a4020, SFX_DEPTH - 1, NORMAL);
        o.setScale(0.5, 0.18).setAlpha(0.9);
        fx.run(o, 1300, (q, im) => {
          const g = ease.quadOut(clamp01(q / 0.25));
          im!.setScale(0.5 + 2.4 * g, (0.18 + 0.7 * g) * 0.45).setAlpha(q < 0.7 ? 0.85 : 0.85 * (1 - (q - 0.7) / 0.3));
        });
        groundRing(fx, p, 0x8a6a3a, 0.4, 3, 700, 60, 0.7);
        for (let i = 0; i < 3; i++) fx.later(200 + i * 180, () => fx.blobs(p.x + (Math.random() - 0.5) * 60, p.feet - 6, 0x7a5a2a, 3));
      }
    },
  },
  heavensDrive: {
    // Небесный удар: ряды земляных шипов разом под всеми врагами фронта.
    hit: at(160),
    draw: (fx, k) => {
      for (const p of k.uniq) {
        spikeRow(fx, p, 0xd89a4a, 5, 1.8, 30, 0);
        groundRing(fx, p, 0xa87840, 0.4, 3.4, 480);
        fx.later(100, () => fx.puffCloud(p.x, p.feet - 10, 0xb89a70, 6, 120, 520));
      }
      fx.later(120, () => fx.shake(0.006, 200));
    },
  },
  dispell: {
    // Развеивание: светлое кольцо сжимается на цели и разбивает чары осколками.
    hit: at(320),
    draw: (fx, k) => {
      const p = k.uniq[0];
      if (!p) return;
      fx.projectile('arcane', k.c, p, 0xe0c8ff, 240, 0, () => {});
      fx.glow(p.x, p.y, 0xe0c8ff, 3.6, 0.3, 320, 0, 0.95, T.ring);
      fx.later(320, () => {
        for (let j = 0; j < 8; j++) {
          const a = (j / 8) * Math.PI * 2;
          const o = fx.img(T.shard, p.x, p.y, j % 2 ? 0xffffff : 0xe0c8ff, SFX_DEPTH + 3, ADD);
          o.setRotation(a).setScale(0.4, 0.6);
          fx.run(o, 420, (q, im) => im!.setPosition(p.x + Math.cos(a) * 110 * q, p.y + Math.sin(a) * 110 * q).setAlpha(1 - q));
        }
        fx.glow(p.x, p.y, 0xffffff, 0.6, 2.8, 220, 0, 1);
      });
    },
  },
  volcano: {
    // Вулкан: огненный круг под мудрецом, языки пламени (союзники — аура volcano).
    hit: at(150),
    draw: (fx, k) => {
      groundCircle(fx, k.c, 0xff6a20, 1.8, 1000);
      fx.rise(k.c.x, k.c.feet, 0xff8a20, 14, 110);
      fx.glow(k.c.x, k.c.feet - 30, 0xff5010, 1.2, 5, 600, 0, 0.8, T.glow, 0.5);
    },
  },

  // ---------- аколит, жрец, монах ----------
  signumCrucis: {
    // Знак креста: золотой крест над каждым врагом, тёмные искры вниз.
    hit: at(200),
    draw: (fx, k) => {
      k.uniq.forEach((p, i) => {
        pop(fx, T.hcross, p.x, head(p) - 30, 0xffe070, 0.8, 800, i * 50, 20, ADD);
        fx.later(200 + i * 50, () => fx.glow(p.x, p.y, 0xff8a6a, 0.8, 2.6, 420, 0, 0.6));
      });
    },
  },
  angelus: {
    // Ангелус: белый нимб над аколитом, перья (союзники — аура angelus).
    hit: at(150),
    draw: (fx, k) => {
      fx.glow(k.c.x, head(k.c) - 10, 0xfff8d8, 0.4, 2.6, 800, 0, 1, T.ring, 0.35);
      fx.feathers(k.c.x, head(k.c), 0xffffff, 6, 70);
      fx.glow(k.c.x, k.c.y, 0xfff8d8, 1, 3.4, 500, 0, 0.8);
    },
  },
  impositio: {
    // Импозицио Манус: золотая вспышка у жреца (союзники — меч света, аура impositio).
    hit: at(150),
    draw: (fx, k) => {
      fx.glow(k.c.x, k.c.y, 0xffe070, 1, 3.6, 460, 0, 0.9);
      fx.rise(k.c.x, k.c.feet, 0xffe070, 8, 50);
    },
  },
  magnus: {
    // Магнус Экзорцизмус: святые кресты на земле под врагами и столбы света.
    hit: (k, i) => 240 + indexOf(k, i) * 70,
    draw: (fx, k) => {
      k.uniq.forEach((p, i) => {
        const o = fx.img(T.hcross, p.x, p.feet - 4, 0xf0e0ff, SFX_DEPTH - 1, ADD);
        o.setScale(1.6, 0).setAlpha(0.9);
        fx.run(o, 1000, (q, im) => im!.setScale(1.6, 0.55 * ease.quadOut(clamp01(q / 0.25))).setAlpha(q < 0.7 ? 0.9 : 0.9 * (1 - (q - 0.7) / 0.3)), i * 70);
        fx.later(160 + i * 70, () => fx.pillar(p, 0xf0e0ff));
      });
      fx.later(200, () => fx.flash(0xf4ecff, 0.12, 240));
    },
  },
  lexAeterna: {
    // Лекс Этерна: алый рунный круг печатью на груди врага.
    hit: at(200),
    draw: (fx, k) => {
      for (const p of k.uniq) {
        const o = fx.img(T.circle, p.x, p.y, 0xff6a4a, SFX_DEPTH + 3, ADD);
        o.setScale(0.1);
        fx.run(o, 800, (q, im) => im!.setScale(0.1 + 0.55 * ease.backOut(clamp01(q / 0.3))).setRotation(q * 2).setAlpha(q < 0.6 ? 1 : 1 - (q - 0.6) / 0.4));
        fx.later(200, () => fx.glow(p.x, p.y, 0xffd060, 0.5, 2.4, 260, 0, 1));
      }
    },
  },
  assumptio: {
    // Ассумптио: розово-золотой свет и перья у жреца (союзники — аура assumptio).
    hit: at(150),
    draw: (fx, k) => {
      fx.glow(k.c.x, k.c.y, 0xffb8d8, 1.2, 4.4, 600, 0, 0.8);
      fx.feathers(k.c.x, head(k.c) + 20, 0xffe0f0, 6, 80);
    },
  },
  tripleAttack: {
    // Тройная атака: три удара кулаком с огненными ударными кольцами.
    hit: (_k, i) => 40 + i * 110,
    draw: (fx, k) => {
      k.hits.forEach((p, i) => fx.later(40 + i * 110, () => {
        const y = p.y + (i - 1) * 18;
        fx.glow(p.x, y, 0xffb050, 0.6, 2.6, 220, 0, 1);
        fx.glow(p.x, y, 0xffd090, 0.3, 2 + i * 0.4, 300, 0, 0.95, T.ring, 1.3);
        fx.streakAt(p.x + k.dir * 50, y, k.dir, 0xfff0c0, 1.3, 220);
        fx.burst(p.x, y, 0xffd090, 6);
        if (i === k.hits.length - 1) fx.stars(p.x, p.y - 20, 0xffe060, 5);
      }));
    },
  },
  investigate: {
    // Проникающий удар: ладонь — голубая ударная волна насквозь через цель.
    hit: at(60),
    draw: (fx, k) => {
      for (const p of k.uniq) fx.later(60, () => {
        fx.glow(p.x, p.y, 0xffffff, 0.6, 2.6, 180, 0, 1);
        for (let i = 0; i < 3; i++) fx.glow(p.x + k.dir * i * 40, p.y, 0x9fd8ff, 0.4, 2.2 - i * 0.3, 320, i * 50, 0.95, T.ring, 2.2);
        fx.streakAt(p.x + k.dir * 170, p.y, k.dir, 0xcfeaff, 2.4, 300);
        fx.burst(p.x + k.dir * 30, p.y, 0xcfeaff, 12);
      });
    },
  },
  asura: {
    // Удар Асуры: сферы собираются в кулак — огромный золотой взрыв, вспышка, тряска.
    hit: at(220),
    draw: (fx, k) => {
      converge(fx, k.c.x, k.c.y, 0xffe070, 10, 160, 200);
      const p = k.uniq[0];
      if (!p) return;
      fx.later(220, () => {
        fx.glow(p.x, p.y, 0xffd84a, 1.2, 7, 520, 0, 1);
        fx.glow(p.x, p.y, 0xffffff, 0.8, 3.6, 260, 0, 1);
        fx.glow(p.x, p.y, 0x9fd8ff, 0.5, 5, 560, 60, 0.9, T.ring);
        groundRing(fx, p, 0xffd84a, 0.5, 8, 640);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          fx.streakAt(p.x + Math.cos(a) * 170, p.y + Math.sin(a) * 120, 1, 0xfff0a0, 1.8, 360, 0, a);
        }
        fx.burst(p.x, p.y, 0xffe890, 26);
        fx.flash(0xfff4c0, 0.22, 280);
        fx.shake(0.012, 320);
      });
    },
  },
  bladeStop: {
    // Хватка клинка: две ладони-дуги схлопываются на клинке врага, искры.
    hit: at(120),
    draw: (fx, k) => {
      for (const p of k.uniq) {
        fx.slash(p.x - 40, p.y, 1, 0xe8f0ff, 1.3, 0, 0, 0.6);
        fx.slash(p.x + 40, p.y, -1, 0xe8f0ff, 1.3, 0, 0, 0.6);
        fx.later(120, () => {
          fx.glow(p.x, p.y, 0xffffff, 0.6, 2.4, 200, 0, 1, T.spark);
          fx.burst(p.x, p.y, 0xffffff, 10);
          fx.stars(p.x, head(p) + 20, 0xffe060, 4);
        });
      }
    },
  },
};

export const signatureDef = (sig: Signature): SigDef => SIGS[sig];

/**
 * Рецепт навыка целиком. start — через сколько мс начать (кадр удара анимации). Возвращает время (мс от «сейчас»)
 * попадания каждого удара k.hits[i]; без ударов — [start + hit(0)] (навыки на союзников: момент эффекта).
 */
export function playSignature(fx: SkillFx, sig: Signature, k: SigCtx, start: number): number[] {
  const def = SIGS[sig];
  fx.later(start, () => def.draw(fx, k));
  if (!k.hits.length) return [start + def.hit(k, 0)];
  return k.hits.map((_, i) => start + def.hit(k, i));
}

// ---------- ауры (бафф, щит, лечение на цели) ----------

/** Вид баффа/щита/лечения этого навыка на цели p. */
export function playAura(fx: SkillFx, aura: Aura, p: FxPoint, tint: number): void {
  const h = head(p);
  switch (aura) {
    case 'endure':
      groundRing(fx, p, tint, 0.4, 2.6, 560);
      fx.glow(p.x, p.y, tint, 1, 3.2, 480, 0, 0.7, T.glow, 1.4);
      fx.rise(p.x, p.feet, tint, 6, 40);
      return;
    case 'regen':
      groundRing(fx, p, tint, 0.3, 1.6, 420, 0, 0.8);
      return;
    case 'rage':
      fx.glow(p.x, p.y, tint, 1.2, 3.4, 520, 0, 0.8, T.glow, 1.5);
      fx.rise(p.x, p.feet, 0xff6a3a, 10, 40);
      groundRing(fx, p, tint, 0.4, 2.4, 460);
      return;
    case 'bladeGlint':
      pop(fx, T.blade, p.x, h - 10, 0xffffff, 0.9, 600, 0, 20, NORMAL, -Math.PI / 2);
      fx.later(150, () => fx.glow(p.x, h - 60, 0xffffff, 0.3, 1.6, 260, 0, 1, T.spark));
      return;
    case 'parry':
      fx.slash(p.x - 20, p.y, 1, tint, 0.9, -0.6, 0, 0.6);
      fx.slash(p.x + 20, p.y, -1, tint, 0.9, -0.6, 0, 0.6);
      fx.glow(p.x, p.y, 0xffffff, 0.4, 1.8, 200, 60, 1, T.spark);
      fx.burst(p.x, p.y, 0xffffff, 5);
      return;
    case 'quicken':
      for (let i = 0; i < 4; i++) fx.streakAt(p.x - 45 + i * 30, p.y - 30 - (i % 2) * 40, 1, tint, 1.2, 320, i * 40, -Math.PI / 2);
      groundRing(fx, p, tint, 0.4, 2.2, 440);
      return;
    case 'faith':
      pop(fx, T.hcross, p.x, h - 20, 0xfff0a0, 0.55, 800, 0, 20, ADD);
      bubble(fx, p, 0xfff0a0, 1, 700);
      return;
    case 'autoGuard':
      pop(fx, T.shield, p.x, p.y, 0xd8e4ff, 1.3, 460, 0, 0);
      fx.glow(p.x, p.y, 0xffffff, 0.3, 1.6, 180, 0, 1, T.spark);
      return;
    case 'devotion':
      bubble(fx, p, 0xffd860, 1.1, 800);
      fx.rise(p.x, p.feet, 0xfff0a0, 6, 40);
      return;
    case 'bulwark':
      pop(fx, T.shield, p.x, h - 20, 0xd8e4ff, 0.8, 700, 0, 20);
      groundRing(fx, p, 0xd8e4ff, 0.4, 2.6, 560);
      return;
    case 'owl':
    case 'vulture':
      fx.glow(p.x, h - 10, 0xffffff, 0.4, 2, 360, 0, 1, T.spark);
      fx.glow(p.x, h - 10, tint, 0.3, 1.8, 420, 0, 0.9, T.ring);
      groundRing(fx, p, tint, 0.3, 1.8, 480, 0, 0.8);
      if (aura === 'vulture') fx.streakAt(p.x + 60, h - 10, 1, tint, 1, 260, 80);
      return;
    case 'focus':
      for (let i = 0; i < 3; i++) fx.glow(p.x, p.y, i % 2 ? 0xffffff : tint, 3.4 - i * 0.4, 0.3, 380, i * 110, 0.9, T.ring);
      fx.later(360, () => fx.glow(p.x, p.y, tint, 0.8, 2.6, 300, 0, 0.9));
      return;
    case 'beast':
      pop(fx, T.claw, p.x, p.y - 10, 0xffffff, 1, 520, 0, 10, ADD);
      fx.glow(p.x, p.y, tint, 0.8, 2.8, 420, 0, 0.7);
      return;
    case 'bragi':
    case 'idun':
    case 'song':
      riseTex(fx, T.note, p, tint, aura === 'idun' ? 2 : 3, 50, 900, 0.8);
      if (aura === 'song') groundRing(fx, p, tint, 0.3, 2.2, 520);
      return;
    case 'kiss':
      riseTex(fx, T.heart, p, tint, 3, 50, 900, 0.8);
      fx.glow(p.x, p.y, 0xffd84a, 0.3, 1.6, 300, 120, 1, T.spark);
      return;
    case 'dodge':
      for (const d of [-1, 1]) for (let i = 0; i < 2; i++) fx.streakAt(p.x + d * (50 + i * 30), p.y - 30 + i * 40, d, tint, 1.1, 260, i * 40);
      fx.glow(p.x, p.y, tint, 0.8, 2.4, 300, 0, 0.6);
      return;
    case 'katar':
      pop(fx, T.blade, p.x, p.y, 0xd0b0ff, 0.8, 520, 0, 10, NORMAL, -0.5);
      fx.glow(p.x, p.y, tint, 0.3, 2, 400, 0, 0.9, T.ring);
      return;
    case 'plagiarism':
    case 'magicRod':
    case 'soulDrain':
      converge(fx, p.x, p.y, tint, 8, 120, 300);
      fx.later(300, () => fx.glow(p.x, p.y, tint, 0.4, 2.4, 360, 0, 0.9, T.ring));
      return;
    case 'uproar':
      fx.shout(p, tint);
      return;
    case 'overcharge':
      fx.coins(p.x, h + 10, 8);
      fx.glow(p.x, p.y, tint, 0.8, 2.8, 420, 0, 0.7);
      return;
    case 'pushcart':
      bubble(fx, p, tint, 1, 600);
      fx.dust(p.x, p.feet, 0xc8b090, 5, 50);
      return;
    case 'fury':
      fx.glow(p.x, p.y, tint, 1.2, 3.8, 560, 0, 0.8, T.glow, 1.5);
      fx.rise(p.x, p.feet, 0xff8a3a, 12, 40);
      groundRing(fx, p, tint, 0.4, 2.8, 500);
      return;
    case 'temper':
      fx.stars(p.x, p.y, 0xffa040, 5);
      fx.glow(p.x, p.y, tint, 0.3, 2.2, 360, 0, 0.9, T.ring);
      return;
    case 'adrenaline':
      for (let i = 0; i < 5; i++) fx.streakAt(p.x - 60 + i * 30, p.y - 30 - (i % 2) * 50, 1, tint, 1.3, 340, i * 30, -Math.PI / 2);
      fx.glow(p.x, p.y, tint, 1, 3, 420, 0, 0.6);
      return;
    case 'forge':
      fx.stars(p.x, p.y - 10, 0xffc040, 5);
      fx.burst(p.x, p.y - 10, 0xffe070, 8);
      groundRing(fx, p, tint, 0.4, 2.4, 500);
      return;
    case 'potion':
      fx.splat(p.x, p.y, tint, 1, 0, 320);
      fx.rise(p.x, p.y, 0xffa0a0, 4, 30);
      return;
    case 'chemical':
      bubble(fx, p, tint, 1, 700);
      fx.blobs(p.x, p.y - 20, tint, 5);
      return;
    case 'mana':
      fx.rise(p.x, p.feet, tint, 6, 40);
      groundRing(fx, p, tint, 0.3, 1.8, 440, 0, 0.8);
      return;
    case 'energyCoat':
      bubble(fx, p, tint, 1.1, 700);
      return;
    case 'safetyWall':
      for (let i = 0; i < 5; i++) {
        const x = p.x + (i - 2) * 34;
        const col = fx.img(T.beam, x, p.feet, tint, SFX_DEPTH + 2, ADD);
        col.setOrigin(0, 0.5).setRotation(-Math.PI / 2).setScale((p.feet - p.y) * 2.2 / 64, 0.8).setAlpha(0);
        fx.run(col, 900, (q, im) => im!.setAlpha((i === 2 ? 0.5 : 0.8) * (q < 0.2 ? q / 0.2 : q < 0.6 ? 1 : 1 - (q - 0.6) / 0.4)), i * 25);
      }
      groundRing(fx, p, tint, 0.5, 2.2, 800);
      return;
    case 'amplify':
    case 'freeCast':
      groundCircle(fx, p, tint, aura === 'amplify' ? 0.9 : 0.7, 900);
      fx.rise(p.x, p.feet, tint, 5, 40);
      return;
    case 'volcano':
      groundCircle(fx, p, tint, 0.7, 800);
      fx.rise(p.x, p.feet, 0xff8a20, 8, 40);
      return;
    case 'divine':
      pop(fx, T.hcross, p.x, h - 10, tint, 0.4, 600, 0, 20, ADD);
      groundRing(fx, p, tint, 0.3, 2, 500);
      return;
    case 'blessing':
      fx.buff(p, tint);
      pop(fx, T.hcross, p.x, h - 30, 0xffe070, 0.4, 600, 200, 20, ADD);
      return;
    case 'agi':
      fx.buff(p, tint);
      fx.feathers(p.x, h, 0xdff4ff, 3, 50, 800);
      return;
    case 'angelus':
      fx.glow(p.x, h - 10, tint, 0.4, 1.8, 900, 0, 1, T.ring, 0.35);
      fx.feathers(p.x, h, 0xffffff, 3, 50, 900);
      return;
    case 'impositio': {
      const o = fx.img(T.blade, p.x, h - 160, tint, SFX_DEPTH + 3, ADD);
      o.setRotation(Math.PI / 2).setScale(1.3);
      fx.run(o, 520, (q, im) => im!.setY(h - 160 + 170 * ease.quadIn(clamp01(q / 0.5))).setAlpha(q < 0.6 ? 1 : 1 - (q - 0.6) / 0.4));
      fx.later(260, () => fx.glow(p.x, p.y, tint, 0.8, 3, 380, 0, 0.9));
      return;
    }
    case 'magnificat':
      fx.rise(p.x, p.feet, tint, 8, 50);
      fx.glow(p.x, h - 10, tint, 0.4, 1.6, 700, 0, 0.9, T.ring, 0.35);
      return;
    case 'kyrie':
      bubble(fx, p, tint, 1.2, 900);
      bubble(fx, p, 0xffffff, 0.9, 700, 120);
      for (let i = 0; i < 3; i++) pop(fx, T.cross, p.x + (i - 1) * 50, p.y - 20 + (i % 2) * 30, 0xffffff, 0.8, 500, i * 90, 20, ADD);
      return;
    case 'assumptio':
      fx.glow(p.x, p.y, tint, 1.5, 4.4, 900, 0, 0.6, T.glow, 1.4);
      bubble(fx, p, 0xffe0a0, 1.1, 800);
      fx.feathers(p.x, h, 0xffe0f0, 2, 50, 800);
      return;
    case 'spheres':
      orbit(fx, p.x, p.y - 10, tint, 5, 70, 900);
      return;
    case 'ironHand':
      fx.glow(p.x, p.y, tint, 0.3, 2.2, 400, 0, 0.9, T.ring);
      fx.burst(p.x, p.y, tint, 8);
      return;
    case 'steelBody':
      fx.glow(p.x, p.y, tint, 1.4, 3.6, 700, 0, 0.8, T.glow, 1.6);
      bubble(fx, p, 0xe8eef8, 1, 700);
      fx.streakAt(p.x, h + 20, 1, 0xffffff, 1.6, 420, 0, -Math.PI / 2);
      fx.burst(p.x, p.y, 0xffffff, 8);
      return;
  }
}

// ---------- срабатывание пассивок ----------

/** Короткая вспышка на кастере c при срабатывании пассивки; targets — цели этого срабатывания. */
export function playProc(fx: SkillFx, proc: Proc, c: FxPoint, targets: FxPoint[], tint: number): void {
  switch (proc) {
    case 'flash':
      fx.glow(c.x, c.y, tint, 0.3, 2.2, 320, 0, 0.9, T.ring, 1.2);
      fx.glow(c.x, head(c) + 10, 0xffffff, 0.3, 1.4, 260, 0, 1, T.spark);
      return;
    case 'falcon':
      for (const p of targets) fly(fx, T.bird, c.x, c.y - 200, p.x, p.y - 20, 0xffffff, 0.8, 220, 0, tint);
      return;
    case 'potion':
      for (const p of targets) lob(fx, T.flask, c, p, tint, 0.9, 300, 0, 120, 8);
      return;
    case 'venomEdge':
      fx.glow(c.x, c.y, tint, 0.8, 2.6, 360, 0, 0.8);
      pop(fx, T.blade, c.x, c.y, 0xc8ffa0, 0.7, 420, 0, 10, NORMAL, -0.6);
      for (const p of targets) fx.later(120, () => fx.splat(p.x, p.y, tint, 0.9));
      return;
    case 'soulDrain':
      converge(fx, c.x, c.y, tint, 10, 160, 340);
      return;
    case 'spheres':
      orbit(fx, c.x, c.y - 10, tint, 5, 70, 700);
      return;
    case 'shout':
      fx.shout(c, tint);
      return;
    case 'notes':
      riseTex(fx, T.note, c, tint, 2, 40, 700, 0.7);
      return;
  }
}

// ---------- зрелищность: ульта, крупный удар, смерть босса, бафф ----------

/**
 * Подготовка ульты (ульта монстра/босса, «большой» навык героя — SkillVisual.big): короткая вспышка-аура у кастера —
 * искры стягиваются к телу, кольцо под ногами, столбик света. ≈ 300 мс, не выше головы — не заходит на полоски.
 */
export function playCharge(fx: SkillFx, c: FxPoint, tint: number): void {
  converge(fx, c.x, c.y, tint, 10, 130, 240);
  fx.glow(c.x, c.y, tint, 0.6, 3.2, 320, 0, 0.75);
  fx.glow(c.x, c.y, 0xffffff, 0.3, 1.6, 200, 60, 0.8);
  groundRing(fx, c, tint, 0.4, 3.4, 420);
  fx.rise(c.x, c.feet, tint, 6, 40);
}

/** Попадание ульты: лёгкая встряска и вспышка экрана (обе — не при «Уменьшить анимацию»), кольцо на каждой цели. */
export function playBigImpact(fx: SkillFx, targets: FxPoint[], tint: number): void {
  fx.shake(0.0045, 160);
  fx.flash(0xffffff, 0.1, 150);
  for (const p of targets.slice(0, 5)) fx.glow(p.x, p.y, tint, 0.4, 2.8, 300, 0, 0.9, T.ring);
}

/** Крупный удар (≥ 25% ОЗ цели, удар ульты): золотая звезда-вспышка «крита» за цифрой, белое ядро, искры. */
export function playCrit(fx: SkillFx, p: FxPoint, dir: number): void {
  const x = p.x - dir * 6;
  fx.glow(x, p.y, 0xffe070, 1.4, 4.2, 220, 0, 1, T.spark);
  fx.glow(x, p.y, 0xffffff, 0.6, 2.2, 140, 0, 1);
  fx.glow(x, p.y, 0xffc040, 0.4, 3, 300, 0, 0.9, T.ring);
  fx.burst(x, p.y, 0xfff0a0, 10);
}

/** Бафф на союзнике: три искорки мерцают над головой (≈ 0,7 с), под полосками ОЗ. */
export function playTwinkle(fx: SkillFx, x: number, y: number, tint: number): void {
  for (let i = 0; i < 3; i++) {
    const sx = x + (i - 1) * 34;
    const sy = y - (i === 1 ? 14 : 0);
    const o = fx.img(T.spark, sx, sy, i === 1 ? 0xffffff : tint, SFX_DEPTH + 3, ADD);
    o.setScale(0);
    fx.run(o, 520, (q, im) => {
      const s = Math.sin(q * Math.PI);
      im!.setScale(0.9 * s * (0.8 + 0.2 * Math.sin(q * 18))).setAlpha(s).setRotation(q * 1.5);
    }, i * 110);
  }
}

/** Смерть босса: белая вспышка, сильная встряска, огненно-золотые кольца и столб искр (пауза-«hit stop» — в BattleScene). */
export function playBossDeath(fx: SkillFx, p: FxPoint): void {
  fx.flash(0xffffff, 0.28, 260);
  fx.shake(0.01, 320);
  fx.glow(p.x, p.y, 0xffd060, 1.2, 7, 620, 0, 1);
  fx.glow(p.x, p.y, 0xffffff, 0.8, 3.6, 300, 0, 1);
  fx.glow(p.x, p.y, 0xff8a3a, 0.5, 6, 700, 80, 0.9, T.ring);
  groundRing(fx, p, 0xffd060, 0.6, 9, 800);
  fx.burst(p.x, p.y, 0xffe890, 26);
  fx.rise(p.x, p.feet, 0xffd060, 12, 70);
}
