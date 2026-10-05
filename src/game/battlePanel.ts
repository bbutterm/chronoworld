import Phaser from 'phaser';
import type { CardRarity } from '../core';
import { BLEED_X, BLEED_Y, GAME_H, GAME_W } from './layout';
import { decorTween, juiceOn } from './juice';
import { portrait } from './screen';
import { portraitKey } from './sprites';
import { COLOR_N, E, M, RARITY, hexNum } from './theme';
import { chargeBreakBadge } from './ultBadge';

/**
 * Панель героев в бою (итерация 5 полировки, как в AFK Arena): внизу экрана по медальону на героя отряда —
 * портрет на тёмном диске в ободе цвета редкости, вокруг — кольцо готовности ульты (дуга по часовой от 12 часов),
 * под ним — тонкая полоска здоровья. Готовая ульта: кольцо золотое, за медальоном мягкое свечение (пульс);
 * в ручном режиме касание медальона — ульта. Павший — обесцвечен и приглушён. Подписей нет: героя видно по портрету.
 *
 * Данные приходят из BattleScene.redraw/update (те же числа, что у полосок над головами), сама панель ничего не считает.
 * Число объектов на героя постоянное (~8), кадр меняет только ширину полоски и угол дуги — и только при смене шага.
 */

export interface PanelUnit {
  uid: string;
  name: string;
  sprite: string;
  /** Есть ульта (копит энергию) — кольцо видно. */
  hasUlt: boolean;
  /** Ульта героя (docs/design/battle-decisions.md §1): кольцо готовности, касание портрета — ульта. */
  ult?: boolean;
  /** Ульта оглушает / срывает каст — ею сбивают заряд босса: значок-молния у медальона (ultBadge.ts). */
  breaks?: boolean;
  /** Редкость карточки героя — цвет обода (нет — бронза). */
  rarity?: CardRarity;
}

interface Entry {
  node: Phaser.GameObjects.Container;
  hp: Phaser.GameObjects.Rectangle;
  arc: Phaser.GameObjects.Arc | null;
  face: Phaser.GameObjects.Image;
  rim: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image | null;
  bolt: Phaser.GameObjects.Image | null;
  pulse: Phaser.Tweens.Tween | null;
  boltPulse: Phaser.Tweens.Tween | null;
  dead: boolean;
  ready: boolean;
  /** Показанный шаг кольца (0…RING_STEPS) и полоски HP (0…HP_STEPS); -1 — ещё не рисовали. */
  ringStep: number;
  hpStep: number;
  hpTone: number;
}

/** Шаг между медальонами и их размеры (ед. поля 1080). */
export const CELL = 196;
/** Радиус диска с портретом, обода редкости и кольца ульты. */
const DISC_R = 64;
const RIM_R = 68;
export const RING_R = 80;
const RING_W = 10;
/** Портрет чуть больше диска: голова фигуры может выйти за обод — «живее», чем вписанный квадрат. */
const FACE = 128;
const HP_W = 136;
const HP_H = 12;
const HP_Y = RING_R + 22;
/** Высота медальона с полоской: от верха кольца до низа полоски HP. */
export const CELL_H = RING_R + RING_W / 2 + HP_Y + HP_H / 2 + 3;
/** Центр медальонов на поле 9:16 (на вытянутых экранах — ниже на navShift, к низу безопасной области). */
export const PANEL_Y = GAME_H - 130;
/** Верх панели (верх кольца) при сдвиге 0: фигуры поля и их подписи держатся выше. */
export const PANEL_TOP = PANEL_Y - RING_R - RING_W / 2;
/** Кольцо делится на столько шагов: дуга перерисовывается только при смене шага (≈ 2.5 % заряда). */
export const RING_STEPS = 40;
const HP_STEPS = 100;
const HP_OK = COLOR_N.positive;
const HP_LOW = COLOR_N.warning;
const HP_BAD = COLOR_N.negative;
const RING_CHARGE = COLOR_N.info;
const RING_READY = COLOR_N.gold;
const BRONZE = COLOR_N.border;

const DISC_TEX = 'hud_disc';
const RIM_TEX = 'hud_rim';
const GLOW_TEX = 'hud_glow';
const SHADE_TEX = 'hud_shade';

/** Шаг кольца для доли заряда 0…1 (полное — только когда правда 1). */
export function ringStep(p: number): number {
  const c = Math.min(1, Math.max(0, p));
  return c >= 1 ? RING_STEPS : Math.min(RING_STEPS - 1, Math.floor(c * RING_STEPS));
}

/** x центров медальонов n героев (по центру поля). */
export function cellXs(n: number): number[] {
  const x0 = GAME_W / 2 - ((n - 1) * CELL) / 2;
  return Array.from({ length: n }, (_, i) => x0 + i * CELL);
}

/** Цвет полоски HP по доле. */
export function hpTone(p: number): number {
  return p > 0.5 ? HP_OK : p > 0.25 ? HP_LOW : HP_BAD;
}

/** Текстуры панели — один раз на игру (canvas): диск с мягким градиентом, белый обод (тонируется), свечение, затемнение низа. */
function ensureTextures(scene: Phaser.Scene): void {
  const tm = scene.textures;
  const canvas = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
    if (tm.exists(key)) return;
    const t = tm.createCanvas(key, w, h);
    if (!t) return;
    draw(t.getContext());
    t.refresh();
  };
  const d = (RING_R + RING_W) * 2;
  canvas(DISC_TEX, d, d, (ctx) => {
    const c = d / 2;
    // Дорожка кольца (тёмная) и диск под портретом: тёплый центр → тёмный край.
    ctx.beginPath();
    ctx.arc(c, c, RING_R, 0, Math.PI * 2);
    ctx.lineWidth = RING_W + 4;
    ctx.strokeStyle = 'rgba(8, 6, 4, 0.72)';
    ctx.stroke();
    const g = ctx.createRadialGradient(c, c - DISC_R * 0.35, DISC_R * 0.1, c, c, DISC_R);
    g.addColorStop(0, '#3b3328');
    g.addColorStop(1, '#14110d');
    ctx.beginPath();
    ctx.arc(c, c, DISC_R, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  });
  const rd = (RIM_R + 4) * 2;
  canvas(RIM_TEX, rd, rd, (ctx) => {
    ctx.beginPath();
    ctx.arc(rd / 2, rd / 2, RIM_R, 0, Math.PI * 2);
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  });
  canvas(GLOW_TEX, 128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 20, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
  canvas(SHADE_TEX, 4, 64, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, 'rgba(10,9,7,0)');
    g.addColorStop(0.45, 'rgba(10,9,7,0.55)');
    g.addColorStop(1, 'rgba(10,9,7,0.85)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 64);
  });
}

/**
 * Затемнение края экрана полосой от top до bottom (на всю ширину с полями): прозрачно со стороны поля, темно у края.
 * fromTop — тёмный край сверху (верхняя полоса боя), иначе снизу (панель героев). Одна картинка 4×64, растянутая.
 */
export function shadeBand(scene: Phaser.Scene, top: number, bottom: number, depth: number, fromTop = false): Phaser.GameObjects.Image {
  ensureTextures(scene);
  return scene.add
    .image(GAME_W / 2, top, SHADE_TEX)
    .setOrigin(0.5, 0)
    .setDisplaySize(GAME_W + 2 * BLEED_X, bottom - top)
    .setFlipY(fromTop)
    .setDepth(depth);
}

export class HeroPanel {
  private entries = new Map<string, Entry>();
  /** Центр медальонов по высоте (PANEL_Y + сдвиг к низу вытянутого экрана). */
  y: number;
  private readonly shade: Phaser.GameObjects.Image;

  constructor(
    private readonly scene: Phaser.Scene,
    units: readonly PanelUnit[],
    depth: number,
    onTap?: (uid: string) => void,
    shift = 0,
  ) {
    ensureTextures(scene);
    const y = (this.y = PANEL_Y + shift);
    // Низ экрана темнеет к панели: медальоны читаются на любом фоне, фигуры у нижнего края не спорят с ними.
    this.shade = shadeBand(scene, y - RING_R - 80, GAME_H + shift + BLEED_Y, depth - 1).setName('heroPanelShade');
    const xs = cellXs(units.length);
    units.forEach((u, i) => {
      const parts: Phaser.GameObjects.GameObject[] = [];
      let glow: Phaser.GameObjects.Image | null = null;
      if (u.ult) {
        glow = scene.add.image(0, 0, GLOW_TEX).setDisplaySize((RING_R + 34) * 2, (RING_R + 34) * 2).setTint(RING_READY).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
        parts.push(glow);
      }
      const disc = scene.add.image(0, 0, DISC_TEX);
      const face = portrait(scene, 0, 0, portraitKey(u.sprite), FACE);
      const rim = scene.add.image(0, 0, RIM_TEX).setTint(u.rarity ? hexNum(RARITY[u.rarity]) : BRONZE);
      parts.push(disc, face, rim);
      let arc: Phaser.GameObjects.Arc | null = null;
      if (u.hasUlt || u.ult) {
        arc = scene.add.arc(0, 0, RING_R, -90, -90, false).setClosePath(false).setIterations(1 / 48).setVisible(false);
        arc.setFillStyle();
        arc.setStrokeStyle(RING_W, RING_CHARGE, 1);
        parts.push(arc);
      }
      const hpBack = scene.add.rectangle(0, HP_Y, HP_W + 6, HP_H + 6, 0x000000, 0.7);
      const hp = scene.add.rectangle(-HP_W / 2, HP_Y, HP_W, HP_H, HP_OK).setOrigin(0, 0.5);
      parts.push(hpBack, hp);
      // Молния — справа сверху на кольце: эта ульта сбивает заряд босса.
      const bolt = u.breaks ? chargeBreakBadge(scene, RING_R * 0.72, -RING_R * 0.72, 44) : null;
      if (bolt) parts.push(bolt);
      const node = scene.add.container(xs[i], y, parts).setDepth(depth).setName(`heroPanel_${i}`);
      if (u.ult && onTap) {
        const r = RING_R + RING_W;
        node.setSize(r * 2, r * 2).setInteractive({ hitArea: new Phaser.Geom.Circle(r, r, r), hitAreaCallback: Phaser.Geom.Circle.Contains, useHandCursor: true });
        node.on('pointerdown', () => onTap(u.uid));
      }
      this.entries.set(u.uid, { node, hp, arc, face, rim, glow, bolt, pulse: null, boltPulse: null, dead: false, ready: false, ringStep: -1, hpStep: -1, hpTone: HP_OK });
    });
  }

  /** Move existing portraits/rings, keeping current charge, pulses and input callbacks on Telegram inset changes. */
  reflow(shift: number): void {
    this.y = PANEL_Y + shift;
    for (const e of this.entries.values()) e.node.setY(this.y);
    const top = this.y - RING_R - 80;
    this.shade.setY(top).setDisplaySize(GAME_W + 2 * BLEED_X, GAME_H + shift + BLEED_Y - top);
  }

  /** Ульта готова и ждёт касания (ручной режим): свечение за медальоном (пульс) и короткий «блик» масштабом. */
  setReady(uid: string, on: boolean): void {
    const e = this.entries.get(uid);
    if (!e?.glow || e.ready === on || (on && e.dead)) return;
    e.ready = on;
    e.glow.setVisible(on).setAlpha(1);
    e.pulse?.stop();
    e.pulse = null;
    e.node.setScale(1);
    if (!on) return;
    e.pulse = decorTween(this.scene, { targets: e.glow, alpha: 0.35, duration: M.emphasis, yoyo: true, repeat: -1, ease: E.inOut });
    if (juiceOn()) this.scene.tweens.add({ targets: e.node, scale: 1.08, duration: M.fast, yoyo: true, ease: E.out });
  }

  /** Кольцо готовности ульты героя (0…1): полное — золотое. Дуга перерисовывается только при смене шага. */
  setCharge(uid: string, p: number): void {
    const e = this.entries.get(uid);
    if (!e?.arc || e.dead) return;
    const k = ringStep(p);
    if (k === e.ringStep) return;
    e.ringStep = k;
    if (k === 0) {
      e.arc.setVisible(false);
      return;
    }
    e.arc.setVisible(true).setEndAngle(-90 + (360 * k) / RING_STEPS);
    e.arc.setStrokeStyle(RING_W, k === RING_STEPS ? RING_READY : RING_CHARGE, 1);
  }

  /** Готова ли ульта героя (медальон светится). */
  isReady(uid: string): boolean {
    return !!this.entries.get(uid)?.ready;
  }

  /** Касание прошло: короткий «нажим» медальона. */
  pressed(uid: string): void {
    const e = this.entries.get(uid);
    if (!e) return;
    if (!juiceOn()) return;
    this.scene.tweens.add({ targets: e.node, scale: 0.92, duration: M.press, yoyo: true, ease: E.out });
  }

  /**
   * Заряд босса идёт: молнии у героев, чья ульта его собьёт, пульсируют (кто ответит — видно без текста).
   * Возвращает, есть ли живой герой с молнией.
   */
  alertBreakers(on: boolean): boolean {
    let any = false;
    for (const e of this.entries.values()) {
      if (!e.bolt) continue;
      e.boltPulse?.stop();
      e.boltPulse = null;
      e.bolt.setScale(1);
      if (!on || e.dead) continue;
      any = true;
      e.boltPulse = juiceOn() ? this.scene.tweens.add({ targets: e.bolt, scale: 1.35, duration: M.slow, yoyo: true, repeat: -1, ease: E.inOut }) : null;
    }
    return any;
  }

  /** Медальон героя: центр и размер (для подсказки «коснитесь»). */
  cardAt(uid: string): { x: number; y: number; w: number; h: number } | null {
    const e = this.entries.get(uid);
    const r = RING_R + RING_W / 2;
    return e ? { x: e.node.x, y: e.node.y, w: r * 2, h: r * 2 } : null;
  }

  /** Полоска здоровья и кольцо (0…1), жив ли. */
  set(uid: string, hp: number, energy: number, alive: boolean): void {
    const e = this.entries.get(uid);
    if (!e) return;
    const p = Phaser.Math.Clamp(hp, 0, 1);
    const k = Math.ceil(p * HP_STEPS);
    if (k !== e.hpStep) {
      e.hpStep = k;
      e.hp.width = (HP_W * k) / HP_STEPS;
      const tone = hpTone(p);
      if (tone !== e.hpTone) {
        e.hpTone = tone;
        e.hp.fillColor = tone;
      }
    }
    this.setCharge(uid, energy);
    if (!alive && !e.dead) {
      this.setReady(uid, false);
      e.dead = true;
      e.arc?.setVisible(false);
      e.boltPulse?.stop();
      e.boltPulse = null;
      e.bolt?.setVisible(false);
      e.node.setAlpha(0.55);
      e.rim.setTint(0x6b645a);
      // Обесцвечен (WebGL: матрица цвета; Canvas — серый оттенок).
      const fx = (e.face as Phaser.GameObjects.Image & { preFX?: Phaser.GameObjects.Components.FX | null }).preFX;
      if (fx) fx.addColorMatrix().grayscale(1);
      else e.face.setTint(0x777777);
    }
  }
}
