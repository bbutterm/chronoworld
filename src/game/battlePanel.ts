import Phaser from 'phaser';
import { GAME_W } from './layout';
import { portrait } from './screen';
import { portraitKey } from './sprites';
import { text } from './ui';

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
}

interface Entry {
  node: Phaser.GameObjects.Container;
  hp: Phaser.GameObjects.Rectangle;
  energy: Phaser.GameObjects.Rectangle | null;
  face: Phaser.GameObjects.Image;
  dead: boolean;
}

/** Центр панели по высоте (между кнопками «1x / Пропустить» и макушками бойцов). */
export const PANEL_Y = 610;
const CARD_W = 184;
const CARD_H = 196;
const GAP = 12;
const FACE = 132;
const BAR_W = CARD_W - 28;

export class HeroPanel {
  private entries = new Map<string, Entry>();

  constructor(scene: Phaser.Scene, units: readonly PanelUnit[], depth: number) {
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
      let energy: Phaser.GameObjects.Rectangle | null = null;
      if (u.hasUlt) {
        const enBack = scene.add.rectangle(0, 84, BAR_W + 4, 10, 0x2a2420, 0.95).setStrokeStyle(2, 0x000000, 0.8);
        energy = scene.add.rectangle(-BAR_W / 2, 84, 0, 6, 0x6fc8ff).setOrigin(0, 0.5);
        parts.push(enBack, energy);
      }
      const node = scene.add.container(x, PANEL_Y, parts).setDepth(depth).setName(`heroPanel_${i}`);
      this.entries.set(u.uid, { node, hp, energy, face, dead: false });
    });
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
      e.dead = true;
      e.node.setAlpha(0.45);
      e.face.setTint(0x777777);
    }
  }
}
