import Phaser from 'phaser';
import { DEPTH } from './battleFx';
import { text } from './ui';

/**
 * Поведение в бою на экране (docs/design/battle-behavior.md): знак провокации «!» над врагом и красная пунктирная линия
 * к стражу, золотая нить связи крестоносца, засечки фаз на полосе босса и надпись фазы. Объекты создаются по событиям
 * боя и живут, пока жив статус/связь; update() каждый кадр ставит их к показанным фигурам. Без утечек: clear() на выходе.
 */

/** Показанная фигура: точка ног и высота (как UnitView сцены). */
export interface FxAnchor {
  node: { x: number; y: number };
  look: { height: number };
  alive: boolean;
}

const TAUNT_COLOR = '#ff4a3a';
const LINK_COLOR = 0xffd66b;
const TAUNT_LINE = 0xff5a4a;

export class BehaviorFx {
  private readonly taunts = new Map<FxAnchor, { mark: Phaser.GameObjects.Text; source: FxAnchor; lineUntil: number }>();
  private readonly links = new Map<FxAnchor, { guard: FxAnchor; phase: number }>();
  private readonly gfx: Phaser.GameObjects.Graphics;
  private clock = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.gfx = scene.add.graphics().setDepth(DEPTH.fx - 10);
  }

  /** Провокация: «!» над врагом, пока статус висит; линия к стражу — 0,4 с. */
  taunt(target: FxAnchor, source: FxAnchor): void {
    const old = this.taunts.get(target);
    if (old) {
      old.source = source;
      old.lineUntil = this.clock + 400;
      return;
    }
    const mark = text(this.scene, target.node.x, target.node.y - target.look.height, '!', 56, TAUNT_COLOR, { fontStyle: 'bold', stroke: '#2a0600', strokeThickness: 8 }).setDepth(DEPTH.numbers - 5);
    mark.setScale(0.2);
    this.scene.tweens.add({ targets: mark, scale: 1, duration: 180, ease: 'Back.easeOut' });
    this.taunts.set(target, { mark, source, lineUntil: this.clock + 400 });
  }

  untaunt(target: FxAnchor): void {
    const t = this.taunts.get(target);
    if (!t) return;
    t.mark.destroy();
    this.taunts.delete(target);
  }

  /** Связь крестоносца: мерцающая золотая нить защитник → союзник. */
  link(guard: FxAnchor, ward: FxAnchor): void {
    this.links.set(ward, { guard, phase: 0 });
  }

  unlink(ward: FxAnchor): void {
    this.links.delete(ward);
  }

  /** Есть ли связь (для подписи перенаправленного урона). */
  linked(ward: FxAnchor): boolean {
    return this.links.has(ward);
  }

  /** Кадр: dt — мс боя. */
  update(dt: number): void {
    this.clock += dt;
    const g = this.gfx;
    g.clear();
    for (const [target, t] of this.taunts) {
      if (!target.alive) {
        this.untaunt(target);
        continue;
      }
      t.mark.setPosition(target.node.x, target.node.y - target.look.height - 20 + Math.sin(this.clock / 120) * 4);
      if (this.clock < t.lineUntil && t.source.alive) dashed(g, t.source.node.x, t.source.node.y - 60, target.node.x, target.node.y - 60, TAUNT_LINE, 0.9);
    }
    for (const [ward, l] of this.links) {
      if (!ward.alive || !l.guard.alive) {
        this.links.delete(ward);
        continue;
      }
      const a = 0.55 + 0.35 * Math.sin(this.clock / 90 + l.phase);
      const y0 = l.guard.node.y - l.guard.look.height * 0.5;
      const y1 = ward.node.y - ward.look.height * 0.5;
      g.lineStyle(10, LINK_COLOR, a * 0.25).lineBetween(l.guard.node.x, y0, ward.node.x, y1);
      g.lineStyle(3, LINK_COLOR, a).lineBetween(l.guard.node.x, y0, ward.node.x, y1);
      // Щит-крест над союзником под связью.
      g.lineStyle(4, LINK_COLOR, a).strokeCircle(ward.node.x, y1, 26);
      g.lineBetween(ward.node.x, y1 - 16, ward.node.x, y1 + 16).lineBetween(ward.node.x - 12, y1 - 4, ward.node.x + 12, y1 - 4);
    }
  }

  clear(): void {
    for (const t of this.taunts.values()) t.mark.destroy();
    this.taunts.clear();
    this.links.clear();
    this.gfx.clear();
  }
}

/** Пунктир от (x0, y0) к (x1, y1). */
function dashed(g: Phaser.GameObjects.Graphics, x0: number, y0: number, x1: number, y1: number, color: number, alpha: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1) return;
  const dx = (x1 - x0) / len;
  const dy = (y1 - y0) / len;
  g.lineStyle(5, color, alpha);
  for (let s = 0; s < len; s += 28) {
    const e = Math.min(len, s + 16);
    g.lineBetween(x0 + dx * s, y0 + dy * s, x0 + dx * e, y0 + dy * e);
  }
}

/**
 * Засечки фаз на полосе ОЗ босса (видны с начала боя: игрок знает, чего ждать): вертикальные риски на долях pcts.
 * barX — левый край полосы, w — ширина, y — центр.
 */
export function phaseNotches(scene: Phaser.Scene, barX: number, w: number, y: number, pcts: number[]): Phaser.GameObjects.Graphics {
  // Поверх подписи полосы (имя босса стоит ровно на середине — на засечке 50%).
  const g = scene.add.graphics().setDepth(1);
  for (const p of pcts) {
    const x = barX + w * p;
    g.fillStyle(0x000000, 0.8).fillRect(x - 4, y - 22, 8, 44);
    g.fillStyle(0xffe28a, 1).fillRect(x - 2, y - 20, 4, 40);
  }
  return g;
}
