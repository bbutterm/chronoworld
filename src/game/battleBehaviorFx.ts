import Phaser from 'phaser';
import { DEPTH } from './battleFx';
import { text } from './ui';

/**
 * Поведение в бою на экране (docs/design/battle-behavior.md): знак провокации «!» над врагом и красная пунктирная линия
 * к стражу, золотая нить связи крестоносца, засечки фаз на полосе босса и надпись фазы; круг удара мага на земле (растёт
 * с кастом, вспышка в момент удара), цветной круг ауры барда/танцовщицы. Объекты создаются по событиям
 * боя и живут, пока жив статус/связь; update() каждый кадр ставит их к показанным фигурам. Без утечек: clear() на выходе.
 */

/** Показанная фигура: точка ног и высота (как UnitView сцены). */
export interface FxAnchor {
  node: { x: number; y: number };
  look: { height: number };
  alive: boolean;
}

const TAUNT_COLOR = '#ff4a3a';
/** Круги на земле (удар мага, аура барда) — под живыми фигурами (их глубина — y ног, поле от 900), над павшими. */
const GROUND_DEPTH = 850;
const LINK_COLOR = 0xffd66b;
const TAUNT_LINE = 0xff5a4a;

export class BehaviorFx {
  private readonly taunts = new Map<FxAnchor, { mark: Phaser.GameObjects.Text; source: FxAnchor; lineUntil: number }>();
  private readonly links = new Map<FxAnchor, { guard: FxAnchor; phase: number }>();
  /** Круг удара мага: кастер → центр, радиус, цвет стихии, когда начат и сколько длится каст (мс). */
  private readonly areas = new Map<FxAnchor, { x: number; y: number; r: number; color: number; start: number; dur: number }>();
  /** Вспышки удара по кругу: центр, радиус, цвет, когда. */
  private readonly blasts: { x: number; y: number; r: number; color: number; start: number }[] = [];
  /** Ауры бардов: исполнитель → радиус, цвет, вид (ноты / лепестки). */
  private readonly auras = new Map<FxAnchor, { r: number; color: number; petals: boolean }>();
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly ground: Phaser.GameObjects.Graphics;
  private clock = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.gfx = scene.add.graphics().setDepth(DEPTH.fx - 10);
    this.ground = scene.add.graphics().setDepth(GROUND_DEPTH);
  }

  /** Маг начал каст по кругу: круг цвета стихии на земле растёт вместе с полосой каста. */
  castArea(caster: FxAnchor, x: number, y: number, r: number, color: number, durMs: number): void {
    this.areas.set(caster, { x, y, r, color, start: this.clock, dur: Math.max(1, durMs) });
  }

  /** Каст кончился: impact — удар по кругу (вспышка), иначе круг просто гаснет (сорван, пусто). */
  endArea(caster: FxAnchor, impact: boolean): void {
    const a = this.areas.get(caster);
    if (!a) return;
    this.areas.delete(caster);
    if (impact) this.blasts.push({ x: a.x, y: a.y, r: a.r, color: a.color, start: this.clock });
  }

  /** Аура барда/танцовщицы: цветной круг под исполнителем, пока он жив. */
  aura(unit: FxAnchor, r: number, color: number, petals: boolean): void {
    this.auras.set(unit, { r, color, petals });
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
    this.drawGround();
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

  /** Земля: круги ударов магов (растут с кастом), вспышки удара, ауры бардов. Эллипсы — поле в псевдоперспективе. */
  private drawGround(): void {
    const g = this.ground;
    g.clear();
    const SQ = 0.8;
    for (const [caster, a] of this.areas) {
      if (!caster.alive) {
        this.areas.delete(caster);
        continue;
      }
      const k = Math.min(1, (this.clock - a.start) / a.dur);
      const pulse = 0.5 + 0.5 * Math.sin(this.clock / 110);
      g.fillStyle(a.color, 0.1 + 0.08 * k).fillEllipse(a.x, a.y, a.r * 2, a.r * 2 * SQ);
      g.lineStyle(4, a.color, 0.55 + 0.25 * pulse).strokeEllipse(a.x, a.y, a.r * 2, a.r * 2 * SQ);
      const rr = a.r * (0.25 + 0.75 * k);
      g.fillStyle(a.color, 0.18 + 0.2 * k).fillEllipse(a.x, a.y, rr * 2, rr * 2 * SQ);
      g.lineStyle(3, 0xffffff, 0.35 + 0.4 * k).strokeEllipse(a.x, a.y, rr * 2, rr * 2 * SQ);
    }
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      const k = (this.clock - b.start) / 380;
      if (k >= 1) {
        this.blasts.splice(i, 1);
        continue;
      }
      const r = b.r * (1 + 0.25 * k);
      g.fillStyle(b.color, 0.45 * (1 - k)).fillEllipse(b.x, b.y, r * 2, r * 2 * SQ);
      g.lineStyle(8 * (1 - k) + 2, 0xffffff, 0.8 * (1 - k)).strokeEllipse(b.x, b.y, r * 2, r * 2 * SQ);
    }
    for (const [u, a] of this.auras) {
      if (!u.alive) {
        this.auras.delete(u);
        continue;
      }
      const x = u.node.x;
      const y = u.node.y;
      const pulse = 0.5 + 0.5 * Math.sin(this.clock / 260);
      // Владелец 30.09: «аура барда бледновата» — ярче заливка и двойной край; под самим исполнителем — яркое пятно,
      // чтобы было видно, чей это круг (RR-14).
      g.fillStyle(a.color, 0.14 + 0.08 * pulse).fillEllipse(x, y, a.r * 2, a.r * 2 * SQ);
      g.lineStyle(10, a.color, 0.3 + 0.15 * pulse).strokeEllipse(x, y, a.r * 2, a.r * 2 * SQ);
      g.lineStyle(4, 0xffffff, 0.7 + 0.25 * pulse).strokeEllipse(x, y, a.r * 2, a.r * 2 * SQ);
      g.fillStyle(a.color, 0.35 + 0.2 * pulse).fillEllipse(x, y, 150, 150 * SQ);
      g.lineStyle(3, 0xffffff, 0.85).strokeEllipse(x, y, 150, 150 * SQ);
      // По краю бегут ноты (бард) или лепестки (танцовщица).
      const n = 8;
      for (let i = 0; i < n; i++) {
        const ang = this.clock / 1400 + (i * Math.PI * 2) / n;
        const px = x + Math.cos(ang) * a.r;
        const py = y + Math.sin(ang) * a.r * SQ;
        if (a.petals) g.fillStyle(0xffe0f0, 1).fillEllipse(px, py, 22, 12);
        else {
          g.fillStyle(0xffffff, 1).fillCircle(px, py, 8);
          g.lineStyle(4, 0xffffff, 1).lineBetween(px + 7, py, px + 7, py - 22);
        }
      }
    }
  }

  clear(): void {
    for (const t of this.taunts.values()) t.mark.destroy();
    this.taunts.clear();
    this.links.clear();
    this.areas.clear();
    this.blasts.length = 0;
    this.auras.clear();
    this.gfx.clear();
    this.ground.clear();
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
  // RR-04: засечки — только у верхнего и нижнего края полосы (зубцы), середину с именем босса не режут; имя — выше по глубине.
  const g = scene.add.graphics().setDepth(1);
  for (const p of pcts) {
    const x = barX + w * p;
    g.fillStyle(0x000000, 0.85).fillTriangle(x - 9, y - 25, x + 9, y - 25, x, y - 11).fillTriangle(x - 9, y + 25, x + 9, y + 25, x, y + 11);
    g.fillStyle(0xffe28a, 1).fillTriangle(x - 6, y - 23, x + 6, y - 23, x, y - 14).fillTriangle(x - 6, y + 23, x + 6, y + 23, x, y + 14);
  }
  return g;
}
