import Phaser from 'phaser';
import { GAME_W } from './layout';
import { portrait } from './screen';
import { portraitKey } from './sprites';
import { text } from './ui';
import { chargeBreakBadge } from './ultBadge';

/**
 * BUG-061 (T3-25). Панель героев в бою — как в AFK Arena: над ареной (там было пустое небо) по карточке на героя
 * отряда: портрет, имя, полоска здоровья и энергии ульты. Павший — тусклый. Данные приходят из BattleScene.redraw
 * (те же числа, что у полосок над головами), сама панель ничего не считает.
 */

export interface PanelUnit {
  uid: string;
  name: string;
  sprite: string;
  /** Есть ульта (копит энергию) — полоска энергии видна. */
  hasUlt: boolean;
  /** Ульта героя (docs/design/battle-decisions.md §1): полоска готовности вместо энергии, касание портрета — ульта. */
  ult?: boolean;
  /** Ульта оглушает / срывает каст — ею сбивают заряд босса: значок-молния в углу портрета (ultBadge.ts). */
  breaks?: boolean;
}

interface Entry {
  node: Phaser.GameObjects.Container;
  hp: Phaser.GameObjects.Rectangle;
  energy: Phaser.GameObjects.Rectangle | null;
  face: Phaser.GameObjects.Image;
  dead: boolean;
  /** Свечение готовой ульты (рамка + ореол) и его пульс. */
  glow: Phaser.GameObjects.Container | null;
  pulse: Phaser.Tweens.Tween | null;
  ready: boolean;
}

/** Центр панели по высоте (между кнопками «1x / Пропустить» и макушками бойцов). */
export const PANEL_Y = 610;
const CARD_W = 184;
const CARD_H = 196;
/** Нижний край панели: плашки навыков и реплики боссов — ниже него (QA RN-05, RN-16). */
export const PANEL_BOTTOM = PANEL_Y + CARD_H / 2;
const GAP = 12;
const FACE = 132;
const BAR_W = CARD_W - 28;

export class HeroPanel {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly scene: Phaser.Scene,
    units: readonly PanelUnit[],
    depth: number,
    onTap?: (uid: string) => void,
  ) {
    const n = units.length;
    const x0 = GAME_W / 2 - ((n - 1) * (CARD_W + GAP)) / 2;
    units.forEach((u, i) => {
      const x = x0 + i * (CARD_W + GAP);
      const back = scene.add.rectangle(0, 0, CARD_W, CARD_H, 0x140e09, 0.8).setStrokeStyle(3, 0xc9a45c, 0.7);
      const face = portrait(scene, 0, -30, portraitKey(u.sprite), FACE);
      const name = text(scene, 0, 42, u.name, 26, '#f3e3c0', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 4 });
      if (name.width > CARD_W - 12) name.setScale((CARD_W - 12) / name.width);
      const hpBack = scene.add.rectangle(0, 68, BAR_W + 4, 16, 0x2a2420, 0.95).setStrokeStyle(2, 0x000000, 0.8);
      const hp = scene.add.rectangle(-BAR_W / 2, 68, BAR_W, 12, 0x5fd35f).setOrigin(0, 0.5);
      const parts: Phaser.GameObjects.GameObject[] = [back, face, name, hpBack, hp];
      // Молния в левом верхнем углу портрета (не под ярлыком «УЛЬТА» по центру сверху).
      if (u.breaks) parts.push(chargeBreakBadge(scene, -CARD_W / 2 + 26, -CARD_H / 2 + 26, 46));
      let energy: Phaser.GameObjects.Rectangle | null = null;
      if (u.hasUlt || u.ult) {
        const enBack = scene.add.rectangle(0, 84, BAR_W + 4, 10, 0x2a2420, 0.95).setStrokeStyle(2, 0x000000, 0.8);
        energy = scene.add.rectangle(-BAR_W / 2, 84, 0, 6, 0x6fc8ff).setOrigin(0, 0.5);
        parts.push(enBack, energy);
      }
      // Готовая ульта: золотая рамка и ореол за портретом (под ним), пульс — пока не нажали.
      let glow: Phaser.GameObjects.Container | null = null;
      if (u.ult) {
        const halo = scene.add.rectangle(0, -30, FACE + 26, FACE + 26, 0xffd84a, 0.35);
        const frame = scene.add.rectangle(0, 0, CARD_W + 8, CARD_H + 8).setStrokeStyle(8, 0xffe070, 1);
        const tag = text(scene, 0, -CARD_H / 2 + 16, 'УЛЬТА', 24, '#3a2408', { fontStyle: 'bold', backgroundColor: '#ffd84a', padding: { x: 8, y: 0 } });
        glow = scene.add.container(0, 0, [halo, frame, tag]).setVisible(false);
        parts.splice(1, 0, glow);
      }
      const node = scene.add.container(x, PANEL_Y, parts).setDepth(depth).setName(`heroPanel_${i}`);
      if (u.ult && onTap) {
        node.setSize(CARD_W, CARD_H).setInteractive({ useHandCursor: true });
        node.on('pointerdown', () => onTap(u.uid));
      }
      this.entries.set(u.uid, { node, hp, energy, face, dead: false, glow, pulse: null, ready: false });
    });
  }

  /** Ульта готова и ждёт касания: свечение и пульс карточки. */
  setReady(uid: string, on: boolean): void {
    const e = this.entries.get(uid);
    if (!e?.glow || e.ready === on || (on && e.dead)) return;
    e.ready = on;
    e.glow.setVisible(on);
    e.pulse?.stop();
    e.pulse = null;
    e.node.setScale(1);
    if (on) {
      e.glow.setAlpha(1);
      e.pulse = this.scene.tweens.add({ targets: e.glow, alpha: 0.45, duration: 480, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.scene.tweens.add({ targets: e.node, scale: 1.06, duration: 160, yoyo: true, ease: 'Quad.easeOut' });
    }
  }

  /** Полоска готовности ульты героя (0…1): доля прошедшей перезарядки; полная — золотая. */
  setCharge(uid: string, p: number): void {
    const e = this.entries.get(uid);
    if (!e?.energy || e.dead) return;
    const c = Phaser.Math.Clamp(p, 0, 1);
    e.energy.width = BAR_W * c;
    e.energy.fillColor = c >= 1 ? 0xffe08a : 0x6fc8ff;
  }

  /** Готова ли ульта героя (карточка светится). */
  isReady(uid: string): boolean {
    return !!this.entries.get(uid)?.ready;
  }

  /** Касание прошло: короткий «нажим» карточки. */
  pressed(uid: string): void {
    const e = this.entries.get(uid);
    if (!e) return;
    this.scene.tweens.add({ targets: e.node, scale: 0.92, duration: 90, yoyo: true, ease: 'Quad.easeOut' });
  }

  /** Середина карточки героя (для подсказки «коснитесь»). */
  cardAt(uid: string): { x: number; y: number; w: number; h: number } | null {
    const e = this.entries.get(uid);
    return e ? { x: e.node.x, y: e.node.y, w: CARD_W, h: CARD_H } : null;
  }

  /** Полоски героя: здоровье и энергия (0…1), жив ли. */
  set(uid: string, hp: number, energy: number, alive: boolean): void {
    const e = this.entries.get(uid);
    if (!e) return;
    const p = Phaser.Math.Clamp(hp, 0, 1);
    e.hp.width = BAR_W * p;
    e.hp.fillColor = p > 0.5 ? 0x5fd35f : p > 0.25 ? 0xe8c547 : 0xe0523a;
    if (e.energy) {
      const full = energy >= 1;
      e.energy.width = BAR_W * Phaser.Math.Clamp(energy, 0, 1);
      e.energy.fillColor = full ? 0xffe08a : 0x6fc8ff;
    }
    if (!alive && !e.dead) {
      this.setReady(uid, false);
      e.dead = true;
      e.node.setAlpha(0.45);
      e.face.setTint(0x777777);
    }
  }
}
